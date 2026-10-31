// シナリオ: 受託先の業務アプリを運用する（prd/09・D-33）。受託は設定（フレーバー）だけで、お金の流れは記事コミュニティと同じ
// （収益 − インフラの費用 = 所持金。人件費は入れない）。値はすべてゲーム上の仮定で、実在の値でも相場でもない。
// 料金・制限は catalog のデータをそのまま使い（ここで料金を作らない）、前提の文も catalog のもの（premiseRefs で参照する）。
import { BUSINESS_APP_SPA, businessApp } from 'catalog';
import type { Action, GameState } from '../index.ts';
import type { EventDef, Scenario } from '../scenario.ts';

// 構成の番号（catalog の MVP_STACKS の順）
const CF_FREE = 0;
const CF_PAID = 1;
const VERCEL_HOBBY = 2;
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
/**
 * VPS を手入れする: 速さが「良い」でなくなったら SSR を最適化し、ディスクの使用率が 70% を超えたら
 * ストレージ変更オプションを付ける（基準プレイ用）。
 */
const careForVps = (s: GameState): Action[] => {
  const last = s.history[s.history.length - 1];
  return [
    ...(last && last.satisfaction.stages.speed !== 'good'
      ? [{ type: 'optimize' } as const]
      : []),
    ...(sawEvent(s, 'c-s-file-storage') && !s.storageOption
      ? [{ type: 'storage-option' } as const]
      : []),
  ];
};

const EVENTS: EventDef[] = [
  // ---- 状態で起きる（S）----
  {
    id: 'c-s-allowance',
    kind: 'state',
    tier: 'common',
    title: '込み分の 70% を超えた',
    text: '利用の増加で、込み分に近づいた。運用費は固定が主なので、超えた分の従量課金はそのまま利幅を削る',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-requests',
        'pool:vercel:pro:pro-cdn-requests',
        'pool:vercel:pro:pro-fdt',
        'pool:supabase:pro-micro:pro-egress',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 'c-s-db-size',
    kind: 'state',
    tier: 'occasional',
    title: 'DB が大きくなった',
    text: '業務の記録がたまり、DB の保存量が込み分・上限に近づいた',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-d1-storage',
        'pool:supabase:pro-micro:pro-disk',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 'c-s-file-storage',
    kind: 'state',
    tier: 'occasional',
    title: '添付ファイルの保存量が増えた',
    text: '添付ファイルがたまり、保存先の容量に近づいた。VPS ではディスクがいっぱいになると止まる',
    when: { type: 'premise', premiseIds: ['host:disk:'], atLeast: 0.7 },
    premiseRefs: [],
  },
  {
    id: 'c-s-d1-limit',
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
  // ---- 顧客からの依頼（P）----
  {
    id: 'c-p-report',
    kind: 'proposal',
    tier: 'common',
    title: '帳票（PDF・CSV）を出力したい',
    text: '顧客から、一覧を帳票として出力したいという依頼。API の処理が重くなり、応答も大きくなる',
    when: { type: 'window', from: 3, to: 10 },
    premiseRefs: [
      'limit:cloudflare:workers-free:cpu-ms-per-request',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
      'fact:cloudflare:',
      'fact:vercel:pro:active-cpu',
      'host:cpu:',
    ],
    accept: {
      label: '受ける（手間 3）',
      effects: [
        { type: 'workload', mods: { apiCpuMs: 15, apiResponseKB: 30 } },
        { type: 'feature', points: 4 },
        { type: 'interrupt', featureWork: true, points: 3, months: 1 },
      ],
    },
  },
  {
    id: 'c-p-attachments',
    kind: 'proposal',
    tier: 'occasional',
    title: '申請に複数のファイルを添付したい',
    text: '顧客から、申請や見積に何件もファイルを添付したいという依頼。添付ファイルの保存量が速く増える',
    when: { type: 'window', from: 3, to: 8 },
    premiseRefs: [
      'pool:cloudflare:r2-standard:r2-storage',
      'host:disk:',
      'pool:supabase:',
    ],
    accept: {
      label: '受ける（手間 3）',
      effects: [
        { type: 'workload', mods: { uploadsFactor: 3 } },
        { type: 'feature', points: 6 },
        { type: 'interrupt', featureWork: true, points: 3, months: 1 },
      ],
    },
  },
  {
    id: 'c-p-audit-log',
    kind: 'proposal',
    tier: 'occasional',
    title: '操作の記録（監査ログ）を残したい',
    text: '顧客の監査の要件で、誰がいつ何をしたかを記録したいという依頼。書き込みと DB の増え方が大きくなる',
    when: { type: 'window', from: 4, to: 10 },
    premiseRefs: [
      'pool:cloudflare:workers-paid:paid-d1-rows-written',
      'pool:cloudflare:workers-paid:paid-d1-storage',
      'limit:cloudflare:workers-paid:d1-db-size',
      'pool:supabase:pro-micro:pro-disk',
      'host:disk:',
    ],
    accept: {
      label: '受ける（手間 3）',
      effects: [
        { type: 'workload', mods: { writesPerCall: 0.6, dbRateFactor: 3 } },
        { type: 'feature', points: 4 },
        { type: 'interrupt', featureWork: true, points: 3, months: 1 },
      ],
    },
  },
  {
    id: 'c-p-retention',
    kind: 'proposal',
    tier: 'occasional',
    title: '旧システムの記録を取り込んで保管したい',
    text: '顧客から、旧システムの過去数年分の記録を取り込み、保管期間のあいだ消さずに残したいという依頼。DB が一気に大きくなる',
    when: { type: 'window', from: 4, to: 9 },
    premiseRefs: [
      'limit:cloudflare:workers-paid:d1-db-size',
      'pool:cloudflare:workers-paid:paid-d1-storage',
      'pool:supabase:pro-micro:pro-disk',
      'host:disk:',
    ],
    accept: {
      label: '受ける（手間 4）',
      effects: [
        { type: 'stock', add: { dbGB: 5 } },
        { type: 'feature', points: 4 },
        { type: 'interrupt', featureWork: true, points: 4, months: 1 },
      ],
    },
  },
  {
    id: 'c-p-members',
    kind: 'proposal',
    tier: 'occasional',
    title: '顧客の担当者をアカウントのメンバーに入れたい',
    text: '顧客の担当者が、デプロイの状況や利用量を自分で見たいという依頼。アカウントのメンバー（席）が 1 つ増える。席ごとに料金がかかるプランでは費用も増える',
    when: { type: 'window', from: 3, to: 10 },
    premiseRefs: [],
    showMembers: true,
    accept: {
      label: '受ける（手間 1）',
      effects: [
        { type: 'seats', add: 1 },
        { type: 'feature', points: 2 },
        { type: 'interrupt', points: 1, months: 1 },
      ],
    },
  },
  {
    // さくらの VPS 4GB だけが自己契約のプランで稼働率の SLA を持つ（catalog の uptimeSla。D-24）
    id: 'c-p-sla',
    kind: 'proposal',
    tier: 'rare',
    title: '顧客が稼働率の SLA を契約に入れたい',
    text: '顧客から、運用の契約に稼働率の SLA を入れたいという打診が来た。応じれば運用費が上がる。裏付けとなる SLA のあるプランで運用している月だけ、上乗せが入る',
    when: { type: 'rare', weight: 1 },
    notice: {
      monthsAhead: 1,
      title: '顧客から SLA の打診が来そう',
      text: '稼働率の SLA を運用の契約に入れたいという打診が来月来る見込み',
    },
    premiseRefs: [],
    showSla: true,
    requires: 'uptime-sla',
    accept: {
      label: '受ける（契約の対応に手間 2）',
      effects: [
        // 上乗せの金額は仮定
        { type: 'contract', usdPerMonth: 40, requires: 'uptime-sla' },
        { type: 'interrupt', points: 2, months: 1 },
      ],
    },
  },
  {
    id: 'c-p-rollout',
    kind: 'proposal',
    tier: 'rare',
    title: '全社に展開したい',
    text: '顧客から、一部の部署で使っていたアプリを全社に展開したいという打診が来た。利用者と記録が大きく増える（運用費の固定分は変わらず、利用に応じた分だけ増える）',
    when: { type: 'rare', weight: 1 },
    notice: {
      monthsAhead: 1,
      title: '全社への展開の打診が来そう',
      text: '全社への展開の打診が来月来る見込み',
    },
    premiseRefs: [
      'pool:cloudflare:workers-paid:',
      'pool:vercel:pro:',
      'pool:supabase:pro-micro:',
      'limit:cloudflare:workers-paid:d1-db-size',
      'host:',
    ],
    accept: {
      label: '受ける（手間 4）',
      effects: [
        { type: 'basePV', factor: 3 },
        { type: 'stock', add: { dbGB: 2 } },
        { type: 'interrupt', points: 4, months: 1 },
      ],
    },
  },
  // ---- シナリオの台本（SC）----
  {
    id: 'c-busy',
    kind: 'script',
    tier: 'common',
    title: '繁忙期（年度末の締め）',
    text: '年度末の締めで、今月は利用が増え、平日の日中に集中した。運用費は固定が主なので、収益はあまり増えない',
    when: { type: 'window', from: 6, to: 11 },
    notice: {
      monthsAhead: 1,
      title: '来月は繁忙期',
      text: '顧客から、来月は年度末の締めで利用が集中すると連絡があった',
    },
    premiseRefs: [
      'pool:cloudflare:workers-free:',
      'pool:cloudflare:workers-paid:paid-requests',
      'pool:vercel:pro:pro-cdn-requests',
      'limit:supabase:pro-micro:pooler-connections',
      'host:cpu:',
    ],
    effects: [
      {
        type: 'traffic',
        factor: 1.5,
        peakFactor: 2,
        earnsRevenue: true,
        months: 1,
      },
    ],
  },
  {
    id: 'c-expand',
    kind: 'script',
    tier: 'occasional',
    title: '他の部署でも使い始めた',
    text: '顧客の別の部署でも使い始め、利用者が増えた（以降ずっと）',
    when: { type: 'window', from: 4, to: 9 },
    premiseRefs: [],
    effects: [{ type: 'basePV', factor: 1.5 }],
  },
];

export const CONTRACT_OPERATIONS: Scenario = {
  id: 'contract-operations',
  name: '受託先の業務アプリの運用',
  months: 12,
  template: businessApp,
  // 添付ファイル 1 件 2 MB は テンプレートの 6 GB / 3,000 件。DB の増え方は仮定（業務の記録が多い）
  stock: { dbGBPerMillionPV: 0.5, gbPerImage: 0.002 },
  // 30 万 PV ≒ 利用者 1,500 人（テンプレートの 1 人 月 200 PV）
  scale: { startPV: 300_000 },
  // 評判 0.9 で月 +3%・0.75 で横ばい（純成長率 = 0.05 × 評判 − 0.15 × (1 − 評判)）。顧客の社内で緩く広がる
  growth: { acquisition: 0.05, churn: 0.15 },
  // 話題の出来事は無い（使わない）
  buzz: { extra: 0, reference: 0.9 },
  revenue: {
    // 顧客から受け取る運用・保守の費用（固定）+ 利用に応じた従量。どちらも仮定（相場ではない）
    fixedUsdPerMonth: 120,
    adsUsdPer1000PV: 0.1,
    // 止まった月は運用費の減額と読み替える（仮定）
    loss: { block: 0.6, throttle: 0.1, incident: 0.1, migration: 0.15 },
  },
  incidents: { selfHostedChancePerMonth: 0.08 },
  unoptimizedImageKB: 150,
  satisfaction: {
    // 顧客の満足。業務アプリなので画質・鮮度は効かせない
    weights: {
      availability: 0.45,
      speed: 0.3,
      feature: 0.25,
      freshness: 0,
      quality: 0,
    },
    // SSR はテンプレートで 20 ms。機能開発で重くなると「重い」になる。画像は配らないので判定に使わない
    speed: { heavySsrCpuMs: 23, heavyImageKB: 1_000_000, nearRatio: 0.7 },
    quality: { good: 0, fair: 0 },
    freshness: { good: 1_000_000, fair: 1_000_000 },
    feature: { expectedPerMonth: 8, good: 1, fair: 0.6 },
  },
  effort: { perMonth: 10, selfHostedUpkeep: 3 },
  rare: { perGame: 0.25, from: 5, to: 9 },
  events: EVENTS,
  revisions: { from: 3, to: 10 },
  goal: { cash: 1700, satisfaction: 0.75, maxOutageMonths: 2 },
  startCash: 60,
  // フレームワーク（prd/10 F-04）。既定は Next.js。業務アプリは SPA で作ることも多いので選べる
  frameworks: {
    allowed: ['nextjs', 'vite-spa'],
    default: 'nextjs',
    spa: {
      shape: BUSINESS_APP_SPA,
      // SNS の話題は無い（使わない）
      socialCardFactor: 1,
      // 平日に毎日使い、JS はブラウザに残るので、初回表示は効かせない（仮定）
      firstLoadHeavy: false,
    },
  },
  hidden: {
    settings: ['compress', 'variants', 'isr'],
    // SNS のカード（OGP）はログインして使う業務アプリでは効かない
    slots: ['isrCache', 'images', 'realtime', 'ogp'],
    blockBots: true,
  },
  text: {
    intro:
      '自社が受託で作った、顧客の業務アプリ（申請・一覧・検索・登録。ログインして使う）の運用を受け持っている。インフラは自社のアカウントで持ち、費用は自社が払う（運用費に込み）。',
    scale: '利用者は顧客の社員と取引先で、平日の日中に集中する。',
    growth: {
      up: '顧客の満足度が高ければ社内で利用が広がり',
      down: '低ければ利用が減る',
    },
    events:
      '運営中に顧客から依頼が来る（帳票の出力・ファイルの添付・監査ログ・旧システムの記録の取り込み・担当者をメンバーに入れる。受けるか断るかを選ぶ）。繁忙期（前の月に予告）や、他の部署での利用の広がりもある。まれに、SLA の打診や全社への展開の打診が来る（1 か月前に予告）。',
    satisfaction:
      '満足度（顧客の満足）は可用性・速さ・機能で決まる（画質・鮮度はこのシナリオでは効かない）。',
    app: [
      'ページはすべて SSR（ログインが要る）。平日と休日の比 8・ピークの時間帯は平均の 4 倍',
      '1 PV あたり API 3 回（書き込みが多い）。DB は 1 GB から、業務の記録で大きくなる',
      '添付ファイルは利用者 1 人あたり月 2 件（1 件 2 MB。始めは月 約 6 GB）。配信の量は数えず、保存量だけがたまる',
    ],
    byFramework: {
      'vite-spa': {
        intro:
          '自社が受託で作った、顧客の業務アプリ（申請・一覧・検索・登録。ログインして使う）の運用を受け持っている。画面は Vite の SPA、API は同じ事業者に置いている。インフラは自社のアカウントで持ち、費用は自社が払う（運用費に込み）。',
        app: [
          '画面は 1 つのシェルとブラウザの JS で描き、中身は API で取る（HTML の生成は無い）。平日と休日の比 8・ピークの時間帯は平均の 4 倍',
          '1 PV あたり API 3 回 + 画面の中身の API 1 回（書き込みが多い）。DB は 1 GB から、業務の記録で大きくなる',
          '添付ファイルは利用者 1 人あたり月 1 件（2 MB）。配信の量は数えず、保存量だけがたまる',
        ],
      },
    },
    revenue:
      '収益は顧客から受け取る運用費: 固定 $120 / 月 + 1,000 PV あたり $0.1（ゲーム上の仮定。相場ではない）。止まった月は減額される。人件費は入れない。',
  },
  baselines: [
    {
      id: 'cf-paid',
      label: 'Cloudflare Paid・何もしない（依頼は断る）',
      short: 'CF Paid・何もしない',
      stackIndex: CF_PAID,
    },
    {
      id: 'cf-paid-accept',
      label:
        'Cloudflare Paid・依頼を全部受ける（D1 が 10 GB に近づいたら Vercel Pro + Supabase へ乗り換え）',
      short: 'CF Paid・依頼を受ける',
      stackIndex: CF_PAID,
      decide: (s) => [
        ...respondAll(s, true),
        ...(sawEvent(s, 'c-s-d1-limit')
          ? [{ type: 'migrate', stackIndex: VERCEL_PRO } as const]
          : []),
      ],
    },
    {
      id: 'vps',
      label: 'さくらの VPS 2GB・何もしない',
      short: 'VPS・何もしない',
      stackIndex: VPS,
    },
    {
      id: 'vps-care',
      label:
        'さくらの VPS 2GB・速さが落ちたら SSR を最適化し、ディスクが 70% を超えたらストレージ変更オプションを付ける',
      short: 'VPS・手入れする',
      stackIndex: VPS,
      decide: careForVps,
    },
    {
      id: 'vps-sla',
      label:
        'さくらの VPS 2GB・手入れをしつつ、SLA の打診が予告されたら 4GB にプラン変更し、打診を受ける',
      short: 'VPS・SLA に応える',
      stackIndex: VPS,
      decide: (s) => [
        ...(sawEvent(s, 'c-p-sla', 'notice') && s.stackIndex === VPS
          ? [{ type: 'plan', stackIndex: VPS_4GB } as const]
          : []),
        ...s.pendingProposals.map((eventId): Action => ({
          type: 'respond',
          eventId,
          accept: eventId === 'c-p-sla',
        })),
        ...careForVps(s),
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
      id: 'vercel-hobby',
      label: 'Vercel Hobby・何もしない（受託の案件で非商用のプラン）',
      short: 'Vercel Hobby・何もしない',
      stackIndex: VERCEL_HOBBY,
    },
    {
      id: 'cf-free',
      label: 'Cloudflare Free・何もしない',
      short: 'CF Free・何もしない',
      stackIndex: CF_FREE,
    },
  ],
};
