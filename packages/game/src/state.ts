// ゲームの状態と行動・月の報告の型（GameState・Action・MonthReport など）。
import type { Choices, FrameworkId, RouteStrategyId, SlotId } from 'catalog';
import type { ActiveCommitment, CommitmentPaymentId } from './commitments.ts';
import type {
  EventKind,
  EventTier,
  Requirement,
  Scenario,
  Scheduled,
  Stock,
  WorkloadMods,
} from './scenario.ts';
import type { LineItem, PlatformPremise } from 'estimator';
import type { PremiseSnapshot } from './trends.ts';
import type { EffortBreakdown, Element, Stages } from './rules.ts';
import type { SettingKey, Settings } from './settings.ts';

/** プレイヤーが選んだページごとの描き方（ルートの id → 描き方。フレームワークの既定と分け方が同じものは持たない。D-107）。 */
export type RouteOverrides = Readonly<Partial<Record<string, RouteStrategyId>>>;

/**
 * ページの部品の選択（段 4・D-109）。今は記事のページのコメント欄の描き方だけ（COMMENTS_IN_BROWSER・COMMENTS_IN_PAGE。D-82 の設定を
 * ルートの部品に移した）。既定（ブラウザで読み込む）は持たない。
 */
export type RoutePartChoice = { comments?: number };

/** ルートの id → ページの部品の選択（D-109）。 */
export type RouteParts = Readonly<Partial<Record<string, RoutePartChoice>>>;

/** ページの部品の種類（行動 route-part の part）。 */
export type RoutePartKey = 'comments';

/**
 * 描き方の分け方（D-107）。S2 と S3 は同じ「キャッシュ」で、期限かオンデマンドかは設定（revalidateSec）で決まる
 * （今までの ISR の再検証・記事のキャッシュの設定のまま。切り替えの手間も今までどおり）。
 */
export type StrategyFamily =
  'static' | 'cached' | 'ssr' | 'api' | 'island' | 'components';

export type Action =
  | { type: 'none' }
  | { type: 'set'; key: SettingKey; value: number }
  | { type: 'optimize' }
  /** 同じ事業者のプランの変更（ほぼ即時・手間なし）。 */
  | { type: 'plan'; stackIndex: number }
  /** 別の事業者への乗り換え（手間・数か月・期間中は新旧両方の費用）。 */
  | { type: 'migrate'; stackIndex: number }
  /** 提案への返事（受ける / 断る）。返事をしなければ断ったことになる。 */
  | { type: 'respond'; eventId: string; accept: boolean }
  /** Bot を遮断するルールを入れる（一度入れれば続く）。 */
  | { type: 'block-bots' }
  /** スロットの部品を差し替える（同じ事業者の中。D-24・prd/07 §11.3）。 */
  | { type: 'component'; slot: SlotId; option: string }
  /** さくらの VPS のストレージ変更オプションを付ける（ディスク 2 倍・手数料一度だけ・戻せない。D-30）。 */
  | { type: 'storage-option' }
  /** アプリを作り直す（フレームワークを替える。大きな手間・数か月。済んだ翌月から新しいフレームワーク。D-81）。 */
  | { type: 'rewrite'; framework: FrameworkId }
  /**
   * ページの描き方を替える（D-107。翌月から）。期限とオンデマンド（S2 ↔ S3）は今までどおり設定（再検証・記事のキャッシュ）で替える。
   */
  | { type: 'route'; route: string; strategy: RouteStrategyId; value?: number }
  /**
   * ページの部品を替える（D-109。翌月から）。今は記事のページのコメント欄の描き方（ブラウザで読み込む / 記事のページに含める）だけ。
   * 前の設定「コメントの描き方」（{ type: 'set', key: 'comments' }）は、保存の読み込みでこれに読み替える。
   */
  | { type: 'route-part'; route: string; part: RoutePartKey; value: number }
  /**
   * 1 年の確約を結ぶ（リザーブドインスタンス・Savings Plans・確約利用割引・年払い。key は provider:planId:id。D-97）。
   * 来月から 12 か月。取り消せず、対象を使わなくなっても支払いは残る。
   */
  | { type: 'commit'; key: string; payment: CommitmentPaymentId };

/** DB の差し替えの進行（データの移行。期間中は新旧の両方の DB の費用）。 */
export type ComponentSwap = {
  slot: SlotId;
  option: string;
  required: number;
  done: number;
};

export type Migration = {
  from: number;
  to: number;
  /** 必要な手間の合計と、入れた手間。 */
  required: number;
  done: number;
};

/**
 * アプリの作り直しの進行（D-81・prd/10 F-06）。作業の間は旧アプリのまま動き（費用・満足度は今のフレームワーク）、
 * 手間を入れ終えた翌月から新しいフレームワークになる。事業者は変わらない。
 */
export type Rewrite = {
  from: FrameworkId;
  to: FrameworkId;
  required: number;
  done: number;
};

export type EndReason = 'won' | 'goal' | 'cash' | 'outages' | 'policy';

/** 月の報告に出す出来事（予告・起きた・提案）。 */
export type MonthEvent = {
  id: string;
  kind: EventKind;
  tier: EventTier;
  phase: 'notice' | 'occurred' | 'proposal';
  title: string;
  text: string;
  /** 効果の要約（PV × 3・手間 +10 / 月 など）。 */
  effects: string[];
  /** 当たりうる前提（今の構成で出ているもの。文は catalog のまま）。 */
  premises: {
    id: string;
    text: string;
    ratio?: number;
    hit: boolean;
    /** どのルートが当たるか（1 リクエストあたりの制限。D-99）。 */
    detail?: string;
  }[];
  /** 席（メンバー）の料金（catalog の members）。 */
  members?: string[];
  /**
   * 予告を持ちうる台本が起きた月: true は予告どおり、false は予告なしで今月起きた（対処は来月から。D-28）。
   */
  announced?: boolean;
  /** 提案の「受ける」の説明。unavailable は受けられない理由（要件を満たせる構成が無い）。 */
  accept?: {
    label: string;
    effects: string[];
    effort: number;
    unavailable?: string;
  };
  /** 今の構成の SLA の扱い（catalog の uptimeSla）。 */
  sla?: string[];
  /** 要件を満たせるか（部品ごと。受ける前に出す。D-32）。 */
  requirementStatus?: {
    label: string;
    ok: boolean;
    reason: string;
    current: boolean;
  }[];
};

/** 前提が境目を初めて越えた月の記録（見込みが外れた理由の材料。prd/07 §10.7）。 */
export type Crossing = {
  premiseId: string;
  text: string;
  /** この出来事が無ければ、今月は越えなかった（反実仮想の見積で確かめた）。 */
  causes: { eventId: string; title: string; ratioWithout: number }[];
};

export type MonthReport = {
  month: number;
  stackName: string;
  buzz: boolean;
  /** 一時的に流量が増えた月の理由（話題・前兆・Bot）。見込みを出さない（§10.7）。 */
  trafficNote?: string;
  /** 見積に入れた PV（Bot を含む）。 */
  pv: number;
  /** 人の PV（収益が付く）と Bot の PV。 */
  humanPV: number;
  botPV: number;
  /** 出来事の倍率を掛ける前の基準の PV。 */
  basePV: number;
  revenue: number;
  /** 動かしている構成のインフラ費用（乗り換え中は新しい構成の分も含む）。 */
  infraCost: number;
  /** うち乗り換え先の構成の費用（乗り換え中だけ）。 */
  parallelInfraCost: number;
  cash: number;
  status: 'ok' | 'down' | 'incident' | 'slow';
  notes: string[];
  events: MonthEvent[];
  crossings: Crossing[];
  /** 規約違反の指摘を受けた月（翌月も違反したままならアカウント停止。D-19）。 */
  policyWarning: boolean;
  /** 当たった前提と、境目の 70% を超えた前提。 */
  premises: PlatformPremise[];
  /** 量の境目がある前提すべての記録（推移と見込みに使う。prd/07 §5）。 */
  snapshots: PremiseSnapshot[];
  lines: {
    /** 行の名前（料金データの label。D-75）。 */
    label: string;
    /** 事業者・行の種類・メーター（名前の文字列から読み取らないためのもの。fee は一度だけの手数料）。 */
    provider: string;
    kind: LineItem['kind'] | 'fee' | 'commitment';
    meterId?: string;
    amount: number;
    currency: string;
    /** 使用量（CloudFront の無効化のパスだけ。次のプレイへのヒントに使う。D-66）。 */
    quantity?: number;
  }[];
  unpricedLines: number;
  settings: Settings;
  ssrCpuMs: number;
  stock: Stock;
  seats: number;
  satisfaction: {
    stages: Stages;
    /** 段階ごとの理由（悪い・普通のときだけ）。 */
    reasons: Partial<Record<Element, string>>;
    score: number;
    reputation: number;
    acquisition: number;
    churn: number;
    growth: number;
    /** 速さが「悪い」で PV の伸びから引いた分（D-47）。 */
    slowPenalty?: number;
  };
  effort: EffortBreakdown;
  /** 今月までの累積の機能ポイント。 */
  featurePoints: number;
  migration?: { toName: string; done: number; required: number };
  /** 作り直しの進行（D-81）。toLabel は新しいフレームワークの名前。 */
  rewrite?: { toLabel: string; done: number; required: number };
  /** その月に動いていたアプリのフレームワーク（作り直しで変わる。D-81）。古い保存の再生でも入る。 */
  framework?: FrameworkId;
  /** その月の部品の選択（D-24）と、画面に出す要約（選べるスロットだけ）。 */
  components: Choices;
  componentSummary: string;
  componentSwap?: { label: string; done: number; required: number };
  /** 契約の収益（SLA の出来事。収益 revenue に含む）。 */
  contractRevenue: number;
  /**
   * 確約の対象になる今月の額（オンデマンド。provider:planId:id ごと・料金データの通貨。D-97）。
   * 来月の「確約する」の可否と、時間あたりの額の確約（Savings Plans・CUD）の額に使う。
   */
  commitmentEligible?: Record<string, number>;
  /** 確約で今月減った額（ドル。割引 − 毎月の支払い − 前払い。前払いの月は負になりうる。D-97）。 */
  commitmentNet?: number;
  action?: string;
};

export type GameState = {
  scenarioId: string;
  /**
   * 遊んでいるシナリオ（newGame に渡した不変の入力）。月の計算はこれだけを読む。
   * 保存するときは scenarioId だけを書き、読み込みで SCENARIOS から引き直す（prd/07 §10.1）。
   */
  scenario: Scenario;
  seed: number; // 偶発的な障害の乱数の内部状態（保存すれば同じ続きになる）
  /** 始めたときのシード（台本の表・基準プレイを同じシードで回すため）。 */
  startSeed: number;
  /** 台本の表（newGame で一度に作る。プレイヤーの選択に依存しない）。 */
  schedule: Scheduled[];
  /** 始めた日（YYYY-MM-DD・画面が渡す。エンジンは時刻に触れない）。改定の出来事の条件に使う（D-21）。 */
  startDate: string;
  /** 実際に予告されている改定の出来事（始めた日が施行日より前のものだけ）と、起きる月。 */
  revisions: { id: string; month: number }[];
  stackIndex: number;
  /**
   * アプリのフレームワーク（始める画面で選ぶ。乗り換えでは変わらない。prd/10 F-04）。
   * 作り直し（D-81）が済むと替わる。
   */
  framework: FrameworkId;
  /** 進行中のアプリの作り直し（D-81）。 */
  rewrite: Rewrite | null;
  /**
   * 選んだページごとの描き方（フレームワークの既定と分け方が違うものだけ。D-107）。古い状態には無い（＝既定のまま）。
   * 作り直しが済むと空に戻り、乗り換えが済むと、乗り換え先で使えないものは外れる。
   */
  routes?: RouteOverrides;
  /**
   * 部品ごとにキャッシュ（Cache Components）を既定にする前の既定で描き方を決める（D-111）。保存の版 3 までの保存を再生するとき
   * だけ true（Vercel × Next.js の既定が ISR・毎回描くだった頃の保存を、同じ結果で再生する）。新しいゲームには無い。
   */
  legacyRouteDefaults?: boolean;
  /**
   * ページの部品の選択（記事のページのコメント欄。既定と違うものだけ。D-109）。古い状態には無い（＝ブラウザで読み込む）。
   * 描き方と違い、作り直し・乗り換えでは戻さない（前の設定「コメントの描き方」と同じ。含められない描き方では効かない）。
   */
  routeParts?: RouteParts;
  /** 部品の選択（今の構成の事業者のスロット。D-24）。 */
  components: Choices;
  /** 進行中の DB の差し替え。 */
  componentSwap: ComponentSwap | null;
  /** 結んだ確約（D-97）。古い状態には無いことがある（無ければ確約なし）。 */
  commitments?: ActiveCommitment[];
  /** 受けた契約（毎月の収益。要件を満たす月だけ入る）。 */
  contracts: { eventId: string; usdPerMonth: number; requires: Requirement }[];
  /** 受けた提案で以後ずっと求められる要件（D-32）。 */
  requirements: Requirement[];
  /** 投稿のときに一律で縮めて置いた（原本の無い）画像の枚数（D-47）。 */
  coarseImages?: number;
  /** 記事のデザインの刷新を受けた（そのときの粗い画像の枚数。以後の投稿は大きく置く。D-47）。 */
  imageRedesign?: { coarseImages: number };
  settings: Settings;
  cash: number;
  basePV: number;
  outages: number;
  featurePoints: number;
  migration: Migration | null;
  /** 次の月が乗り換えの切り替えの月か。 */
  switching: boolean;
  /** 次の月に使う行動の手間。 */
  plannedEffort: number;
  /** 規約違反の指摘を受けた月。 */
  policyWarnedMonth: number | null;
  /** 月の手間の総量（チームが増えると増える）。 */
  effortPerMonth: number;
  /** 足した席（メンバー）の数。 */
  seats: number;
  /** 提案を受けて変わった Workload（以降ずっと）。 */
  mods: WorkloadMods;
  stock: Stock;
  botBlocked: boolean;
  /** さくらの VPS のストレージ変更オプション（付けたら戻せない）と、手数料をまだ払っていないか（D-30）。 */
  storageOption: boolean;
  /** 申し込んだときのプランの手数料（まだ払っていない。払ったら null。OCL-91E46AC4）。 */
  /** label は明細の行の名前（料金データの addon の label。D-75）。 */
  storageOptionFeeDue: { name: string; label?: string; amount: number } | null;
  /** 返事を待っている提案。 */
  pendingProposals: string[];
  responses: Record<string, 'accepted' | 'declined'>;
  /** 一度起きた状態の出来事。 */
  fired: string[];
  /** 出来事への対応の手間（毎月 points を months か月）。 */
  interrupts: {
    points: number;
    months: number;
    eventId: string;
    /** 機能の追加の作業（機能開発に数える）と、毎月の加点（D-29）。 */
    featureWork?: boolean;
    bonus?: number;
  }[];
  /** 成長率への上乗せ（毎月 add を months か月）。 */
  growthBonus: { add: number; months: number }[];
  history: MonthReport[];
  phase: 'playing' | 'won' | 'lost';
  end?: { reason: EndReason; month: number };
};
