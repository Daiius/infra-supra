// シナリオと出来事のデータの形（prd/07 §10.1・§10.2・D-20）。ここは型と、台本の表を作る純粋関数だけ。
// シナリオの値（規模・収益・満足度の重み・手間・確率・時期・効果）はすべてゲーム上の仮定。
import type { FrameworkId, Platform, SlotId, SpaShape } from 'catalog';
import type { WorkloadInput } from 'estimator';
import { draws } from './random.ts';
import type { Element } from './rules.ts';
import type { Action, GameState } from './index.ts';

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
   * 画像 1 枚の原本の保存量。圧縮なし（150 KB）のときの値で、圧縮の度合いに比例して減る。
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
  freshness: { good: number; fair: number };
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
export type Requirement = 'uptime-sla' | 'on-demand-isr';

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
};

export type Strategy = {
  id: string;
  label: string;
  /** 表の見出しに使う短い名前。 */
  short?: string;
  stackIndex: number;
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
  /** 画像を最適化しない部品のときに配る大きさ（原本の大きさ＝stock.gbPerImage と同じ。ゲーム上の仮定・D-24・D-47）。 */
  unoptimizedImageKB: number;
  /**
   * 画像を投稿のときに一律で縮めて置く部品の、1 枚の大きさ（圧縮なしのとき。保存も配信もこの大きさ。
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
  };
  /** 画面の文言（始める画面の説明。D-33・prd/09 E-6）。省略時は画面の既定。 */
  text?: ScenarioText;
  /** このシナリオで効かない行動を画面に出さない（D-33・prd/09 E-6）。 */
  hidden?: {
    settings?: ('compress' | 'variants' | 'isr' | 'apiCacheTtl')[];
    slots?: SlotId[];
    blockBots?: boolean;
  };
};

/** 始める画面の説明（シナリオごとの文言）。数値は画面がシナリオの値から足す。 */
export type ScenarioText = {
  /** 何のアプリで、どう収益を得るか。 */
  intro: string;
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
   * note: 選んだときだけ出す短い注記。app: ⓘ に畳む長い説明（SSR / API の CPU の行は画面がテンプレートから足す）。
   */
  byFramework?: Partial<Record<FrameworkId, { note?: string; app?: string[] }>>;
  /** 収益の文（ゲーム上の仮定であることを含める）。 */
  revenue?: string;
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
