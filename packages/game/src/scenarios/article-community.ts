// シナリオ: 記事コミュニティ（prd/07 §7・§10）。値はすべてゲーム上の仮定で、実在の値ではない。
// 料金・制限は catalog のデータをそのまま使う（ここで料金を作らない）。
import { articleCommunity } from 'catalog';
import type { Scenario } from '../scenario.ts';

export const ARTICLE_COMMUNITY: Scenario = {
  id: 'article-community',
  name: '記事コミュニティ',
  months: 12,
  template: articleCommunity,
  stock: null,
  scale: { startPV: 150_000 },
  growth: { acquisition: 0.5, churn: 0.5 },
  buzz: { extra: 0.8, reference: 0.9 },
  revenue: {
    adsUsdPer1000PV: 0.25,
    loss: { block: 0.6, throttle: 0.1, incident: 0.1, migration: 0.15 },
  },
  incidents: { selfHostedChancePerMonth: 0.08 },
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
  rare: { perGame: 0, from: 5, to: 9 },
  events: [
    {
      id: 'buzz',
      kind: 'script',
      tier: 'common',
      title: 'SNS で話題になった！',
      text: '記事が SNS で広まり、今月だけ PV が大きく増えた。満足度が高ければ、その後も伸びが残る',
      when: { type: 'window', from: 7, to: 7 },
      premiseRefs: [],
      effects: [
        {
          type: 'traffic',
          factor: 10,
          earnsRevenue: true,
          months: 1,
          lasting: true,
        },
      ],
    },
  ],
  calendarStart: null,
  goal: { cash: 6200, satisfaction: 0.75, maxOutageMonths: 2 },
  startCash: 60,
  baselines: [
    {
      id: 'cf-paid',
      label: 'Cloudflare Paid・何もしない',
      short: 'CF Paid・何もしない',
      stackIndex: 1,
      actions: [],
    },
    {
      id: 'vps',
      label: 'さくらの VPS・何もしない',
      short: 'VPS・何もしない',
      stackIndex: 4,
      actions: [],
    },
    {
      id: 'vercel-pro',
      label: 'Vercel Pro・何もしない',
      short: 'Vercel Pro・何もしない',
      stackIndex: 3,
      actions: [],
    },
    {
      id: 'vercel-compress-late',
      label: 'Vercel Pro・話題の前（6 か月目）に画像を中程度に圧縮',
      short: 'Vercel Pro・話題前に圧縮',
      stackIndex: 3,
      actions: [
        [],
        [],
        [],
        [],
        [],
        [{ type: 'set', key: 'compress', value: 100 }],
      ],
    },
    {
      id: 'cf-free',
      label: 'Cloudflare Free・何もしない',
      short: 'CF Free・何もしない',
      stackIndex: 0,
      actions: [],
    },
  ],
};
