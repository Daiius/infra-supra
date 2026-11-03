// 組み合わせの総当たりを pairwise に絞る（D-114 CP-14）。スロットの選択肢の 2 つの組（slot A = a, slot B = b）を、どれも少なくとも 1 つの
// 組み合わせで覆う、少ない数の組み合わせを作る（貪欲法。AETG に近い形）。選んだ組み合わせの正しさ（選択で現れる・消えるスロット、部品どうしの
// 依存）は呼ぶ側の normalize が決める（始める画面で選べる形に直すか、選べなければ null）。乱数はシードで決まる（同じ入力なら同じ組み合わせ）。

/** スロットと選択肢（選択で現れるスロットも含めた和）。 */
export type Domain = readonly { slot: string; options: readonly string[] }[];
export type Combo = Record<string, string>;

export type PairwiseResult = {
  combos: Combo[];
  /** 覆う対象の 2 つの組の数（同じスロットの組を除く。スロットが 1 つなら選択肢 1 つずつ）。 */
  pairs: number;
  /** どの組み合わせも作れなかった組（選択で消えるスロットとの組・依存に当たる組）。 */
  infeasible: string[];
};

/** シード付きの乱数（mulberry32）。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列のシード（グループの名前など）を数に。 */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pairKey = (x: string, a: string, y: string, b: string) =>
  x < y ? `${x}=${a}&${y}=${b}` : `${y}=${b}&${x}=${a}`;

/** 組み合わせが覆う組（スロットが 1 つなら、その選択肢だけ）。 */
function pairsOf(c: Combo): string[] {
  const e = Object.entries(c).sort(([x], [y]) => (x < y ? -1 : 1));
  if (e.length === 1) return [`${e[0]![0]}=${e[0]![1]}`];
  const out: string[] = [];
  for (let i = 0; i < e.length; i++)
    for (let j = i + 1; j < e.length; j++)
      out.push(pairKey(e[i]![0], e[i]![1], e[j]![0], e[j]![1]));
  return out;
}

/**
 * pairwise の組み合わせ。base（既定の部品など）を先に入れ、覆っていない組を 1 つずつ取り、その組を固定して残りのスロットを
 * 埋めた候補（既定の部品に当てたもの・貪欲・無作為）を tries 個作り、normalize を通ったうちで最も多く覆うものを足す。
 * どの候補も normalize を通らない（か、通っても固定した組が消える）組は、作れない組として外す。
 */
export function pairwise(
  domain: Domain,
  normalize: (c: Combo) => Combo | null,
  seed: number,
  options: {
    base?: readonly Combo[];
    tries?: number;
    /** 埋める途中の選択で選べる選択肢か（部品どうしの依存。選べるものを先に選ぶ。省略はすべて）。 */
    allowed?: (slot: string, option: string, partial: Combo) => boolean;
  } = {},
): PairwiseResult {
  const random = rng(seed);
  const tries = options.tries ?? 12;
  const all: string[] =
    domain.length === 1
      ? domain[0]!.options.map((o) => `${domain[0]!.slot}=${o}`)
      : domain.flatMap((x, i) =>
          domain
            .slice(i + 1)
            .flatMap((y) =>
              x.options.flatMap((a) =>
                y.options.map((b) => pairKey(x.slot, a, y.slot, b)),
              ),
            ),
        );
  const uncovered = new Set(all);
  const combos: Combo[] = [];
  const seen = new Set<string>();
  const add = (c: Combo) => {
    const k = JSON.stringify(Object.entries(c).sort());
    if (seen.has(k)) return;
    seen.add(k);
    combos.push(c);
    for (const p of pairsOf(c)) uncovered.delete(p);
  };
  const gainOf = (c: Combo) =>
    pairsOf(c).filter((p) => uncovered.has(p)).length;
  for (const b of options.base ?? []) {
    const n = normalize(b);
    if (n) add(n);
  }
  const infeasible: string[] = [];
  const parse = (p: string) =>
    p.split('&').map((s) => s.split('=') as [string, string]);
  while (uncovered.size > 0) {
    const focus = uncovered.values().next().value as string;
    const fixed = Object.fromEntries(parse(focus)) as Combo;
    let best: Combo | null = null;
    let bestGain = 0;
    for (let t = 0; t < tries; t++) {
      // 候補の作り方: 1 つ目は base の先頭（既定の部品）に組を当てただけのもの、3 つに 1 つは選べる選択肢から無作為、
      // 残りは貪欲（まだ覆っていない組が最も増える選択肢）。貪欲だけだと、固定した組を消す選択（DB を出さなくする API の置き場など）を
      // 選び続けて、作れる組を作れないと見誤る
      const first = t === 0 ? options.base?.[0] : undefined;
      const c: Combo = { ...(first ?? {}), ...fixed };
      const greedy = t % 3 !== 2;
      const rest = domain
        .filter((x) => !(x.slot in c))
        .map((x) => ({ x, r: random() }))
        .sort((p, q) => p.r - q.r)
        .map((p) => p.x);
      for (const x of rest) {
        let pick: string | undefined;
        let pickGain = -1;
        const ok = x.options.filter(
          (o) => options.allowed?.(x.slot, o, c) ?? true,
        );
        for (const o of ok.length ? ok : x.options) {
          const g = greedy
            ? Object.entries(c).filter(([y, b]) =>
                uncovered.has(pairKey(x.slot, o, y, b)),
              ).length +
              random() * 0.5
            : random();
          if (g > pickGain) {
            pickGain = g;
            pick = o;
          }
        }
        if (pick !== undefined) c[x.slot] = pick;
      }
      const n = normalize(c);
      // 固定した組が消える（選択で消えるスロット）候補は数えない
      if (!n || !pairsOf(n).includes(focus)) continue;
      const g = gainOf(n);
      if (g > bestGain) {
        best = n;
        bestGain = g;
      }
    }
    if (best) add(best);
    else {
      uncovered.delete(focus);
      infeasible.push(focus);
    }
  }
  return { combos, pairs: all.length, infeasible };
}
