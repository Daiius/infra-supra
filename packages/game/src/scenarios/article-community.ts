// シナリオ: 記事コミュニティ（prd/07 §7・§10・D-20）。値はすべてゲーム上の仮定で、実在の値ではない。
// 料金・制限は catalog のデータをそのまま使う（ここで料金を作らない）。前提の文も catalog のもの（premiseRefs で参照する）。
import { articleCommunity } from 'catalog';
import type { Action, GameState } from '../index.ts';
import type { EventDef, Scenario } from '../scenario.ts';

// 構成の番号（catalog の MVP_STACKS の順）
const CF_FREE = 0;
const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const VPS_4GB = 5;

/** 前の月の終わりに出ていた出来事（基準プレイが状態を見て行動を決めるため）。 */
const sawEvent = (s: GameState, id: string, phase?: string) =>
  (s.history[s.history.length - 1]?.events ?? []).some(
    (e) => e.id === id && (phase === undefined || e.phase === phase),
  );
const respondAll = (s: GameState, accept: boolean): Action[] =>
  s.pendingProposals.map((eventId) => ({ type: 'respond', eventId, accept }));

const EVENTS: EventDef[] = [
  // ---- 状態で起きる（S）----
  {
    id: 's-allowance',
    kind: 'state',
    tier: 'common',
    title: '込み分の 70% を超えた',
    text: '流量で決まる込み分に近づいた。設定（ISR・圧縮）やプランで対応できる',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-requests',
        'pool:cloudflare:workers-paid:paid-kv-writes',
        'pool:vercel:pro:pro-cdn-requests',
        'pool:vercel:pro:pro-fdt',
        'pool:supabase:pro-micro:pro-egress',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 's-db-size',
    kind: 'state',
    tier: 'occasional',
    title: 'DB が大きくなった',
    text: 'たまった投稿とコメントで、DB の保存量が込み分・上限に近づいた',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-d1-storage',
        'pool:supabase:pro-micro:pro-disk',
        'limit:cloudflare:workers-free:d1-db-size',
        'limit:supabase:free:db-size',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 's-image-storage',
    kind: 'state',
    tier: 'occasional',
    title: '画像の保存量が増えた',
    text: '投稿された画像がたまり、保存先の容量に近づいた。VPS ではディスクがいっぱいになると止まる',
    when: {
      type: 'premise',
      premiseIds: ['host:disk:', 'pool:cloudflare:r2-standard:r2-storage'],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 's-concurrency',
    kind: 'state',
    tier: 'occasional',
    title: '同時接続が増えた',
    text: 'ピークの時間帯の接続・CPU・回線が上限に近づいた',
    when: {
      type: 'premise',
      premiseIds: [
        'limit:supabase:pro-micro:pooler-connections',
        'host:cpu:',
        'host:line:',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 's-d1-limit',
    kind: 'state',
    tier: 'rare',
    title: 'D1 が 10 GB に近づいた',
    text: 'D1 のデータベースの大きさは引き上げられない。超えると止まるので、乗り換えを考える時期',
    when: {
      type: 'premise',
      premiseIds: ['limit:cloudflare:workers-paid:d1-db-size'],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  // ---- 提案として来る（P）----
  {
    id: 'p-notify',
    kind: 'proposal',
    tier: 'common',
    title: 'コメントへの返信の通知',
    text: '返信が来たら通知する機能の要望が来た。書き込みが増える',
    when: { type: 'window', from: 3, to: 10 },
    premiseRefs: [
      'pool:cloudflare:workers-free:free-d1-rows-written',
      'pool:cloudflare:workers-paid:paid-d1-rows-written',
      'pool:supabase:',
    ],
    accept: {
      label: '受ける（手間 2）',
      effects: [
        { type: 'workload', mods: { writesPerCall: 0.2 } },
        { type: 'feature', points: 4 },
        { type: 'interrupt', points: 2, months: 1 },
      ],
    },
  },
  {
    id: 'p-images',
    kind: 'proposal',
    tier: 'occasional',
    title: '記事に画像を多く載せる機能',
    text: '記事に画像を何枚も貼れるようにしてほしいという要望。画像の配信と保存が増える',
    when: { type: 'window', from: 3, to: 8 },
    premiseRefs: [
      'pool:cloudflare:images-',
      'pool:vercel:pro:pro-fdt',
      'pool:vercel:pro:pro-cdn-requests',
      'host:disk:',
      'host:line:',
      'pool:cloudflare:r2-standard:r2-storage',
    ],
    accept: {
      label: '受ける（手間 3 × 2 か月）',
      effects: [
        { type: 'workload', mods: { imagesPerPage: 10, uploadsFactor: 3 } },
        { type: 'feature', points: 8 },
        { type: 'growth', add: 0.03, months: 3 },
        { type: 'interrupt', points: 3, months: 2 },
      ],
    },
  },
  {
    id: 'p-personal',
    kind: 'proposal',
    tier: 'occasional',
    title: '会員向けの個人化（マイページ・おすすめ）',
    text: 'ログインした会員に、おすすめの記事を出す機能の要望。SSR のページが増える',
    when: { type: 'window', from: 4, to: 10 },
    premiseRefs: [
      'limit:cloudflare:workers-free:cpu-ms-per-request',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
      'host:cpu:',
      'limit:supabase:pro-micro:pooler-connections',
    ],
    accept: {
      label: '受ける（手間 4）',
      effects: [
        { type: 'workload', mods: { ssrShare: 0.6 } },
        { type: 'feature', points: 6 },
        { type: 'interrupt', points: 4, months: 1 },
      ],
    },
  },
  {
    id: 'p-archive',
    kind: 'proposal',
    tier: 'rare',
    title: '閉鎖する別のコミュニティから記事とコメントを引き取る',
    text: '閉鎖する別のコミュニティから、記事とコメントを引き取ってほしいと打診が来た。読者も移ってくるが、DB が一気に大きくなる',
    when: { type: 'rare', weight: 1 },
    notice: {
      monthsAhead: 1,
      title: '記事の引き取りの打診が来そう',
      text: '閉鎖するコミュニティから、記事の引き取りの打診が来月来る見込み',
    },
    premiseRefs: [
      'limit:cloudflare:workers-paid:d1-db-size',
      'pool:cloudflare:workers-paid:paid-d1-storage',
      'pool:supabase:pro-micro:pro-disk',
      'host:disk:',
    ],
    accept: {
      label: '受ける（手間 4）',
      effects: [
        { type: 'stock', add: { dbGB: 9, articlePages: 4000 } },
        { type: 'workload', mods: { dbRateFactor: 4 } },
        { type: 'basePV', factor: 1.5 },
        { type: 'interrupt', points: 4, months: 1 },
      ],
    },
  },
  {
    // W-1（D-24）: Vercel・VPS のリアルタイムは未取得なので、Cloudflare の構成のときだけ出す（X-5）
    id: 'p-chat',
    kind: 'proposal',
    tier: 'occasional',
    title: '記事ごとのチャット（リアルタイム）',
    text: '記事を読みながら話せるチャットがほしいという要望。WebSocket の接続を保つ部品が要る',
    when: { type: 'window', from: 4, to: 9 },
    platforms: ['cloudflare'],
    premiseRefs: [
      'pool:cloudflare:durable-objects-',
      'pool:cloudflare:workers-free:free-requests',
    ],
    accept: {
      label: '受ける（Durable Objects を付ける。手間 4）',
      effects: [
        {
          type: 'workload',
          // 会員の 5% が使い、1 人が月 8 回つなぎ 100 件送る。1 件 2 ms で処理し、つなぐと履歴 50 行を読む（仮定）
          mods: {
            realtime: {
              usersPerMau: 0.05,
              connectionsPerUser: 8,
              messagesPerUser: 100,
              processingMs: 2,
              historyRowsPerConnect: 50,
            },
          },
        },
        { type: 'component', slot: 'realtime', option: 'durable-objects' },
        { type: 'feature', points: 6 },
        { type: 'growth', add: 0.02, months: 3 },
        { type: 'interrupt', points: 4, months: 1 },
      ],
    },
  },
  {
    // SC-5・W-2（D-24）: セルフサービスのプランで稼働率の SLA があるのはさくらの VPS 4GB だけ（catalog の uptimeSla）
    id: 'p-sla',
    kind: 'proposal',
    tier: 'rare',
    title: '法人顧客が SLA つきの契約を求める',
    text: '社内の勉強会で記事を使いたい法人から、稼働率の SLA を条件にした有料の契約の打診が来た。契約の収益は SLA のあるプランで運営している月だけ入る',
    when: { type: 'rare', weight: 1 },
    notice: {
      monthsAhead: 1,
      title: '法人から SLA つきの契約の打診が来そう',
      text: '稼働率の SLA を条件にした契約の打診が来月来る見込み',
    },
    premiseRefs: [],
    showSla: true,
    requires: 'uptime-sla',
    accept: {
      label: '受ける（契約の対応に手間 2）',
      effects: [
        // 契約の金額は仮定
        { type: 'contract', usdPerMonth: 40, requires: 'uptime-sla' },
        { type: 'interrupt', points: 2, months: 1 },
      ],
    },
  },
  // ---- シナリオの台本（SC）----
  {
    id: 'buzz',
    kind: 'script',
    tier: 'common',
    title: 'SNS で話題になった！',
    text: '記事が SNS で広まり、今月だけ PV が大きく増えた。満足度が高ければ、その後も伸びが残る',
    when: { type: 'window', from: 6, to: 9 },
    notice: {
      monthsAhead: 1,
      title: 'SNS で話題になりそう',
      text: '記事が SNS で伸び始めた（来月、話題になるかもしれない）',
      pvFactor: 1.2,
      // 半分は予告なしで起きる（対処は来月から。D-28）
      chance: 0.5,
    },
    surpriseText:
      '記事が突然 SNS で広まり、今月だけ PV が大きく増えた（前兆はなかった）。今月の費用と満足度に効いている。満足度が高ければ、その後も伸びが残る',
    premiseRefs: [
      'pool:vercel:pro:',
      'pool:cloudflare:workers-paid:',
      'host:line:',
      'limit:supabase:pro-micro:pooler-connections',
    ],
    effects: [
      {
        type: 'traffic',
        factor: 3,
        earnsRevenue: true,
        months: 1,
        lasting: true,
      },
    ],
  },
  {
    id: 'bot',
    kind: 'script',
    tier: 'common',
    title: 'Bot・クローラーの大量アクセス',
    text: 'クローラーが大量に来ている（2 か月続く）。Bot は広告の収益にならない。Bot を遮断するルールを入れると、来月から半分になる',
    when: { type: 'window', from: 3, to: 11 },
    notice: {
      monthsAhead: 1,
      title: 'Bot・クローラーが大量に来そう',
      text: 'クローラーの訪問が増え始めた（来月、大量に来るかもしれない）。今月のうちに Bot を遮断するルールを入れれば、来月から半分になる',
      pvFactor: 1.2,
      bot: true,
      // 半分は予告なしで起きる。序盤（1〜2 か月目）には予告を出さない（D-28・D-20 V-12）
      chance: 0.5,
      notBefore: 3,
    },
    surpriseText:
      'クローラーが予告なしに大量に来た（2 か月続く）。Bot は広告の収益にならない。今月の費用に効いている。Bot を遮断するルールは来月から効く',
    premiseRefs: [
      'pool:cloudflare:workers-free:free-requests',
      'pool:cloudflare:workers-paid:paid-requests',
      'pool:vercel:pro:pro-cdn-requests',
      'pool:vercel:pro:pro-fdt',
      'host:cpu:',
      'host:line:',
    ],
    effects: [
      {
        type: 'traffic',
        factor: 2,
        earnsRevenue: false,
        months: 2,
        bot: true,
      },
    ],
  },
  {
    id: 'team',
    kind: 'script',
    tier: 'occasional',
    title: 'チームが増えた（2 人目）',
    text: '開発者がもう 1 人加わった。開発の手間が増える。席（メンバー）ごとに料金がかかるプランでは費用も増える（人件費は所持金に入れない）',
    when: { type: 'window', from: 4, to: 8 },
    premiseRefs: [],
    showMembers: true,
    effects: [
      { type: 'effortPerMonth', add: 10 },
      { type: 'seats', add: 1 },
    ],
  },
];

export const ARTICLE_COMMUNITY: Scenario = {
  id: 'article-community',
  name: '記事コミュニティ',
  months: 12,
  template: articleCommunity,
  // 1 枚 4 MB は テンプレートの 20 GB / 5,000 枚。DB の増え方は仮定
  stock: { dbGBPerMillionPV: 0.05, gbPerImage: 0.004 },
  scale: { startPV: 300_000 },
  growth: { acquisition: 0.15, churn: 0.15 },
  buzz: { extra: 0.3, reference: 0.9 },
  revenue: {
    adsUsdPer1000PV: 0.25,
    loss: { block: 0.6, throttle: 0.1, incident: 0.1, migration: 0.15 },
  },
  incidents: { selfHostedChancePerMonth: 0.08 },
  // 最適化しない画像の大きさ（原本。仮定）
  unoptimizedImageKB: 400,
  satisfaction: {
    weights: {
      availability: 0.4,
      speed: 0.2,
      feature: 0.2,
      freshness: 0.1,
      quality: 0.1,
    },
    speed: { heavySsrCpuMs: 12, heavyImageKB: 120, nearRatio: 0.7 },
    quality: { good: 150, fair: 100 },
    freshness: { good: 300, fair: 3600 },
    feature: { expectedPerMonth: 8, good: 1, fair: 0.6 },
  },
  effort: { perMonth: 10, selfHostedUpkeep: 3 },
  rare: { perGame: 0.25, from: 5, to: 9 },
  events: EVENTS,
  // 実際に予告されている改定の出来事（D-21）。1〜2 か月目は出さない（V-12）
  revisions: { from: 3, to: 10 },
  /**
   * 所持金の目標は基準プレイをシード 1〜50 で回して決めた（prd/07 §10.8）: CF Paid・何もしない（最小 $2,164）と
   * Vercel Pro → CF Paid（最小 $1,746）は全シードで届き、Vercel Pro・何もしない（最大 $1,716）は届かない。
   * VPS・画像の提案を受ける（中央値 $1,874）は、偶発的な障害が重ならなければ届く。
   */
  goal: { cash: 1730, satisfaction: 0.75, maxOutageMonths: 2 },
  startCash: 60,
  baselines: [
    {
      id: 'cf-paid',
      label: 'Cloudflare Paid・何もしない（提案は断る）',
      short: 'CF Paid・何もしない',
      stackIndex: CF_PAID,
    },
    {
      id: 'cf-paid-accept',
      label:
        'Cloudflare Paid・提案を全部受ける（D1 が 10 GB に近づいたら Vercel Pro + Supabase へ乗り換え）',
      short: 'CF Paid・提案を受ける',
      stackIndex: CF_PAID,
      decide: (s) => [
        ...respondAll(s, true),
        ...(sawEvent(s, 's-d1-limit')
          ? [{ type: 'migrate', stackIndex: VERCEL_PRO } as const]
          : []),
      ],
    },
    {
      id: 'vps-images',
      label:
        'さくらの VPS・画像を多く載せる提案だけ受け、画像の保存量が 70% を超えたら中程度に圧縮',
      short: 'VPS・画像の提案を受ける',
      stackIndex: VPS,
      decide: (s) => [
        ...s.pendingProposals.map((eventId): Action => ({
          type: 'respond',
          eventId,
          accept: eventId === 'p-images',
        })),
        ...(sawEvent(s, 's-image-storage') && s.settings.imageKB > 100
          ? [{ type: 'set', key: 'compress', value: 100 } as const]
          : []),
      ],
    },
    {
      id: 'vercel-pro',
      label: 'Vercel Pro・何もしない',
      short: 'Vercel Pro・何もしない',
      stackIndex: VERCEL_PRO,
    },
    {
      id: 'vercel-to-cf',
      label:
        'Vercel Pro で始め、1 か月目の終わりに Cloudflare Paid へ乗り換える',
      short: 'Vercel Pro → CF Paid',
      stackIndex: VERCEL_PRO,
      actions: [[{ type: 'migrate', stackIndex: CF_PAID }]],
    },
    {
      id: 'cf-free',
      label: 'Cloudflare Free・何もしない',
      short: 'CF Free・何もしない',
      stackIndex: CF_FREE,
    },
    // GD-4（D-24）の目盛り。不適切な選択と、部品の追加・SLA の対応
    {
      id: 'cf-paid-kvdb',
      label:
        'Cloudflare Paid・1 か月目の終わりに DB を KV に差し替える（不適切な選択）',
      short: 'CF Paid・KV を DB 代わり',
      stackIndex: CF_PAID,
      actions: [[{ type: 'component', slot: 'db', option: 'kv' }]],
    },
    {
      id: 'cf-paid-chat',
      label: 'Cloudflare Paid・チャットの提案だけ受ける',
      short: 'CF Paid・チャットを受ける',
      stackIndex: CF_PAID,
      decide: (s) =>
        s.pendingProposals.map((eventId): Action => ({
          type: 'respond',
          eventId,
          accept: eventId === 'p-chat',
        })),
    },
    {
      id: 'vps-sla',
      label:
        'さくらの VPS 2GB・SLA の契約の打診が予告されたら 4GB にプラン変更し、打診を受ける',
      short: 'VPS・SLA に応える',
      stackIndex: VPS,
      decide: (s) => [
        ...(sawEvent(s, 'p-sla', 'notice') && s.stackIndex === VPS
          ? [{ type: 'plan', stackIndex: VPS_4GB } as const]
          : []),
        ...s.pendingProposals.map((eventId): Action => ({
          type: 'respond',
          eventId,
          accept: eventId === 'p-sla',
        })),
      ],
    },
  ],
};
