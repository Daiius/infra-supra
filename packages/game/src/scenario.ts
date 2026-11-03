// シナリオと出来事のデータの形（prd/07 §10.1・§10.2・D-20）。ここは型と、台本の表を作る純粋関数だけ。
// シナリオの値（規模・収益・満足度の重み・手間・確率・時期・効果）はすべてゲーム上の仮定。
import type {
  AstroShape,
  FrameworkId,
  Platform,
  RouteStrategyId,
  RouteTraits,
  SlotId,
  SpaShape,
} from 'catalog';
import type { WorkloadInput } from 'estimator';
import { draws } from './random.ts';
import type { Element } from './rules.ts';
import type { Action, GameState } from './state.ts';

/** ためていく量（prd/07 §10.4）。 */
export type Stock = {
  dbGB: number;
  imagesGB: number;
  /** 画像の種類（一意な変換の数に効く）。 */
  images: number;
  articlePages: number;
};

export type StockRule = {
  /** DB の増え方（PV 100 万あたり・月）。 */
  dbGBPerMillionPV: number;
  /**
   * 画像 1 枚の原本の保存量。原本はそのまま置く（画像の形式は閲覧・投稿のときに変える。D-58 で圧縮の比を掛けるのをやめた）。
   * サイズ違いは含まない（投稿のときに作って保存する構成だけ、estimator が別に数える。OCL-F3098083）。
   */
  gbPerImage: number;
};

export type SatisfactionRules = {
  weights: Record<Element, number>;
  speed: {
    heavySsrCpuMs: number;
    heavyImageKB: number;
    nearRatio: number;
    /** 1 枚がこれ以上の画像（原本級）を配ると、速さはそれだけで「悪い」（ゲーム上の仮定・D-47）。省略は効かない。 */
    veryHeavyImageKB?: number;
  };
  quality: { good: number; fair: number };
  freshness: {
    good: number;
    fair: number;
    /**
     * 利用者が投稿した記事が、投稿した人に開けるまでの許容（秒。D-104・ゲーム上の仮定）。記事をビルドし直す形（静的書き出し）では、
     * 新しい記事のページはビルドが終わるまで無い。遅れ（間隔 + ビルドの時間）がこれを超えると、鮮度を 1 段下げる。省略は判定しない。
     */
    newPostVisibleSec?: number;
  };
  feature: { expectedPerMonth: number; good: number; fair: number };
};

/** 提案を受けたときの Workload の変化（以降ずっと）。 */
export type WorkloadMods = {
  /** 1 PV あたりの画像の枚数。 */
  imagesPerPage?: number;
  /** MAU あたりの画像の投稿の倍率。 */
  uploadsFactor?: number;
  /** SSR（個人化されたページ）の割合。 */
  ssrShare?: number;
  /** API 1 回あたりの書き込み。 */
  writesPerCall?: number;
  /** DB の増え方の倍率。 */
  dbRateFactor?: number;
  /** リアルタイム（チャット）。Workload の realtime にそのまま入る（D-24・W-1）。 */
  realtime?: NonNullable<WorkloadInput['realtime']>;
  /** API 1 回の CPU（ms）と応答の大きさ（KB）。帳票の出力など（D-33・prd/09 E-3）。 */
  apiCpuMs?: number;
  apiResponseKB?: number;
};

export type Effect =
  /** その月の PV の倍率。earnsRevenue: false は Bot（収益なし）。lasting は話題の後に残る伸び（§9.3）。 */
  | {
      type: 'traffic';
      factor: number;
      earnsRevenue: boolean;
      months: number;
      lasting?: boolean;
      bot?: boolean;
      /** その月のピークの係数の倍率（繁忙期。D-33・prd/09 E-2）。 */
      peakFactor?: number;
      /**
       * 上乗せ分（factor − 1 の PV）がその月のうち何日に集中するか（話題・Bot。ゲーム上の仮定・D-44）。
       * 容量の判定（ピークの時間帯）だけに効き、課金は月の総量のまま。省略は月全体に均等。
       */
      spikeDays?: number;
      /**
       * SNS で共有されて伸びる流量（話題）。記事ごとのカード（OGP）が出ない構成（SPA で前処理なし）では、
       * 伸びの分が Scenario.frameworks.spa.socialCardFactor 倍になる（ゲーム上の仮定・prd/10 F-05）。
       */
      social?: boolean;
    }
  | { type: 'workload'; mods: WorkloadMods }
  | { type: 'stock'; add: Partial<Stock> }
  | { type: 'basePV'; factor: number }
  /** 席（メンバー）を増やす。席課金のプランだけ費用が変わる（catalog の members）。 */
  | { type: 'seats'; add: number }
  | { type: 'effortPerMonth'; add: number }
  /** 出来事への対応の手間（翌月から months か月）。 */
  | {
      type: 'interrupt';
      points: number;
      months: number;
      /**
       * 機能の追加の作業（機能追加の提案への対応。D-29）。この手間はその月の機能開発に数え、
       * 同じ提案の feature の加点は受けた瞬間でなく、この作業の月に按分して足す。
       */
      featureWork?: boolean;
      /** 再検証がすでにオンデマンド（Next.js）なら要らない作業（オンデマンドへの切り替えの実装。D-49）。 */
      unlessOnDemand?: boolean;
    }
  /** ISR の再検証をオンデマンドにする（Next.js だけ。D-49）。 */
  | { type: 'on-demand-revalidate' }
  | { type: 'feature'; points: number }
  /** 成長率に足す（翌月から months か月）。 */
  | { type: 'growth'; add: number; months: number }
  /** 部品を付ける（受けた提案に要る部品。D-24）。 */
  | { type: 'component'; slot: SlotId; option: string }
  /**
   * 契約の収益（毎月）。requires を満たす構成のときだけ入る（SLA の出来事。D-24・SC-5）。
   */
  | { type: 'contract'; usdPerMonth: number; requires: Requirement }
  /** 以後ずっと構成に求める要件（満たさない月は満足度に効く。D-32）。 */
  | { type: 'requirement'; requirement: Requirement }
  /**
   * 記事のデザインの刷新を受ける（D-47）。手間は画像の部品で決まる: 原本がある構成 1・一律で縮めた構成 2
   * （これからの投稿だけ大きくできる）・最適化しない（原本を配っている）0。
   */
  | { type: 'imageRedesign' };

/** 構成に求める要件。uptime-sla: 課金先のプランがすべて稼働率の SLA を持つ（catalog の uptimeSla）。 */
export type Requirement = 'uptime-sla' | 'on-demand-isr' | 'db-pitr';

export type EventKind = 'state' | 'proposal' | 'script';
export type EventTier = 'common' | 'occasional' | 'rare';

export type EventDef = {
  id: string;
  kind: EventKind;
  tier: EventTier;
  title: string;
  text: string;
  when:
    /** 時期をシードで決める（台本・提案）。 */
    | {
        type: 'window';
        from: number;
        to: number;
        /** 起きる確率（省略は必ず起きる。乱数は出来事の列の 3 つ目。月と予告の乱数は変わらない。D-47）。 */
        chance?: number;
      }
    /** まれな出来事の候補（1 ゲームに高々 1 回。Scenario.rare で引く）。 */
    | { type: 'rare'; weight: number }
    /** 前提の使用率が境目を越えた月（前の月は下だった。状態）。premiseIds は前提の id の前方一致。 */
    | { type: 'premise'; premiseIds: string[]; atLeast: number };
  /** 予告（何か月前に出すか）。pvFactor は前兆（その月の PV の倍率）。 */
  notice?: {
    monthsAhead: number;
    /** 予告の見出し（起きたように読めない言い方にする。例: 「SNS で話題になりそう」）。 */
    title: string;
    text: string;
    pvFactor?: number;
    /** 前兆の流量が Bot か（収益にならない。Bot の遮断が効く）。 */
    bot?: boolean;
    /**
     * 予告が出る確率（D-28）。省略は必ず出る。出なければ予告なしで起き、対処は翌月から。
     * 乱数は出来事の列から月の次に引く（月は変わらない）。
     */
    chance?: number;
    /** この月より前には予告を出さない（序盤の 1〜2 か月は台本を出さない。D-20 V-12）。 */
    notBefore?: number;
  };
  /** 予告なしで起きたときの文（D-28）。 */
  surpriseText?: string;
  /** 当たりうる前提の id の前方一致。通知に catalog の前提の文をそのまま出す（D-12）。 */
  premiseRefs: string[];
  /** 提案の「受ける」の効果（断ると何も起きない。D-20 V-11）。 */
  accept?: { label: string; effects: Effect[] };
  /** 提案以外の効果。 */
  effects?: Effect[];
  /** 席の料金を通知に出す（チームが増える）。 */
  showMembers?: boolean;
  /** 今の構成の SLA の扱い（catalog の uptimeSla の文）を通知に出す。 */
  showSla?: boolean;
  /** この事業者の構成のときだけ出す（データが無い事業者の罰にしないため。D-24 X-5）。 */
  platforms?: Platform[];
  /** 受けるのに要る要件（満たせる構成でなければ受けられない。理由を出す）。 */
  requires?: Requirement;
  /** 受ける前に、構成・部品ごとにこの要件を満たせるかを出す（D-32）。 */
  previewRequirement?: Requirement;
  /**
   * 起きる月の構成が先に手を打っていれば、提案（苦情）の代わりに出す知らせ（D-118）。効果は起きた月から当てる。
   * edits-immediate: 記事の投稿・編集がすぐ見える構成（editsReflectImmediately）。時期の乱数は変えない（台本はそのまま）。
   */
  preempted?: {
    by: 'edits-immediate';
    title: string;
    text: string;
    effects: Effect[];
  };
};

export type Strategy = {
  id: string;
  label: string;
  /** 表の見出しに使う短い名前。 */
  short?: string;
  stackIndex: number;
  /** フレームワーク（省略はシナリオの既定）。 */
  framework?: FrameworkId;
  /** 始める画面で選ぶページごとの描き方（ルートの id → 描き方。省略はフレームワークの既定。D-107）。 */
  routes?: Readonly<Partial<Record<string, RouteStrategyId>>>;
  /** 毎月の行動の固定の列（添字 0 が 1 か月目の終わり）。 */
  actions?: Action[][];
  /** 状態を見て行動を決める（台本の時期がシードで揺れるため。§10.8）。actions より優先。 */
  decide?: (s: GameState) => Action[];
};

export type Scenario = {
  id: string;
  name: string;
  months: number;
  /** テンプレート（PV → Workload）。catalog のものを見積モードと共有する。 */
  template: (pv: number) => WorkloadInput;
  /** テンプレートのルートの性質（見る人・SNS のカード・鮮度の要件・部品。catalog のテンプレートのデータ。D-107）。 */
  routeTraits: Readonly<Record<string, RouteTraits>>;
  /** ためていく量の増え方。null なら増えない（テンプレートの値のまま）。 */
  stock: StockRule | null;
  scale: { startPV: number };
  growth: {
    acquisition: number;
    churn: number;
    /**
     * 速さが「悪い」月に、PV の伸び（純成長率）から引くポイント（離脱・検索からの流入の減り。ゲーム上の仮定・D-47）。
     * 省略は 0。
     */
    slowPenalty?: number;
  };
  /** 話題の月の後に残る倍率 = 1 + extra × 評判 / reference。 */
  buzz: { extra: number; reference: number };
  revenue: {
    /** 固定の月額（運用・保守の費用など。D-33・prd/09 E-1）。省略は 0。止まった月などの減りは固定分にも掛かる。 */
    fixedUsdPerMonth?: number;
    /** 人の PV 1,000 あたりの収益（広告・利用に応じた従量）。 */
    adsUsdPer1000PV: number;
    loss: {
      block: number;
      throttle: number;
      incident: number;
      migration: number;
    };
  };
  incidents: { selfHostedChancePerMonth: number };
  /**
   * API の書き込みのうち、記事のページ（ISR・Astro のキャッシュ・静的書き出しの静的なページ）の HTML を作り直す更新の割合（記事の投稿・編集）。
   * 月の内容の更新 = PV × 1 PV あたりの API × 書き込みの割合 × この値。オンデマンドの再検証の再生成・CDN の無効化と、
   * Astro のキャッシュを消す数・静的書き出しのビルドし直しの数のもと。コメント・いいねは別のデータとして読み込み、ページを作り直さないとみなす（既定。記事のページの部品「コメント欄」で含めると comments を足す。D-109）
   * （一般的な作り方の仮定。D-49・D-70・prd/04 §2）。
   */
  pageUpdateShare: number;
  /**
   * 記事のページの部品「コメント欄」（D-82。段 4 で設定から移した。D-109）。記事のページに含める（ISR・静的なページの HTML にコメントも入れる）と、
   * API の書き込みのうちこの割合（コメントの投稿）も記事のページを作り直す（pageUpdateShare に足す）。
   * 省略したシナリオでは設定を出さない（受託など、コメントの無いアプリ）。値はゲーム上の仮定。
   */
  comments?: {
    pageUpdateShare: number;
    /**
     * 記事のページに含めて時間で再検証・ビルドするとき、コメントが間隔の分だけ遅れて見える。その遅れ（秒）の鮮度の段階の境目
     * （D-85。記事の freshness より厳しい。満足度の鮮度は記事とコメントの悪い方）。値はゲーム上の仮定。
     */
    freshness: { good: number; fair: number };
  };
  /** 画像を最適化しない部品のときに配る大きさ（原本の大きさ＝stock.gbPerImage と同じ。ゲーム上の仮定・D-24・D-47）。 */
  unoptimizedImageKB: number;
  /**
   * 画像を投稿のときに一律で縮めて置く部品の、1 枚の大きさ（JPEG のとき。保存も配信もこの大きさで、画像の形式の比で小さくなる。
   * 長い辺 1,600〜2,000px 程度の JPEG・WebP を想定したゲーム上の仮定・D-47）。
   */
  resizedImageKB: number;
  /**
   * 記事のデザインの刷新（大きな画面向けに画像を大きく出したい）の提案（D-47）。確率と、断ったときに画質を下げる月数、
   * 受けたあと一律で縮めた粗い画像が在庫のこの割合以上なら画質を 1 段下げる（いずれもゲーム上の仮定）。
   */
  imageRedesign?: { declineMonths: number; coarseShare: number };
  satisfaction: SatisfactionRules;
  effort: { perMonth: number; selfHostedUpkeep: number };
  /** まれな出来事: 1 ゲームに高々 1 回。起きる確率と時期の幅。 */
  rare: { perGame: number; from: number; to: number };
  events: EventDef[];
  /**
   * 実際に予告されている改定（catalog の scheduledChanges）の出来事が起きる月の幅（D-21）。null なら出さない。
   * 始めた日が施行日より前の予告だけが起きる。
   */
  revisions: { from: number; to: number } | null;
  goal: { cash: number; satisfaction: number; maxOutageMonths: number };
  startCash: number;
  baselines: Strategy[];
  /**
   * 選べるフレームワークと既定（prd/10 F-04）。省略は Next.js だけ。
   * spa: SPA にしたときのアプリの形（catalog のテンプレートの既定値）と、SNS のカードの効き方（ゲーム上の仮定）。
   */
  frameworks?: {
    allowed: FrameworkId[];
    default: FrameworkId;
    spa?: {
      shape: SpaShape;
      /** 記事ごとのカードが出ないとき、話題の伸び（倍率 − 1 と後に残る分）に掛ける値（ゲーム上の仮定）。 */
      socialCardFactor: number;
      /** 初回表示（シェル → JS → API）を速さの重さに 1 つ数えるか（ゲーム上の仮定）。 */
      firstLoadHeavy: boolean;
    };
    /**
     * Astro にしたときのアプリの形（catalog のテンプレートの既定値）と、初回表示の効き方（ゲーム上の仮定。D-68）。
     * 記事は静的にビルドし、更新はビルドし直し（間隔は設定「ビルドの間隔」）。
     */
    astro?: {
      shape: AstroShape;
      /** JS がアイランドの分だけで初回表示が軽いとみなし、速さの重さを 1 つ減らすか（ゲーム上の仮定）。 */
      firstLoadLight: boolean;
    };
  };
  /** 画面の文言（始める画面の説明。D-33・prd/09 E-6）。省略時は画面の既定。 */
  text?: ScenarioText;
  /** このシナリオで効かない行動を画面に出さない（D-33・prd/09 E-6）。 */
  hidden?: {
    settings?: (
      | 'format'
      | 'variants'
      | 'isr'
      | 'apiCacheTtl'
      | 'buildInterval'
      | 'pageCache'
    )[];
    slots?: SlotId[];
    blockBots?: boolean;
  };
};

/** 始める画面の説明（シナリオごとの文言）。数値は画面がシナリオの値から足す。 */
export type ScenarioText = {
  /** 何のアプリで、どう収益を得るか。 */
  intro: string;
  /**
   * ページの一覧（ページ → 見る人・要件の順。1 ページ 1 行。D-101）。描き方はフレームワークで変わるので byFramework.pages に書く。
   * テンプレートのルート（label）と同じ単位にする。
   */
  pages?: string[];
  /** 規模の補足（誰が使うか）。 */
  scale?: string;
  /** 成長の言い方（満足度が高い / 低いとき）。画面が「満足度 0.9 で毎月約 N%」を挟む。 */
  growth: { up: string; down: string };
  /** 運営中に起きる出来事の説明。 */
  events: string;
  /** 満足度の要素の説明。 */
  satisfaction: string;
  /** アプリの形（コストに効く判断ポイント）のうち、フレームワークに依らない文。 */
  app: string[];
  /**
   * フレームワークごとの文（D-35。シナリオの説明には入れず、始める画面の構成のカードのフレームワーク欄に出す）。
   * note: 短い注記（カードに出す）。pages: ページごとの描き方（カードに出す）。app: ⓘ に畳む長い説明（SSR / API の CPU の行は画面がテンプレートから足す）。
   */
  byFramework?: Partial<
    Record<
      FrameworkId,
      {
        note?: string;
        /** ページごとの描き方と、その帰結（1 ページ 1 行。選ぶ前に構成のカードに出す。D-101）。 */
        pages?: string[];
        app?: string[];
      }
    >
  >;
  /** 収益の文（ゲーム上の仮定であることを含める）。 */
  revenue?: string;
  /**
   * ページの見取り図（D-102。始める画面で、選んだフレームワークでページのどの区画をどう作るかを出す）。
   * テンプレートのルート 1 つに 1 枚。区画の作られ方は今の計算のモデル（D-68・D-70・D-80・D-82）に合わせた、ゲーム上の仮定の図。
   */
  wireframes?: PageWireframe[];
  /**
   * ページの外の要素（D-117）。見取り図の脇に小さなカードで出す（今はメールだけ）。ページの区画ではないので、要件の札・
   * 描き方の色は付けない。シナリオが使う（Workload に email がある）ときだけ出す。
   */
  offscreen?: OffscreenElement[];
};

/** ページの外の要素（D-117）。kind は見た目（アイコン）の種類で、意味は label・items・note に書く。 */
export type OffscreenElement = {
  kind: 'email';
  /** カードの題（「メール（ページの外）」など）。 */
  label: string;
  /** 何を送るか（1 行 1 つ）。 */
  items: string[];
  /** 何が効くか（送信の仕組みの選び方・出来事）。 */
  note?: string;
};

/**
 * 見取り図の区画の作られ方（D-102）。画面は札の文字（REGION_SOURCES の short）を必ず出し、色・模様は補助にする。
 */
export type RegionSource =
  | 'build'
  | 'isr'
  | 'cached'
  | 'ssr'
  | 'api'
  | 'island'
  | 'island-shell'
  | 'server-island'
  | 'cc-cached'
  | 'cc-dynamic'
  | 'shell'
  | 'image';

/** 区画の作られ方の札（short）と凡例の説明（long）。 */
export const REGION_SOURCES: Readonly<
  Record<RegionSource, { short: string; long: string }>
> = {
  build: {
    short: 'ビルドで静的',
    long: 'ビルドのときに HTML を作り、静的な配信から返す（変えるにはビルドし直す）',
  },
  isr: {
    short: 'ISR（キャッシュ）',
    long: '最初の閲覧でサーバーが描いてキャッシュし、再検証で描き直す',
  },
  // Astro の記事（D-103）
  cached: {
    short: '閲覧時に SSR + キャッシュ（投稿で消す）',
    long: '最初の閲覧でサーバーが描き、前段（CDN・Workers Cache・Node のメモリ）にキャッシュする。記事の投稿・編集でそのページのキャッシュを消す（消せない事業者では期限で取り直す）',
  },
  ssr: {
    short: '閲覧ごとに SSR',
    long: '閲覧のたびにサーバーが描く（1 回ごとに CPU を使う）',
  },
  api: {
    short: 'ブラウザが API で取る',
    long: 'ページを開いてから、ブラウザの JS が API で中身を取って描く',
  },
  island: {
    short: 'アイランドが API で取る',
    long: '静的な HTML の中の動きのある部品（アイランド）だけ、ブラウザが API で取る',
  },
  // 枠 + サーバーの島（S6。D-108）
  'island-shell': {
    short: '枠（使い回す）',
    long: '人ごとに違わない枠。Astro は最初の閲覧で描いてキャッシュし 1 日の期限で取り直す。Next.js の PPR はビルドで作った枠を島と同じ応答の先頭で流す（費用は閲覧ごとに島を描く分で数える）',
  },
  'server-island': {
    short: 'サーバーの島（閲覧ごとに一部だけ描く）',
    long: '人ごとに違う部分だけを閲覧のたびにサーバーが描く（Astro は枠とは別のリクエスト・Next.js の PPR は同じ応答の中）。キャッシュしない',
  },
  // 部品ごとにキャッシュ（Cache Components。D-111）
  'cc-cached': {
    short: "部品をキャッシュ（'use cache'）",
    long: "全員に同じ部品。'use cache' でキャッシュして静的な枠に入れ、期限（cacheLife）かタグ（cacheTag・updateTag）で作り直す（Vercel は全体の ISR のキャッシュと CDN、自前の Node はインスタンスのディスク・メモリ）",
  },
  'cc-dynamic': {
    short: '動的な穴（閲覧ごとに描く）',
    long: '人ごとに違う部分。Suspense の中で閲覧のたびにサーバーが描き、枠と同じ応答で続けて流す。キャッシュしない',
  },
  shell: {
    short: 'シェル + JS',
    long: 'どのページも同じ 1 つのシェル（静的）を返し、ブラウザの JS が描く',
  },
  image: {
    short: '画像の配信',
    long: 'HTML とは別のリクエストで、画像の部品（変換・CDN）から届く',
  },
};

/**
 * 見取り図の区画の要件（D-113）。作られ方（RegionSource）と違い、フレームワークに依らない「その区画が何で、何が要るか」。
 * シナリオの説明の見取り図に札で出す。ゲーム上の仮定（計算には使わない）。
 */
export type RegionNeed =
  'same' | 'personal' | 'fresh' | 'live' | 'ogp' | 'media' | 'input';

/** 区画の要件の札（short）と凡例の説明（long）。並びは凡例の順。 */
export const REGION_NEEDS: Readonly<
  Record<RegionNeed, { short: string; long: string }>
> = {
  same: { short: '全員に同じ', long: '誰が見ても同じ中身' },
  personal: {
    short: '人ごとに違う',
    long: 'ログインした人ごとに中身が違う（使い回せない）',
  },
  fresh: {
    short: 'すぐ見えてほしい',
    long: '投稿・編集・登録したら、すぐ見えてほしい',
  },
  live: {
    short: '閲覧ごとに変わる',
    long: '見るたびに数・中身が変わりうる（いいね数・新しいコメント・通知）',
  },
  ogp: {
    short: 'SNS のカードが要る',
    long: 'SNS・検索に、ページごとのタイトル・画像（OGP）を HTML で見せたい',
  },
  media: {
    short: '画像',
    long: 'HTML とは別のファイルとして届く（変換・配信の費用がかかる）',
  },
  input: {
    short: '書き込む',
    long: '人が送信する（投稿・登録。サーバーの API が受ける）',
  },
};

/**
 * 見取り図の区画の見た目の種類（D-113 の追記）。シナリオの説明の見取り図で、区画を本物のページに近い
 * スケルトン（ロゴ・文の行・画像・アイコンなどの灰色の塊）で描くのに使う。ゲーム上の仮定（計算には使わない）。
 */
export const REGION_KINDS = [
  'header',
  'login',
  'title',
  'body',
  'image',
  'likes',
  'comments',
  'related',
  'footer',
  'profile',
  'notifications',
  'list',
  'form',
  'post-button',
  'table',
  'search',
  'menu',
] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

/** 見取り図の区画（D-102）。幅は横いっぱい（full）か半分（half）、高さは目安の 3 段。 */
export type WireframeRegion = {
  id: string;
  /** 区画の名前（画面に文字で出す）。 */
  label: string;
  width?: 'full' | 'half';
  height?: 'sm' | 'md' | 'lg';
  /** 区画の要件（フレームワークに依らない。シナリオの説明の見取り図に出す。D-113）。すべての区画に書く（テストで確かめる）。 */
  needs?: RegionNeed[];
  /** 区画の見た目の種類（シナリオの説明の見取り図のスケルトン。D-113 の追記）。すべての区画に書く（テストで確かめる）。 */
  kind?: RegionKind;
};

/** ページの見取り図 1 枚（D-102）。 */
export type PageWireframe = {
  /** テンプレートのルートの id（ページの名前はルートの label を使う）。 */
  route: string;
  regions: WireframeRegion[];
  /** フレームワークごとの、区画の id → 作られ方。すべての区画を書く（テストで確かめる）。 */
  byFramework: Record<FrameworkId, Record<string, RegionSource>>;
  /**
   * 描き方 S6（枠 + サーバーの島）にしたときに島になる区画（人ごとに違う部分。D-108）。ほかの HTML の区画は枠
   * （island-shell）になる。S6 を選べるページ（人ごとに違うページ）だけに書く。
   */
  islandRegions?: string[];
  /** 記事のページの部品「コメント欄」で記事のページに含めたときに上書きする区画（D-82・D-109）。 */
  commentsInPage?: Partial<Record<FrameworkId, Record<string, RegionSource>>>;
  /**
   * 記事ごとの枠（全員に同じ中身のページの S5。Next.js・Astro・静的書き出し。D-109）にしたときの区画の作られ方と札。
   * 枠（ビルドで書き出す・メタタグ入り）と、ブラウザが API で取る中身に分ける。
   */
  shellPerPage?: { sources: Record<string, RegionSource>; badges: PageBadge[] };
  /** フレームワークごとの、ページの短い札（鮮度・SNS のカード・CPU の注意・API の増え方。文字で出す）。 */
  badges?: Partial<Record<FrameworkId, PageBadge[]>>;
};

/** ページの短い札（D-102）。kind は見た目の補助で、意味は text に書く。 */
export type PageBadge = {
  kind: 'freshness' | 'ogp' | 'cpu' | 'api';
  text: string;
};

/** 台本の表の 1 行（newGame で一度に作る。プレイヤーの選択に依存しない）。 */
export type Scheduled = { id: string; month: number; noticeMonth?: number };

/**
 * 台本の表を作る（prd/07 §10.5）。出来事ごとに id とシードから独立した列を引くので、
 * 出来事を足しても他の出来事の時期は変わらない。偶発的な障害の列（GameState.seed）には触れない。
 */
export function rollSchedule(sc: Scenario, startSeed: number): Scheduled[] {
  const out: Scheduled[] = [];
  const at = (def: EventDef, month: number, noticeDraw?: number): Scheduled => {
    const n = def.notice;
    const noticeMonth = n ? month - n.monthsAhead : undefined;
    const noticed =
      n !== undefined &&
      noticeMonth! >= (n.notBefore ?? -Infinity) &&
      (n.chance === undefined || (noticeDraw ?? 0) < n.chance);
    return {
      id: def.id,
      month,
      ...(noticed ? { noticeMonth: noticeMonth! } : {}),
    };
  };
  for (const def of sc.events) {
    if (def.when.type !== 'window') continue;
    // 1 つ目で月、2 つ目で予告の有無（同じ列の続きなので、月は予告の有無を足す前と変わらない）
    const chance = def.when.chance;
    const [r, rn, rc] = draws(startSeed, def.id, chance === undefined ? 2 : 3);
    if (chance !== undefined && rc! >= chance) continue;
    const span = def.when.to - def.when.from + 1;
    out.push(at(def, def.when.from + Math.floor(r! * span), rn));
  }
  const rare = sc.events.filter(
    (d): d is EventDef & { when: { type: 'rare'; weight: number } } =>
      d.when.type === 'rare',
  );
  const [occur, which, when] = draws(startSeed, '__rare__', 3);
  if (rare.length && occur! < sc.rare.perGame) {
    const total = rare.reduce((a, d) => a + d.when.weight, 0);
    let x = which! * total;
    const def = rare.find((d) => (x -= d.when.weight) < 0) ?? rare[0]!;
    const span = sc.rare.to - sc.rare.from + 1;
    out.push(at(def, sc.rare.from + Math.floor(when! * span)));
  }
  return out.sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
}

/**
 * 実際に予告されている改定の出来事の月を決める（D-21）。始めた日が施行日より前の予告だけが候補で、
 * 月は現実の日付に写さず、ほかの台本と同じくシードで決める（予告ごとに独立した列）。
 */
export function rollRevisions(
  sc: Scenario,
  startSeed: number,
  startDate: string,
  changes: readonly { id: string; effectiveFrom: string }[],
): { id: string; month: number }[] {
  if (!sc.revisions) return [];
  const { from, to } = sc.revisions;
  return changes
    .filter((c) => startDate < c.effectiveFrom)
    .map((c) => {
      const [r] = draws(startSeed, c.id, 1);
      return { id: c.id, month: from + Math.floor(r! * (to - from + 1)) };
    });
}
