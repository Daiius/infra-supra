// ゲームのターンのスパイク（P1-S・使い捨て）。ターミナルで遊ぶ:
//   node --experimental-strip-types spikes/game-2026-10-31/play.ts
//   node --experimental-strip-types spikes/game-2026-10-31/play.ts --script 4,0,2,0,0,0,0,0,0,0,0,0,0   （自動で進める）
//
// 料金・前提はエンジン（estimator）と実データ（catalog・2026-10-31 取得）をそのまま使う。
// ゲームのバランス（収益・成長・行動の費用・障害の影響）はすべて下の GAME にまとめた「ゲーム上の仮定」で、実在の値ではない。
import { createInterface } from 'node:readline/promises';
import {
  estimate,
  type PlatformPremise,
  type WorkloadInput,
} from '../../packages/estimator/src/index.ts';
import {
  articleCommunity,
  loadPriceBooks,
  MVP_STACKS,
} from '../../packages/catalog/src/index.ts';

const GAME = {
  months: 12,
  startPV: 150_000,
  growth: 0.4, // 月の成長率（障害・遅延で下がる）
  buzzMonth: 7, // SNS で話題になる月（その月だけ PV が buzzFactor 倍、翌月から基準が上がる）
  buzzFactor: 10,
  buzzLasting: 1.8,
  adUsdPer1000PV: 0.25, // 広告収入（ゲーム上の仮定。利幅の薄いコミュニティ）
  startCash: 60,
  usdJpy: 150, // ⚠ 為替は取得していない（仮定）
  migrationCost: 40, // 構成の乗り換えの作業費（ゲーム上の仮定）
  migrationRevenueLoss: 0.15,
  blockRevenueLoss: 0.6, // 止まる前提に当たった月の収益の損失
  blockGrowth: -0.2, // 止まった月は利用者が離れる（成長率をこの値で置き換える）
  throttleRevenueLoss: 0.1,
  throttleGrowthPenalty: 0.5,
  // 自前運用（ホスト）の手間と、SLA のない 1 台構成の障害（前提の「常に効く事実」のゲーム上の効果。spike 所見 14）
  selfHostedOpsUsdPerMonth: 30, // パッチ・バックアップ・監視の作業費（ゲーム上の仮定）
  noSlaOutageChance: 0.08, // 1 か月に 1 回、数時間止まる確率（ゲーム上の仮定）
  incidentRevenueLoss: 0.1, // 数時間の障害の収益の損失
  incidentGrowthPenalty: 0.7,
  goal: { cash: 6500, maxOutageMonths: 2 },
};

type Mods = {
  imageKB: number;
  ssrCpuMs: number;
  revalidateSec: number;
  variants: number;
};
const ACTIONS: {
  key: string;
  label: string;
  cost: number;
  apply: (m: Mods) => void;
  note: string;
}[] = [
  {
    key: 'compress',
    label: '画像を圧縮する（150 KB → 70 KB）',
    cost: 20,
    apply: (m) => (m.imageKB = 70),
    note: '転送量に効く',
  },
  {
    key: 'optimize',
    label: 'SSR を最適化する（CPU 15 ms → 8 ms）',
    cost: 60,
    apply: (m) => (m.ssrCpuMs = 8),
    note: 'CPU 時間に効く',
  },
  {
    key: 'isr',
    label: 'ISR の再検証の間隔を延ばす（5 分 → 1 時間）',
    cost: 0,
    apply: (m) => (m.revalidateSec = 3600),
    note: '再生成の回数に効く。記事の更新は遅れて見える',
  },
  {
    key: 'variants',
    label: '画像のサイズ違いを減らす（3 → 1）',
    cost: 10,
    apply: (m) => (m.variants = 1),
    note: '画像変換の件数に効く',
  },
];

function workloadFor(pv: number, m: Mods): WorkloadInput {
  const w = articleCommunity(Math.round(pv));
  for (const r of w.routes) {
    r.processing = { ...r.processing, cpuMs: m.ssrCpuMs };
    if (r.rendering === 'isr') r.revalidateSeconds = m.revalidateSec;
  }
  w.images = { ...w.images, sizeKB: m.imageKB, variants: m.variants };
  return w;
}

const books = loadPriceBooks();
const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / GAME.usdJpy;
const yen = (usd: number) =>
  `${Math.round(usd * GAME.usdJpy).toLocaleString()} 円`;
const pct = (r: number | undefined) =>
  r === undefined ? '' : `（${(r * 100).toFixed(0)}%）`;

// シード付き乱数（同じシード・同じ行動なら同じ結果。prd/02 §3）
const seedArg = process.argv.indexOf('--seed');
let seed = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 42;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const scriptArg = process.argv.indexOf('--script');
const script =
  scriptArg > 0 ? process.argv[scriptArg + 1]!.split(',').map(Number) : null;
const rl = script
  ? null
  : createInterface({ input: process.stdin, output: process.stdout });
async function ask(q: string): Promise<number> {
  if (script) {
    const v = script.shift() ?? 0;
    console.log(`${q}${v}`);
    return v;
  }
  const a = await rl!.question(q);
  return Number.parseInt(a.trim() || '0', 10) || 0;
}

function premiseLine(p: PlatformPremise): string {
  if (p.kind === 'fact') return `  ・ ${p.text}`;
  const mark = p.hit ? (p.effect === 'cost' ? '●' : '✗') : '◐';
  return `  ${mark} ${p.text}${pct(p.ratio)}`;
}

async function main() {
  console.log(`
━━━ シナリオ: 記事コミュニティを ${GAME.months} か月運営する ━━━
Next.js（App Router）で作った記事 + コメントのサイト。広告収入で運営する（商用）。
今は月 ${GAME.startPV.toLocaleString()} PV。順調なら毎月 ${GAME.growth * 100}% ずつ伸びる。どこかで SNS で話題になるかもしれない。
所持金 $${GAME.startCash}。自前で運用する構成は、毎月 $${GAME.selfHostedOpsUsdPerMonth} の作業がかかる。
目標: ${GAME.months} か月後に所持金 $${GAME.goal.cash} 以上、止まった月が ${GAME.goal.maxOutageMonths} 回以内。

アプリの形（コストに効く判断ポイント）:
  - 記事ページは ISR（再検証 5 分・2,000 ページ）、マイページなどは SSR。SSR 1 回の CPU は約 15 ms
  - 1 PV あたり画像 5 枚（150 KB）、画像は 5,000 種類 × サイズ違い 3
  - 1 PV あたり API 1 回。DB は小さい（0.3 GB）
（料金は 2026-10-31 時点の公式の料金表。円建ては 1 USD = ${GAME.usdJpy} 円の仮定で換算）
`);
  MVP_STACKS.forEach((s, i) => console.log(`  ${i}. ${s.name}`));
  let stackIndex = Math.min(
    Math.max(await ask('\nどの構成で始めますか？ 番号: '), 0),
    MVP_STACKS.length - 1,
  );

  const mods: Mods = {
    imageKB: 150,
    ssrCpuMs: 15,
    revalidateSec: 300,
    variants: 3,
  };
  const done = new Set<string>();
  let cash = GAME.startCash;
  let basePV = GAME.startPV;
  let growth = GAME.growth;
  let outages = 0;
  let pendingMigration = false;
  const history: string[] = [];

  for (let month = 1; month <= GAME.months; month++) {
    const buzz = month === GAME.buzzMonth;
    const pv = buzz ? basePV * GAME.buzzFactor : basePV;
    const stack = MVP_STACKS[stackIndex]!;
    const r = estimate({
      workload: workloadFor(pv, mods),
      architecture: stack,
      books,
    });
    const selfHosted = r.simulation.architecture.nodes.some(
      (n) => n.config.kind === 'host',
    );
    const ops = selfHosted ? GAME.selfHostedOpsUsdPerMonth : 0;
    const cost = toUsd(r.bill.totals) + ops;
    const randomOutage = selfHosted && random() < GAME.noSlaOutageChance;
    const blocking = r.premises.filter(
      (p) =>
        p.hit &&
        (p.effect === 'block' ||
          p.effect === 'policy' ||
          p.effect === 'upgrade-required'),
    );
    const throttling = r.premises.filter(
      (p) => p.hit && p.effect === 'throttle',
    );
    let revenue = (pv / 1000) * GAME.adUsdPer1000PV;
    let monthGrowth = growth;
    const notes: string[] = [];
    if (blocking.length) {
      revenue *= 1 - GAME.blockRevenueLoss;
      monthGrowth = GAME.blockGrowth;
      outages++;
      notes.push('サービスが止まった');
    } else if (randomOutage) {
      revenue *= 1 - GAME.incidentRevenueLoss;
      monthGrowth *= GAME.incidentGrowthPenalty;
      outages++;
      notes.push('VPS の障害で数時間止まった（SLA なし・1 台構成）');
    } else if (throttling.length) {
      revenue *= 1 - GAME.throttleRevenueLoss;
      monthGrowth *= GAME.throttleGrowthPenalty;
      notes.push('遅くなった');
    }
    if (pendingMigration) {
      revenue *= 1 - GAME.migrationRevenueLoss;
      notes.push('乗り換えの作業');
      pendingMigration = false;
    }
    cash += revenue - cost;

    console.log(
      `\n━━ ${month} か月目 ━━ ${stack.name}${buzz ? '  📣 SNS で話題になった！' : ''}`,
    );
    console.log(
      `  PV ${Math.round(pv).toLocaleString()}  収益 $${revenue.toFixed(2)}  費用 $${cost.toFixed(2)}（${yen(cost)}${ops ? `・うち運用の作業 $${ops}` : ''}）  所持金 $${cash.toFixed(2)}${notes.length ? `  ⚠ ${notes.join('・')}` : ''}`,
    );
    if (r.bill.unpricedLines)
      console.log(
        `  （料金未取得の明細 ${r.bill.unpricedLines} 件。費用は下限）`,
      );
    const shown = r.premises
      .filter((p) => p.hit || (p.ratio ?? 0) >= 0.7)
      .slice(0, 6);
    if (shown.length) {
      console.log('  前提:');
      for (const p of shown) console.log(premiseLine(p));
    }
    history.push(
      `${String(month).padStart(2)} | ${stack.name.padEnd(28)} | ${Math.round(pv).toLocaleString().padStart(10)} PV | 収益 ${revenue.toFixed(0).padStart(5)} | 費用 ${cost.toFixed(0).padStart(5)} | 所持金 ${cash.toFixed(0).padStart(6)}${blocking.length || randomOutage ? ' | 停止' : throttling.length ? ' | 遅延' : ''}`,
    );

    if (cash < 0) {
      console.log('\n💸 所持金が尽きた。ゲームオーバー。');
      break;
    }
    basePV = buzz ? basePV * GAME.buzzLasting : basePV * (1 + monthGrowth);
    if (month === GAME.months) break;

    console.log('\n  行動: 0. このまま続ける');
    const available = ACTIONS.filter((a) => !done.has(a.key));
    available.forEach((a, i) =>
      console.log(`        ${i + 1}. ${a.label}  $${a.cost}（${a.note}）`),
    );
    console.log(
      `        ${available.length + 1}. 構成を乗り換える  $${GAME.migrationCost}（翌月は作業で収益が ${GAME.migrationRevenueLoss * 100}% 減る）`,
    );
    const choice = await ask('  番号: ');
    if (choice >= 1 && choice <= available.length) {
      const a = available[choice - 1]!;
      a.apply(mods);
      done.add(a.key);
      cash -= a.cost;
      console.log(`  → ${a.label}（-$${a.cost}）`);
    } else if (choice === available.length + 1) {
      MVP_STACKS.forEach((s, i) =>
        console.log(
          `        ${i}. ${s.name}${i === stackIndex ? '（今）' : ''}`,
        ),
      );
      const next = await ask('  乗り換え先: ');
      if (next !== stackIndex && MVP_STACKS[next]) {
        stackIndex = next;
        cash -= GAME.migrationCost;
        pendingMigration = true;
        console.log(
          `  → ${MVP_STACKS[next]!.name} へ乗り換える（-$${GAME.migrationCost}）`,
        );
      }
    }
  }

  const win = cash >= GAME.goal.cash && outages <= GAME.goal.maxOutageMonths;
  console.log(`\n━━━ 結果 ━━━\n${history.join('\n')}`);
  console.log(
    `\n所持金 $${cash.toFixed(2)}・止まった月 ${outages} 回 → ${win ? '🎉 目標達成' : '目標に届かず'}`,
  );
  rl?.close();
}

await main();
