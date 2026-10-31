// シナリオと出来事のデータの形（prd/07 §10.1・§10.2・D-20）。ここは型と、台本の表を作る純粋関数だけ。
// シナリオの値（規模・収益・満足度の重み・手間・確率・時期・効果）はすべてゲーム上の仮定。
import type { Platform, SlotId } from 'catalog';
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
  /** 画像 1 枚の保存量（原本 + サイズ違い）。圧縮なし（150 KB）のときの値で、圧縮の度合いに比例して減る。 */
  gbPerImage: number;
};

export type SatisfactionRules = {
  weights: Record<Element, number>;
  speed: { heavySsrCpuMs: number; heavyImageKB: number; nearRatio: number };
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
    }
  | { type: 'workload'; mods: WorkloadMods }
  | { type: 'stock'; add: Partial<Stock> }
  | { type: 'basePV'; factor: number }
  /** 席（メンバー）を増やす。席課金のプランだけ費用が変わる（catalog の members）。 */
  | { type: 'seats'; add: number }
  | { type: 'effortPerMonth'; add: number }
  /** 出来事への対応の手間（翌月から months か月）。 */
  | { type: 'interrupt'; points: number; months: number }
  | { type: 'feature'; points: number }
  /** 成長率に足す（翌月から months か月）。 */
  | { type: 'growth'; add: number; months: number }
  /** 部品を付ける（受けた提案に要る部品。D-24）。 */
  | { type: 'component'; slot: SlotId; option: string }
  /**
   * 契約の収益（毎月）。requires を満たす構成のときだけ入る（SLA の出来事。D-24・SC-5）。
   */
  | { type: 'contract'; usdPerMonth: number; requires: Requirement };

/** 構成に求める要件。uptime-sla: 課金先のプランがすべて稼働率の SLA を持つ（catalog の uptimeSla）。 */
export type Requirement = 'uptime-sla';

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
    | { type: 'window'; from: number; to: number }
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
  growth: { acquisition: number; churn: number };
  /** 話題の月の後に残る倍率 = 1 + extra × 評判 / reference。 */
  buzz: { extra: number; reference: number };
  revenue: {
    adsUsdPer1000PV: number;
    loss: {
      block: number;
      throttle: number;
      incident: number;
      migration: number;
    };
  };
  incidents: { selfHostedChancePerMonth: number };
  /** 画像を最適化しない部品のときに配る大きさ（原本の大きさ。ゲーム上の仮定・D-24）。 */
  unoptimizedImageKB: number;
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
    const [r, rn] = draws(startSeed, def.id, 2);
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
