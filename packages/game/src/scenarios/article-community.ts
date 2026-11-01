// シナリオ: 記事コミュニティ（prd/07 §7・§10・D-20）。値はすべてゲーム上の仮定で、実在の値ではない。
// 料金・制限は catalog のデータをそのまま使う（ここで料金を作らない）。前提の文も catalog のもの（premiseRefs で参照する）。
import {
  ARTICLE_COMMUNITY_ASTRO,
  ARTICLE_COMMUNITY_SPA,
  articleCommunity,
} from 'catalog';
import type { Action, GameState } from '../index.ts';
import type { EventDef, Scenario } from '../scenario.ts';
import { ARTICLE_COMMUNITY_TEXT } from './article-community-text.ts';

// 構成の番号（catalog の MVP_STACKS の順）
const CF_FREE = 0;
const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const VPS_4GB = 5;
const AWS_AMPLIFY = 6;
const AWS_OPENNEXT = 7;

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
    title: '込み分・クレジットの 70% を超えた',
    text: '流量で決まる込み分（Vercel Pro は月のクレジット）に近づいた。設定（ISR・画像の形式）やプランで対応できる',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-requests',
        'pool:cloudflare:workers-paid:paid-kv-writes',
        'credit:vercel:pro:usage-credit',
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
        { type: 'interrupt', featureWork: true, points: 2, months: 1 },
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
      'credit:vercel:pro:usage-credit',
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
        { type: 'interrupt', featureWork: true, points: 3, months: 2 },
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
        { type: 'interrupt', featureWork: true, points: 4, months: 1 },
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
        { type: 'interrupt', featureWork: true, points: 4, months: 1 },
      ],
    },
  },
  {
    // D-32: 編集部が記事の即時反映を求める。受けると以後ずっと「即時反映」の要件（満たさない構成では鮮度が下がる）
    id: 'p-ondemand',
    kind: 'proposal',
    tier: 'occasional',
    title: '編集部が記事の即時反映を求める（オンデマンド ISR）',
    text: '記事を直したらすぐ読者に見えるようにしてほしいという要望。公開・修正のたびに revalidatePath・revalidateTag で再検証する。古い版を一度も出さないなら revalidateTag の { expire: 0 }（次のアクセスは再生成を待つ）。ISR のキャッシュの置き場所しだいで、すぐには反映されない構成がある',
    when: { type: 'window', from: 4, to: 9 },
    previewRequirement: 'on-demand-isr',
    premiseRefs: [
      'fact:cloudflare:workers-paid:',
      'fact:cloudflare:cdn-free:next-on-demand',
    ],
    // 受けると再検証をオンデマンドにする。時間のままなら切り替えの実装（設定の切り替えと同じ手間 2）がかかり、
    // すでにオンデマンドなら作業は要らない（D-49。それまでは一律に手間 3）
    accept: {
      label: '受ける（手間 2。再検証がすでにオンデマンドなら 0）',
      effects: [
        { type: 'feature', points: 5 },
        { type: 'growth', add: 0.02, months: 3 },
        {
          type: 'interrupt',
          featureWork: true,
          points: 2,
          months: 1,
          unlessOnDemand: true,
        },
        { type: 'on-demand-revalidate' },
        { type: 'requirement', requirement: 'on-demand-isr' },
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
  {
    // D-47: 投稿のときに一律で縮めて置くと原本が残らず、後から大きな表示に対応しにくい
    id: 'p-image-redesign',
    kind: 'proposal',
    tier: 'occasional',
    title: '記事のデザインを刷新して、画像を大きく綺麗に出したい',
    text: '大きな画面・高精細の端末で記事を読む人が増え、画像をもっと大きく綺麗に出したいという声が上がった。原本が無いと、過去の画像は大きくできない（縮めて置いた画像からは元の細かさを戻せない）。原本を保存している構成（閲覧のときに変換・投稿のときにサイズ違いを作る）なら過去の記事も含めて大きくでき、一律で縮めて置いた構成はこれからの投稿だけ大きくできる。原本をそのまま配っている構成は既に大きい。断ると、しばらく画質の評価が下がる',
    // 確率は基準プレイを見て決めた（ゲーム上の仮定）
    when: { type: 'window', from: 5, to: 10, chance: 0.5 },
    premiseRefs: [],
    accept: {
      label:
        '受ける（手間: 原本がある構成 1・一律で縮めた構成 2・原本を配っている構成 0）',
      effects: [{ type: 'imageRedesign' }],
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
        social: true,
        // 上乗せ分は 2 日に集中する（SNS の拡散は 1〜2 日で山を作る。容量の判定だけ・ゲーム上の仮定。D-44）
        spikeDays: 2,
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
      'credit:vercel:pro:usage-credit',
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
        // 上乗せ分は月のうち 7 日に集中する（クローラーは波で来る。容量の判定だけ・ゲーム上の仮定。D-44）
        spikeDays: 7,
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
  // slowPenalty: 速さが「悪い」月は PV の伸びを 3 ポイント下げる（離脱・検索からの流入。割合は出典なしの仮定・D-47）
  growth: { acquisition: 0.15, churn: 0.15, slowPenalty: 0.03 },
  buzz: { extra: 0.3, reference: 0.9 },
  revenue: {
    adsUsdPer1000PV: 0.25,
    loss: { block: 0.6, throttle: 0.1, incident: 0.1, migration: 0.15 },
  },
  incidents: { selfHostedChancePerMonth: 0.08 },
  // 記事のページを作り直すのは記事の投稿・編集だけ（書き込みの 1%。30 万 PV で月 300 回 ≒ 1 日 10 回）。
  // コメント・いいねは別のデータとして読み込み（クライアントで取得・Suspense で後から流す）、記事のページを再生成しない
  // （一般的な作り方の仮定。D-70・prd/04 §2）。Astro のビルドし直しも同じ回数（D-68）
  pageUpdateShare: 0.01,
  // 設定「コメントの描き方」で記事のページに含めると、コメントの投稿も記事のページを作り直す（D-82）。コメントの投稿の割合は
  // 出典が無く、D-49 の旧仮定（書き込みの半分がページを変える）に合うよう、記事の投稿・編集と合わせて 0.5 になる 0.49 とする
  // （30 万 PV で月 約 1.5 万回 ≒ 1 日 約 490 回。ゲーム上の仮定）
  // 記事のページに含めて時間で再検証すると、コメントは間隔の分だけ遅れて見える（D-85）。コメントは書いた人と返信を待つ人がいる
  // やりとりなので、記事（5 分まで「良い」・1 時間まで「普通」）より厳しく、1 分まで「良い」・5 分まで「普通」とする（ゲーム上の仮定）
  comments: { pageUpdateShare: 0.49, freshness: { good: 60, fair: 300 } },
  // 最適化しない画像の大きさ = 原本（stock.gbPerImage の 4 MB。D-47 で 400 KB から揃えた）
  unoptimizedImageKB: 4_000,
  // 投稿のときに一律で縮めて置く 1 枚（長い辺 1,600〜2,000px の JPEG・WebP を想定。ゲーム上の仮定・D-47）
  resizedImageKB: 400,
  // 記事のデザインの刷新を断ると 2 か月画質が 1 段下がる・受けたあと粗い画像が在庫の 2 割以上なら 1 段下がる（仮定・D-47）
  imageRedesign: { declineMonths: 2, coarseShare: 0.2 },
  satisfaction: {
    weights: {
      availability: 0.4,
      speed: 0.2,
      feature: 0.2,
      freshness: 0.1,
      quality: 0.1,
    },
    // 1 枚 1 MB 以上（原本級）を配ると速さは「悪い」（ゲーム上の仮定・D-47）
    speed: {
      heavySsrCpuMs: 12,
      heavyImageKB: 120,
      nearRatio: 0.7,
      veryHeavyImageKB: 1_000,
    },
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
   * 所持金の目標は基準プレイをシード 1〜50 で回して決めた（prd/07 §10.8・D-64）: CF Paid・何もしない（最小 $2,110）・
   * Amplify・前段の CloudFront + 定額（最小 $1,834）・OpenNext・画像の最適化（最小 $2,145）は全シードで届き、
   * Vercel Pro・何もしない（最大 $982）と CF Paid・原本のまま配る（最大 $1,702）は届かない。範囲（$1,702〜$1,834）に入るので動かさない。
   * VPS・前段の CDN（37 / 50）と Vercel Pro → CF Paid（15 / 50）は、届きやすいが確実ではない道筋。
   */
  goal: { cash: 1730, satisfaction: 0.75, maxOutageMonths: 2 },
  startCash: 60,
  text: ARTICLE_COMMUNITY_TEXT,
  // フレームワーク（prd/10 F-04・F-05）。既定は Next.js。SPA の効き方の値はゲーム上の仮定
  frameworks: {
    allowed: ['nextjs', 'vite-spa', 'astro', 'nextjs-export'],
    default: 'nextjs',
    // Astro（D-68）: 記事は静的にビルドし、JS はアイランドの分だけ。記事は検索・SNS から初めて来る読者が多いので、
    // 初回表示の軽さが効く（仮定: 速さの重さを 1 つ減らす）
    astro: { shape: ARTICLE_COMMUNITY_ASTRO, firstLoadLight: true },
    spa: {
      shape: ARTICLE_COMMUNITY_SPA,
      // 記事ごとのカードが出ないと、話題の伸び（× 3 の 2 倍分と後に残る分）が半分（仮定）
      socialCardFactor: 0.5,
      // 記事は検索・SNS から初めて来る読者が多く、初回表示が効く（仮定）
      firstLoadHeavy: true,
    },
  },
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
        'さくらの VPS・画像を多く載せる提案だけ受け、画像の保存量が 70% を超えたら画像を WebP にする',
      short: 'VPS・画像の提案を受ける',
      stackIndex: VPS,
      decide: (s) => [
        ...s.pendingProposals.map((eventId): Action => ({
          type: 'respond',
          eventId,
          accept: eventId === 'p-images',
        })),
        ...(sawEvent(s, 's-image-storage') && s.settings.imageKB > 105
          ? [{ type: 'set', key: 'format', value: 105 } as const]
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
    // GD-4（D-24）の目盛り。不適切な選択（画面では印を出さない。D-45）と、部品の追加・SLA の対応
    {
      id: 'cf-paid-kvdb',
      label: 'Cloudflare Paid・1 か月目の終わりに DB を KV に差し替える',
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
    // 構成に合った対策（D-64）。目標の根拠に使う。1 か月目の終わりに部品を替え、提案は断る
    {
      id: 'vps-cdn',
      label:
        'さくらの VPS 2GB・1 か月目の終わりに前段の CDN（静的と画像だけ）を付ける',
      short: 'VPS・前段の CDN',
      stackIndex: VPS,
      actions: [[{ type: 'component', slot: 'frontCdn', option: 'static' }]],
    },
    {
      id: 'vercel-cf-images',
      label:
        'Vercel Pro・1 か月目の終わりに画像を Cloudflare に出す（投稿のときに一律で縮めて R2 に置く）',
      short: 'Vercel Pro・画像だけ Cloudflare',
      stackIndex: VERCEL_PRO,
      actions: [[{ type: 'component', slot: 'images', option: 'cf-resize' }]],
    },
    {
      id: 'aws-amplify-cdn',
      label:
        'AWS Amplify・1 か月目の終わりに前段の CloudFront（静的と画像だけ）を付け、CDN の料金を定額 Pro にする',
      short: 'Amplify・前段の CloudFront + 定額',
      stackIndex: AWS_AMPLIFY,
      actions: [
        [
          { type: 'component', slot: 'frontCdn', option: 'static' },
          { type: 'component', slot: 'cdnPlan', option: 'flat-pro' },
        ],
      ],
    },
    {
      id: 'aws-opennext-images',
      label: 'AWS OpenNext・1 か月目の終わりに画像を OpenNext の最適化にする',
      short: 'OpenNext・画像の最適化',
      stackIndex: AWS_OPENNEXT,
      actions: [[{ type: 'component', slot: 'images', option: 'default' }]],
    },
  ],
};
