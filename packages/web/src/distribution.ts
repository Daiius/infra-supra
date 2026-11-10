// 集計の分布の中での位置（段 3・D-161〜D-164・prd/15 §3.1・§6）。サーバーの分布（4 軸 × 同じシード / 全シード）と自分の値から、
// 軸ごとの「上位何 %」と、上位に入った軸の数（花火の段）を出す。④ 費用の合計は向きを持たない軸なので、上位 % と上位の判定を
// 出さず、分布の中の位置と中央値だけを見せる（D-166）。純粋な部分だけ（取得は stats-client.ts、順序は App.tsx）。
import { RESULT_AXES, type ResultAxes, type ResultAxisId } from 'game';
import type { Distribution, GroupStat, Histogram } from 'stats';

/**
 * 上位の判定に使う最少の件数（自分を含む）。上位何 % の文・「★ 上位」の印・花火の段はこれ以上の分布だけで決める。
 * 結果の画面では、全シードの分布がこれより少なければ分布を出さず、手元の履歴との比較（段 1）に戻る（D-163・D-198）。
 */
export const MIN_RANKED_COUNT = 10;

/**
 * 分布（ヒストグラム・中央値・比較の図の行）を描く最少の件数（集計にある件数。自分を 1 件足す分は数えない）。
 * これ以上 MIN_RANKED_COUNT 未満のうちは描いたうえで「まだ n 件なので、形は参考程度です」と添える（D-198）。
 */
export const MIN_DRAWN_COUNT = 1;

/** 描くが、まだ少ないので注記を添える件数か（MIN_RANKED_COUNT 未満。D-198）。 */
export const isFewCount = (n: number) => n < MIN_RANKED_COUNT;

/** 少ない分布に添える注記（D-198）。 */
export const fewNote = (n: number) => `まだ ${n} 件なので、形は参考程度です。`;

/** 「上位に入った」の線（上位 25% 以内。ST-01・D-163）。 */
export const TOP_PERCENT = 25;

/** 1 つの分布の中での位置。 */
export type Standing = {
  /** 比べた件数（自分を含む）。 */
  n: number;
  /** 上位何 %（自分以上の件数 ÷ n を百分率の整数に丸めた値。1〜100）。 */
  topPercent: number;
  /** 上位の判定に使える件数か（n が MIN_RANKED_COUNT 以上。D-198）。false なら topPercent を画面に出さない。 */
  ranked: boolean;
  /** 上位 TOP_PERCENT % 以内か（丸めた topPercent で見る。表示と食い違わない）。ranked でなければ常に false。 */
  inTop: boolean;
  /** 棒を描く元（サーバーの分布そのまま）。 */
  histogram: Histogram;
};

export type AxisStanding = {
  id: ResultAxisId;
  label: string;
  /** 大きいほど上位の向きを持つか（④ 費用の合計は持たない。D-166）。持たなければ上位 % と上位の判定を出さない。 */
  directed: boolean;
  value: number;
  /** 同じシードの分布の中での位置。集計に 1 件も無ければ null（seedCount に件数）。 */
  seed: Standing | null;
  seedCount: number;
  /**
   * 全シードの分布の中での位置。集計に 1 件も無ければ null（allCount に件数）。軸ごとに見る（④ 費用の合計は、列を足す前の行が
   * null で分布に入らないので、ほかの軸より少ないことがある。OCL-22EC415E）。
   */
  all: Standing | null;
  allCount: number;
  /**
   * 上位に入ったか（花火の段に数える）。同じシードの分布が上位の判定に使える件数ならそちら（楽なシードを選び直しても有利に
   * ならない。D-136）、使えなければ全シードで見る（rankBasisOf）。向きを持たない軸は常に false。
   */
  inTop: boolean;
};

export type DistributionView = {
  axes: AxisStanding[];
  /** 自分が分布に入っているか（送信が保存された・戻っていない）。入っていなければ自分を 1 件足して数える。 */
  included: boolean;
  /** 開発用の架空の分布か（stats-mock.ts。画面に明記する）。 */
  mock: boolean;
};

/** 画面に渡す集計の状態。ready のときだけ分布を出し、ほかは段 1 の表示に戻る（注記だけ変える）。 */
export type StatsView =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'few'; count: number }
  | { status: 'ready'; view: DistributionView };

function standingOf(
  h: Histogram,
  included: boolean,
): { n: number; atOrAbove: number } {
  const p = h.position ?? { above: 0, equal: 0 };
  // 入っていれば自分は equal に数えられている（最後の桁の差は stats の histogramOf が同じとみなす）。入っていなければ 1 件足す
  return included
    ? { n: h.count, atOrAbove: p.above + Math.max(p.equal, 1) }
    : { n: h.count + 1, atOrAbove: p.above + p.equal + 1 };
}

/** 上位何 %（自分と同じ値の人も自分より上に数える控えめな数え方。全員が同じ値なら 100%）。 */
export function topPercentOf(n: number, atOrAbove: number): number {
  if (n <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round((atOrAbove / n) * 100)));
}

function toStanding(h: Histogram, included: boolean): Standing {
  const { n, atOrAbove } = standingOf(h, included);
  const topPercent = topPercentOf(n, atOrAbove);
  const ranked = n >= MIN_RANKED_COUNT;
  return {
    n,
    topPercent,
    ranked,
    inTop: ranked && topPercent <= TOP_PERCENT,
    histogram: h,
  };
}

/** 上位の判定の元にする分布（同じシードが使える件数ならそちら、無理なら全シード。どちらも少なければ null。D-136・D-198）。 */
export const rankBasisOf = (a: Pick<AxisStanding, 'seed' | 'all'>) =>
  a.seed?.ranked ? a.seed : a.all?.ranked ? a.all : null;

/**
 * 分布と自分の値から、軸ごとの位置を出す。全シードの分布が少なすぎれば few（段 1 に戻す）。
 * included は自分が分布に入っているか（App.tsx が送信の結末から決める。D-162）。
 */
export function standingsOf(
  dist: Distribution,
  axes: ResultAxes,
  included: boolean,
  mock = false,
): StatsView {
  const allCount = standingOf(dist.axes.cash.all, included).n;
  if (allCount < MIN_RANKED_COUNT) return { status: 'few', count: allCount };
  return { status: 'ready', view: axisStandingsOf(dist, axes, included, mock) };
}

/**
 * 軸ごとの位置（全体の件数で段 1 に戻さない）。絞った分布（同じインフラなど。D-175）はこちらを使う。集計に 1 件でもあれば
 * 描き、MIN_RANKED_COUNT 件未満の分布は上位の判定に使わない（D-198）。
 */
export function axisStandingsOf(
  dist: Distribution,
  axes: ResultAxes,
  included: boolean,
  mock = false,
): DistributionView {
  return {
    included,
    mock,
    axes: RESULT_AXES.map(({ id, label, directed }) => {
      const d = dist.axes[id];
      const allStanding = toStanding(d.all, included);
      const all = d.all.count >= MIN_DRAWN_COUNT ? allStanding : null;
      const seedStanding = toStanding(d.seed, included);
      const seed = d.seed.count >= MIN_DRAWN_COUNT ? seedStanding : null;
      return {
        id,
        label,
        directed,
        value: axes[id],
        seed,
        seedCount: seedStanding.n,
        all,
        allCount: allStanding.n,
        inTop: directed && rankBasisOf({ seed, all })?.inTop === true,
      };
    }),
  };
}

// ---- 構成・フレームワークごとの分布（ST-11・D-175）----
// 見るためだけの絞り込み。上位 25% の判定と花火の段（D-163・D-168）は、今までどおり全部の構成の分布で決める。

/** 分布の絞り込みのチップ。stack は同じインフラ（構成）、framework は同じフレームワーク、both は両方。 */
export const STATS_FILTERS = ['all', 'stack', 'framework', 'both'] as const;
export type StatsFilter = (typeof STATS_FILTERS)[number];

export const STATS_FILTER_LABEL: Record<StatsFilter, string> = {
  all: '全部',
  stack: '同じインフラ',
  framework: '同じフレームワーク',
  both: '同じ組み合わせ',
};

/** 比較の図の分け方。 */
export type GroupBy = 'stack' | 'framework';

/** 結果の画面で選んだ絞り込み・比較の図の軸と分け方を覚えるキー（infra-supra: で始まるので、ローカルの記録の消去でも消える）。 */
export const STATS_BREAKDOWN_KEY = 'infra-supra:stats-breakdown';

export type StatsBreakdownPrefs = {
  filter: StatsFilter;
  by: GroupBy;
  axis: ResultAxisId;
};

export const DEFAULT_BREAKDOWN_PREFS: StatsBreakdownPrefs = {
  filter: 'all',
  by: 'stack',
  axis: 'cash',
};

/** 覚えた選択を読む。形が違う欄は既定に戻す。 */
export function parseBreakdownPrefs(x: unknown): StatsBreakdownPrefs {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<
    string,
    unknown
  >;
  const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
    all.includes(v as T) ? (v as T) : d;
  return {
    filter: pick(o.filter, STATS_FILTERS, DEFAULT_BREAKDOWN_PREFS.filter),
    by: pick(o.by, ['stack', 'framework'], DEFAULT_BREAKDOWN_PREFS.by),
    axis: pick(
      o.axis,
      RESULT_AXES.map((a) => a.id),
      DEFAULT_BREAKDOWN_PREFS.axis,
    ),
  };
}

/** 絞り込みのチップから、distribution の口に足す引数（自分のプレイの構成・フレームワーク）。 */
export function filterParams(
  filter: StatsFilter,
  own: { stackId: string; framework: string },
): { stack?: string; framework?: string } {
  return {
    ...(filter === 'stack' || filter === 'both' ? { stack: own.stackId } : {}),
    ...(filter === 'framework' || filter === 'both'
      ? { framework: own.framework }
      : {}),
  };
}

/** 比較の図の 1 行（小さなヒストグラム）。集計に 1 件以上ある構成（フレームワーク）だけを行にする（D-198）。 */
export type GroupRow = {
  key: string;
  label: string;
  count: number;
  /** bins は共通の区切りでの棒の件数。 */
  stats: {
    p25: number;
    median: number;
    p75: number;
    bins: number[];
  };
  /** 自分のプレイの構成（フレームワーク）の行か。 */
  mine: boolean;
  /** 件数がまだ少ない行か（MIN_RANKED_COUNT 未満。形は参考程度と添える。D-198）。 */
  few: boolean;
};

/**
 * サーバーの要約を、出す行（隠した構成を除いた構成・フレームワークの並び）に写す。keys の順のまま、集計に 1 件以上ある鍵
 * （MIN_DRAWN_COUNT 以上）だけを行にする。0 件の鍵は自分の構成でも出さない（Free のプランのように完走できない構成の空の行が
 * 並ぶだけになるため。自分の値は図の縦の線で出る。D-198）。keys に無い鍵（隠した構成・知らない id）も出さない。
 * 全部が 0 件なら空の配列（呼ぶ側は図を出さない）。
 */
export function groupRowsOf(
  groups: readonly GroupStat[],
  keys: readonly { key: string; label: string }[],
  mineKey: string,
): GroupRow[] {
  return keys.flatMap(({ key, label }) => {
    const g = groups.find((x) => x.key === key);
    if (!g || g.count < MIN_DRAWN_COUNT) return [];
    return [
      {
        key,
        label,
        count: g.count,
        stats: { p25: g.p25, median: g.median, p75: g.p75, bins: g.bins },
        mine: key === mineKey,
        few: isFewCount(g.count),
      },
    ];
  });
}

/** 上位に入った軸の数（向きのある 3 軸だけ。D-166）。 */
export const topAxesCount = (view: DistributionView) =>
  view.axes.filter((a) => a.inTop).length;

/**
 * 花火の段（1〜3。ST-01・D-163・D-168）: 分布があるときは上位に入った軸の数（向きのある 3 軸）で分ける（0 → 1・1〜2 → 2・3 → 3）。
 * 分布が無いときは常に 1 段（自己ベストの数では変えない。D-168 で D-145 を撤回）。
 */
export function distributionFireworkLevel(view: DistributionView): 1 | 2 | 3 {
  const n = topAxesCount(view);
  return n >= 3 ? 3 : n >= 1 ? 2 : 1;
}

// ---- 送ったプレイが分布に入ったかの記録（開き直しのとき。OCL-9B705B16）----
// 送り直さない（D-152）ので、開き直したときは送信の応答（inHistogram）を覚えておいた値で自分を数えるかを決める。
// キーは infra-supra: で始まるので、ローカルの記録の消去（D-147）でも消える。

export const STATS_MEMBERSHIP_KEY = 'infra-supra:stats-membership';
/** 覚える件数の上限（手元の結果の履歴と同じ。新しい順に残す）。 */
export const STATS_MEMBERSHIP_LIMIT = 50;

export type Membership = {
  version: 1;
  /** [プレイの id, 分布に入ったか]。新しい順。 */
  entries: [string, boolean][];
};

/** 保存した記録を読む。形・版が違えば空、壊れた 1 件はその件だけ捨てる。 */
export function parseMembership(x: unknown): Membership {
  const ok =
    typeof x === 'object' &&
    x !== null &&
    (x as { version?: unknown }).version === 1 &&
    Array.isArray((x as { entries?: unknown }).entries);
  if (!ok) return { version: 1, entries: [] };
  const entries = (x as { entries: unknown[] }).entries.filter(
    (e): e is [string, boolean] =>
      Array.isArray(e) &&
      e.length === 2 &&
      typeof e[0] === 'string' &&
      typeof e[1] === 'boolean',
  );
  return { version: 1, entries: entries.slice(0, STATS_MEMBERSHIP_LIMIT) };
}

/** 1 件を先頭に足す（同じ id は置き換える）。上限を超えた古いものは落とす。 */
export function withMembership(
  m: Membership,
  id: string,
  included: boolean,
): Membership {
  return {
    version: 1,
    entries: [
      [id, included] as [string, boolean],
      ...m.entries.filter(([k]) => k !== id),
    ].slice(0, STATS_MEMBERSHIP_LIMIT),
  };
}

export const membershipOf = (m: Membership, id: string) =>
  m.entries.find(([k]) => k === id)?.[1];
