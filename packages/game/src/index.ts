// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間、GD-3 でシナリオのデータと出来事を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// シナリオの値（収益・成長・手間・満足度・障害の影響・出来事・目標）はゲーム上の仮定で、実在の値ではない（prd/07 §10）。
import {
  accountsOf,
  apiCacheActive,
  apiPlacedElsewhere,
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  DEFAULT_CHOICES,
  FRAMEWORKS,
  imagesBehavior,
  loadPriceBooks,
  MVP_STACKS,
  SLOT_LABELS,
  frameworkSupported,
  STACK_DEFS,
  toAstro,
  toSpa,
  type Choices,
  type FrameworkId,
  type ComponentProvider,
  type Platform,
  type SlotId,
} from 'catalog';
import {
  estimate,
  type ArchitectureInput,
  type LineItem,
  type PlatformPremise,
  type PriceBook,
  type ScheduledChange,
  type WorkloadInput,
} from 'estimator';
import { nextRandom } from './random.ts';
import {
  allocateEffort,
  buzzLasting,
  EFFORT,
  FLAT_PLAN_ADJUST,
  effectiveSsrCpuMs,
  ELEMENT_LABEL,
  ELEMENTS,
  growthFromReputation,
  judgeStages,
  policyStep,
  reputation,
  satisfactionScore,
  speedHeaviness,
  STAGE_VALUE,
  type EffortBreakdown,
  type Element,
  type Stages,
} from './rules.ts';
import {
  rollRevisions,
  rollSchedule,
  type Effect,
  type EventDef,
  type Requirement,
  type EventKind,
  type EventTier,
  type Scenario,
  type Scheduled,
  type Stock,
  type Strategy,
  type WorkloadMods,
} from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';
import { premiseTrends, type PremiseSnapshot } from './trends.ts';

/** 組み込みのシナリオ（id で引く。保存したゲームを読み込むときに使う）。ゲームの計算はこの表を書き換えない。 */
export const SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  [ARTICLE_COMMUNITY.id]: ARTICLE_COMMUNITY,
  [CONTRACT_OPERATIONS.id]: CONTRACT_OPERATIONS,
});

/** ⚠ 為替は取得していない（仮定）。シナリオによらない共通の仮定。 */
export const USD_JPY = 150;

/** テンプレートの SSR 1 回の CPU（シナリオのテンプレートから読む）。 */
export function baseSsrCpuMsOf(sc: Scenario): number {
  return sc.template(1).routes[0]!.processing.cpuMs;
}

/** 記事コミュニティの値の見え方（画面とテストの互換のため。正はシナリオのデータ）。 */
export const GAME = {
  months: ARTICLE_COMMUNITY.months,
  startPV: ARTICLE_COMMUNITY.scale.startPV,
  startCash: ARTICLE_COMMUNITY.startCash,
  usdJpy: USD_JPY,
  baseSsrCpuMs: baseSsrCpuMsOf(ARTICLE_COMMUNITY),
  goal: ARTICLE_COMMUNITY.goal,
} as const;

export type Settings = {
  /**
   * 画像 1 枚（サイズ違い 1 種）の大きさ（KB）。画像の形式で決まる（JPEG 150・WebP 105・AVIF 84。同じ見た目の画質での比較。D-58）。
   */
  imageKB: number;
  variants: number;
  revalidateSec: number;
  /** SSR の最適化の段数。 */
  ssrOptimizations: number;
};

/** ISR の再検証の設定の「オンデマンド」（revalidateSec の値。時間の間隔はすべて正。D-49）。 */
export const ON_DEMAND_REVALIDATE = 0;

/** 再検証がオンデマンドか（Next.js の ISR の設定。SPA では revalidateSec は API のキャッシュの期間で、0 にならない）。 */
export function isOnDemand(settings: Pick<Settings, 'revalidateSec'>): boolean {
  return settings.revalidateSec === ON_DEMAND_REVALIDATE;
}

/**
 * オンデマンドの最大寿命の説明（設定の ⓘ に出す。D-56）。Next.js の文書（ISR のガイド・2026-10-15 更新）で確かめたのは、
 * タグで再検証するデータに revalidate: 3600 を併せて付けた例（unstable_cache）があることまで。
 */
export const ON_DEMAND_MAX_AGE_NOTE =
  '実際には、再検証の呼び出しの取りこぼし（webhook の失敗・呼び忘れ・外部データの変化）に備えて、時間の再検証（最大寿命）を併せて設定することが多い（1 時間〜1 日など。Next.js の文書の例にも、タグで再検証するデータに revalidate: 3600 を併せて付けたものがある）。このゲームでは 1 日とみなし、その分の再生成も数える';

/**
 * 画像の形式ごとの 1 枚の大きさ（KB。同じ見た目の画質。D-58）。JPEG はテンプレートの 150 KB。
 * WebP: 同等の SSIM の JPEG より 25〜34% 小さい（https://developers.google.com/speed/webp/docs/webp_study ・2025-08-07 更新・
 * 2026-11-01 取得）の中ほどの 30% とする。AVIF: WebP より約 20% 小さい（https://nextjs.org/docs/app/api-reference/components/image
 * の formats・2026-09-28 更新・2026-11-01 取得）。範囲の取り方はゲーム上の仮定。
 */
export const IMAGE_FORMAT_KB = { jpeg: 150, webp: 105, avif: 84 } as const;

/** 画像の形式（設定の値から）。 */
export function imageFormatOf(imageKB: number): 'jpeg' | 'webp' | 'avif' {
  return imageKB <= IMAGE_FORMAT_KB.avif
    ? 'avif'
    : imageKB <= IMAGE_FORMAT_KB.webp
      ? 'webp'
      : 'jpeg';
}

/**
 * Next.js の画像の部品（next/image）で閲覧のときに変換する構成か（Vercel の画像の最適化・VPS の next start）。
 * next/image の formats の既定は WebP で、ブラウザの Accept を見て形式を選ぶ（JPEG は選べない。D-58）。
 */
export function usesNextImage(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): boolean {
  return (
    framework === 'nextjs' &&
    platform !== 'cloudflare' &&
    (images ?? 'default') === 'default'
  );
}

/**
 * 閲覧のときに、ブラウザに合わせた形式（WebP）で配る構成か（D-62）。next/image（usesNextImage）に加えて、
 * Cloudflare Images の閲覧のときの変換（Cloudflare の構成の Images・他の事業者の部品 cf-images）。
 * Cloudflare Images の format=auto は「Automatically serves the most efficient format that the requesting browser supports」
 * （URL の変換。Workers・バインディングでは Accept を見て形式を選ぶ公式の例がある）。AVIF も選びうるが、next/image と揃えて
 * WebP とみなす（AVIF の設定を選べばそちら。推奨案）。images は部品の id（他の事業者の部品は振る舞いで見る）。
 */
export function autoImageFormat(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): boolean {
  return (
    usesNextImage(platform, framework, images) ||
    astroImage(platform, framework, images) ||
    imagesBehavior(platform, images) === 'images'
  );
}

/**
 * Astro の画像の部品（astro:assets の <Image />）で閲覧のときに変換する構成か（Vercel の画像の最適化・VPS の Node）。
 * <Image /> は既定で WebP を作る（「By default, the <Image /> component will produce a .webp file」。D-68）。
 */
function astroImage(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): boolean {
  return (
    framework === 'astro' &&
    platform !== 'cloudflare' &&
    (images ?? 'default') === 'default'
  );
}

/** 戻せる設定（prd/07 §9.5）。値はゲーム上の仮定。 */
export const SETTINGS = {
  format: {
    label: '画像の形式',
    field: 'imageKB',
    effort: EFFORT.setting.format,
    note: '同じ見た目の画質のまま、画像を小さくする形式（転送量・保存量・速さに効き、画質は下がらない）。WebP は同等の SSIM の JPEG より 25〜34% 小さい（Google の WebP の比較の文書）。AVIF は WebP より約 20% 小さいが、変換に約 50% 長くかかる（Next.js の画像の部品の文書）。古いブラウザ向けに JPEG の代わり（フォールバック）を用意するのが推奨（MDN）で、投稿のときに作って置く構成では JPEG も保存する。閲覧のときに変換するサービスはブラウザに合わせて形式を選ぶ（Cloudflare Images の変換の数は形式で増えない・Vercel は形式ごとにキャッシュする）',
    options: [
      { value: IMAGE_FORMAT_KB.jpeg, label: 'JPEG（そのまま）' },
      { value: IMAGE_FORMAT_KB.webp, label: 'WebP' },
      { value: IMAGE_FORMAT_KB.avif, label: 'AVIF' },
    ],
  },
  variants: {
    label: '画像のサイズ違い',
    field: 'variants',
    effort: EFFORT.setting.variants,
    note: '画像変換の件数に効く。1 種だと大きい画像を全端末に配るので遅くなる',
    options: [
      { value: 3, label: '3 種' },
      { value: 2, label: '2 種' },
      { value: 1, label: '1 種' },
    ],
  },
  isr: {
    label: 'ISR の再検証',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note:
      '再生成の回数に効く。間隔を延ばすと記事の更新が遅れて見え、鮮度（満足度）が下がる。オンデマンドは記事の更新のときに再検証する（再生成はおもに更新の回数。ISR のキャッシュの置き場所によっては再検証が届かない。時間からの切り替えは実装の手間がかかる）。' +
      ON_DEMAND_MAX_AGE_NOTE,
    options: [
      {
        value: ON_DEMAND_REVALIDATE,
        label: 'オンデマンド（記事の更新のとき）',
      },
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
  /**
   * SPA の記事の中身の API の応答のキャッシュの期間（s-maxage。D-37）。ISR の間隔と同じ値（revalidateSec）を使う
   * （SPA には ISR が無いので、同じ値をこちらの意味で選ぶ）。
   */
  apiCacheTtl: {
    label: 'API のキャッシュの期間',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note: 'API の応答のキャッシュを使うときだけ効く。延ばすとヒットが増えて取り直しが減るが、記事の更新が遅れて見え、鮮度（満足度）が下がる',
    options: [
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
  /**
   * Astro の静的なページ（記事）をビルドし直す間隔（D-68）。ISR の間隔と同じ値（revalidateSec）を使う
   * （Astro には ISR が無いので、同じ値をこちらの意味で選ぶ）。オンデマンドは記事を更新するたびにビルドする。
   */
  buildInterval: {
    label: 'ビルドの間隔',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note: '記事の投稿・編集をまとめてビルドし直す間隔。ビルドの回数と時間（Workers Builds・Vercel のビルドの料金）に効く。間隔を延ばすと記事の更新が遅れて見え、鮮度（満足度）が下がる。オンデマンドは記事を更新するたびにビルドする（ビルドの時間より短くはまとまらない）',
    options: [
      {
        value: ON_DEMAND_REVALIDATE,
        label: 'オンデマンド（記事の更新のたび）',
      },
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    field: Exclude<keyof Settings, 'ssrOptimizations'>;
    effort: number;
    note: string;
    options: readonly { value: number; label: string }[];
  }
>;
export type SettingKey = keyof typeof SETTINGS;

/** Bot を遮断するルールの手間と効き方（ゲーム上の仮定。製品の料金は未取得。D-20 V-9）。 */
export const BOT_BLOCK = { effort: 2, remaining: 0.5 } as const;

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
  | { type: 'storage-option' };

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
  premises: { id: string; text: string; ratio?: number; hit: boolean }[];
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
    kind: LineItem['kind'] | 'fee';
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
  /** その月の部品の選択（D-24）と、画面に出す要約（選べるスロットだけ）。 */
  components: Choices;
  componentSummary: string;
  componentSwap?: { label: string; done: number; required: number };
  /** 契約の収益（SLA の出来事。収益 revenue に含む）。 */
  contractRevenue: number;
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
  /** アプリのフレームワーク（始める画面で選ぶ。乗り換えでも変わらない。prd/10 F-04）。 */
  framework: FrameworkId;
  /** 部品の選択（今の構成の事業者のスロット。D-24）。 */
  components: Choices;
  /** 進行中の DB の差し替え。 */
  componentSwap: ComponentSwap | null;
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

export function scenarioOf(state: Pick<GameState, 'scenario'>): Scenario {
  return state.scenario;
}

/** シナリオで選べるフレームワーク（省略は Next.js だけ）と既定。 */
export function frameworksOf(sc: Scenario): {
  allowed: FrameworkId[];
  default: FrameworkId;
} {
  return sc.frameworks ?? { allowed: ['nextjs'], default: 'nextjs' };
}

/** フレームワークの既定の部品（SPA は OGP の前処理なし・API の応答のキャッシュなし。prd/10 F-07・D-37）。 */
export function frameworkDefaults(framework: FrameworkId): Choices {
  // API の置き場の既定は同じ事業者（SPA は D-65・Next.js は D-67）
  return framework === 'vite-spa'
    ? { ogp: 'none', apiCache: 'none', api: 'same' }
    : { api: 'same' };
}

/**
 * データの移行を伴う差し替え（DB・API の置き場）。乗り換えと同じく進行中の状態を持ち、手間を入れ終えた翌月に切り替える
 * （期間中は新旧の両方の費用）。API の置き場は DB も一緒に移す（API と DB は同じ事業者。D-65）。
 */
export const isDataSwap = (slot: SlotId): slot is 'db' | 'api' =>
  slot === 'db' || slot === 'api';

/** 差し替えの進行の名前（画面・通知）。 */
export const swapLabel = (slot: SlotId): string =>
  slot === 'api'
    ? 'API の置き場の移し替え（API と DB のデータの移行）'
    : 'DB の差し替え（データの移行）';

/**
 * 今の選択で効かないスロット（出さない）。API を他の事業者に置くと、DB はその事業者の部品になるので、
 * 構成の DB のスロットは出さない（D-65）。
 */
export function slotIneffective(slot: SlotId, choices: Choices): boolean {
  return slot === 'db' && apiPlacedElsewhere(choices);
}

/**
 * 画面に出さず、選べない設定（シナリオで効かないもの + SPA の ISR の間隔・Next.js の API のキャッシュの期間。
 * prd/10・OCL-8DFFDBEC・D-37）。
 */
export function hiddenSettings(
  state: Pick<GameState, 'framework' | 'scenario'>,
): SettingKey[] {
  const fromScenario = state.scenario.hidden?.settings ?? [];
  const byFramework = FRAMEWORK_HIDDEN_SETTINGS[state.framework];
  return [
    ...fromScenario,
    ...byFramework.filter((k) => !fromScenario.includes(k)),
  ];
}

/** フレームワークで意味の無い設定（revalidateSec をフレームワークごとの意味で 1 つだけ出す。D-37・D-68）。 */
const FRAMEWORK_HIDDEN_SETTINGS: Record<FrameworkId, SettingKey[]> = {
  nextjs: ['apiCacheTtl', 'buildInterval'],
  'vite-spa': ['isr', 'buildInterval'],
  astro: ['isr', 'apiCacheTtl'],
};

/** revalidateSec をこのフレームワークで何の設定として出すか（ISR の間隔・API のキャッシュの期間・ビルドの間隔）。 */
export function revalidateSettingOf(framework: FrameworkId): SettingKey {
  return framework === 'vite-spa'
    ? 'apiCacheTtl'
    : framework === 'astro'
      ? 'buildInterval'
      : 'isr';
}

/** 記事ごとの SNS のカードが出ないか（SPA で OGP の前処理なし。prd/10 F-05）。 */
function noSocialCards(
  state: Pick<GameState, 'framework' | 'components'>,
): boolean {
  return state.framework === 'vite-spa' && state.components.ogp !== 'prerender';
}

export function eventDef(sc: Scenario, id: string): EventDef | undefined {
  return sc.events.find((e) => e.id === id);
}

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
  /** 事業者（同じ事業者のあいだはプラン変更。さくらの VPS 2GB ↔ 4GB も含む。D-24）。 */
  provider: STACK_DEFS[i]!.platform as Platform,
  plan: STACK_DEFS[i]!.plan,
  selfHosted: s.nodes.some((n) => n.config.kind === 'host'),
  /** 自分で組む構成（OpenNext など。維持の手間がかかる。D-63）。 */
  assembled: STACK_DEFS[i]!.assembled ?? false,
  /** ホストのディスク（VPS だけ。下位のプランへ変更できるかの判定に使う）。 */
  diskGB: s.nodes.reduce(
    (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
    0,
  ),
}));

/**
 * その構成にフレームワークを載せられるか（catalog の DeployTarget が unsupported でない。Astro は AWS に公式のアダプターが無い。D-68）。
 * 始める画面の構成の一覧と乗り換え先に使う。
 */
export function stackSupports(
  stackIndex: number,
  framework: FrameworkId,
): boolean {
  const s = STACKS[stackIndex];
  return s !== undefined && frameworkSupported(framework, s.provider);
}

/** API を他の事業者に置いたときの、API と DB の名前（D-65・D-67）。 */
const API_PLACEMENT_NAME: Readonly<Record<string, string>> = {
  'cf-workers': 'Cloudflare Workers・D1',
  'aws-lambda': 'AWS Lambda・DynamoDB',
  'cf-workers-server': 'Cloudflare Workers・D1',
  'cf-workers-astro': 'Cloudflare Workers・D1',
  'sakura-vps-2gb': 'さくらの VPS 2GB（API・MySQL）',
  'sakura-vps-4gb': 'さくらの VPS 4GB（API・MySQL）',
};

/** Next.js の構成で API を他の事業者に置いたときの、Next.js を載せている側の名前（D-67）。 */
const NEXT_HOST_NAME: Readonly<Record<string, string>> = {
  'aws-amplify': 'AWS Amplify の Next.js',
  'aws-opennext': 'AWS の OpenNext',
};

/**
 * 構成に自前運用のサーバー（VPS のホスト）があるか。構成そのもの（さくらの VPS）に加えて、部品で VPS を使うとき
 * （Cloudflare の静的 + VPS の API。D-67）も含む。standby（差し替えの途中で新旧の両方を動かしている部品）も数える。
 * serving が true なら、経路に載っている（リクエストを受けている）ホストだけ。
 */
export function selfHostedOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  standby: Choices = {},
  serving = false,
): boolean {
  if (STACKS[stackIndex]!.selfHosted) return true;
  const arch = composeStack(STACK_DEFS[stackIndex]!, components, {
    framework,
    standby,
  });
  const routed = new Set(Object.values(arch.routes).flat());
  return arch.nodes.some(
    (n) => n.config.kind === 'host' && (!serving || routed.has(n.id)),
  );
}

/**
 * 構成の名前（SPA では vinext を使わないので外し、フレームワークを添える。prd/10）。
 * components を渡すと、SPA の API を他の事業者に置いているときは実際の組で出す（例「Vercel Pro の静的 + Cloudflare Workers・D1」。
 * 構成の既定の DB の名前を出さない。D-65）。始める画面の構成の一覧は渡さない（構成の名前のまま）。
 */
/**
 * DB を Neon にした Vercel・Netlify の構成の名前（D-77）。「Supabase Pro」を実際の組「Neon（Launch）」に替える
 * （土台が Hobby・Free なら Neon（Free））。API を他の事業者に置くと DB の名前は使わないので、そのまま。
 */
function withDbName<T extends { name: string; id: string }>(
  s: T,
  components: Choices,
): T {
  if (components.db !== 'neon') return s;
  const free = /-(hobby|free)$/.test(s.id);
  return {
    ...s,
    name: s.name.replace(
      /Supabase (Free|Pro)/,
      `Neon（${free ? 'Free' : 'Launch'}）`,
    ),
  };
}

export function stackName(
  stackIndex: number,
  framework: FrameworkId = 'nextjs',
  /** false なら「（Vite の SPA）」を添えない（フレームワークをすぐ隣で選んでいる始める画面。D-35）。 */
  withFramework = true,
  components: Choices = {},
): string {
  const s = withDbName(STACKS[stackIndex]!, components);
  const api = apiPlacedElsewhere(components)
    ? API_PLACEMENT_NAME[components.api!]
    : undefined;
  // Astro は vinext を使わないので外し、フレームワークを添える（D-68）。API を他の事業者に置くと、Astro を載せている側 + API と DB（D-69）
  if (framework === 'astro') {
    const base = api
      ? `${s.name.split(' + ')[0]} + ${api}`
      : s.name.replace(' + vinext', '');
    return withFramework ? `${base}（Astro）` : base;
  }
  // Next.js のサーバーから別の事業者の API を呼ぶ（D-67）: Next.js を載せている側 + API と DB
  if (framework !== 'vite-spa')
    return api
      ? `${NEXT_HOST_NAME[s.id] ?? s.name.split(' + ')[0]} + ${api}`
      : s.name;
  const base = api
    ? `${s.provider === 'aws' ? 'AWS の S3 + CloudFront' : s.name.split(' + ')[0]} の静的 + ${api}`
    : s.name.replace(' + vinext', '');
  return withFramework ? `${base}（Vite の SPA）` : base;
}

const books = loadPriceBooks();

/** 既定の始めた日（料金データの取得日）。テストと基準プレイの golden はこの日で固定する。 */
export const DEFAULT_START_DATE = '2026-10-31';

/** catalog の施行日つきの予告（id は事業者と施行日）。 */
export const SCHEDULED_CHANGES: (ScheduledChange & {
  id: string;
  provider: string;
})[] = books.flatMap((b) =>
  b.scheduledChanges.map((c) => ({
    ...c,
    id: `revision:${b.provider}:${c.effectiveFrom}`,
    provider: b.provider,
  })),
);

/**
 * その月の料金データ（D-21）。起きた改定のうち、改定後の料金を持つものだけメーターの料金を差し替える。
 * 改定後の料金が無い予告は計算を変えない。同じメーターの改定が複数起きていれば、後に起きたほうを使う。
 */
export function applyRevisions(
  base: readonly PriceBook[],
  changes: readonly (ScheduledChange & { id: string; provider: string })[],
  revisions: readonly { id: string; month: number }[],
  month: number,
): PriceBook[] {
  const occurred = (c: { id: string }) =>
    revisions.find((r) => r.id === c.id && r.month <= month)?.month;
  // 起きた月の順（同じ月なら施行日の順）。後ろの改定が前の改定を上書きする
  const due = changes
    .filter((c) => c.revisedMeters.length > 0 && occurred(c) !== undefined)
    .sort(
      (a, b) =>
        occurred(a)! - occurred(b)! ||
        a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
  if (!due.length) return [...base];
  return base.map((b) => {
    const mine = due.filter((c) => c.provider === b.provider);
    if (!mine.length) return b;
    return {
      ...b,
      plans: b.plans.map((p) => ({
        ...p,
        meters: p.meters.map((m) => {
          const rv = mine
            .flatMap((c) => c.revisedMeters)
            .findLast((x) => x.planId === p.id && x.meterId === m.id);
          return rv ? { ...m, pricing: rv.pricing } : m;
        }),
      })),
    };
  });
}

const booksAt = (state: Pick<GameState, 'revisions'>, month: number) =>
  applyRevisions(books, SCHEDULED_CHANGES, state.revisions, month);

/** 改定の出来事の文（D-21）。計算への影響を正確に書く。 */
export function revisionText(
  c: (typeof SCHEDULED_CHANGES)[number],
  usedByStack: boolean,
): string {
  const effect =
    c.revisedMeters.length > 0
      ? 'あり（改定後の料金を公式の出典つきで持っているので、今月から改定後の料金で計算する）'
      : `なし（${c.notModeledReason}）`;
  return `実際に予告されている改定（${c.provider}・施行日 ${c.effectiveFrom}）: ${c.description}。${usedByStack ? '' : '今の構成では使っていない事業者。'}このモデルの計算への影響: ${effect}`;
}

export { nextRandom };

/** Workload を組み立てる入力（反実仮想の見積でも同じ関数を使う）。 */
export type WorkloadParts = {
  pv: number;
  settings: Settings;
  ssrCpuMs: number;
  mods: WorkloadMods;
  stock: Stock | null;
  platform: Platform;
  components: Choices;
  framework: FrameworkId;
  /** その月のピークの係数の倍率（繁忙期。D-33）。省略は 1。 */
  peakFactor?: number;
  /** 短い期間に集中する上乗せの PV（話題・Bot。容量の判定だけに効く。D-44）。 */
  spikes?: Spike[];
};

/** 月のうち days 日に集中する上乗せの PV（id は出来事。反実仮想で外すときに使う）。 */
export type Spike = { id: string; extraPV: number; days: number };

const DAYS_PER_MONTH = 730 / 24;

/**
 * 集中する上乗せがあるときのピークの係数の倍率（D-44・prd/04 §5）。上乗せ分 E_i が D_i 日に集中し、その日の時間帯の形
 * （ピーク / 平均）はふだんと同じと仮定すると、ピークの時間帯の量は (N + Σ E_i × 30.4 / D_i) / 30.4 日 × ピーク係数
 * （N は集中しない分の PV）。月の PV で割った倍率を返す（課金は月の総量のまま）。
 */
export function spikePeakFactor(pv: number, spikes: readonly Spike[]): number {
  if (pv <= 0 || spikes.length === 0) return 1;
  const extra = spikes.reduce((a, s) => a + s.extraPV, 0);
  const steady = Math.max(0, pv - extra);
  const peakDay = spikes.reduce(
    (a, s) =>
      a + s.extraPV * (DAYS_PER_MONTH / Math.min(s.days, DAYS_PER_MONTH)),
    0,
  );
  return Math.max(1, (steady + peakDay) / pv);
}

/**
 * オンデマンドの再検証に併せて持つとみなす最大寿命（保険の時間の再検証・秒）。再検証の呼び出しの取りこぼし
 * （webhook の失敗・呼び忘れ・外部データの変化）に備えて、時間の再検証を併せて設定することが多い（1 時間〜1 日など）。
 * 選択肢にはせず、長い側の 1 日とみなす（ゲーム上の仮定。D-56）。
 */
export const ON_DEMAND_MAX_AGE_SEC = 86_400;

/**
 * オンデマンドの再検証で、1 回の内容の更新ごとに再検証を呼ぶページの数（その記事のページと、記事が並ぶ一覧）。
 * CDN のキャッシュの無効化の数に効く（OpenNext の CloudFront。再生成の回数には効かない）。ゲーム上の仮定（D-66）。
 */
export const ON_DEMAND_PAGES_PER_UPDATE = 2;

/**
 * 月の内容の更新の回数（記事のページを作り直す更新。API の書き込み × シナリオの pageUpdateShare。D-49・D-70）。
 * オンデマンドの再検証の再生成・無効化と、Astro のビルドし直しの数のもと。
 */
function onDemandUpdates(sc: Scenario, pv: number, w: WorkloadInput): number {
  return pv * w.perPage.apiCalls * w.api.writesPerCall * sc.pageUpdateShare;
}

export function workloadFor(sc: Scenario, p: WorkloadParts): WorkloadInput {
  const w = sc.template(Math.round(p.pv));
  const ssr = p.mods.ssrShare;
  w.routes = w.routes.map((r) => ({
    ...r,
    processing: { ...r.processing, cpuMs: p.ssrCpuMs },
    ...(r.rendering === 'isr'
      ? { revalidateSeconds: p.settings.revalidateSec }
      : {}),
    ...(ssr !== undefined
      ? { share: r.rendering === 'ssr' ? ssr : 1 - ssr }
      : {}),
    ...(p.stock && r.rendering === 'isr'
      ? { pages: p.stock.articlePages }
      : {}),
  }));
  const nextImage = autoImageFormat(
    p.platform,
    p.framework,
    { ...DEFAULT_CHOICES[p.platform], ...p.components }.images,
  );
  w.images = {
    ...w.images,
    sizeKB: deliveredImageKB(sc, p.settings, undefined, nextImage),
    variants: p.settings.variants,
    uploadsPerMau: w.images.uploadsPerMau * (p.mods.uploadsFactor ?? 1),
    ...(p.stock
      ? { storedGB: p.stock.imagesGB, distinct: Math.round(p.stock.images) }
      : {}),
  };
  if (p.mods.imagesPerPage !== undefined)
    w.perPage = { ...w.perPage, images: p.mods.imagesPerPage };
  if (p.mods.writesPerCall !== undefined)
    w.api = { ...w.api, writesPerCall: p.mods.writesPerCall };
  if (p.stock) w.db = { ...w.db, sizeGB: p.stock.dbGB };
  if (p.mods.realtime) w.realtime = p.mods.realtime;
  if (p.mods.apiCpuMs !== undefined)
    w.api = { ...w.api, cpuMs: p.mods.apiCpuMs };
  if (p.mods.apiResponseKB !== undefined)
    w.api = { ...w.api, responseKB: p.mods.apiResponseKB };
  // オンデマンドの再検証（D-49）: 再生成の回数は、時間でなく内容の更新の回数から出す
  if (isOnDemand(p.settings)) {
    const updates = onDemandUpdates(sc, p.pv, w);
    w.routes = w.routes.map((r) => {
      if (r.rendering !== 'isr') return r;
      const { revalidateSeconds: _, ...rest } = r;
      return {
        ...rest,
        onDemandUpdatesPerMonth: updates,
        onDemandMaxAgeSeconds: ON_DEMAND_MAX_AGE_SEC,
        onDemandPagesPerUpdate: ON_DEMAND_PAGES_PER_UPDATE,
      };
    });
  }
  // 話題・Bot の上乗せが短い期間に集中する月: その日の量はピークの時間帯（容量。D-44）と、日次の無料枠の判定（D-60）に効く
  const spikeDay = spikePeakFactor(p.pv, p.spikes ?? []);
  const peak = (p.peakFactor ?? 1) * spikeDay;
  if (peak !== 1)
    w.traffic = {
      ...w.traffic,
      peakHourFactor: w.traffic.peakHourFactor * peak,
    };
  if (spikeDay > 1) w.traffic = { ...w.traffic, peakDayFactor: spikeDay };
  // SPA は ISR・SSR のページを、シェル + データの API に書き換える（prd/10 F-01）。
  // API の応答をキャッシュするなら、記事（ISR だったルート）の中身の API に期間（ISR の間隔と同じ値）を付ける（D-37）
  const shape = sc.frameworks?.spa?.shape;
  const cache = apiCacheActive(p.platform, p.components, p.framework);
  // Astro は記事（ISR だったルート）を静的なページにし、更新をビルドし直しで反映する（D-68）。ビルドを起こす更新は
  // オンデマンドの再検証と同じ数え方の内容の更新、間隔は revalidateSec（オンデマンドは更新のたび）
  const astro = sc.frameworks?.astro?.shape;
  const app =
    p.framework === 'vite-spa' && shape
      ? toSpa(w, shape, cache ? { cacheContent: true } : {})
      : p.framework === 'astro' && astro
        ? toAstro(w, astro, {
            updatesPerMonth: onDemandUpdates(sc, p.pv, w),
            ...(isOnDemand(p.settings)
              ? {}
              : { intervalSeconds: p.settings.revalidateSec }),
          })
        : w;
  // 部品が Workload の側を変えるもの（キャッシュしない・サイズ違いを作る時・最適化しない。D-24）
  const out = applyComponentsToWorkload(app, p.platform, p.components, {
    originalImageKB: sc.unoptimizedImageKB,
    resizedImageKB: deliveredImageKB(sc, p.settings, 'resize'),
  });
  return withImageFormat(out, p);
}

/**
 * 画像の形式の損の側（D-58）。変換の件数（サイズ違いの数）で表す。値の倍率は出典の文から取ったゲーム上の近似。
 * - Vercel の next/image で AVIF: AVIF と WebP を形式ごとにキャッシュする（Next.js の文書）→ 変換を 2 倍に数える
 *   （ほぼすべてのブラウザが AVIF を受けるが、WebP の版も一度は作られると読む）。
 * - VPS のホストで変換して AVIF: 変換に約 50% 長くかかる（Next.js の文書）→ 変換の件数を 1.5 倍（CPU の重さとして）。
 * - 投稿のときにサイズ違いを作る（R2）で WebP・AVIF: JPEG のフォールバックも作って置く（MDN）→ 変換と保存を 2 倍
 *   （フォールバックの大きさは同じとみなす近似）。
 * - Cloudflare Images（閲覧のときに変換）は形式で変換の数が増えない（料金の文書: format は一意の判定から除く）。
 */
function withImageFormat(w: WorkloadInput, p: WorkloadParts): WorkloadInput {
  const format = imageFormatOf(p.settings.imageKB);
  if (format === 'jpeg') return w;
  const images = { ...DEFAULT_CHOICES[p.platform], ...p.components }.images;
  // OpenNext の画像の最適化（Lambda）: CloudFront の外れた分ごとに変換するので、変換 1 回の時間を 1.5 倍にする（OCL-ECDEF8A1・D-63）
  if (
    format === 'avif' &&
    p.platform === 'aws-opennext' &&
    usesNextImage(p.platform, p.framework, images)
  )
    return { ...w, images: { ...w.images, transformWorkFactor: 1.5 } };
  const factor =
    images === 'r2-variants'
      ? 2
      : format === 'avif' && usesNextImage(p.platform, p.framework, images)
        ? p.platform === 'vercel'
          ? 2
          : 1.5
        : format === 'avif' && p.platform === 'sakura' && images === 'default'
          ? 1.5
          : 1;
  return factor === 1
    ? w
    : { ...w, images: { ...w.images, variants: w.images.variants * factor } };
}

/** テンプレートの値から在庫の初期値を作る。 */
export function initialStock(sc: Scenario): Stock {
  const w = sc.template(sc.scale.startPV);
  return {
    dbGB: w.db.sizeGB,
    imagesGB: w.images.storedGB,
    images: w.images.distinct,
    articlePages: w.routes.find((r) => r.rendering === 'isr')?.pages ?? 0,
  };
}

/** 部品の選択と席を足した構成（席課金のプランだけ費用が変わる）。standby は差し替えの途中の新しい部品。 */
function architectureFor(
  stackIndex: number,
  seats: number,
  framework: FrameworkId,
  components: Choices = {},
  standby: Choices = {},
  storageOption = false,
): ArchitectureInput {
  const stack = composeStack(STACK_DEFS[stackIndex]!, components, {
    standby,
    storageOption,
    framework,
  });
  if (seats <= 0) return stack;
  const ids = [
    ...new Set(
      stack.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
  return { ...stack, accounts: ids.map((id) => ({ id, seats: 1 + seats })) };
}

const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / USD_JPY;

/** 明細の行の名前。料金データの label があればそれ（D-75）、無ければ ID から作る（架空の料金など）。 */
function lineLabel(l: LineItem): string {
  if (l.label) return l.label;
  if (l.kind === 'base-fee')
    return `${l.priceRef.provider} ${l.priceRef.planId} 基本料`;
  if (l.kind === 'credit') return `${l.priceRef.provider} クレジット`;
  return `${l.priceRef.provider} ${l.priceRef.meterId}`;
}

/** 構成が使うプランのメンバー（席）の料金の文（catalog の members）。 */
export function membersOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.members) out.add(plan.members.premise);
  }
  return [...out];
}

/** 構成が要件を満たすか。uptime-sla: 課金先のプランがすべて稼働率の SLA を持つ（catalog の uptimeSla）。 */
export function meetsRequirement(
  stackIndex: number,
  requirement: Requirement,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): boolean {
  switch (requirement) {
    case 'on-demand-isr':
      return onDemandBlocker(stackIndex, components, framework) === undefined;
    case 'uptime-sla': {
      const plans = composeStack(STACK_DEFS[stackIndex]!, components)
        .nodes.flatMap((n) => (n.billing ? [n.billing] : []))
        .map((b) =>
          books
            .find((x) => x.provider === b.provider)
            ?.plans.find((p) => p.id === b.planId),
        );
      return (
        plans.length > 0 &&
        plans.every((p) => p?.uptimeSla?.status === 'offered')
      );
    }
  }
}

/** 今の構成のプラン変更で要件を満たせるか（受けられない提案の判定）。 */
export function requirementReachable(
  stackIndex: number,
  requirement: Requirement,
  framework: FrameworkId = 'nextjs',
): boolean {
  return STACKS.some(
    (s) =>
      s.provider === STACKS[stackIndex]!.provider &&
      meetsRequirement(s.index, requirement, {}, framework),
  );
}

const REQUIREMENT_LABEL: Record<Requirement, string> = {
  'uptime-sla': '稼働率の SLA があるプラン',
  'on-demand-isr': '即時反映（オンデマンド ISR）',
};

/** catalog の事実を「provider:planId:factId」で引く。 */
function factByRef(ref: string) {
  const [provider, planId, factId] = ref.split(':');
  return books
    .find((b) => b.provider === provider)
    ?.plans.find((p) => p.id === planId)
    ?.facts.find((f) => f.id === factId);
}

/** 即時反映を妨げている部品（無ければ undefined）。理由は catalog の事実の文（D-32）。 */
/** 前段の CDN が ISR のページ（HTML）を実際にキャッシュするか（HTML もキャッシュ × ISR のキャッシュが有効）。 */
function htmlCachedAtFront(c: Choices): boolean {
  return c.frontCdn === 'html' && c.isrCache !== 'none';
}

function onDemandBlocker(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): { slot: SlotId; label: string; reason: string } | undefined {
  // SPA は ISR を持たず、ページの中身を毎回 API で読むので、いつも即時に反映される（prd/10）
  if (framework === 'vite-spa') return undefined;
  // Astro は記事を更新するたびにビルドし直せる（ビルドの数分は待つ。即時反映とみなすのはゲーム上の仮定。D-68）
  if (framework === 'astro') return undefined;
  const platform = STACKS[stackIndex]!.provider;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[]) {
    // ISR をキャッシュしない（毎回 SSR）なら、前段の CDN に HTML のキャッシュは載らない（OCL-490F1874）
    if (slot === 'frontCdn' && !htmlCachedAtFront(c)) continue;
    const opt = componentsOf(platform, slot).find((o) => o.id === c[slot]);
    if (opt?.onDemandIsr && !opt.onDemandIsr.ok)
      return {
        slot,
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
      };
  }
  return undefined;
}

/**
 * 要件を満たせるかを、今の事業者の部品ごとに並べる（受ける前のカードに出す。D-32）。
 * 今の部品の組み合わせと、要件にかかわるスロットの選択肢それぞれ。
 */
export function requirementStatus(
  stackIndex: number,
  components: Choices,
  requirement: Requirement,
  framework: FrameworkId = 'nextjs',
): { label: string; ok: boolean; reason: string; current: boolean }[] {
  if (requirement !== 'on-demand-isr') return [];
  if (framework === 'vite-spa')
    return [
      {
        label: 'Vite の SPA',
        ok: true,
        reason: 'ISR を持たず、ページの中身を毎回 API で読む',
        current: true,
      },
    ];
  if (framework === 'astro')
    return [
      {
        label: 'Astro',
        ok: true,
        reason:
          '記事を更新するたびにビルドし直す（ビルドの数分は待つ。ゲーム上の仮定）。ビルドの回数と時間が増える',
        current: true,
      },
    ];
  const platform = STACKS[stackIndex]!.provider;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  const out: {
    label: string;
    ok: boolean;
    reason: string;
    current: boolean;
  }[] = [];
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[])
    for (const opt of componentsOf(platform, slot)) {
      if (!opt.onDemandIsr) continue;
      out.push({
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        ok: opt.onDemandIsr.ok,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
        current: c[slot] === opt.id,
      });
    }
  return out;
}

/** 構成が使うプランの SLA の扱いの文（catalog の uptimeSla）。 */
export function slaOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.uptimeSla) out.add(plan.uptimeSla.premise);
  }
  return [...out];
}

/** 乗り換えた先の部品の選択（既定。チャットを持っていれば Durable Objects を付ける。D-24 X-9）。 */
function componentsAfterMigration(
  to: number,
  mods: WorkloadMods,
  framework: FrameworkId,
): Choices {
  const platform = STACKS[to]!.provider;
  const base = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(framework),
  };
  if (mods.realtime && platform === 'cloudflare')
    base.realtime = 'durable-objects';
  return base;
}

function withoutRealtime(mods: WorkloadMods): WorkloadMods {
  const out = { ...mods };
  delete out.realtime;
  return out;
}

/** その事業者で、今の部品の選択がリアルタイムを持てるか（チャットを受けたあと）。 */
function realtimeSupported(platform: Platform): boolean {
  return componentsOf(platform, 'realtime').length > 0;
}

export function componentLabel(
  platform: Platform,
  slot: SlotId,
  option: string | undefined,
): string {
  return (
    componentsOf(platform, slot).find((c) => c.id === option)?.label ??
    option ??
    '—'
  );
}

/** 今の構成のプランのストレージ変更オプション（さくらの VPS だけ。catalog の addons。D-30）。 */
export function storageOptionAddon(stackIndex: number) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const a = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.addons.find((x) => x.id === 'storage-change');
    if (a) return a;
  }
  return undefined;
}

/** ストレージ変更オプションの選択肢の文（名前・メタ情報・説明）。VPS でなければ undefined。 */
export function storageOptionText(
  stackIndex: number,
): { name: string; meta: string[]; detail: string } | undefined {
  const addon = storageOptionAddon(stackIndex);
  if (!addon) return undefined;
  const disk = (option: boolean) =>
    composeStack(
      STACK_DEFS[stackIndex]!,
      {},
      { storageOption: option },
    ).nodes.reduce(
      (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
      0,
    );
  const scaleUp = STACKS.filter(
    (x) => x.provider === STACKS[stackIndex]!.provider,
  )
    .map((x) => stackFact(x.index, 'scale-up'))
    .find((f) => f !== undefined);
  return {
    name: 'ストレージ変更オプションを付ける',
    meta: [
      `ディスク ${disk(false)} → ${disk(true)} GB`,
      `手数料 ${addon.oneTimeFee.toLocaleString('ja-JP')} 円（一度だけ）`,
      `手間 ${EFFORT.storageOption}`,
      '来月から',
    ],
    detail: `${addon.premise}。申し込みはスケールアップと同じ手順で、${scaleUp?.premise ?? 'サーバーを停止して行う'}。計画的な短い停止なので、止まった月には数えない。戻せない（${addon.interpretation?.adopted ?? ''}）。性能差はこの計算に入れていない。上位のプランへ変更してもオプションは残るとみなす（公式に記載なし）。乗り換え・契約し直しでは外れる。`,
  };
}

/** 同じ事業者のプランの変更か（Cloudflare Free ↔ Paid・Vercel Hobby ↔ Pro）。 */
export function isPlanChange(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    !isRecontract(from, to)
  );
}

/** 構成のプランが持つ事実（catalog の Plan の facts）。 */
function stackFact(stackIndex: number, factId: string) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const f = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.facts.find((x) => x.id === factId);
    if (f) return f;
  }
  return undefined;
}

/**
 * 同じ事業者でも、下位のプランへは変更できず契約し直す（さくらの VPS は今よりディスクが少ないプランへ変更できない。D-27）。
 * 乗り換えと同じ仕組み（手間・期間・新旧両方の費用）で扱う。
 */
export function isRecontract(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    STACKS[to]!.diskGB < STACKS[from]!.diskGB &&
    stackFact(from, 'no-smaller-disk') !== undefined
  );
}

/** プラン変更の手間（さくらの VPS の上位への変更は停止とディスクの拡張の作業がある。D-27）。 */
export function planChangeEffort(from: number): number {
  return stackFact(from, 'scale-up') ? EFFORT.scaleUp : EFFORT.plan;
}

/** 乗り換えに必要な手間の合計（VPS が絡むと長い。下位のプランへの契約し直しは別の値）。 */
export function migrationEffort(from: number, to: number): number {
  const m = EFFORT.migrationMonths;
  const months = isRecontract(from, to)
    ? m.recontract
    : STACKS[from]!.selfHosted || STACKS[to]!.selfHosted
      ? m.selfHosted
      : m.serverless;
  return months * EFFORT.migrationPerMonth;
}

/**
 * 構成を変える選択肢（プラン変更・契約し直し・乗り換え）。label は判断に直接効く数だけの短い文、
 * detail は理由・事実の説明（画面の ⓘ に出す。前提の文は catalog の facts）。
 */
export function stackChangeText(
  from: number,
  to: number,
  framework: FrameworkId = 'nextjs',
  /** 今の部品（プラン変更は部品を引き継ぐので、API の置き場を名前に出す。乗り換えは既定の部品に戻る。D-65）。 */
  components: Choices = {},
): { name: string; meta: string[]; detail: string } {
  const target = stackName(
    to,
    framework,
    true,
    isPlanChange(from, to) ? components : {},
  );
  const months = migrationEffort(from, to) / EFFORT.migrationPerMonth;
  const per = EFFORT.migrationPerMonth;
  const both = '期間中は新旧両方の費用';
  if (isPlanChange(from, to)) {
    const effort = planChangeEffort(from);
    const fact = stackFact(from, 'scale-up');
    return effort === 0
      ? {
          name: `${target} にプラン変更`,
          meta: ['手間なし', '来月から'],
          detail:
            '同じ事業者のプランの変更。上限と込み分が変わり、来月から効く。',
        }
      : {
          name: `${target} にプラン変更`,
          meta: [`手間 ${effort}`, '来月から'],
          detail: `${fact?.premise ?? ''}。計画的な短い停止なので、止まった月には数えない。`,
        };
  }
  if (isRecontract(from, to))
    return {
      name: `${target} へ契約し直す`,
      meta: [`${per} × ${months} か月`, both],
      detail: `${stackFact(from, 'no-smaller-disk')!.premise}。新しく契約してデータを移す間は、新旧両方を動かして両方の費用を払う。`,
    };
  return {
    name: `${target} へ乗り換える`,
    meta: [`${per} × ${months} か月`, both],
    detail:
      '別の事業者へ移す。作業の間は新旧両方の構成を動かして両方の費用を払い、済んだ翌月に切り替わる（その月は収益が少し減る）。部品は乗り換え先の既定の選択から始まる。',
  };
}

/**
 * 構成ごとの維持の手間（毎月）。自前運用（VPS）はシナリオの値、自分で組む構成（OpenNext）は EFFORT.assembledUpkeep、
 * マネージドなら 0。始める画面の手間のバーにも使う（D-36・D-63）。
 */
export function upkeepOf(
  sc: Scenario,
  stackIndex: number,
  /** 部品（VPS を部品として使うときも自前運用の維持がかかる。D-67）。省略は構成の既定。 */
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  standby: Choices = {},
): number {
  const s = STACKS[stackIndex]!;
  return selfHostedOf(stackIndex, components, framework, standby)
    ? sc.effort.selfHostedUpkeep
    : s.assembled
      ? EFFORT.assembledUpkeep
      : 0;
}

/** 課金のアカウントの画面の名前（D-52）。 */
const ACCOUNT_LABEL: Readonly<Record<string, string>> = {
  cloudflare: 'Cloudflare',
  vercel: 'Vercel',
  aws: 'AWS',
  supabase: 'Supabase',
  netlify: 'Netlify',
  neon: 'Neon',
  sakura: 'さくらのクラウド',
};
export const accountLabel = (id: string) => ACCOUNT_LABEL[id] ?? id;

/** 構成の課金のアカウント（部品の選択で増える。D-52）。 */
export function accountsFor(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): string[] {
  return accountsOf(
    composeStack(STACK_DEFS[stackIndex]!, components, { framework }),
  );
}

/**
 * 部品の選択で、構成の既定より増えた事業者のアカウント（D-52・AX-11）。Vercel Pro + Supabase Pro の Supabase のように
 * 構成の既定に含まれるアカウントは数えない。Cloudflare + Hyperdrive の Supabase・VPS の前段の CDN の Cloudflare・
 * Vercel の画像の Cloudflare は数える。
 */
export function addedAccounts(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): string[] {
  const base = accountsFor(stackIndex, {}, framework);
  return accountsFor(stackIndex, components, framework).filter(
    (a) => !base.includes(a),
  );
}

/** 他の事業者の管理の毎月の手間（増えたアカウント 1 つにつき EFFORT.accountUpkeep。ゲーム上の仮定・D-52）。 */
export function accountUpkeepOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): number {
  return (
    addedAccounts(stackIndex, components, framework).length *
    EFFORT.accountUpkeep
  );
}

const accountUpkeepFor = (
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
) => accountUpkeepOf(state.stackIndex, state.components, state.framework);

/** その部品に替えると新しく増えるアカウント（差すときの一度きりの手間が付く。D-52）。 */
export function newAccountsBy(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: SlotId,
  option: string,
): string[] {
  const now = accountsFor(state.stackIndex, state.components, state.framework);
  return accountsFor(
    state.stackIndex,
    { ...state.components, [slot]: option },
    state.framework,
  ).filter((a) => !now.includes(a));
}

/** 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品の id。D-52）。 */
function imagesOf(
  state: Pick<GameState, 'stackIndex' | 'components'>,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  return imagesBehavior(
    platform,
    { ...DEFAULT_CHOICES[platform], ...state.components }.images,
  );
}

/**
 * 動いている構成（乗り換え中は新旧両方）の維持の手間。両方が自前運用でも 1 回分。今の構成は部品（差し替えの途中の新しい部品を含む）
 * で VPS を使うときも自前運用（D-67）。乗り換え先は既定の部品から始まる。
 */
function upkeepFor(
  state: Pick<
    GameState,
    | 'stackIndex'
    | 'migration'
    | 'scenario'
    | 'components'
    | 'framework'
    | 'componentSwap'
  >,
) {
  const sc = scenarioOf(state);
  const swap = state.componentSwap;
  return Math.max(
    upkeepOf(
      sc,
      state.stackIndex,
      state.components,
      state.framework,
      swap ? { [swap.slot]: swap.option } : {},
    ),
    ...(state.migration
      ? [
          upkeepOf(
            sc,
            state.migration.to,
            frameworkDefaults(state.framework),
            state.framework,
          ),
        ]
      : []),
  );
}

function migrationWanted(m: Migration | null): number {
  return m ? Math.min(EFFORT.migrationPerMonth, m.required - m.done) : 0;
}

function swapWanted(s: ComponentSwap | null): number {
  return s ? Math.min(EFFORT.dbSwap.perMonth, s.required - s.done) : 0;
}

const interruptOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && !i.featureWork ? i.points : 0),
    0,
  );
const featureWorkOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? i.points : 0),
    0,
  );
const featureBonusOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? (i.bonus ?? 0) : 0),
    0,
  );

/** 次の月に、まだ行動に使える手間。 */
export function effortAvailable(state: GameState): number {
  return (
    state.effortPerMonth -
    upkeepFor(state) -
    accountUpkeepFor(state) -
    interruptOf(state) -
    featureWorkOf(state) -
    migrationWanted(state.migration) -
    swapWanted(state.componentSwap) -
    state.plannedEffort
  );
}

/** 次の月の SSR の CPU（今月までの機能開発で重くなった分を含む）。 */
export function nextSsrCpuMs(state: GameState): number {
  return effectiveSsrCpuMs(
    baseSsrCpuMsOf(scenarioOf(state)),
    state.settings.ssrOptimizations,
    state.featurePoints,
  );
}

/** 今の状態で要る効果（再検証がすでにオンデマンドなら、切り替えの作業を除く。D-49）。 */
function effectsFor(
  state: Pick<GameState, 'framework' | 'settings'>,
  effects: readonly Effect[],
): Effect[] {
  const already = state.framework !== 'vite-spa' && isOnDemand(state.settings);
  return effects.filter(
    (e) => !(e.type === 'interrupt' && e.unlessOnDemand && already),
  );
}

const acceptEffort = (def: EventDef, state: GameState) =>
  effectsFor(state, def.accept?.effects ?? []).reduce(
    (a, e) =>
      a +
      (e.type === 'interrupt'
        ? e.points
        : e.type === 'imageRedesign'
          ? imageRedesignEffort(state)
          : 0),
    0,
  );

/**
 * 記事のデザインの刷新を受ける手間（D-47・ゲーム上の仮定）。原本を配っている（最適化しない）なら 0、
 * 一律で縮めて原本が無いなら 2（これからの投稿だけ大きくする作業）、原本があるなら 1。
 */
function imageRedesignEffort(state: GameState): number {
  const images = imagesOf(state);
  // 今の部品が原本を配っていても、一律で縮めて置いた原本の無い画像が多く残っていれば、一律で縮めた構成と同じ（OCL-0A3AC32F）
  if (images === 'none') return hasManyCoarseImages(state) ? 2 : 0;
  return images === 'resize' ? 2 : 1;
}

/**
 * 一律で縮めて置いた原本の無い画像が、在庫の coarseShare 以上残っているか（D-47）。部品を替えても、
 * それまでに縮めて置いた画像は大きくできない（OCL-0A3AC32F）。
 */
function hasManyCoarseImages(state: GameState): boolean {
  const rule = scenarioOf(state).imageRedesign;
  if (!rule || state.stock.images <= 0) return false;
  return (state.coarseImages ?? 0) / state.stock.images >= rule.coarseShare;
}

/** 記事のデザインの刷新の提案の id（D-47）。 */
export const IMAGE_REDESIGN_ID = 'p-image-redesign';

/**
 * 記事のデザインの刷新で、今月の画質を 1 段下げる理由（下げないなら undefined。D-47・ゲーム上の仮定）。
 * 断った: 断った後の declineMonths か月（原本を配っている構成は画像が既に大きいので下げない）。
 * 受けた: 原本の無い粗い画像が在庫の coarseShare 以上ある間。
 */
function imageRedesignQuality(
  state: GameState,
  sc: Scenario,
  month: number,
  images: string | undefined,
): string | undefined {
  const rule = sc.imageRedesign;
  if (!rule) return undefined;
  const res = state.responses[IMAGE_REDESIGN_ID];
  const at = state.schedule.find((x) => x.id === IMAGE_REDESIGN_ID)?.month;
  if (
    res === 'declined' &&
    at !== undefined &&
    // 原本を配っている構成は既に大きいので下げない。ただし原本の無い画像が多く残っていれば下げる（OCL-0A3AC32F）
    (images !== 'none' || hasManyCoarseImages(state)) &&
    month > at &&
    month <= at + rule.declineMonths
  )
    return '記事のデザインの刷新を断った（大きな画面で画像が小さく粗く見える）';
  if (state.imageRedesign && state.stock.images > 0) {
    const share = state.imageRedesign.coarseImages / state.stock.images;
    if (share >= rule.coarseShare)
      return `原本の無い粗い画像が在庫の ${Math.round(share * 100)}%（一律で縮めて置いた画像は、後から大きくできない）`;
  }
  return undefined;
}

/**
 * 設定が今の部品では効かない理由（効くなら undefined）。画像のサイズ違いは、最適化しない・一律で縮めて置く部品では
 * 作らない（1 種を配る）ので効かない（D-47）。画面は選択肢を無効にしてこの文を出す。
 */
export function settingInactiveReason(
  state: GameState,
  key: SettingKey,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  const images = imagesOf(state);
  const raw = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  // 原本をそのまま配るので、形式は変わらない（D-58）
  if (key === 'format')
    return images === 'none'
      ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なので原本の形式のまま配る`
      : undefined;
  if (key !== 'variants') return undefined;
  return images === 'none' || images === 'resize'
    ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なのでサイズ違いは作らない（1 種）`
    : undefined;
}

/**
 * 設定の今の効き方の注記（効かないわけではないが、選んだ値どおりにならないとき）。Next.js の画像の部品は JPEG を選んでも
 * WebP で配る（formats の既定。D-58）。
 */
export function settingNote(
  state: GameState,
  key: SettingKey,
): string | undefined {
  if (key !== 'format') return undefined;
  const platform = STACKS[state.stackIndex]!.provider;
  const images = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  if (usesNextImage(platform, state.framework, images))
    return 'Next.js の画像の部品は、ブラウザに合わせて既定で WebP を配る（JPEG を選んでも WebP）';
  if (astroImage(platform, state.framework, images))
    return 'Astro の画像の部品（<Image />）は既定で WebP を作る（JPEG を選んでも WebP）';
  return autoImageFormat(platform, state.framework, images)
    ? 'Cloudflare Images の閲覧のときの変換は、ブラウザに合わせた形式（format=auto）で配る（JPEG を選んでも WebP とみなす）'
    : undefined;
}

/** 1 枚あたり配る画像の大きさ（KB）。画像の部品と画像の形式の設定から（D-47・D-58）。 */
export function deliveredImageKB(
  sc: Scenario,
  settings: Settings,
  images: string | undefined,
  /** 閲覧のときにブラウザに合わせた形式で配る（JPEG を選んでも WebP。autoImageFormat。D-58・D-62）。 */
  nextImage = false,
): number {
  if (images === 'none') return sc.unoptimizedImageKB;
  const kb = nextImage
    ? Math.min(settings.imageKB, IMAGE_FORMAT_KB.webp)
    : settings.imageKB;
  if (images === 'resize')
    return sc.resizedImageKB * (kb / IMAGE_FORMAT_KB.jpeg);
  return kb;
}

/**
 * 1 ページの通信量（KB）: HTML（SPA はデータの API）+ JS・CSS + 画像。ブラウザのキャッシュが無い最初の 1 ページ（D-47）。
 * 画像の枚数は提案で変わる（mods.imagesPerPage）。
 */
export function pageWeightKB(
  sc: Scenario,
  settings: Settings,
  mods: WorkloadMods,
  images: string | undefined,
  nextImage = false,
): number {
  const w = sc.template(1);
  const html = w.routes[0]!.processing.responseKB;
  const perImage = deliveredImageKB(sc, settings, images, nextImage);
  return (
    html +
    w.perPage.assets * w.assets.sizeKB +
    (mods.imagesPerPage ?? w.perPage.images) * perImage
  );
}

/** 1 ページの通信量の表示（例: 「1 ページ約 20.5 MB」）。 */
export function pageWeightLabel(kb: number): string {
  return kb >= 1000
    ? `1 ページ約 ${Number((kb / 1000).toFixed(1))} MB`
    : `1 ページ約 ${Math.round(kb)} KB`;
}

/** 状態の画像の部品で、1 ページの通信量の表示（画像の部品の ⓘ に使う）。 */
export function pageWeightOf(state: GameState, images?: string): string {
  const platform = STACKS[state.stackIndex]!.provider;
  const opt =
    images !== undefined ? imagesBehavior(platform, images) : imagesOf(state);
  return pageWeightLabel(
    pageWeightKB(
      scenarioOf(state),
      state.settings,
      state.mods,
      opt,
      autoImageFormat(platform, state.framework, opt),
    ),
  );
}

/** 行動を選べない理由（画面はこの文をそのまま出す）。 */
export type ActionBlockReason =
  | 'not-playing' // ゲームが終わっている
  | 'invalid' // 存在しない選択肢
  | 'same' // 今と同じ・すでに選んでいる（予定済み）
  | 'irreversible' // 戻せない（チャットを受けたあとのリアルタイムなど）
  | 'busy' // 乗り換え・DB の差し替えの最中
  | 'unavailable' // 要件を満たせる構成が無い（SLA など）
  | 'via-proposal' // 提案を受けると付く部品
  | 'limit' // これ以上できない（SSR の最適化の下限など）
  | 'effort'; // 手間が足りない

export type ActionCheck =
  | { ok: true; cost: number }
  | { ok: false; reason: ActionBlockReason; message: string };

const ok = (cost: number): ActionCheck => ({ ok: true, cost });
const ng = (reason: ActionBlockReason, message: string): ActionCheck => ({
  ok: false,
  reason,
  message,
});

/**
 * その部品を付ける提案が届いているか（部品の欄で選ぶのは、その提案を受けるのと同じ。D-24 の画面確認）。
 * 届いている提案の「受ける」の効果に、同じスロット・同じ部品を付ける効果があればその id。
 */
export function componentProposal(
  state: Pick<GameState, 'pendingProposals' | 'scenario'>,
  slot: SlotId,
  option: string,
): string | undefined {
  const sc = scenarioOf(state);
  return state.pendingProposals.find((id) =>
    eventDef(sc, id)?.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/** 提案で付く部品か（どの提案の「受ける」にも、この部品を付ける効果がある）。 */
function proposalOnlyComponent(
  sc: Scenario,
  slot: SlotId,
  option: string,
): EventDef | undefined {
  return sc.events.find((d) =>
    d.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/**
 * 部品どうしの依存で選べない理由（ゲーム中の差し替えと始める画面で共有。D-37・D-45）。
 * さくらの VPS の API の応答のキャッシュは前段の CDN の上で効くので、前段の CDN なしでは選べず、
 * キャッシュしている間は前段の CDN を外せない。choices はスロットごとの今の選択（始める画面では未選択もある）。
 */
export function componentConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
  /** フレームワーク（AWS の CDN の料金のプランの判定に使う。省略は Next.js）。 */
  framework: FrameworkId = 'nextjs',
): string | null {
  const api = apiConflict(platform, slot, option, choices);
  if (api) return api;
  // OpenNext は 1 つの CloudFront がページを返すので、画像を R2 に出しても CloudFront は残る（同じ規則で衝突しない。D-63）
  if (platform === 'aws' || platform === 'aws-opennext')
    return cdnPlanConflict(platform, slot, option, choices, framework);
  if (platform !== 'sakura') return null;
  if (
    slot === 'apiCache' &&
    option !== 'none' &&
    (choices.frontCdn ?? 'none') === 'none'
  )
    return '前段の CDN が要る（先に前段の CDN を選ぶ）';
  if (
    slot === 'frontCdn' &&
    option === 'none' &&
    (choices.apiCache ?? 'none') !== 'none'
  )
    return 'API の応答を前段の CDN でキャッシュしている（先にキャッシュを外す）';
  return null;
}

/**
 * SPA の API の置き場の依存（D-65）。他の事業者に置くと、DB はその事業者の部品になり（構成の DB は選べない）、
 * この事業者の API の応答のキャッシュは効かず、D1 に置いた画像を読む Worker の API も無くなる。頼る側を先に戻す（D-37 と同じ向き）。
 */
function apiConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
): string | null {
  const elsewhere = apiPlacedElsewhere(choices);
  if (slot === 'db' && elsewhere)
    return 'API を他の事業者に置いているので、DB はその事業者の部品になる（構成の DB は選べない）';
  if (slot === 'apiCache' && option !== 'none' && elsewhere)
    return 'API を他の事業者に置いているので、この事業者の API の応答のキャッシュは効かない';
  if (slot === 'images' && option === 'd1' && elsewhere)
    return 'API を他の事業者に置いているので、画像を読み出す Worker の API が無い';
  if (slot === 'api' && option !== 'same') {
    if ((choices.apiCache ?? 'none') !== 'none')
      return 'API の応答のキャッシュを使っている（先にキャッシュを外す）';
    if (platform === 'cloudflare' && choices.images === 'd1')
      return '画像を D1 に置いている（読み出す Worker の API が無くなる。先に画像の置き場を替える）';
  }
  return null;
}

/** AWS の構成に CloudFront（課金されるノード）があるか。 */
function hasCloudFront(
  platform: Platform,
  choices: Choices,
  framework: FrameworkId,
): boolean {
  const def = STACK_DEFS.find((d) => d.platform === platform);
  if (!def) return false;
  return composeStack(def, choices, { framework }).nodes.some((n) =>
    n.billing?.planId.startsWith('cloudfront'),
  );
}

/**
 * CDN の料金のプラン（D-61）は CloudFront があるときだけ効く。前段の CloudFront が無い Amplify で画像を他の事業者（R2）に出すと
 * CloudFront が無くなるので、定額のプランは選べない（B-11・D-62。効かない設定の扱い D-47 と同じ形で理由を出す）。
 * 定額のプランを選んでいる間は、CloudFront が無くなる選択（画像を R2 に出す・前段を外す）も選べない（頼る側を先に戻す。D-37 と同じ）。
 */
function cdnPlanConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
  framework: FrameworkId,
): string | null {
  const flat = (v: string | undefined) => v !== undefined && v !== 'payg';
  if (slot === 'cdnPlan')
    return flat(option) && !hasCloudFront(platform, choices, framework)
      ? 'この構成には CloudFront が無い（前段の CloudFront が無く、画像も他の事業者から配る）ので、CDN の料金のプランは効かない'
      : null;
  if (!flat(choices.cdnPlan)) return null;
  const next = { ...choices, [slot]: option };
  return hasCloudFront(platform, choices, framework) &&
    !hasCloudFront(platform, next, framework)
    ? 'CloudFront が無くなり、定額のプランが効かなくなる（先に CDN の料金のプランを従量に戻す）'
    : null;
}

/** 行動の規則（手間の残りは見ない）。選べない理由を区別して返す。 */
function actionRule(state: GameState, action: Action): ActionCheck {
  if (state.phase !== 'playing')
    return ng('not-playing', 'ゲームは終わっている');
  const busy = state.migration
    ? ng('busy', '乗り換えの最中は選べない')
    : state.componentSwap
      ? ng('busy', `${swapLabel(state.componentSwap.slot)}の最中は選べない`)
      : null;
  switch (action.type) {
    case 'none':
      return ok(0);
    case 'set': {
      const def = SETTINGS[action.key];
      if (!def || !def.options.some((o) => o.value === action.value))
        return ng('invalid', '選択肢に無い');
      if (hiddenSettings(state).includes(action.key))
        return ng(
          'unavailable',
          action.key === 'isr' ||
            action.key === 'apiCacheTtl' ||
            action.key === 'buildInterval'
            ? `${FRAMEWORKS[state.framework].label} では「${SETTINGS[revalidateSettingOf(state.framework)].label}」で選ぶ`
            : 'このシナリオでは効かない',
        );
      if (state.settings[def.field] === action.value)
        return ng('same', '今と同じ（または選択済み）');
      const inactive = settingInactiveReason(state, action.key);
      if (inactive) return ng('unavailable', inactive);
      // 時間 → オンデマンドは、更新のたびに再検証を呼ぶ実装の手間がかかる（D-49）
      // Astro の更新のたびのビルドも、更新からビルドを起こす仕組み（デプロイの hook）の実装が要る（同じ手間・仮定。D-68）
      if (
        (action.key === 'isr' || action.key === 'buildInterval') &&
        action.value === ON_DEMAND_REVALIDATE
      )
        return ok(EFFORT.onDemandSwitch);
      return ok(def.effort);
    }
    case 'optimize':
      return nextSsrCpuMs(state) > EFFORT.minSsrCpuMs
        ? ok(EFFORT.optimize)
        : ng(
            'limit',
            `SSR の CPU は ${EFFORT.minSsrCpuMs} ms より下げられない`,
          );
    case 'plan':
    case 'migrate': {
      if (busy) return busy;
      if (!STACKS[action.stackIndex]) return ng('invalid', '構成が無い');
      if (action.stackIndex === state.stackIndex)
        return ng('same', '今の構成と同じ');
      if (!stackSupports(action.stackIndex, state.framework))
        return ng(
          'unavailable',
          `${FRAMEWORKS[state.framework].label} を載せる公式のアダプターが無い`,
        );
      const plan = isPlanChange(state.stackIndex, action.stackIndex);
      if ((action.type === 'plan') !== plan)
        return ng(
          'invalid',
          plan
            ? '同じ事業者なのでプラン変更'
            : isRecontract(state.stackIndex, action.stackIndex)
              ? '今よりディスク容量が少ないプランへは変更できないので契約し直し'
              : '別の事業者なので乗り換え',
        );
      // 乗り換えの手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(plan ? planChangeEffort(state.stackIndex) : 0);
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId);
      if (!def?.accept) return ng('invalid', '提案が無い');
      if (!state.pendingProposals.includes(action.eventId))
        return ng('same', 'すでに返事をした');
      if (action.accept) {
        const why = unavailableReason(state, def);
        if (why) return ng('unavailable', why);
      }
      return ok(action.accept ? acceptEffort(def, state) : 0);
    }
    case 'storage-option': {
      if (busy) return busy;
      if (!storageOptionAddon(state.stackIndex))
        return ng('invalid', 'さくらの VPS のときだけ');
      if (state.storageOption)
        return ng('same', 'すでに付けている（戻せない）');
      return ok(EFFORT.storageOption);
    }
    case 'block-bots':
      return state.botBlocked
        ? ng('same', 'すでに入れている')
        : ok(BOT_BLOCK.effort);
    case 'component': {
      if (busy) return busy;
      const sc = scenarioOf(state);
      const platform = STACKS[state.stackIndex]!.provider;
      const opt = componentsOf(platform, action.slot, state.framework).find(
        (c) => c.id === action.option,
      );
      if (!opt) return ng('invalid', 'この事業者の部品に無い');
      const current = { ...DEFAULT_CHOICES[platform], ...state.components };
      if (current[action.slot] === action.option)
        return ng('same', '今の部品（または選択済み）');
      // チャットを受けたあとはリアルタイムを外せない
      if (action.slot === 'realtime' && state.mods.realtime)
        return ng('irreversible', 'チャットを受けたので外せない');
      // さくらの VPS の API の応答のキャッシュは前段の CDN の上で効く（D-37）
      const conflict = componentConflict(
        platform,
        action.slot,
        action.option,
        current,
        state.framework,
      );
      if (conflict) return ng('unavailable', conflict);
      // 提案で付く部品は、提案が届いている月だけ選べる（選ぶと提案を受けたのと同じ）
      const via = proposalOnlyComponent(sc, action.slot, action.option);
      if (via) {
        const pending = componentProposal(state, action.slot, action.option);
        if (!pending)
          return ng('via-proposal', `提案「${via.title}」を受けると付く`);
        return actionRule(state, {
          type: 'respond',
          eventId: pending,
          accept: true,
        });
      }
      // 新しい事業者のアカウントを足す部品は、差すときに一度きりの手間が付く（D-52）
      const setup =
        newAccountsBy(state, action.slot, action.option).length > 0
          ? EFFORT.accountSetup
          : 0;
      if (isDataSwap(action.slot)) return ok(setup); // 移行の手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(EFFORT.component[action.slot] + setup);
    }
  }
}

/** 行動の手間（選べない行動は null。手間の残りは見ない）。 */
export function actionEffort(state: GameState, action: Action): number | null {
  const r = actionRule(state, action);
  return r.ok ? r.cost : null;
}

/** 行動を今選べるか（規則と手間の残り）。選べなければ理由を区別して返す。 */
export function checkAction(state: GameState, action: Action): ActionCheck {
  const r = actionRule(state, action);
  if (!r.ok) return r;
  const left = effortAvailable(state);
  const short = (need: number) => ng('effort', `手間が足りない: あと ${need}`);
  if (r.cost > left) return short(r.cost - left);
  if (action.type === 'migrate') {
    const m: Migration = {
      from: state.stackIndex,
      to: action.stackIndex,
      required: migrationEffort(state.stackIndex, action.stackIndex),
      done: 0,
    };
    const after = effortAvailable({ ...state, migration: m });
    if (after < 0) return short(-after);
  }
  if (
    action.type === 'component' &&
    isDataSwap(action.slot) &&
    !proposalOnlyComponent(scenarioOf(state), action.slot, action.option)
  ) {
    const after = effortAvailable({
      ...state,
      componentSwap: {
        slot: action.slot,
        option: action.option,
        required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
        done: 0,
      },
      // 新しいアカウントの設定の一度きりの手間（r.cost）も同じ月に使う（D-52・OCL-B6A107A3）
      plannedEffort: state.plannedEffort + r.cost,
    });
    if (after < 0) return short(-after);
  }
  // DB 以外の部品は今月から差し替わるので、増えるアカウントの維持（D-52）も今月の余力に含めて確かめる（OCL-73780314）
  if (
    action.type === 'component' &&
    !isDataSwap(action.slot) &&
    !proposalOnlyComponent(scenarioOf(state), action.slot, action.option)
  ) {
    const after = effortAvailable({
      ...state,
      components: { ...state.components, [action.slot]: action.option },
      plannedEffort: state.plannedEffort + r.cost,
    });
    if (after < 0) return short(-after);
  }
  return r;
}

/**
 * 行動を順に当て、最初に選べなかった行動の理由を返す（画面の選択肢の表示に使う）。すべて選べれば ok。
 */
export function checkActions(
  state: GameState,
  actions: readonly Action[],
):
  | { ok: true; state: GameState }
  | { ok: false; index: number; reason: ActionBlockReason; message: string } {
  let s = state;
  for (const [index, a] of actions.entries()) {
    const c = checkAction(s, a);
    if (!c.ok)
      return { ok: false, index, reason: c.reason, message: c.message };
    s = applyAction(s, a);
  }
  return { ok: true, state: s };
}

/** 部品の選択肢（今の事業者のスロットごと）と、今の部品。画面の「部品」の欄に使う。 */
export function componentSlots(state: GameState): {
  slot: SlotId;
  label: string;
  current: string;
  options: ReturnType<typeof componentsOf>;
}[] {
  const platform = STACKS[state.stackIndex]!.provider;
  const current = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(state.framework),
    ...state.components,
  };
  return (Object.keys(SLOT_LABELS) as SlotId[])
    .map((slot) => ({
      slot,
      label: SLOT_LABELS[slot],
      current: current[slot] ?? '',
      options: componentsOf(platform, slot, state.framework),
    }))
    .filter(
      (x) =>
        x.options.length > 1 &&
        // このシナリオで効かないスロットは出さない（D-33・prd/09 E-6）
        !scenarioOf(state).hidden?.slots?.includes(x.slot) &&
        // 今の選択で効かないスロット（API を他の事業者に置いたときの DB。D-65）
        !slotIneffective(x.slot, current),
    );
}

// ---- 始める画面の部品の選択（D-45）----

/** 始める画面の部品の選択肢（files は構成が暗黙に持つファイルの置き場。catalog の fileStorageOf）。 */
export type SetupOption = {
  id: string;
  platform: ComponentProvider;
  slot: SlotId | 'files';
  label: string;
  note: string;
};

export type SetupSlot = {
  slot: SlotId | 'files';
  label: string;
  options: SetupOption[];
  /** この構成では 1 択（変更できない。未選択の判定に含めない）。 */
  fixed: boolean;
};

/**
 * 始める画面の部品のスロット（構成・フレームワークの組み合わせで）。ゲーム中の部品の欄（componentSlots）と同じ
 * スロットから、提案で付く部品（チャットの Durable Objects など）を除く。選択肢が 1 つしか残らないスロットは「固定」として出す。
 * 最後に、構成が暗黙に持つファイルの置き場（R2・VPS のディスクなど。構成のノードから引く）を固定のスロットとして足す。
 * スロットの一覧は持たず、catalog の部品の定義から引く（スロットが増えても追従する）。
 */
export function setupSlots(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  /** 選んだ部品（今の選択で効かないスロットを出さないために使う。API を他の事業者に置いたときの DB。D-65）。 */
  choices: Choices = {},
): SetupSlot[] {
  const fresh = newGame(stackIndex, 0, scenario, DEFAULT_START_DATE, framework);
  const draft = {
    ...fresh,
    components: { ...fresh.components, ...choices },
  };
  const slots: SetupSlot[] = componentSlots(draft).map(
    ({ slot, label, options }) => {
      const usable = options.filter(
        (o) => !proposalOnlyComponent(scenario, slot, o.id),
      );
      return { slot, label, options: usable, fixed: usable.length < 2 };
    },
  );
  const files = fileStorageOf(STACKS[stackIndex]!.id);
  if (files)
    slots.push({
      slot: 'files',
      label: FILE_STORAGE_LABEL,
      options: [{ ...files, slot: 'files' }],
      fixed: true,
    });
  return slots.filter((x) => x.options.length > 0);
}

/** 選ぶスロット（固定でないもの）。 */
const choosable = (slots: SetupSlot[]) =>
  slots.filter(
    (x): x is SetupSlot & { slot: SlotId } => !x.fixed && x.slot !== 'files',
  );

/** 選んだ部品のうち、その組み合わせで選べるものだけを残す（構成・フレームワークを替えたとき）。 */
export function validSetupChoices(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices,
): Choices {
  const out: Choices = {};
  const slots = choosable(setupSlots(scenario, stackIndex, framework));
  for (const x of slots) {
    const v = choices[x.slot];
    if (v !== undefined && x.options.some((o) => o.id === v)) out[x.slot] = v;
  }
  // 依存の崩れた選択（前段の CDN を外したのに残っている API のキャッシュなど）は外す。
  // 頼る側（後ろのスロット）から見るので、頼られる側（前段の CDN）の選択は残る
  const platform = STACKS[stackIndex]!.provider;
  for (const x of [...slots].reverse()) {
    const v = out[x.slot];
    if (
      v !== undefined &&
      componentConflict(platform, x.slot, v, out, framework)
    )
      delete out[x.slot];
  }
  return out;
}

/** ISR の再検証の既定（5 分）。 */
export const DEFAULT_REVALIDATE_SEC = 300;

/**
 * 始める画面で選べる ISR の再検証（D-49）。ISR のある構成（Next.js）で、シナリオが隠していないときだけ。
 * 各選択肢に短い説明（フレーバー）を添える。
 */
export function setupRevalidateOptions(
  scenario: Scenario,
  framework: FrameworkId,
): { value: number; label: string; flavor: string }[] {
  const key = revalidateSettingOf(framework);
  if (key === 'apiCacheTtl') return [];
  if (hiddenSettings({ scenario, framework }).includes(key)) return [];
  return SETTINGS[key].options.map((o) => ({
    ...o,
    flavor: settingFlavor(key, o.value) ?? '',
  }));
}

/**
 * 設定の選択肢の短い説明（部品の説明 COMPONENT_FLAVOR と同じ方針: 事実だが、それだけで選ぶと外れうる文。数値は書かない。D-49）。
 * 「設定:値」で引く。
 */
export const SETTING_FLAVOR: Readonly<Record<string, string>> = {
  [`format:${IMAGE_FORMAT_KB.jpeg}`]:
    'どのブラウザでも表示でき、作るのも速い。仕組みがいちばん単純',
  [`format:${IMAGE_FORMAT_KB.webp}`]:
    '見た目の画質を保ったまま小さくなり、今の主なブラウザで表示できる',
  [`format:${IMAGE_FORMAT_KB.avif}`]:
    'いちばん小さくなる新しい形式。画質を保ったまま転送量を大きく減らせる',
  'isr:0': '記事を更新したときだけ作り直すので、無駄な再生成がなく、いつも最新',
  'isr:60': '少し待てば更新が見える。設定を書くだけで、追加の実装は要らない',
  'isr:300': '更新の反映と作り直しの回数の釣り合いを取った、ほどほどの間隔',
  'isr:3600': '間隔が長いほど、同じページを作り直すまでの間があく',
  'isr:21600': '更新はゆっくり見えるが、同じページを作り直すのは一日に数回まで',
  'buildInterval:0':
    '記事を更新するたびにビルドするので、待つのはビルドの間だけ。仕組みもいちばん素直',
  'buildInterval:60':
    '少し待てば更新が見える。間隔の間の更新はまとめて 1 回でビルドする',
  'buildInterval:300':
    '更新の反映とビルドの回数の釣り合いを取った、ほどほどの間隔',
  'buildInterval:3600': '間隔が長いほど、ビルドの回数はまとまって減る',
  'buildInterval:21600': '更新はゆっくり見えるが、ビルドは一日に数回まで',
};

export function settingFlavor(
  key: SettingKey,
  value: number,
): string | undefined {
  return SETTING_FLAVOR[`${key}:${value}`];
}

/** 始められない理由（まだ選んでいないスロット）。選び終えていれば null。 */
export function setupProblem(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices,
): string | null {
  const missing = choosable(
    setupSlots(scenario, stackIndex, framework, choices),
  ).filter((x) => !x.options.some((o) => o.id === choices[x.slot]));
  return missing.length
    ? `部品をまだ選んでいない: ${missing.map((x) => x.label).join('・')}`
    : null;
}

/** 部品の選択肢の短い説明（フレーバー。catalog の COMPONENT_FLAVOR。D-45）。 */
export function componentFlavor(o: {
  platform: ComponentProvider;
  slot: SlotId | 'files';
  id: string;
}): string | undefined {
  return COMPONENT_FLAVOR[`${o.platform}:${o.slot}:${o.id}`];
}

/**
 * 部品の差し替えの手間の説明（DB は進行中の月ごと）。state と option を渡すと、新しい事業者のアカウントが増える部品の
 * 一度きりの手間と毎月の維持を添える（D-52）。
 */
export function componentEffortLabel(
  slot: SlotId,
  state?: Pick<GameState, 'stackIndex' | 'components' | 'framework'> & {
    scenario?: Scenario;
  },
  option?: string,
): string[] {
  const added =
    state && option !== undefined ? newAccountsBy(state, slot, option) : [];
  const setup = added.length > 0 ? EFFORT.accountSetup : 0;
  // 部品で VPS を使い始める（VPS の API。D-67）と、自前運用の維持と偶発的な障害が加わる
  const selfHosting =
    state?.scenario &&
    option !== undefined &&
    !selfHostedOf(state.stackIndex, state.components, state.framework) &&
    selfHostedOf(
      state.stackIndex,
      { ...state.components, [slot]: option },
      state.framework,
    )
      ? [
          `自前運用になる（毎月の維持 ${state.scenario.effort.selfHostedUpkeep}・自前の障害 月 ${Math.round(state.scenario.incidents.selfHostedChancePerMonth * 100)}%）`,
        ]
      : [];
  const cross = [
    ...(added.length > 0
      ? [
          `${added.map(accountLabel).join('・')} のアカウントが増える（毎月の維持 ${EFFORT.accountUpkeep * added.length}）`,
        ]
      : []),
    ...selfHosting,
  ];
  return isDataSwap(slot)
    ? [
        `${EFFORT.dbSwap.perMonth} × ${EFFORT.dbSwap.months} か月${setup ? ` + 手間 ${setup}` : ''}`,
        '期間中は新旧両方の費用',
        ...cross,
      ]
    : [
        `手間 ${EFFORT.component[slot] + setup}${setup ? `（他の事業者の設定 ${setup} を含む）` : ''}`,
        '来月から',
        ...cross,
      ];
}

/**
 * 部品を選ぶ前に出す、当たりうる前提（D-24・選ぶ前に前提の文を出す）。今月の基準の PV で、その部品に替えた見積を引き、
 * 部品の premiseRefs に当たる前提を返す。表示のためだけで、ゲームの状態には入れない。
 */
export function componentPreview(
  state: GameState,
  slot: SlotId,
  option: string,
): MonthEvent['premises'] {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const def = componentsOf(platform, slot, state.framework).find(
    (c) => c.id === option,
  );
  if (!def || def.premiseRefs.length === 0) return [];
  const components = { ...state.components, [slot]: option };
  const r = estimate({
    workload: workloadFor(sc, {
      pv: state.basePV,
      settings: state.settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: sc.stock ? state.stock : null,
      platform,
      components,
      framework: state.framework,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      components,
      {},
      state.storageOption,
    ),
    books: booksAt(state, state.history.length + 1),
  });
  return premiseRefsOf(def, r.premises);
}

/**
 * オンデマンドの再検証にしたときの CloudFront の無効化の見込み（D-66）。今月の基準の PV と今の部品で見積を引き、
 * 無効化のメーターの明細を読む。無効化が起きない構成（OpenNext 以外・ISR を CloudFront にキャッシュしない部品）は undefined。
 * included: 定額のプランで込み（解釈）。freePaths・unitUsd は従量の料金データ（無料のパス・1 パスの単価）。表示のためだけ。
 */
export type InvalidationEstimate = {
  paths: number;
  usd: number;
  included: boolean;
  freePaths: number;
  unitUsd: number;
};

export function onDemandInvalidationEstimate(
  state: GameState,
): InvalidationEstimate | undefined {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const settings = { ...state.settings, revalidateSec: ON_DEMAND_REVALIDATE };
  const bk = booksAt(state, state.history.length + 1);
  const r = estimate({
    workload: workloadFor(sc, {
      pv: state.basePV,
      settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: sc.stock ? state.stock : null,
      platform,
      components: state.components,
      framework: state.framework,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      state.components,
      {},
      state.storageOption,
    ),
    books: bk,
  });
  const lines = r.bill.lines.filter(
    (l) => l.priceRef.meterId === INVALIDATION_METER && (l.quantity ?? 0) > 0,
  );
  if (lines.length === 0) return undefined;
  // 従量の料金データ（CloudFront の無効化の無料のパスと単価）
  const payg = bk
    .find((b) => b.provider === 'aws')
    ?.plans.find((p) => p.id === 'cloudfront');
  const meter = payg?.meters.find((m) => m.id === INVALIDATION_METER);
  const pool = bk
    .find((b) => b.provider === 'aws')
    ?.allowancePools.find((p) => p.id === meter?.allowancePool);
  const unitUsd =
    meter?.pricing.model === 'flat'
      ? meter.pricing.unitPrice / meter.pricing.per
      : 0;
  return {
    paths: lines.reduce((a, l) => a + (l.quantity ?? 0), 0),
    usd: lines.reduce((a, l) => a + (l.amount ?? 0), 0),
    included: lines.every((l) => l.priceRef.planId !== 'cloudfront'),
    freePaths: pool?.quantity ?? 0,
    unitUsd,
  };
}

const INVALIDATION_METER = 'invalidation-paths';

/** 始める画面で、オンデマンドを選んだときの無効化の見込み（1 か月目の規模。D-66）。 */
export function setupInvalidationEstimate(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Choices,
): InvalidationEstimate | undefined {
  return onDemandInvalidationEstimate(
    newGame(
      stackIndex,
      1,
      scenario,
      DEFAULT_START_DATE,
      framework,
      components,
      ON_DEMAND_REVALIDATE,
    ),
  );
}

/** 無効化の見込みの文（再検証の設定の「オンデマンド」の選択肢に添える。D-66）。 */
export function invalidationNote(e: InvalidationEstimate): string {
  const paths = `無効化 月約 ${commas(e.paths)} パス`;
  return e.included
    ? `${paths}（定額のプランでは込み。解釈）`
    : `${paths}・約 ${usd(e.usd)}（月 ${commas(e.freePaths)} パスまで無料、以降 1 パス $${e.unitUsd}）`;
}

/**
 * 始める画面の 1 か月目の費用と収益の見込み（D-72）。ゲーム上の目安で、出来事・乱数（話題・Bot・自前運用の障害）は含めない。
 * 1 か月目の基準の PV と選んだ部品・設定で、playMonth と同じ Workload・見積を引く。収益は広告・固定の収益に、前提に当たって
 * 止まる・遅くなる月の減りだけを掛ける。short: 費用が「開始の所持金 + 収益」を超える（1 か月目に所持金が尽きる見込み）。
 * topLines: 金額の大きい明細（$1 以上の上位 3 件。同じラベルはまとめる・USD に直す・クレジット前）。
 */
export type MonthOneEstimate = {
  costUsd: number;
  revenueUsd: number;
  startCash: number;
  short: boolean;
  topLines: { label: string; usd: number }[];
};

export function setupMonthOneEstimate(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Choices,
  revalidateSec?: number,
): MonthOneEstimate {
  const state = newGame(
    stackIndex,
    1,
    scenario,
    DEFAULT_START_DATE,
    framework,
    components,
    revalidateSec,
  );
  const r = estimate({
    workload: workloadFor(scenario, {
      pv: state.basePV,
      settings: state.settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: scenario.stock ? state.stock : null,
      platform: STACKS[state.stackIndex]!.provider,
      components: state.components,
      framework: state.framework,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      state.components,
      {},
      state.storageOption,
    ),
    books: booksAt(state, 1),
  });
  const costUsd = toUsd(r.bill.totals);
  const loss = scenario.revenue.loss;
  const hit = (e: string[]) =>
    r.premises.some((p) => p.hit && e.includes(p.effect));
  let revenueUsd =
    (scenario.revenue.fixedUsdPerMonth ?? 0) +
    (state.basePV / 1000) * scenario.revenue.adsUsdPer1000PV;
  if (hit(['block', 'upgrade-required'])) revenueUsd *= 1 - loss.block;
  else if (hit(['throttle'])) revenueUsd *= 1 - loss.throttle;
  const byLabel = new Map<string, number>();
  for (const l of r.bill.lines) {
    if (!l.amount) continue;
    const v = l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
    byLabel.set(lineLabel(l), (byLabel.get(lineLabel(l)) ?? 0) + v);
  }
  const topLines = [...byLabel]
    .filter(([, v]) => v >= 1) // $1 未満の明細は主な費用に出さない
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, v]) => ({ label, usd: v }));
  return {
    costUsd,
    revenueUsd,
    startCash: scenario.startCash,
    short: costUsd > scenario.startCash + revenueUsd,
    topLines,
  };
}

/** 提案を受けられない理由（要件を満たせる構成がプラン変更でも無い）。 */
export function unavailableReason(
  state: Pick<GameState, 'stackIndex' | 'framework'>,
  def: EventDef,
): string | undefined {
  if (
    !def.requires ||
    requirementReachable(state.stackIndex, def.requires, state.framework)
  )
    return undefined;
  return `今の事業者では「${REQUIREMENT_LABEL[def.requires]}」を選べない（セルフサービスのプランに無く、Enterprise などの契約の料金は取得していない）`;
}

export function newGame(
  stackIndex: number,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
  startDate: string = DEFAULT_START_DATE,
  /** アプリのフレームワーク（省略はシナリオの既定。シナリオで選べないものは既定にする。prd/10 F-04）。 */
  framework?: FrameworkId,
  /** 始める画面で選んだ部品（D-45）。選べないものは捨て、省略したスロットは既定の部品。 */
  components?: Choices,
  /** 始める画面で選んだ ISR の再検証（D-49。秒・オンデマンドは 0）。選べないもの・省略は既定（5 分）。 */
  revalidateSec?: number,
): GameState {
  const fw = frameworksOf(scenario);
  // 載せられない構成（Astro × AWS など）では既定のフレームワークにする（画面では選べない。D-68）
  const app =
    framework !== undefined &&
    fw.allowed.includes(framework) &&
    stackSupports(stackIndex, framework)
      ? framework
      : fw.default;
  const chosen = components
    ? validSetupChoices(scenario, stackIndex, app, components)
    : {};
  return {
    startDate,
    revisions: rollRevisions(scenario, seed, startDate, SCHEDULED_CHANGES),
    scenarioId: scenario.id,
    scenario,
    seed,
    startSeed: seed,
    schedule: rollSchedule(scenario, seed),
    stackIndex,
    framework: app,
    components: {
      ...DEFAULT_CHOICES[STACKS[stackIndex]!.provider],
      ...frameworkDefaults(app),
      ...chosen,
    },
    storageOption: false,
    storageOptionFeeDue: null,
    componentSwap: null,
    contracts: [],
    requirements: [],
    settings: {
      imageKB: 150,
      variants: 3,
      revalidateSec:
        revalidateSec !== undefined &&
        setupRevalidateOptions(scenario, app).some(
          (o) => o.value === revalidateSec,
        )
          ? revalidateSec
          : DEFAULT_REVALIDATE_SEC,
      ssrOptimizations: 0,
    },
    cash: scenario.startCash,
    basePV: scenario.scale.startPV,
    outages: 0,
    featurePoints: 0,
    migration: null,
    switching: false,
    plannedEffort: 0,
    policyWarnedMonth: null,
    effortPerMonth: scenario.effort.perMonth,
    seats: 0,
    mods: {},
    stock: initialStock(scenario),
    botBlocked: false,
    pendingProposals: [],
    responses: {},
    fired: [],
    interrupts: [],
    growthBonus: [],
    history: [],
    phase: 'playing',
  };
}

const optionLabel = (key: SettingKey, value: number) =>
  SETTINGS[key].options.find((o) => o.value === value)?.label ?? String(value);

const fmtFactor = (f: number) => `× ${Number(f.toFixed(2))}`;

/** 効果の要約（画面の通知に出す）。 */
export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'traffic':
      return `${e.bot ? 'Bot の' : ''}PV ${fmtFactor(e.factor)}${e.peakFactor ? `・ピーク ${fmtFactor(e.peakFactor)}` : ''}（${e.months} か月${e.earnsRevenue ? '' : '・収益なし'}）`;
    case 'workload': {
      const m = e.mods;
      return [
        m.imagesPerPage !== undefined && `1 PV の画像 ${m.imagesPerPage} 枚`,
        m.uploadsFactor !== undefined &&
          `画像の投稿 ${fmtFactor(m.uploadsFactor)}`,
        m.ssrShare !== undefined &&
          `SSR の割合 ${Math.round(m.ssrShare * 100)}%`,
        m.writesPerCall !== undefined &&
          `API 1 回の書き込み ${m.writesPerCall}`,
        m.dbRateFactor !== undefined &&
          `DB の増え方 ${fmtFactor(m.dbRateFactor)}`,
        m.apiCpuMs !== undefined && `API 1 回の CPU ${m.apiCpuMs} ms`,
        m.apiResponseKB !== undefined && `API 1 回の応答 ${m.apiResponseKB} KB`,
      ]
        .filter(Boolean)
        .join('・');
    }
    case 'stock':
      return [
        e.add.dbGB && `DB +${e.add.dbGB} GB`,
        e.add.imagesGB && `画像 +${e.add.imagesGB} GB`,
        e.add.articlePages &&
          `記事ページ +${e.add.articlePages.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join('・');
    case 'basePV':
      return `基準の PV ${fmtFactor(e.factor)}（以降ずっと）`;
    case 'seats':
      return `席（メンバー）+${e.add}`;
    case 'effortPerMonth':
      return `開発の手間 +${e.add} / 月`;
    case 'interrupt':
      if (e.featureWork)
        return `機能の追加の作業 ${e.points} × ${e.months} か月（翌月から。その月の機能開発に数える${e.unlessOnDemand ? '。再検証がすでにオンデマンドなら不要' : ''}）`;
      return `対応の手間 ${e.points} × ${e.months} か月（翌月から）`;
    case 'feature':
      return `機能開発 +${e.points}`;
    case 'growth':
      return `成長 +${Math.round(e.add * 100)} ポイント × ${e.months} か月`;
    case 'component':
      return `${SLOT_LABELS[e.slot]}に部品を付ける（${componentLabel('cloudflare', e.slot, e.option)}）`;
    case 'on-demand-revalidate':
      return 'ISR の再検証をオンデマンドにする（Next.js）';
    case 'requirement':
      return `以後の要件: ${REQUIREMENT_LABEL[e.requirement]}（満たさない月は鮮度が下がる）`;
    case 'contract':
      return `契約の収益 $${e.usdPerMonth} / 月（${REQUIREMENT_LABEL[e.requires]}のときだけ）`;
    case 'imageRedesign':
      return '画像を大きく綺麗に出す（原本がある構成は過去の記事も・一律で縮めた構成はこれからの投稿だけ。原本が無いと過去の画像は大きくできない）';
  }
}

/** 効果を状態に当てる（traffic はその月の計算で扱うのでここでは何もしない）。 */
function applyEffects(
  state: GameState,
  allEffects: Effect[],
  eventId: string,
): GameState {
  let s = state;
  const effects = effectsFor(state, allEffects);
  const deferFeature = effects.some(
    (e) => e.type === 'interrupt' && e.featureWork,
  );
  const featurePointsOf = effects.reduce(
    (a, e) => a + (e.type === 'feature' ? e.points : 0),
    0,
  );
  for (const e of effects) {
    switch (e.type) {
      case 'workload':
        s = { ...s, mods: { ...s.mods, ...e.mods } };
        break;
      case 'stock':
        s = {
          ...s,
          stock: {
            dbGB: s.stock.dbGB + (e.add.dbGB ?? 0),
            imagesGB: s.stock.imagesGB + (e.add.imagesGB ?? 0),
            images: s.stock.images + (e.add.images ?? 0),
            articlePages: s.stock.articlePages + (e.add.articlePages ?? 0),
          },
        };
        break;
      case 'basePV':
        s = { ...s, basePV: s.basePV * e.factor };
        break;
      case 'seats':
        s = { ...s, seats: s.seats + e.add };
        break;
      case 'effortPerMonth':
        s = { ...s, effortPerMonth: s.effortPerMonth + e.add };
        break;
      case 'interrupt':
        s = {
          ...s,
          interrupts: [
            ...s.interrupts,
            {
              points: e.points,
              months: e.months,
              eventId,
              ...(e.featureWork
                ? { featureWork: true, bonus: featurePointsOf / e.months }
                : {}),
            },
          ],
        };
        break;
      case 'feature':
        // 機能の追加の作業がある提案は、加点を作業の月に按分して足す（D-29）
        if (!deferFeature)
          s = { ...s, featurePoints: s.featurePoints + e.points };
        break;
      case 'growth':
        s = {
          ...s,
          growthBonus: [...s.growthBonus, { add: e.add, months: e.months }],
        };
        break;
      case 'component':
        s = { ...s, components: { ...s.components, [e.slot]: e.option } };
        break;
      case 'on-demand-revalidate':
        // SPA には ISR が無い（revalidateSec は API のキャッシュの期間）ので変えない
        if (s.framework !== 'vite-spa')
          s = {
            ...s,
            settings: { ...s.settings, revalidateSec: ON_DEMAND_REVALIDATE },
          };
        break;
      case 'imageRedesign': {
        // 手間は画像の部品で決まる（D-47）。粗い画像の数はここで固定し、以後の一律で縮めた投稿は粗くない
        const points = imageRedesignEffort(s);
        s = {
          ...s,
          imageRedesign: { coarseImages: s.coarseImages ?? 0 },
          ...(points > 0
            ? {
                interrupts: [...s.interrupts, { points, months: 1, eventId }],
              }
            : {}),
        };
        break;
      }
      case 'requirement':
        s = s.requirements.includes(e.requirement)
          ? s
          : { ...s, requirements: [...s.requirements, e.requirement] };
        break;
      case 'contract':
        s = {
          ...s,
          contracts: [
            ...s.contracts,
            { eventId, usdPerMonth: e.usdPerMonth, requires: e.requires },
          ],
        };
        break;
      case 'traffic':
        break;
    }
  }
  return s;
}

function premiseRefsOf(
  def: Pick<EventDef, 'premiseRefs'>,
  premises: readonly PlatformPremise[],
): MonthEvent['premises'] {
  return premises
    .filter((p) => def.premiseRefs.some((ref) => p.id.startsWith(ref)))
    .map((p) => ({
      id: p.id,
      text: p.text,
      hit: p.hit,
      ...(p.ratio !== undefined && Number.isFinite(p.ratio)
        ? { ratio: p.ratio }
        : {}),
    }));
}

/** 1 か月を進める（出来事 → 見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 在庫 → 終わりの判定）。 */
export function playMonth(input: GameState): GameState {
  if (input.phase !== 'playing') return input;
  const sc = scenarioOf(input);
  const month = input.history.length + 1;
  const prev = input.history[input.history.length - 1];

  // 返事のない提案は断ったことにする（罰はない。D-20 V-11）
  let state: GameState = input.pendingProposals.length
    ? {
        ...input,
        responses: {
          ...input.responses,
          ...Object.fromEntries(
            input.pendingProposals.map((id) => [id, 'declined' as const]),
          ),
        },
        pendingProposals: [],
      }
    : input;

  // 台本: 今月起きる出来事と予告（事業者を限った出来事は、その事業者の構成のときだけ。D-24 X-5）
  const events: MonthEvent[] = [];
  const platformNow = STACKS[state.stackIndex]!.provider;
  const forPlatform = (x: Scheduled) => {
    const ps = eventDef(sc, x.id)!.platforms;
    return !ps || ps.includes(platformNow);
  };
  const due = state.schedule.filter((x) => x.month === month && forPlatform(x));
  const noticed = state.schedule.filter(
    (x) => x.noticeMonth === month && forPlatform(x),
  );
  let humanFactor = 1;
  let botExtra = 0;
  let peakFactor = 1;
  let lasting = false;
  // 記事ごとの SNS のカードが出ないと、話題の伸びが小さい（SPA で OGP の前処理なし。ゲーム上の仮定・prd/10 F-05）
  const cardFactor = noSocialCards(state)
    ? (sc.frameworks?.spa?.socialCardFactor ?? 1)
    : 1;
  let socialLasting = false;
  const trafficEvents: {
    id: string;
    title: string;
    bot: boolean;
    factor: number;
    peak?: number;
    spikeDays?: number;
  }[] = [];
  const trafficNotes: string[] = [];
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    const n = def.notice!;
    if (n.pvFactor && n.bot) {
      // Bot の前兆（収益にならない。遮断していれば半分）
      const extra =
        (n.pvFactor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
      botExtra += extra;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: true,
        factor: 1 + extra,
      });
      trafficNotes.push(n.title);
    } else if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: false,
        factor: n.pvFactor,
      });
      trafficNotes.push(n.text);
    }
  }
  // 続いている流量の出来事（Bot は 2 か月など）
  for (const x of state.schedule) {
    if (x.month > month) continue;
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    for (const e of def.effects ?? []) {
      if (e.type !== 'traffic' || month >= x.month + e.months) continue;
      if (e.bot) {
        const extra =
          (e.factor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
        botExtra += extra;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: true,
          factor: 1 + extra,
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        trafficNotes.push(`${def.title}（Bot は収益にならない）`);
      } else {
        const factor = e.social ? 1 + (e.factor - 1) * cardFactor : e.factor;
        humanFactor *= factor;
        if (e.peakFactor) peakFactor *= e.peakFactor;
        if (e.lasting) lasting = true;
        if (e.lasting && e.social) socialLasting = true;
        if (e.social && cardFactor !== 1)
          trafficNotes.push(
            `記事ごとの SNS のカードが出ないので、話題の伸びが小さい（${fmtFactor(e.factor)} → ${fmtFactor(factor)}・ゲーム上の仮定）`,
          );
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: false,
          factor,
          ...(e.peakFactor ? { peak: e.peakFactor } : {}),
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        if (!e.lasting) trafficNotes.push(def.title);
      }
    }
  }
  // 台本の効果（流量以外）は起きた月から効く
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    state = applyEffects(state, def.effects ?? [], def.id);
  }
  const buzz = lasting;
  // 話題の後に残る伸びも、カードが出ないと小さい（同じ仮定）
  const buzzRule =
    socialLasting && cardFactor !== 1
      ? { ...sc.buzz, extra: sc.buzz.extra * cardFactor }
      : sc.buzz;
  const basePV = state.basePV;
  const humanPV = basePV * humanFactor;
  const botPV = humanPV * botExtra;
  const pv = humanPV + botPV;
  // 話題・Bot の上乗せ分は短い期間に集中する（容量の判定だけ。D-44）
  const spikes: Spike[] = trafficEvents.flatMap((t) =>
    t.spikeDays
      ? [
          {
            id: t.id,
            extraPV: t.bot
              ? humanPV * (t.factor - 1)
              : humanPV * (1 - 1 / t.factor),
            days: t.spikeDays,
          },
        ]
      : [],
  );

  const stackIndexNow = state.stackIndex;
  const stack = MVP_STACKS[stackIndexNow]!;
  const ssrCpuMs = nextSsrCpuMs(state);
  const parts: WorkloadParts = {
    pv,
    settings: state.settings,
    ssrCpuMs,
    mods: state.mods,
    stock: sc.stock ? state.stock : null,
    platform: platformNow,
    components: state.components,
    framework: state.framework,
    ...(peakFactor !== 1 ? { peakFactor } : {}),
    ...(spikes.length ? { spikes } : {}),
  };
  const workload = workloadFor(sc, parts);
  const swap = state.componentSwap;
  const architecture = architectureFor(
    stackIndexNow,
    state.seats,
    state.framework,
    state.components,
    swap ? { [swap.slot]: swap.option } : {},
    state.storageOption,
  );
  const monthBooks = booksAt(state, month);
  const r = estimate({ workload, architecture, books: monthBooks });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）。乗り換え先は既定の部品（D-24 X-9）
  const target = state.migration
    ? (() => {
        const to = state.migration.to;
        const components = componentsAfterMigration(
          to,
          state.mods,
          state.framework,
        );
        return estimate({
          workload: workloadFor(sc, {
            ...parts,
            platform: STACKS[to]!.provider,
            components,
          }),
          architecture: architectureFor(
            to,
            state.seats,
            state.framework,
            components,
          ),
          books: monthBooks,
        });
      })()
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  // ストレージ変更オプションの手数料（付けた次の月に一度だけ。D-30）
  // 申し込んだときのプランの金額を一度だけ払う（同じ月に上位へ変更しても変わらない）
  const fee = state.storageOptionFeeDue;
  const feeUsd = fee ? fee.amount / USD_JPY : 0;
  const infraCost = toUsd(r.bill.totals) + parallelInfraCost + feeUsd;

  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    // 予告を持ちうる台本は、予告どおり起きたか、予告なしで起きたか（D-28）
    const announced =
      def.notice && def.kind !== 'proposal'
        ? { announced: x.noticeMonth !== undefined }
        : {};
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      ...announced,
      title: def.title,
      text:
        def.notice && x.noticeMonth === undefined && def.surpriseText
          ? def.surpriseText
          : def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, r.premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...(def.previewRequirement
        ? {
            requirementStatus: requirementStatus(
              stackIndexNow,
              state.components,
              def.previewRequirement,
              state.framework,
            ),
          }
        : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def, state),
              ...(unavailableReason(state, def)
                ? { unavailable: unavailableReason(state, def)! }
                : {}),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.notice!.title,
      text: def.notice!.text,
      effects: [],
      premises: premiseRefsOf(def, r.premises),
    });
  }
  // 状態で起きる出来事（前提の使用率が境目を越えた。一度だけ）
  let fired = state.fired;
  for (const def of sc.events) {
    if (def.when.type !== 'premise' || fired.includes(def.id)) continue;
    const w = def.when;
    // 前の月は境目より下で、今月越えた前提（1 か月目から越えているものは「近づいた」と呼ばない）
    const p = r.premises.find(
      (q) =>
        w.premiseIds.some((id) => q.id.startsWith(id)) &&
        (q.ratio ?? 0) >= w.atLeast &&
        (prev?.snapshots.find((x) => x.id === q.id)?.ratio ?? Infinity) <
          w.atLeast,
    );
    if (!p) continue;
    fired = [...fired, def.id];
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'occurred',
      title: def.title,
      text: def.text,
      effects: [],
      premises: premiseRefsOf(
        { premiseRefs: w.premiseIds },
        r.premises.filter((q) => (q.ratio ?? 0) >= w.atLeast),
      ),
    });
  }
  // 実際に予告されている改定（始めた日が施行日より前のものだけ。D-21）
  const used = new Set(
    stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    events.push({
      id: c.id,
      kind: 'script',
      tier: 'common',
      phase: 'occurred',
      title: `${c.kind === 'pricing' ? '料金' : c.kind === 'limit' ? '制限' : '提供条件'}の改定が予告された（${c.provider}・施行日 ${c.effectiveFrom}）`,
      text: revisionText(c, used.has(c.provider)),
      effects: [],
      premises: [],
    });
  }

  // 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    accounts: accountUpkeepFor(state),
    interrupt: interruptOf(state),
    featureWork: featureWorkOf(state),
    featureBonus: featureBonusOf(state),
    // 乗り換えと DB の差し替えは同時に進めない（どちらかだけ）
    migrationWanted:
      migrationWanted(state.migration) + swapWanted(state.componentSwap),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;
  let componentSwap = swap
    ? { ...swap, done: swap.done + effort.migration }
    : null;

  const [rand, seed] = nextRandom(state.seed);
  // 自前運用のサーバーの偶発的な障害。部品で VPS を使うとき（VPS の API。D-67）も、そのホストがリクエストを受けていれば当たる
  const apiOnlyHost = !STACKS[stackIndexNow]!.selfHosted;
  const incident =
    selfHostedOf(stackIndexNow, state.components, state.framework, {}, true) &&
    rand < sc.incidents.selfHostedChancePerMonth;

  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = r.premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = r.premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  // CDN の定額のプランの込みを超えた前提（請求は増えない）。急増が大きいか、続けて超えると性能が調整される（D-61）
  const prevAdjust = new Set(
    (state.history[state.history.length - 1]?.premises ?? [])
      .filter((p) => p.hit && p.effect === 'adjust')
      .map((p) => p.id),
  );
  const adjusted = r.premises.filter(
    (p) =>
      p.hit &&
      p.effect === 'adjust' &&
      ((p.ratio ?? 0) > FLAT_PLAN_ADJUST.spikeRatio ||
        // 続けて超えた: 前の月も同じ前提で超えていた（sustainedMonths = 2 か月）
        prevAdjust.has(p.id)),
  );
  const loss = sc.revenue.loss;
  let revenue =
    (sc.revenue.fixedUsdPerMonth ?? 0) +
    (humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - loss.block;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - loss.incident;
    outages++;
    status = 'incident';
    notes.push(
      apiOnlyHost
        ? 'API の VPS の障害で数時間止まった（SLA なし・1 台構成。シェルは出るが中身が読めない）'
        : 'VPS の障害で数時間止まった（SLA なし・1 台構成）',
    );
  } else if (throttling.length) {
    revenue *= 1 - loss.throttle;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - loss.migration;
    notes.push('乗り換えの切り替えで収益が減った');
  }
  // 契約の収益（要件を満たす構成の月だけ。SLA の出来事・D-24）
  let contractRevenue = 0;
  for (const c of state.contracts) {
    if (
      meetsRequirement(
        stackIndexNow,
        c.requires,
        state.components,
        state.framework,
      )
    )
      contractRevenue += c.usdPerMonth;
    else
      notes.push(
        `契約の収益が入らなかった（${REQUIREMENT_LABEL[c.requires]}でない）`,
      );
  }
  revenue += contractRevenue;

  // 規約違反: 最初の月は指摘（警告）、翌月も違反したままならアカウント停止（D-19）
  const ps = policyStep({
    warnedMonth: state.policyWarnedMonth,
    violating: policy.length > 0,
    migrating: state.migration !== null,
    month,
  });
  const policyWarnedMonth = ps.warnedMonth;
  const policyWarning = ps.outcome === 'warned';
  const accountSuspended = ps.outcome === 'suspended';
  if (ps.outcome === 'warned')
    notes.push(
      `運営元から指摘が来た（規約違反の警告: ${policy[0]!.text}）。来月も違反したままならアカウントが停止される`,
    );
  else if (ps.outcome === 'grace')
    notes.push('規約違反のまま乗り換えの作業中（猶予中）');
  else if (accountSuspended)
    notes.push('規約違反が続いたため、アカウントが停止された');

  // 満足度と評判（prd/07 §9.1〜9.3）
  const sat = sc.satisfaction;
  // 部品で変わる判定の入力（D-24）: 最適化しない画像は原本の大きさ・キャッシュしないと記事は常に新しい・
  // KV を DB の代わりにすると書き込みがすぐ見えない
  const comps = { ...DEFAULT_CHOICES[platformNow], ...state.components };
  // 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品として見る。D-52）
  const imgs = imagesBehavior(platformNow, comps.images);
  const viewed: Settings = {
    ...state.settings,
    imageKB: deliveredImageKB(
      sc,
      state.settings,
      imgs,
      autoImageFormat(platformNow, state.framework, comps.images),
    ),
    // 最適化しない・一律で縮めて置くは、サイズ違いを作らず 1 種を配る（D-47）
    ...(imgs === 'resize' || imgs === 'none' ? { variants: 1 } : {}),
  };
  // 画質: 最適化しないは原本、それ以外は JPEG と同じ見た目（形式では下げない。D-58）。記事のデザインの刷新を断った月・
  // 受けたあと粗い画像（一律で縮めた原本の無い画像）が多い月は 1 段下げる（D-47）
  // 画像の形式は同じ見た目の画質で小さくするので、画質は下げない（D-58）。JPEG の大きさで判定する
  const qualityImageKB =
    imgs === 'none' ? viewed.imageKB : IMAGE_FORMAT_KB.jpeg;
  const redesign = imageRedesignQuality(state, sc, month, imgs);
  // SPA は ISR を持たず、ページの中身を毎回 API で読む（記事は常に新しい。prd/10）。
  // API の応答をキャッシュすると、記事はキャッシュの期間だけ古く見える（ISR の間隔と同じ判定。D-37）
  const spa = state.framework === 'vite-spa';
  const astro = state.framework === 'astro';
  // Astro の記事は静的なページで、鮮度はビルドの間隔で決まる（ISR のキャッシュの部品は無い。D-68）
  const uncached = spa
    ? !apiCacheActive(platformNow, state.components, state.framework)
    : !astro && comps.isrCache === 'none';
  // SPA の API の CPU（速さの「SSR の重さ」の代わりに使う。SSR の CPU × dataCpuFactor）
  const firstLoad = spa && (sc.frameworks?.spa?.firstLoadHeavy ?? false);
  // Astro の初回表示の軽さ（JS はアイランドの分だけ。速さの重さを 1 つ減らす。ゲーム上の仮定・D-68）
  const firstLoadLight =
    astro && (sc.frameworks?.astro?.firstLoadLight ?? false);
  const serverCpuMs = spa
    ? ssrCpuMs * (sc.frameworks?.spa?.shape.dataCpuFactor ?? 1)
    : ssrCpuMs;
  // HTML を前段の CDN でキャッシュすると、オンデマンドの再検証が届かず古いページが出る（D-31。同じく鮮度を 1 段下げる）
  // API を他の事業者に置いている間は、構成の DB の選択は使われない（DB は API の事業者の部品。OCL-5A7916E6）
  const eventuallyConsistent =
    (comps.db === 'kv' && !apiPlacedElsewhere(comps)) ||
    (!spa && htmlCachedAtFront(comps));
  // 即時反映（オンデマンド ISR）の要件を満たさない構成（D-32）。再検証の設定をオンデマンドにしたときも、
  // 対応しない部品があると再検証が届かず古いページが出る（同じ判定・同じ理由の文。D-49）
  const onDemandSetting = !spa && isOnDemand(state.settings);
  const onDemand =
    state.requirements.includes('on-demand-isr') || onDemandSetting
      ? onDemandBlocker(stackIndexNow, state.components, state.framework)
      : undefined;
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs: serverCpuMs,
      firstLoadHeavy: firstLoad,
      firstLoadLight,
      imageKB: viewed.imageKB,
      variants: viewed.variants,
      revalidateSec: viewed.revalidateSec,
      qualityImageKB,
      qualityDown: redesign !== undefined,
      featurePoints,
      month,
      premises: r.premises,
      uncached,
      eventuallyConsistent,
      onDemandUnmet: onDemand !== undefined,
      speedDown: adjusted.length > 0,
    },
    sat,
  );
  if (adjusted.length)
    notes.push(
      'CDN の定額のプランの込みを超え続け、配信の性能が調整された（請求は増えない。ゲーム上の仮定）',
    );
  const reasons = stageReasons(sc, stages, {
    blocking,
    throttling,
    adjusted,
    incident,
    switching: state.switching,
    ssrCpuMs: serverCpuMs,
    spa,
    astro,
    settings: viewed,
    heaviness: speedHeaviness(
      {
        ...viewed,
        ssrCpuMs: serverCpuMs,
        premises: r.premises,
        firstLoadHeavy: firstLoad,
        firstLoadLight,
      },
      sat,
    ),
    featurePoints,
    month,
    imagesUnoptimized: imgs === 'none',
    pageWeight: pageWeightLabel(
      pageWeightKB(
        sc,
        state.settings,
        state.mods,
        imgs,
        autoImageFormat(platformNow, state.framework, comps.images),
      ),
    ),
    qualityReason: redesign,
    eventuallyConsistent,
    uncached,
    onDemandReason: onDemand
      ? state.requirements.includes('on-demand-isr')
        ? `即時反映の要件を満たさない（${onDemand.label}。${onDemand.reason}）`
        : `オンデマンドの再検証が届かない（${onDemand.label}。${onDemand.reason}）`
      : undefined,
  });
  const score = satisfactionScore(stages, sat.weights);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad', sc.growth);
  const bonus = state.growthBonus.reduce(
    (a, b) => a + (b.months > 0 ? b.add : 0),
    0,
  );
  // 速さが「悪い」月は、離脱と検索からの流入の減りで PV の伸びが下がる（ゲーム上の仮定・D-47）
  const slowPenalty = stages.speed === 'bad' ? (sc.growth.slowPenalty ?? 0) : 0;
  if (slowPenalty > 0 && reasons.speed)
    reasons.speed += `。速さが悪く PV の伸びが約 ${Math.round(slowPenalty * 100)}% 下がった`;
  const net = g.net + bonus - slowPenalty;

  const cash = state.cash + revenue - infraCost;

  // 前提が初めて境目を越えた月: 出来事を外して見積を引き直し、理由を確かめる（prd/07 §10.7）
  const crossings = crossingsOf(sc, {
    prev,
    premises: r.premises,
    parts,
    architecture,
    books: monthBooks,
    humanPV,
    basePV,
    trafficEvents,
    state,
  });

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = stackIndexNow;
  let switching = false;
  let components = state.components;
  let mods = state.mods;
  let storageOption = state.storageOption;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    components = componentsAfterMigration(
      migration.to,
      state.mods,
      state.framework,
    );
    // 乗り換え・契約し直しは新しいサーバーなので、ストレージ変更オプションは付いていない
    storageOption = false;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${stackName(migration.to, state.framework)} に切り替える（部品は既定の選択から始まる）`,
    );
    if (mods.realtime && !realtimeSupported(STACKS[migration.to]!.provider)) {
      mods = withoutRealtime(mods);
      notes.push(
        'チャットは乗り換え先のリアルタイムのデータを取得していないため、乗り換えとともに止めた',
      );
    }
    migration = null;
  }
  // DB の差し替えが済んだら、次の月から新しい DB に切り替える
  if (componentSwap && componentSwap.done >= componentSwap.required) {
    components = { ...components, [componentSwap.slot]: componentSwap.option };
    // API を他の事業者に移したら、構成の DB の選択は既定に戻す（DB は API の事業者に移った。
    // 同じ事業者へ戻すときは既定の DB へ移す。OCL-5A7916E6）
    if (componentSwap.slot === 'api' && apiPlacedElsewhere(components)) {
      const { db: _db, ...rest } = components;
      components = rest;
    }
    notes.push(
      `${swapLabel(componentSwap.slot)}が済んだ。来月から ${componentLabel(platformNow, componentSwap.slot, componentSwap.option)} を使う`,
    );
    componentSwap = null;
  }

  // ためていく量（月ごとに増える。prd/07 §10.4）
  const stock = sc.stock ? grow(sc, state, humanPV) : state.stock;
  // 一律で縮めて置いた画像（原本が無い）は、記事のデザインの刷新を受ける前の分だけ粗い画像として数える（D-47）
  const coarseImages =
    (state.coarseImages ?? 0) +
    (imgs === 'resize' && !state.imageRedesign
      ? stock.images - state.stock.images
      : 0);

  const report: MonthReport = {
    month,
    stackName: stackName(
      stackIndexNow,
      state.framework,
      true,
      state.components,
    ),
    buzz,
    ...(trafficNotes.length ? { trafficNote: trafficNotes.join('・') } : {}),
    pv,
    humanPV,
    botPV,
    basePV,
    revenue,
    infraCost,
    parallelInfraCost,
    cash,
    status,
    notes,
    events,
    crossings,
    policyWarning,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    snapshots: r.premises
      .filter(
        (p) =>
          p.kind === 'threshold' &&
          p.ratio !== undefined &&
          Number.isFinite(p.ratio),
      )
      .map((p) => ({
        id: p.id,
        text: p.text,
        effect: p.effect,
        ratio: p.ratio!,
        hit: p.hit,
        accumulates: p.accumulates ?? false,
      })),
    lines: [
      ...[r, ...(target ? [target] : [])].flatMap((x) =>
        x.bill.lines
          .filter((l) => l.amount)
          .map((l) => ({
            label: lineLabel(l),
            provider: l.priceRef.provider,
            kind: l.kind,
            ...(l.priceRef.meterId ? { meterId: l.priceRef.meterId } : {}),
            amount: l.amount!,
            currency: l.currency,
            ...(l.priceRef.meterId === INVALIDATION_METER
              ? { quantity: l.quantity ?? 0 }
              : {}),
          })),
      ),
      ...(fee
        ? [
            {
              label: fee.label ?? `sakura-vps ${fee.name}（手数料・一度だけ）`,
              provider: 'sakura-vps',
              kind: 'fee' as const,
              amount: fee.amount,
              currency: 'JPY',
            },
          ]
        : []),
    ],
    unpricedLines: r.bill.unpricedLines + (target?.bill.unpricedLines ?? 0),
    settings: state.settings,
    ssrCpuMs,
    stock: state.stock,
    seats: state.seats,
    satisfaction: {
      stages,
      reasons,
      score,
      reputation: rep,
      acquisition: g.acquisition,
      churn: g.churn,
      growth: buzz ? buzzLasting(rep, buzzRule) * (1 - slowPenalty) - 1 : net,
      ...(slowPenalty > 0 ? { slowPenalty } : {}),
    },
    effort,
    featurePoints,
    components: comps,
    componentSummary: (Object.keys(SLOT_LABELS) as SlotId[])
      .filter(
        (slot) =>
          componentsOf(platformNow, slot, state.framework).length > 1 &&
          !slotIneffective(slot, comps),
      )
      .map(
        (slot) =>
          `${SLOT_LABELS[slot]}: ${componentLabel(platformNow, slot, comps[slot])}`,
      )
      .join('・'),
    contractRevenue,
    ...(swap
      ? {
          componentSwap: {
            label: `${SLOT_LABELS[swap.slot]}を ${componentLabel(platformNow, swap.slot, swap.option)} へ`,
            done: swap.done + effort.migration,
            required: swap.required,
          },
        }
      : {}),
    ...(state.migration
      ? {
          migration: {
            toName: stackName(state.migration.to, state.framework),
            done: state.migration.done + effort.migration,
            required: state.migration.required,
          },
        }
      : {}),
  };

  // 今月届いた提案は、月の終わりに返事を待つ
  const proposals = due.filter((x) => eventDef(sc, x.id)!.kind === 'proposal');

  const history = [...state.history, report];
  const finished = month >= sc.months;
  const end: GameState['end'] = accountSuspended
    ? { reason: 'policy', month }
    : outages > sc.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes(sc, { cash, outages, history }) ? 'won' : 'goal',
              month,
            }
          : undefined;
  return {
    ...state,
    seed,
    stackIndex,
    components,
    componentSwap,
    mods,
    storageOption,
    storageOptionFeeDue: null,
    cash,
    outages,
    featurePoints,
    migration,
    switching,
    plannedEffort: 0,
    policyWarnedMonth,
    stock,
    ...(coarseImages > 0 ? { coarseImages } : {}),
    fired,
    pendingProposals: end ? [] : proposals.map((x) => x.id),
    interrupts: state.interrupts
      .map((i) => ({ ...i, months: i.months - 1 }))
      .filter((i) => i.months > 0),
    growthBonus: state.growthBonus
      .map((b) => ({ ...b, months: b.months - 1 }))
      .filter((b) => b.months > 0),
    basePV: buzz
      ? basePV * buzzLasting(rep, buzzRule) * (1 - slowPenalty)
      : basePV * (1 + net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

function grow(sc: Scenario, state: GameState, humanPV: number): Stock {
  const rule = sc.stock!;
  const w = sc.template(1);
  // 1 MAU あたりの PV はテンプレートから読む（記事コミュニティは 10・業務アプリは 200。D-33）
  const mau = humanPV / Math.round(1 / w.traffic.mau);
  const uploads =
    mau * w.images.uploadsPerMau * (state.mods.uploadsFactor ?? 1);
  const s = state.stock;
  // 一律で縮めて置く部品なら、保存するのは縮めた大きさ（原本は残さない。D-47）
  const resize = imagesOf(state) === 'resize';
  const gbPerUpload = resize
    ? // 一律で縮めて置く: 形式が JPEG でなければ、古いブラウザ向けの JPEG も置く（MDN の推奨。D-58）
      (deliveredImageKB(sc, state.settings, 'resize') +
        (imageFormatOf(state.settings.imageKB) === 'jpeg'
          ? 0
          : sc.resizedImageKB)) /
      1e6
    : // 原本はそのまま置く（形式は閲覧・投稿のときに変える。D-58 で圧縮の比を掛けるのをやめた）
      rule.gbPerImage;
  return {
    dbGB:
      s.dbGB +
      (rule.dbGBPerMillionPV * humanPV * (state.mods.dbRateFactor ?? 1)) / 1e6,
    imagesGB: s.imagesGB + uploads * gbPerUpload,
    images: s.images + uploads,
    articlePages: s.articlePages,
  };
}

/** 境目を初めて越えた前提について、出来事ごとに効果を外した見積を引き直す（表示のためだけ）。 */
function crossingsOf(
  sc: Scenario,
  c: {
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    parts: WorkloadParts;
    architecture: ArchitectureInput;
    books: PriceBook[];
    humanPV: number;
    basePV: number;
    trafficEvents: {
      id: string;
      title: string;
      bot: boolean;
      factor: number;
      peak?: number;
    }[];
    state: GameState;
  },
): Crossing[] {
  const crossed = c.premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.hit &&
      Number.isFinite(p.ratio ?? NaN) &&
      // 前の月にも同じ前提があり、境目より下だった（1 か月目・乗り換えの直後は数えない）
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? Infinity) <= 1,
  );
  if (!crossed.length) return [];
  // 外してみる候補: 流量の出来事・受けた提案（Workload の変化・在庫の一括の増加）
  const variants: { eventId: string; title: string; parts: WorkloadParts }[] =
    [];
  for (const t of c.trafficEvents) {
    const pv = t.bot
      ? c.parts.pv - c.humanPV * (t.factor - 1)
      : c.parts.pv / t.factor;
    const peakFactor = (c.parts.peakFactor ?? 1) / (t.peak ?? 1);
    // 外した出来事の集中を除き、人の流量の出来事を外すなら残りの上乗せも同じ割合で小さくする
    const spikes = (c.parts.spikes ?? [])
      .filter((s) => s.id !== t.id)
      .map((s) => (t.bot ? s : { ...s, extraPV: s.extraPV / t.factor }));
    variants.push({
      eventId: t.id,
      title: t.title,
      parts: { ...c.parts, pv, peakFactor, spikes },
    });
  }
  for (const [id, res] of Object.entries(c.state.responses)) {
    if (res !== 'accepted') continue;
    const def = eventDef(sc, id);
    if (!def?.accept) continue;
    let mods = c.parts.mods;
    let stock = c.parts.stock;
    let pv = c.parts.pv;
    // basePV を外すと、話題・Bot の上乗せ（集中する分）も同じ割合で小さくなる（OCL-37A91830）
    let baseFactor = 1;
    for (const e of def.accept.effects) {
      if (e.type === 'workload') {
        const next = { ...mods };
        for (const k of Object.keys(e.mods) as (keyof WorkloadMods)[])
          delete next[k];
        mods = next;
      } else if (e.type === 'stock' && stock) {
        stock = {
          dbGB: stock.dbGB - (e.add.dbGB ?? 0),
          imagesGB: stock.imagesGB - (e.add.imagesGB ?? 0),
          images: stock.images - (e.add.images ?? 0),
          articlePages: stock.articlePages - (e.add.articlePages ?? 0),
        };
      } else if (e.type === 'basePV') {
        pv /= e.factor;
        baseFactor *= e.factor;
      }
    }
    const spikes = (c.parts.spikes ?? []).map((s) => ({
      ...s,
      extraPV: s.extraPV / baseFactor,
    }));
    variants.push({
      eventId: id,
      title: def.title,
      parts: { ...c.parts, mods, stock, pv, spikes },
    });
  }
  const ratios = variants.map((v) => {
    const r = estimate({
      workload: workloadFor(sc, v.parts),
      architecture: c.architecture,
      books: c.books,
    });
    return new Map(r.premises.map((p) => [p.id, p.ratio ?? 0]));
  });
  return crossed.map((p) => ({
    premiseId: p.id,
    text: p.text,
    causes: variants.flatMap((v, i) => {
      const without = ratios[i]!.get(p.id) ?? 0;
      return without <= 1
        ? [{ eventId: v.eventId, title: v.title, ratioWithout: without }]
        : [];
    }),
  }));
}

function stageReasons(
  sc: Scenario,
  stages: Stages,
  c: {
    blocking: PlatformPremise[];
    throttling: PlatformPremise[];
    /** 定額のプランの込みを超えて性能が調整された前提（D-61）。 */
    adjusted: PlatformPremise[];
    incident: boolean;
    switching: boolean;
    ssrCpuMs: number;
    /** SPA（速さの理由を「API の CPU・初回表示」で書く）。 */
    spa: boolean;
    /** Astro（鮮度の理由を「ビルドの間隔」で書く。D-68）。 */
    astro?: boolean;
    settings: Settings;
    heaviness: number;
    featurePoints: number;
    month: number;
    imagesUnoptimized: boolean;
    /** 1 ページの通信量の表示（速さの理由に添える。D-47）。 */
    pageWeight: string;
    /** 画質を下げた理由（記事のデザインの刷新。D-47）。 */
    qualityReason?: string | undefined;
    eventuallyConsistent: boolean;
    uncached: boolean;
    onDemandReason?: string | undefined;
  },
): Partial<Record<Element, string>> {
  const out: Partial<Record<Element, string>> = {};
  if (stages.availability !== 'good')
    out.availability = c.blocking.length
      ? `止まった: ${c.blocking[0]!.text}`
      : c.incident
        ? '偶発的な障害（数時間）'
        : '乗り換えの切り替え';
  if (stages.speed !== 'good')
    out.speed = c.throttling.length
      ? `前提に当たった: ${c.throttling[0]!.text}`
      : c.spa
        ? `重さ ${c.heaviness}（SPA の初回表示・API ${Number(c.ssrCpuMs.toFixed(1))} ms・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種・${c.pageWeight}）`
        : `重さ ${c.heaviness}（SSR ${c.ssrCpuMs} ms・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種・${c.pageWeight}）`;
  if (stages.quality !== 'good')
    out.quality = c.qualityReason ?? `画像 ${c.settings.imageKB} KB`;
  if (stages.freshness !== 'good')
    out.freshness = [
      !c.uncached &&
        (c.spa || !isOnDemand(c.settings)) &&
        (c.spa
          ? `API のキャッシュの期間 ${optionLabel('apiCacheTtl', c.settings.revalidateSec)}`
          : c.astro
            ? `ビルドの間隔 ${optionLabel('buildInterval', c.settings.revalidateSec)}`
            : `ISR の間隔 ${optionLabel('isr', c.settings.revalidateSec)}`),
      c.eventuallyConsistent &&
        'KV を DB の代わりにしているか、HTML を前段の CDN でキャッシュしていて、更新がすぐ見えない',
      c.onDemandReason,
    ]
      .filter(Boolean)
      .join('・');
  if (stages.speed !== 'good' && c.adjusted.length)
    out.speed = `配信の性能が調整された: ${c.adjusted[0]!.text}・${out.speed}`;
  if (c.imagesUnoptimized && out.speed && !c.throttling.length)
    out.speed += '（画像を最適化していない）';
  if (stages.feature !== 'good') {
    const expected = sc.satisfaction.feature.expectedPerMonth * c.month;
    out.feature = `機能開発 ${c.featurePoints} / 期待 ${expected}`;
  }
  return out;
}

export function averageSatisfaction(history: readonly MonthReport[]): number {
  return history.length
    ? history.reduce((a, r) => a + r.satisfaction.score, 0) / history.length
    : 0;
}

function passes(
  sc: Scenario,
  s: {
    cash: number;
    outages: number;
    history: readonly MonthReport[];
  },
): boolean {
  return (
    s.cash >= sc.goal.cash &&
    averageSatisfaction(s.history) >= sc.goal.satisfaction &&
    s.outages <= sc.goal.maxOutageMonths
  );
}

/** 月の終わりの行動（次の月に効く）。1 か月に複数選べる。選べない行動は状態を変えずに返す。 */
export function applyAction(state: GameState, action: Action): GameState {
  const check = checkAction(state, action);
  if (!check.ok || action.type === 'none') return state;
  const cost = check.cost;
  // 提案で付く部品を部品の欄で選ぶのは、その提案を受けるのと同じ（どちらから選んでも同じ結果）
  if (action.type === 'component') {
    const pending = componentProposal(state, action.slot, action.option);
    if (pending)
      return applyAction(state, {
        type: 'respond',
        eventId: pending,
        accept: true,
      });
  }
  const last = state.history[state.history.length - 1];
  const withNote = (label: string, s: GameState): GameState =>
    last
      ? {
          ...s,
          history: [
            ...s.history.slice(0, -1),
            {
              ...last,
              action: last.action ? `${last.action}・${label}` : label,
            },
          ],
        }
      : s;
  const planned = { plannedEffort: state.plannedEffort + cost };
  switch (action.type) {
    case 'set': {
      const def = SETTINGS[action.key];
      return withNote(
        `${def.label}: ${optionLabel(action.key, action.value)}`,
        {
          ...state,
          ...planned,
          settings: { ...state.settings, [def.field]: action.value },
        },
      );
    }
    case 'optimize':
      return withNote('SSR を最適化（−5 ms）', {
        ...state,
        ...planned,
        settings: {
          ...state.settings,
          ssrOptimizations: state.settings.ssrOptimizations + 1,
        },
      });
    case 'plan':
      return withNote(
        `${stackName(action.stackIndex, state.framework, true, state.components)} にプラン変更`,
        {
          ...state,
          ...planned,
          stackIndex: action.stackIndex,
        },
      );
    case 'migrate': {
      const migration: Migration = {
        from: state.stackIndex,
        to: action.stackIndex,
        required: migrationEffort(state.stackIndex, action.stackIndex),
        done: 0,
      };
      // 乗り換えの月ごとの手間と行動を合わせて、来月の手間に収まるか
      if (effortAvailable({ ...state, migration }) < 0) return state;
      return withNote(
        `${stackName(action.stackIndex, state.framework)} へ乗り換えを始めた`,
        {
          ...state,
          migration,
        },
      );
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId)!;
      const responded: GameState = {
        ...state,
        pendingProposals: state.pendingProposals.filter((id) => id !== def.id),
        responses: {
          ...state.responses,
          [def.id]: action.accept ? 'accepted' : 'declined',
        },
      };
      return withNote(
        `提案「${def.title}」を${action.accept ? '受けた' : '断った'}`,
        action.accept
          ? applyEffects(responded, def.accept!.effects, def.id)
          : responded,
      );
    }
    case 'storage-option': {
      const addon = storageOptionAddon(state.stackIndex)!;
      return withNote('ストレージ変更オプションを付けた', {
        ...state,
        ...planned,
        storageOption: true,
        storageOptionFeeDue: {
          name: addon.name,
          ...(addon.label ? { label: addon.label } : {}),
          amount: addon.oneTimeFee,
        },
      });
    }
    case 'block-bots':
      return withNote('Bot を遮断するルールを入れた', {
        ...state,
        ...planned,
        botBlocked: true,
      });
    case 'component': {
      const platform = STACKS[state.stackIndex]!.provider;
      const label = `${SLOT_LABELS[action.slot]}: ${componentLabel(platform, action.slot, action.option)}`;
      if (isDataSwap(action.slot)) {
        const componentSwap: ComponentSwap = {
          slot: action.slot,
          option: action.option,
          required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
          done: 0,
        };
        // 新しい事業者のアカウントを足す DB（Hyperdrive の Supabase など）は、設定の一度きりの手間も今月使う（D-52・OCL-B6A107A3）
        const next = { ...state, ...planned, componentSwap };
        if (effortAvailable(next) < 0) return state;
        return withNote(`${label} へ差し替えを始めた`, next);
      }
      return withNote(`${label} に差し替えた`, {
        ...state,
        ...planned,
        components: { ...state.components, [action.slot]: action.option },
      });
    }
  }
}

export function applyActions(
  state: GameState,
  actions: readonly Action[],
): GameState {
  return actions.reduce(applyAction, state);
}

/** 今月見込みを出さない理由（一時的に流量が増えた月。プレイヤーにも見えている出来事。prd/07 §10.7）。 */
export function projectionNote(r: MonthReport): string | undefined {
  if (r.buzz)
    return '話題になった月の伸びは続かないかもしれないので、今月は見込みを出さない';
  if (r.trafficNote)
    return `一時的に流量が増えた月（${r.trafficNote}）なので、今月は見込みを出さない`;
  return undefined;
}

// ---- 評価（prd/07 §9.6）----

export type Axes = {
  /** 累積の利益（最終の所持金 − 開始時）。 */
  profit: number;
  satisfaction: number;
  /** 要素ごとの平均の段階の数値（0〜1）。 */
  elements: Record<Element, number>;
  /** 最終月の基準の PV（話題・Bot の倍率を除く）。 */
  finalPV: number;
  featurePoints: number;
  /** 総ポイントに対する機能開発の割合。 */
  featureShare: number;
};

export function axesOf(state: GameState): Axes {
  const h = state.history;
  const n = Math.max(1, h.length);
  const last = h[h.length - 1];
  const elements = Object.fromEntries(
    ELEMENTS.map((e) => [
      e,
      h.reduce((a, r) => a + STAGE_VALUE[r.satisfaction.stages[e]], 0) / n,
    ]),
  ) as Record<Element, number>;
  const total = h.reduce((a, r) => a + r.effort.total, 0);
  return {
    profit: state.cash - scenarioOf(state).startCash,
    satisfaction: averageSatisfaction(h),
    elements,
    finalPV: last ? last.basePV : 0,
    featurePoints: state.featurePoints,
    featureShare: total ? state.featurePoints / total : 0,
  };
}

export type Check = {
  label: string;
  ok: boolean;
  value: string;
  target: string;
};

export function goalChecks(state: GameState): Check[] {
  const goal = scenarioOf(state).goal;
  const avg = averageSatisfaction(state.history);
  return [
    {
      label: '所持金',
      ok: state.cash >= goal.cash,
      value: `$${state.cash.toFixed(2)}`,
      target: `$${goal.cash} 以上`,
    },
    {
      label: '満足度の平均',
      ok: avg >= goal.satisfaction,
      value: avg.toFixed(2),
      target: `${goal.satisfaction} 以上`,
    },
    {
      label: '止まった月',
      ok: state.outages <= goal.maxOutageMonths,
      value: `${state.outages} 回`,
      target: `${goal.maxOutageMonths} 回以内`,
    },
  ];
}

export const END_LABEL: Record<EndReason, string> = {
  won: '目標達成',
  goal: '目標に届かず',
  cash: '所持金が尽きた',
  outages: '止まった回数の上限を超えた',
  policy: '規約違反が続き、アカウントが停止された',
};

export type Surprise = {
  premiseId: string;
  text: string;
  month: number;
  cause:
    | { kind: 'event'; title: string; ratioWithout: number }
    | { kind: 'action'; action: string }
    | { kind: 'growth' };
};

export type Reflection = {
  premises: { month: number; text: string; hit: boolean; action?: string }[];
  badMonths: {
    month: number;
    element: Element;
    label: string;
    reason: string;
  }[];
  effort: Omit<EffortBreakdown, 'total'> & { total: number };
  /** 見込みより早く超えた前提と、その理由（prd/07 §10.7）。 */
  surprises: Surprise[];
};

/**
 * 見込みが外れた理由（prd/07 §10.7）。前提が境目を初めて越えた月のうち、その月までの推移で
 * 「前の月の見込みより早く超えた」（GD-1 の earlierThanProjected）ものについて、
 * ① 外すと越えなかった出来事 → ② 前の月のプレイヤーの行動 → ③ 伸びが直近より速かった、の順に理由を決める。
 */
export function surprisesOf(state: GameState): Surprise[] {
  const months = scenarioOf(state).months;
  const out: Surprise[] = [];
  for (const r of state.history) {
    if (!r.crossings.length) continue;
    const earlier = new Set(
      premiseTrends(
        state.history.slice(0, r.month).map((m) => m.snapshots),
        months,
      )
        .filter((t) => t.earlierThanProjected)
        .map((t) => t.id),
    );
    for (const c of r.crossings) {
      if (!earlier.has(c.premiseId)) continue;
      const before = state.history[r.month - 2];
      const top = [...c.causes].sort(
        (a, b) => a.ratioWithout - b.ratioWithout,
      )[0];
      out.push({
        premiseId: c.premiseId,
        text: c.text,
        month: r.month,
        cause: top
          ? { kind: 'event', title: top.title, ratioWithout: top.ratioWithout }
          : before?.action
            ? { kind: 'action', action: before.action }
            : { kind: 'growth' },
      });
    }
  }
  return out;
}

/** 振り返り（①前提とその月の選択 ②「悪い」になった月と理由 ③手間の内訳 ④見込みが外れた理由）。 */
export function reflectionOf(state: GameState): Reflection {
  const seen = new Map<string, Reflection['premises'][number]>();
  for (const r of state.history)
    for (const p of r.premises) {
      const cur = seen.get(p.id);
      if (!cur || (!cur.hit && p.hit))
        seen.set(p.id, {
          month: r.month,
          text: p.text,
          hit: p.hit,
          ...(r.action ? { action: r.action } : {}),
        });
    }
  const badMonths = state.history.flatMap((r) =>
    ELEMENTS.filter((e) => r.satisfaction.stages[e] === 'bad').map((e) => ({
      month: r.month,
      element: e,
      label: ELEMENT_LABEL[e],
      reason: r.satisfaction.reasons[e] ?? '',
    })),
  );
  const effort = state.history.reduce(
    (a, r) => ({
      total: a.total + r.effort.total,
      upkeep: a.upkeep + r.effort.upkeep,
      accounts: (a.accounts ?? 0) + (r.effort.accounts ?? 0),
      interrupt: a.interrupt + r.effort.interrupt,
      featureWork: a.featureWork + r.effort.featureWork,
      featureBonus: a.featureBonus + r.effort.featureBonus,
      migration: a.migration + r.effort.migration,
      actions: a.actions + r.effort.actions,
      feature: a.feature + r.effort.feature,
    }),
    {
      total: 0,
      upkeep: 0,
      accounts: 0,
      interrupt: 0,
      featureWork: 0,
      featureBonus: 0,
      migration: 0,
      actions: 0,
      feature: 0,
    },
  );
  return {
    premises: [...seen.values()].sort((a, b) => a.month - b.month),
    badMonths,
    effort,
    surprises: surprisesOf(state),
  };
}

// ---- 次のプレイへのヒント（目標に届かなかったとき。D-40）----

export type RetryHint = {
  /** 原因の種類（画面のキー・テスト用）。 */
  kind:
    | 'limit'
    | 'incident'
    | 'policy'
    | 'cost'
    | 'overage'
    | 'element'
    | 'ogp'
    | 'slow';
  /** 何が起きたか（何か月目に・数値）。 */
  what: string;
  /** 次に試せる方向。正解の構成名は出さない（事業者の制限・プラン名など事実の名前は出してよい。D-40）。 */
  next: string;
};

/** 整数に丸めて 3 桁ごとにカンマを入れる。 */
const commas = (x: number) =>
  Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const usd = (x: number) => `$${commas(x)}`;

/** 月の並び（1 つなら「3 か月目」、続くなら「3〜5 か月目」、飛ぶなら「3・7 か月目」）。 */
function monthsText(ms: readonly number[]): string {
  if (ms.length === 1) return `${ms[0]} か月目`;
  const contiguous = ms.every((m, i) => i === 0 || m === ms[i - 1]! + 1);
  return contiguous
    ? `${ms[0]}〜${ms[ms.length - 1]} か月目`
    : ms.length <= 4
      ? `${ms.join('・')} か月目`
      : `${ms[0]} か月目から計 ${ms.length} か月`;
}

const ELEMENT_NEXT: Record<Exclude<Element, 'availability'>, string> = {
  speed:
    'ページの重さ（サーバーの処理・画像の大きさと種類）を設定や部品で軽くするか、処理の上限に余裕のある構成を考える',
  quality:
    '画像の画質が下がっている（記事のデザインの刷新など）。画像の部品と、原本を残しているかを見直す',
  freshness:
    'キャッシュの間隔や部品の性質で更新が遅れて見える。間隔を短くするか、更新がすぐ届く部品を考える',
  feature:
    '機能開発に回せる手間が期待に届かない。維持・出来事への対応・行動の手間を減らして、機能開発に回す',
};

/**
 * SPA で OGP の前処理なしに話題の月を迎えたときの、取り逃がした収益の見積もり（D-43）。
 * 行動の列は状態に残らないのでプレイを引き直せない。代わりに、カードが出ないことの効き方（socialCardFactor）だけを
 * 戻して記録から見積もる: 話題の月の広告の収益は 話題の伸び（× f）/ 小さくなった伸び（× (1 + (f − 1) × c)）倍、
 * それ以後の月は、話題の後に残る伸び（buzzLasting。その月の評判で）の比の倍になる。成長率・費用・上限への当たり方の
 * 変化は織り込まない（大きくなった流量で上限に当たる構成なら、この見積もりより少なくなる）。最初の該当の月だけを見る。
 */
function socialCardLoss(
  state: GameState,
):
  | { month: number; factor: number; reduced: number; extraRevenue: number }
  | undefined {
  const sc = scenarioOf(state);
  const c = sc.frameworks?.spa?.socialCardFactor ?? 1;
  if (state.framework !== 'vite-spa' || c === 1) return undefined;
  const h = state.history;
  const ads = (r: MonthReport) => {
    const raw = (r.humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
    const fixed = sc.revenue.fixedUsdPerMonth ?? 0;
    // 収益から契約の分を除き、止まった月などの減り方は広告と固定の分で同じとみなす
    return raw > 0
      ? ((r.revenue - r.contractRevenue) * raw) / (raw + fixed)
      : 0;
  };
  for (const r of h) {
    if (!r.buzz || r.components.ogp === 'prerender') continue;
    const effect = state.schedule
      .filter((x) => x.month === r.month)
      .flatMap((x) => eventDef(sc, x.id)?.effects ?? [])
      .find((e) => e.type === 'traffic' && e.social && e.lasting);
    if (!effect || effect.type !== 'traffic') continue;
    const factor = effect.factor;
    const reduced = 1 + (factor - 1) * c;
    const rep = r.satisfaction.reputation;
    const lastingRatio =
      buzzLasting(rep, sc.buzz) /
      buzzLasting(rep, { ...sc.buzz, extra: sc.buzz.extra * c });
    const extraRevenue =
      ads(r) * (factor / reduced - 1) +
      h
        .filter((x) => x.month > r.month)
        .reduce((a, x) => a + ads(x) * (lastingRatio - 1), 0);
    return { month: r.month, factor, reduced, extraRevenue };
  }
  return undefined;
}

/**
 * 次のプレイへのヒント（目標に届かなかったとき・途中で終わったとき。達成なら空）。
 * 未達の目標と終わり方ごとに、原因を月の記録（止まった月の前提・費用の内訳・満足度の理由・手間の内訳・出来事）から特定し、
 * 影響の大きい順に最大 3 つ返す。終わり方の直接の原因 → 未達の目標の原因 の順に並べる。
 */
export function retryHintsOf(state: GameState): RetryHint[] {
  if (state.phase !== 'lost' || !state.end) return [];
  const sc = scenarioOf(state);
  const h = state.history;
  const n = Math.max(1, h.length);
  const reason = state.end.reason;
  const early = reason !== 'goal';
  const cashShort = reason === 'cash' || (!early && state.cash < sc.goal.cash);
  const satShort = !early && averageSatisfaction(h) < sc.goal.satisfaction;
  const w = sc.satisfaction.weights;
  const out: { hint: RetryHint; score: number }[] = [];
  // 終わり方の直接の原因は 300 台、未達の目標の原因は 200 台、補足は 100 台（それぞれの中は影響の大きさ）
  const tier = (direct: boolean, metric: number) =>
    (direct ? 300 : 200) + Math.min(99, metric);

  // ① 前提（上限）に当たって止まった月
  const limits = new Map<
    string,
    { text: string; months: number[]; ratio: number; accumulates: boolean }
  >();
  for (const r of h) {
    if (r.status !== 'down') continue;
    for (const p of r.premises) {
      if (!p.hit || (p.effect !== 'block' && p.effect !== 'upgrade-required'))
        continue;
      const cur = limits.get(p.id) ?? {
        text: p.text,
        months: [],
        ratio: 0,
        accumulates: p.accumulates ?? false,
      };
      cur.months.push(r.month);
      cur.ratio = Math.max(cur.ratio, p.ratio ?? 0);
      limits.set(p.id, cur);
    }
  }
  // 同じ方向の対策になる前提はまとめる（無料プランは同じ月に複数の上限に当たる）
  const groups = new Map<
    string,
    {
      months: Set<number>;
      items: { text: string; ratio: number }[];
      cause?: string;
    }
  >();
  for (const [id, l] of limits) {
    const crossing = h
      .flatMap((r) => r.crossings)
      .find((c) => c.premiseId === id && c.causes.length);
    const cause = crossing
      ? [...crossing.causes].sort((a, b) => a.ratioWithout - b.ratioWithout)[0]
      : undefined;
    // 原因は一時的な流量の出来事か、受けた提案（以後ずっと効く負荷・保存量の追加）のどちらか（crossingsOf）
    const permanent =
      cause !== undefined && eventDef(sc, cause.eventId)?.kind === 'proposal';
    const next = permanent
      ? l.accumulates
        ? '受けた提案で保存量が増え、上限を越えた。ためていく量は減らない。受ける前に容量との余裕を確かめるか、容量の大きいプラン・部品へ移す'
        : '受けた提案で以後の負荷が増え、上限を越えた。受ける前に上限との余裕を確かめるか、上限の大きいプラン・部品・設定で負荷を下げる'
      : cause
        ? cause.eventId === 'bot'
          ? 'Bot の大量アクセスで上限を越えた。Bot を遮断するか、上限に余裕のあるプラン・部品を考える'
          : '一時的に流量が増える出来事で上限を越えた。予告や前兆が来たら、前もって上限に余裕を作る'
        : l.accumulates
          ? 'ためていく量（保存量）は減らない。上限に届く前に、容量の大きいプラン・部品へ移すか、ためる量を減らす'
          : '込みの量・無料枠の上限に当たると止まる。上限の大きいプラン・部品に変えるか、設定・部品で量や処理を減らす';
    const g = groups.get(next) ?? { months: new Set<number>(), items: [] };
    l.months.forEach((m) => g.months.add(m));
    g.items.push({ text: l.text, ratio: l.ratio });
    if (cause && !g.cause) g.cause = cause.title;
    groups.set(next, g);
  }
  const times = (r: number) =>
    r > 1 && Number.isFinite(r) ? `${r.toFixed(1)} 倍` : '';
  for (const [next, g] of groups) {
    const months = [...g.months].sort((a, b) => a - b);
    const items = [...g.items].sort((a, b) => b.ratio - a.ratio);
    const top = items[0]!;
    const by = g.cause ? `。「${g.cause}」が無ければ越えなかった` : '';
    const what =
      items.length === 1
        ? `${monthsText(months)}に「${top.text}」に当たって止まった${times(top.ratio) ? `。使用量は上限の ${times(top.ratio)}` : ''}${by}`
        : `${monthsText(months)}に止まった。当たった上限: ${items
            .slice(0, 2)
            .map(
              (x) =>
                `「${x.text}」${times(x.ratio) ? `（${times(x.ratio)}）` : ''}`,
            )
            .join(
              '・',
            )}${items.length > 2 ? ` ほか ${items.length - 2} 件` : ''}${by}`;
    out.push({
      hint: { kind: 'limit', what, next },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? months.length * 10 + Math.min(9, top.ratio)
          : (100 * w.availability * months.length) / n,
      ),
    });
  }

  // ② 自前運用の偶発的な障害
  const incidents = h
    .filter((r) => r.status === 'incident')
    .map((r) => r.month);
  if (incidents.length)
    out.push({
      hint: {
        kind: 'incident',
        what: `${monthsText(incidents)}に自前運用のサーバーの障害で止まった（偶発的。1 台構成・SLA なし）`,
        next: '自前運用は偶発的に止まることがある。止まった回数の上限に余裕を残すか、障害の対応を事業者に任せられる構成を考える',
      },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? incidents.length * 10
          : (100 * w.availability * incidents.length * 0.5) / n,
      ),
    });

  // ③ 規約違反（指摘の翌月も違反したまま）
  if (reason === 'policy') {
    // 停止につながった指摘は最後の指摘（一度解消して再び違反すると、指摘からやり直しになる。policyStep）
    const warned = h.findLast((r) => r.policyWarning);
    const p = warned?.premises.find((x) => x.hit && x.effect === 'policy');
    out.push({
      hint: {
        kind: 'policy',
        what: `${warned ? `${warned.month} か月目に運営元から規約違反の指摘${p ? `（${p.text}）` : ''}を受け、` : ''}${state.end.month} か月目も違反したままでアカウントが停止された`,
        next: '指摘が来た月のうちにプランを変えるか、乗り換えを始める（乗り換えの作業中は猶予される）。規約の条件は始める前に構成の説明で確かめられる',
      },
      score: tier(true, 99),
    });
  }

  // ④ 費用（所持金が足りない・尽きた）
  if (cashShort) {
    const byLabel = new Map<string, number>();
    const baseLabels = new Set<string>();
    const invLabels = new Set<string>();
    for (const r of h)
      for (const l of r.lines) {
        const v = l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
        if (v > 0) byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + v);
        if (l.kind === 'base-fee') baseLabels.add(l.label);
        if (l.meterId === INVALIDATION_METER) invLabels.add(l.label);
      }
    const top = [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const infra = h.reduce((a, r) => a + r.infraCost, 0);
    const revenue = h.reduce((a, r) => a + r.revenue, 0);
    const positive = [...byLabel.values()].reduce((a, v) => a + v, 0);
    const baseSum = [...byLabel]
      .filter(([k]) => baseLabels.has(k))
      .reduce((a, [, v]) => a + v, 0);
    const base = baseSum > positive / 2;
    const share = infra / Math.max(1, revenue);
    // オンデマンドの再検証の CloudFront の無効化が最も大きい費用（D-66）
    const inv = h.flatMap((r) =>
      r.lines.filter((l) => l.meterId === INVALIDATION_METER),
    );
    const invalidation =
      top[0] && invLabels.has(top[0][0])
        ? {
            paths: inv.reduce((a, l) => a + (l.quantity ?? 0), 0),
            usd: top[0][1],
          }
        : undefined;
    const shortText =
      reason === 'cash'
        ? `${state.end.month} か月目に所持金が尽きた`
        : `所持金 ${usd(state.cash)} で、目標 ${usd(sc.goal.cash)} に ${usd(sc.goal.cash - state.cash)} 足りない`;
    if (top.length)
      out.push({
        hint: {
          kind: 'cost',
          what: `${shortText}。${h.length} か月の収益 ${usd(revenue)} に対し、インフラの費用は ${usd(infra)}（${Math.round(100 * share)}%）で、大きいのは ${top.map(([k, v]) => `${k} ${usd(v)}`).join('・')}`,
          next: invalidation
            ? `オンデマンドの再検証で CloudFront の無効化が増えた（${h.length} か月で ${commas(invalidation.paths)} パス・${usd(invalidation.usd)}）。更新のたびにページごとに無効化するので、記事の更新が多い規模では高くつく。無効化が込みの定額のプラン・時間の再検証にする、または無効化をワイルドカード・タグでまとめる`
            : share < 0.2
              ? `費用は収益に比べて小さく、差は収益（PV の伸び）の側にもある。伸びは満足度（評判）で決まるので、「良い」でない要素や止まった月を減らす。費用を削るなら、${base ? '規模に見合う基本料を見直す' : '設定・部品で量を下げる'}`
              : base
                ? '基本料（固定費）が費用の大半。今の規模に見合う基本料か、込みの量や席がそこまで要るかを見直す'
                : '使った分の費用が大きい。設定・部品で量（転送・変換・実行）を下げるか、込みの量の大きいプランと比べる',
        },
        score: tier(reason === 'cash', 50 + Math.min(49, 100 * share)),
      });
    // 込み分を超えて請求が付いた前提
    const over = new Map<string, { text: string; months: number[] }>();
    for (const r of h)
      for (const p of r.premises) {
        if (!p.hit || p.effect !== 'cost') continue;
        const cur = over.get(p.id) ?? { text: p.text, months: [] };
        cur.months.push(r.month);
        over.set(p.id, cur);
      }
    for (const o of over.values())
      out.push({
        hint: {
          kind: 'overage',
          what: `${o.months[0]} か月目から「${o.text}」を超え、超えた分が請求された`,
          next: '込みの量・クレジットを超えた分は使った分だけ請求される。設定・部品で量を下げるか、超えたときの単価をプランごとに比べる',
        },
        score: tier(false, 20 + o.months.length),
      });
  }

  // ⑦ 速さが「悪い」で PV の伸びが下がった月（離脱・検索からの流入。ゲーム上の仮定・D-47）
  if (cashShort) {
    const slow = h.filter((r) => (r.satisfaction.slowPenalty ?? 0) > 0);
    if (slow.length) {
      const pen = slow[0]!.satisfaction.slowPenalty!;
      const cut =
        1 - slow.reduce((a, r) => a * (1 - r.satisfaction.slowPenalty!), 1);
      out.push({
        hint: {
          kind: 'slow',
          what: `${monthsText(slow.map((r) => r.month))}、速さが悪く PV の伸びが下がった（1 か月あたり約 ${Math.round(pen * 100)}%・合わせて約 ${Math.round(cut * 100)}%。${(slow[0]!.satisfaction.reasons.speed ?? '').replace(/。速さが悪く PV の伸び.*$/, '')}）`,
          next: '速さを「悪い」から戻す: 画像を原本のまま配っていないか（1 ページの通信量）、SSR の重さ、ピークに詰まる前提を見直す',
        },
        // 合わせて 1 割未満なら補足（100 台）。大きいときは未達の原因として並べる
        score:
          cut >= 0.1
            ? tier(reason === 'cash', Math.min(99, 100 * cut))
            : 100 + Math.min(99, 100 * cut),
      });
    }
  }

  // ⑥ SPA で OGP の前処理なしに話題の月を迎えた（記事ごとの SNS のカードが出ず、伸びが小さい。D-43）
  if (cashShort) {
    const ogp = socialCardLoss(state);
    if (ogp) {
      const shortfall = Math.max(1, sc.goal.cash - state.cash);
      const platform = STACKS[state.stackIndex]!.provider;
      // VPS で前段の CDN が無いと、伸びた話題の月に回線が詰まりうる（話題は短い期間に集中する。D-44）
      const noFrontCdn =
        platform === 'sakura' &&
        (state.components.frontCdn ?? 'none') === 'none';
      out.push({
        hint: {
          kind: 'ogp',
          what: `${ogp.month} か月目の話題で、記事ごとの SNS のカードが出ないため伸びが小さかった（話題の伸び ${fmtFactor(ogp.factor)} → ${fmtFactor(ogp.reduced)}・ゲーム上の仮定）。前処理があれば、収益は約 +${usd(ogp.extraRevenue)} の見込み${noFrontCdn ? '（ただし前段の CDN が無いと、伸びた話題の月に回線が詰まりうるので、増えた分の一部が失われる）' : ''}`,
          next: `SNS のカード（OGP）の前処理の部品（${componentLabel(platform, 'ogp', 'prerender')}）を、話題の前に付ける${noFrontCdn ? '。前段の CDN も一緒に付けると、話題の月の回線の詰まりを避けられる' : ''}`,
        },
        // 影響額で比べる: 足りない額に対する、取り戻せた収益の割合（半分以上なら最上位）
        score: tier(
          reason === 'cash',
          50 + Math.min(49, (100 * ogp.extraRevenue) / shortfall),
        ),
      });
    }
  }

  // ⑤ 満足度の要素（満足度の目標・伸び＝収益にも効く。可用性は ①② で扱う）
  if (satShort || cashShort) {
    const eff = reflectionOf(state).effort;
    for (const e of ELEMENTS) {
      if (e === 'availability' || !w[e]) continue;
      const months = h.filter((r) => r.satisfaction.stages[e] !== 'good');
      if (!months.length) continue;
      const loss =
        h.reduce(
          (a, r) => a + w[e] * (1 - STAGE_VALUE[r.satisfaction.stages[e]]),
          0,
        ) / n;
      const last = months[months.length - 1]!;
      // 維持には他の事業者の管理（D-52）を含める
      const upkeepSum = eff.upkeep + (eff.accounts ?? 0);
      const effortText =
        e === 'feature' && upkeepSum + eff.interrupt > 0
          ? `。維持の手間 計 ${upkeepSum}・出来事への対応 計 ${eff.interrupt}（手間の合計 ${eff.total} の ${Math.round((100 * (upkeepSum + eff.interrupt)) / Math.max(1, eff.total))}%）`
          : '';
      const growth = satShort ? '' : '満足度は伸び（PV と収益）にも効く。';
      out.push({
        hint: {
          kind: 'element',
          what: `${ELEMENT_LABEL[e]}が「良い」でない月が ${months.length} か月${last.satisfaction.reasons[e] ? `（${last.month} か月目: ${last.satisfaction.reasons[e]}）` : ''}${effortText}`,
          next: growth + ELEMENT_NEXT[e],
        },
        score: satShort
          ? tier(false, 100 * loss)
          : 100 + Math.min(99, 100 * loss),
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.hint);
}

// ---- 基準プレイ（目標値の根拠・成績の目盛り。prd/07 §9.6・§10.8）----

/** 記事コミュニティの基準プレイ（シナリオのデータ）。 */
export const BASELINES: Strategy[] = ARTICLE_COMMUNITY.baselines;

export function playStrategy(
  s: Strategy,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
  startDate: string = DEFAULT_START_DATE,
  framework?: FrameworkId,
): GameState {
  let st = playMonth(
    newGame(s.stackIndex, seed, scenario, startDate, framework),
  );
  for (let i = 0; st.phase === 'playing'; i++)
    st = playMonth(
      applyActions(st, s.decide ? s.decide(st) : (s.actions?.[i] ?? [])),
    );
  return st;
}

export type ComparisonRow = {
  id: string;
  /** 表の 1 列目に出す名前（基準プレイは短い名前）。 */
  name: string;
  /** 長い説明（ツールチップ用）。 */
  description: string;
  axes: Axes;
  you: boolean;
};

/** 結果の比較の表の行（あなた + 同じシードの基準プレイ）。表示用の名前はここで決める。 */
export function comparisonRows(state: GameState): ComparisonRow[] {
  const sc = scenarioOf(state);
  return [
    {
      id: 'you',
      name: 'あなた',
      description: 'あなたのプレイ',
      axes: axesOf(state),
      you: true,
    },
    ...sc.baselines.map((b) => ({
      id: b.id,
      name: b.short ?? b.label,
      description: b.label,
      // 基準プレイも同じフレームワークで回す（同じアプリの形で比べる。prd/10）
      axes: axesOf(
        playStrategy(b, state.startSeed, sc, state.startDate, state.framework),
      ),
      you: false,
    })),
  ];
}

export * from './rules.ts';
export * from './trends.ts';
export * from './scenario.ts';
export * from './save.ts';
export * from './estimate-mode.ts';
export { ARTICLE_COMMUNITY };
export { FRAMEWORKS, type FrameworkId } from 'catalog';

// フレーバーは計算に使わない表示用のデータなので、使うこの節でだけ読む
import {
  COMPONENT_FLAVOR,
  FILE_STORAGE_LABEL,
  fileStorageOf,
  STACK_FLAVOR,
} from 'catalog';

/** 構成の短い説明（始める画面のフレーバー。catalog の STACK_FLAVOR。D-41）。 */
export function stackFlavor(stackIndex: number): string | undefined {
  return STACK_FLAVOR[STACKS[stackIndex]!.id];
}
