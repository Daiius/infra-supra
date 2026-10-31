// コンセプト確認用スパイク（使い捨て）。node --experimental-strip-types run.ts [-v]
// 目的: 実データで MVP の 3 構成を比べ、モデルの穴と「プラットフォームの前提」（PRD 01 §8.1）の出し方を試す。
// 本体の設計（10 進数・スキーマ・出所の型）には従わない。料金は data.ts（出典つき）、仮定はすべて A。
import {
  cloudflare as CF,
  vercel as V,
  supabase as SB,
  sakuraVps as VPS,
} from './data.ts';

const A = {
  usdJpy: 150, // ⚠ 為替は取得していない。比較のための仮定
  daysPerMonth: 730 / 24,
  peakDayFactor: 1.3, // 多い日 / 平均日
  peakHourFactor: 2.5, // 多い時間帯 / 平均
  isrShare: 0.6,
  ssrShare: 0.4,
  assetsPerPV: 10,
  imagesPerPV: 5,
  apiPerPV: 1,
  browserReuseAsset: 0.7,
  browserReuseImage: 0.5,
  docKB: 60,
  assetKB: 40,
  imageKB: 150,
  apiKB: 5,
  ssrCpuMs: 15,
  ssrWallMs: 80,
  apiCpuMs: 5,
  apiWallMs: 40,
  isrServeCpuMs: 2,
  revalidateCpuMs: 15,
  isrPages: 2_000,
  revalidateSec: 300,
  queriesPerSsr: 3,
  queriesPerApi: 1,
  dbKBPerQuery: 2, // DB → アプリの応答サイズ（Supabase の egress）
  rowsReadPerQuery: 20,
  writesPerApi: 0.1,
  rowsWrittenPerWrite: 3,
  dbGB: 0.3,
  imagesStoredGB: 20,
  distinctImages: 5_000,
  variantsPerImage: 3,
  cdnHitImage: 0.9,
  isrRegionalMiss: 0.2,
  isrChangedRate: 0.1,
  fnMemoryGB: 2,
  fluidConcurrency: 1, // ⚠ 実請求で確かめる（calibration-vercel-pro.md）
  newImageWritesPerPV: 0.001,
  // VPS
  vpsMemGB: { os: 0.3, mysql: 0.6, node: 0.4, nginx: 0.05 },
  vpsLineUsable: 0.5, // 共有回線のうち実際に使える割合
  vpsCpuUtilMax: 0.7,
  mysqlCpuMsPerQuery: 0.3,
  sharpCpuMsPerTransform: 150,
};

const SEC_PER_MONTH = 730 * 3600;
const GB = 1024 * 1024; // KB → GB
const fmt = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2));
const over = (used: number, incl: number) => Math.max(0, used - incl);
const peakDay = (m: number) => (m / A.daysPerMonth) * A.peakDayFactor;
const peakRps = (m: number) => (m / SEC_PER_MONTH) * A.peakHourFactor;

function workload(pv: number) {
  const isrViews = pv * A.isrShare;
  const ssrViews = pv * A.ssrShare;
  const api = pv * A.apiPerPV;
  const assets = pv * A.assetsPerPV * (1 - A.browserReuseAsset);
  const images = pv * A.imagesPerPV * (1 - A.browserReuseImage);
  // ISR の再生成: 1 ページへの閲覧の到着率 λ に対し、間隔 T あたり高々 1 回 → 閲覧 / (1 + λT)（一様な人気を仮定）
  const lambdaT = (isrViews / A.isrPages) * (A.revalidateSec / SEC_PER_MONTH);
  const revalidations = isrViews / (1 + lambdaT);
  const writes = api * A.writesPerApi;
  const queries =
    (ssrViews + revalidations) * A.queriesPerSsr + api * A.queriesPerApi;
  const transforms = Math.min(A.distinctImages * A.variantsPerImage, images);
  return {
    pv,
    isrViews,
    ssrViews,
    api,
    assets,
    images,
    revalidations,
    writes,
    queries,
    transforms,
  };
}
type W = ReturnType<typeof workload>;

// 「プラットフォームの前提」: 人が読める 1 文 + 使用量 / 境目。used ≥ limit で当たっている
type Premise = {
  text: string;
  used: number;
  limit: number;
  effect: 'block' | 'cost' | 'policy';
};
type Line = { item: string; amount: number; note?: string };
type Result = { name: string; lines: Line[]; premises: Premise[] };

const sum = (ls: Line[]) => ls.reduce((s, l) => s + l.amount, 0);
const blocked = (r: Result) =>
  r.premises.filter((p) => p.effect !== 'cost' && p.used >= p.limit);
const fact = (text: string): Premise => ({
  text,
  used: 1,
  limit: 1,
  effect: 'cost',
});

function cloudflareVinext(w: W, plan: 'free' | 'paid'): Result {
  const workerReq = w.isrViews + w.ssrViews + w.api; // vinext の ISR は閲覧ごとに Worker + KV
  const cpuMs =
    w.isrViews * A.isrServeCpuMs +
    w.revalidations * A.revalidateCpuMs +
    w.ssrViews * A.ssrCpuMs +
    w.api * A.apiCpuMs;
  const rowsRead = w.queries * A.rowsReadPerQuery;
  const rowsWritten = w.writes * A.rowsWrittenPerWrite;
  const kvReads = w.isrViews;
  const kvWrites = w.revalidations; // ⚠ 内容が変わらなくても書くと仮定（vinext の実装は未確認）
  const classB = w.images * (1 - A.cdnHitImage);
  const classA = w.pv * A.newImageWritesPerPV;
  const lines: Line[] = [];
  const P: Premise[] = [];
  if (plan === 'free') {
    P.push(
      {
        text: 'Workers Free は 1 リクエストあたり CPU 10 ms まで（超えると Error 1102）',
        used: A.ssrCpuMs,
        limit: CF.workersFree.cpuMsPerRequestLimit,
        effect: 'block',
      },
      {
        text: 'Workers Free は 1 日 10 万リクエストまで（超えると UTC 0 時まで Error 1027）',
        used: peakDay(workerReq),
        limit: CF.workersFree.requestsPerDay,
        effect: 'block',
      },
      {
        text: 'KV Free は 1 日 10 万回の読み取りまで',
        used: peakDay(kvReads),
        limit: CF.kvFree.readsPerDay,
        effect: 'block',
      },
      {
        text: 'KV Free は 1 日 1,000 回の書き込みまで（ISR の再生成のたびに書く）',
        used: peakDay(kvWrites),
        limit: CF.kvFree.writesPerDay,
        effect: 'block',
      },
      {
        text: 'D1 Free は 1 日 500 万行の読み取りまで',
        used: peakDay(rowsRead),
        limit: CF.d1Free.rowsReadPerDay,
        effect: 'block',
      },
      {
        text: 'Images Free は月 5,000 の一意な変換まで（超えると新しい変換が 9422 エラー）',
        used: w.transforms,
        limit: CF.images.freeUniqueTransforms,
        effect: 'block',
      },
    );
  } else {
    const p = CF.workersPaid;
    const d = CF.d1Paid;
    const kv = CF.kvPaid;
    lines.push(
      { item: 'Workers Paid 最低請求', amount: p.baseFee },
      {
        item: 'Workers リクエスト',
        amount:
          (over(workerReq, p.requestsIncluded) / 1e6) * p.requestsPerMillion,
        note: `${(workerReq / 1e6).toFixed(2)}M`,
      },
      {
        item: 'Workers CPU',
        amount: (over(cpuMs, p.cpuMsIncluded) / 1e6) * p.cpuPerMillionMs,
        note: `${(cpuMs / 1e6).toFixed(1)}M ms`,
      },
      {
        item: 'D1 読み取り行',
        amount:
          (over(rowsRead, d.rowsReadIncluded) / 1e6) * d.rowsReadPerMillion,
        note: `${(rowsRead / 1e6).toFixed(0)}M 行`,
      },
      {
        item: 'D1 書き込み行',
        amount:
          (over(rowsWritten, d.rowsWrittenIncluded) / 1e6) *
          d.rowsWrittenPerMillion,
      },
      {
        item: 'KV 読み取り（ISR）',
        amount: (over(kvReads, kv.readsIncluded) / 1e6) * kv.readsPerMillion,
        note: `${(kvReads / 1e6).toFixed(2)}M`,
      },
      {
        item: 'KV 書き込み（ISR）',
        amount: (over(kvWrites, kv.writesIncluded) / 1e6) * kv.writesPerMillion,
        note: `${(kvWrites / 1e6).toFixed(2)}M`,
      },
      {
        item: 'Images 一意な変換',
        amount:
          (over(w.transforms, CF.images.freeUniqueTransforms) / 1e3) *
          CF.images.paidPerThousand,
        note: `${w.transforms.toLocaleString()} 件`,
      },
    );
    P.push(
      {
        text: 'Workers Paid は月 1,000 万リクエストまで込み（vinext の ISR は閲覧ごとに数える）',
        used: workerReq,
        limit: p.requestsIncluded,
        effect: 'cost',
      },
      {
        text: 'KV の書き込みは月 100 万回まで込み、以降 $5/100 万回（ISR の再生成のたびに書く）',
        used: kvWrites,
        limit: kv.writesIncluded,
        effect: 'cost',
      },
      {
        text: 'Images は月 5,000 の一意な変換まで込み（画像の種類 × サイズ違い）',
        used: w.transforms,
        limit: CF.images.freeUniqueTransforms,
        effect: 'cost',
      },
    );
  }
  const r = CF.r2;
  lines.push(
    {
      item: 'R2 保存',
      amount: over(A.imagesStoredGB, r.storageFreeGB) * r.storagePerGB,
    },
    {
      item: 'R2 Class A',
      amount: (over(classA, r.classAFree) / 1e6) * r.classAPerMillion,
    },
    {
      item: 'R2 Class B',
      amount: (over(classB, r.classBFree) / 1e6) * r.classBPerMillion,
    },
  );
  P.push(fact('R2 と Workers は転送量（egress）に課金しない'));
  return {
    name: `Cloudflare ${plan === 'free' ? 'Free' : 'Paid'} + vinext`,
    lines,
    premises: P,
  };
}

function vercelSupabase(w: W, plan: 'hobby' | 'pro'): Result {
  const fnReq = w.ssrViews + w.api + w.revalidations;
  const cdnReq = w.isrViews + w.ssrViews + w.api + w.assets + w.images;
  const fdtGB =
    (w.isrViews * A.docKB +
      w.ssrViews * A.docKB +
      w.api * A.apiKB +
      w.assets * A.assetKB +
      w.images * A.imageKB) /
    GB;
  const fotGB =
    ((w.ssrViews + w.revalidations) * A.docKB + w.api * A.apiKB) / GB;
  const cpuH =
    (w.ssrViews * A.ssrCpuMs +
      w.api * A.apiCpuMs +
      w.revalidations * A.revalidateCpuMs) /
    3.6e6;
  const wallMsAvg =
    (w.ssrViews * A.ssrWallMs +
      w.api * A.apiWallMs +
      w.revalidations * A.ssrWallMs) /
    fnReq;
  const memGBh =
    (((fnReq * wallMsAvg) / 3.6e6) * A.fnMemoryGB) / A.fluidConcurrency;
  const imgUnits = A.imageKB / 8;
  const imgReads = w.images * (1 - A.cdnHitImage) * imgUnits;
  const imgWrites = w.transforms * imgUnits;
  const docUnits = A.docKB / 8;
  const isrReads = w.isrViews * A.isrRegionalMiss * docUnits;
  const isrWrites = w.revalidations * A.isrChangedRate * docUnits;
  const sbEgressGB = (w.queries * A.dbKBPerQuery) / GB;
  const conc = peakRps(fnReq) * (wallMsAvg / 1000); // リトルの法則: 同時に DB 接続を持つ関数の数
  const lines: Line[] = [];
  const P: Premise[] = [];
  if (plan === 'hobby') {
    const h = V.hobby;
    P.push(
      {
        text: 'Vercel Hobby は個人・非商用のみ',
        used: 1,
        limit: 1,
        effect: 'policy',
      },
      {
        text: 'Hobby は CDN Requests 月 100 万まで（超えると 30 日待つ）',
        used: cdnReq,
        limit: h.cdnRequests,
        effect: 'block',
      },
      {
        text: 'Hobby は Fast Data Transfer 月 100 GB まで',
        used: fdtGB,
        limit: h.fdtGB,
        effect: 'block',
      },
      {
        text: 'Hobby は Active CPU 月 4 時間まで',
        used: cpuH,
        limit: h.activeCpuHours,
        effect: 'block',
      },
      {
        text: 'Hobby は画像の変換 月 5,000 回まで（超えると 402）',
        used: w.transforms,
        limit: h.imageTransforms,
        effect: 'block',
      },
      {
        text: 'Supabase Free は DB 500 MB まで（1 週間使われないと一時停止）',
        used: A.dbGB,
        limit: SB.free.dbGB,
        effect: 'block',
      },
      {
        text: 'Supabase Free の egress は月 5 GB まで',
        used: sbEgressGB,
        limit: SB.free.egressGB,
        effect: 'block',
      },
    );
  } else {
    const p = V.pro;
    const usage: Line[] = [
      {
        item: 'CDN Requests',
        amount:
          (over(cdnReq, p.cdnRequestsIncluded) / 1e6) * p.cdnRequestsPerMillion,
        note: `${(cdnReq / 1e6).toFixed(2)}M`,
      },
      {
        item: 'Fast Data Transfer',
        amount: over(fdtGB, p.fdtIncludedGB) * p.fdtPerGB,
        note: `${fdtGB.toFixed(0)} GB`,
      },
      {
        item: 'Fast Origin Transfer',
        amount: fotGB * p.fotPerGB,
        note: `${fotGB.toFixed(1)} GB`,
      },
      { item: 'Invocations', amount: (fnReq / 1e6) * p.invocationsPerMillion },
      {
        item: 'Active CPU',
        amount: cpuH * p.activeCpuPerHour,
        note: `${cpuH.toFixed(1)} h`,
      },
      {
        item: 'Provisioned Memory',
        amount: memGBh * p.memoryPerGBHour,
        note: `${memGBh.toFixed(0)} GB-h`,
      },
      {
        item: 'Image transforms',
        amount: (w.transforms / 1e3) * p.imageTransformsPerThousand,
      },
      {
        item: 'Image cache r/w',
        amount:
          (imgReads / 1e6) * p.imageCacheReadsPerMillion +
          (imgWrites / 1e6) * p.imageCacheWritesPerMillion,
      },
      {
        item: 'ISR reads/writes',
        amount:
          (isrReads / 1e6) * p.isrReadsPerMillion +
          (isrWrites / 1e6) * p.isrWritesPerMillion,
      },
    ];
    const s = SB.pro;
    const compute = 730 * s.compute.micro.perHour;
    lines.push(
      { item: 'Vercel Pro 基本料（1 席）', amount: p.baseFee },
      ...usage,
      {
        item: 'Vercel 利用クレジット',
        amount: -Math.min(p.usageCredit, sum(usage)),
      },
      { item: 'Supabase Pro 基本料', amount: s.baseFee },
      { item: 'Supabase Micro', amount: compute, note: '730 h' },
      {
        item: 'Supabase Compute クレジット',
        amount: -Math.min(s.computeCredit, compute),
      },
      {
        item: 'Supabase egress',
        amount: over(sbEgressGB, s.egressIncludedGB) * s.egressPerGB,
        note: `${sbEgressGB.toFixed(1)} GB`,
      },
      {
        item: 'Supabase disk',
        amount: over(A.dbGB, s.diskIncludedGB) * s.diskPerGB,
      },
    );
    P.push(
      {
        text: 'Vercel Pro は Fast Data Transfer 月 1 TB まで込み、以降 $0.15/GB（Cloudflare は egress 無料）',
        used: fdtGB,
        limit: p.fdtIncludedGB,
        effect: 'cost',
      },
      {
        text: 'Vercel Pro は CDN Requests 月 1,000 万まで込み（静的アセット・画像も 1 件ずつ数える）',
        used: cdnReq,
        limit: p.cdnRequestsIncluded,
        effect: 'cost',
      },
      {
        text: 'Vercel の $20 のクレジットが従量を相殺する（超えるまでは基本料だけ）',
        used: sum(usage),
        limit: p.usageCredit,
        effect: 'cost',
      },
      {
        text: 'Supabase Micro の pooler 接続は 200 まで（サーバーレスの同時実行がそのまま接続数になる）',
        used: conc,
        limit: s.compute.micro.poolerConn,
        effect: 'block',
      },
      {
        text: 'Supabase の egress は月 250 GB まで込み（Vercel の関数への応答も数える想定）',
        used: sbEgressGB,
        limit: s.egressIncludedGB,
        effect: 'cost',
      },
      fact(
        'Supabase の Compute は支出上限の対象外で、1 時間単位で切り上げて課金される',
      ),
    );
  }
  return {
    name:
      plan === 'hobby'
        ? 'Vercel Hobby + Supabase Free'
        : 'Vercel Pro + Supabase Pro',
    lines,
    premises: P,
  };
}

function sakura(w: W): Result {
  // nginx が静的配信と画像（next/image の結果はディスクにキャッシュ）、next start が SSR・API・ISR（ディスクのキャッシュ）
  const bytesKB =
    w.isrViews * A.docKB +
    w.ssrViews * A.docKB +
    w.api * A.apiKB +
    w.assets * A.assetKB +
    w.images * A.imageKB;
  const peakMbps = (peakRps(bytesKB) * 8) / 1000;
  const nodeMs =
    w.ssrViews * A.ssrCpuMs +
    w.api * A.apiCpuMs +
    w.revalidations * A.revalidateCpuMs +
    w.isrViews * A.isrServeCpuMs +
    w.transforms * A.sharpCpuMsPerTransform;
  const mysqlMs = w.queries * A.mysqlCpuMsPerQuery;
  const peakCores = peakRps(nodeMs + mysqlMs) / 1000;
  const mem = Object.values(A.vpsMemGB).reduce((a, b) => a + b, 0);
  const disk = A.dbGB + A.imagesStoredGB + 10; // OS・ログ・キャッシュ 10 GB は仮定
  return {
    name: `さくらの VPS ${VPS.plan}`,
    lines: [
      {
        item: `月額 ${VPS.monthlyJPY.toLocaleString()} 円（税込）`,
        amount: VPS.monthlyJPY / A.usdJpy,
        note: `1 USD = ${A.usdJpy} 円の仮定`,
      },
    ],
    premises: [
      {
        text: `転送量は無制限だが、回線は 100 Mbps の共有（使える割合 ${A.vpsLineUsable} を仮定・ピーク時間帯）`,
        used: peakMbps,
        limit: VPS.lineMbps * A.vpsLineUsable,
        effect: 'block',
      },
      {
        text: `${VPS.vcpu} vCPU を使用率 ${A.vpsCpuUtilMax} まで（ピーク時間帯）`,
        used: peakCores,
        limit: VPS.vcpu * A.vpsCpuUtilMax,
        effect: 'block',
      },
      {
        text: `メモリ ${VPS.ramGB} GB に OS・MySQL・Node・nginx が同居する`,
        used: mem,
        limit: VPS.ramGB,
        effect: 'block',
      },
      {
        text: `SSD ${VPS.ssdGB} GB に DB と画像を置く`,
        used: disk,
        limit: VPS.ssdGB,
        effect: 'block',
      },
      fact('2GB プランは SLA 非対応で、1 台に全部が載る（障害時は全停止）'),
      fact('最低利用期間 3 か月・初回は 2 か月分の前払い'),
    ],
  };
}

function print(r: Result, verbose: boolean) {
  const b = blocked(r);
  const status = b.length
    ? `✗ 不成立（${b.length} 件）`
    : `$${fmt(sum(r.lines))}/月`;
  console.log(`  ${r.name.padEnd(30)} ${status}`);
  for (const p of b) console.log(`      ✗ ${p.text}`);
  if (!verbose) return;
  if (!b.length)
    for (const l of r.lines)
      if (l.amount !== 0)
        console.log(
          `      ${l.item.padEnd(26)} ${('$' + fmt(l.amount)).padStart(9)}  ${l.note ?? ''}`,
        );
  for (const p of r.premises.filter((p) => !b.includes(p))) {
    const ratio = p.used / p.limit;
    const isFact = p.used === 1 && p.limit === 1;
    const mark = isFact ? '・' : ratio >= 1 ? '●' : ratio >= 0.5 ? '◐' : '○';
    const pct = isFact
      ? ''
      : `（${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 0)}%）`;
    console.log(`      ${mark} ${p.text}${pct}`);
  }
}

const verbose = process.argv.includes('-v');
if (verbose)
  console.log(
    '凡例: ● 当たっている前提 / ◐ 境目の半分を超えた / ○ まだ遠い / ・ 常に効く事実',
  );
for (const pv of [1e4, 1e5, 1e6, 1e7]) {
  const w = workload(pv);
  console.log(
    `\n■ 月間 ${pv.toLocaleString()} PV（ISR の再生成 ${Math.round(w.revalidations).toLocaleString()} 回）`,
  );
  print(cloudflareVinext(w, 'free'), verbose);
  print(cloudflareVinext(w, 'paid'), verbose);
  print(vercelSupabase(w, 'hobby'), verbose);
  print(vercelSupabase(w, 'pro'), verbose);
  print(sakura(w), verbose);
}
