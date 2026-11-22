// @vitest-environment jsdom
// バックエンドの長時間の処理（D-239・prd/17 §6 の出来事 7）の進み具合を月の報告に出す。出来事そのもの（文言・起きる月）は PR-10 なので、
// 棋譜解析に提案を足した形で 1 か月目に受け、2 か月目の報告のカードを描いて確かめる。
import { render } from '@testing-library/react';
import {
  applyActions,
  DEFAULT_START_DATE,
  ESTIMATE_ONLY_SCENARIOS,
  newGame,
  playMonth,
  STACKS,
  type BackgroundJobDef,
  type Scenario,
} from 'game';
import { describe, expect, it } from 'vitest';
import { MonthCard } from './game-screen/month-card.tsx';
import { useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

const PRO = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
const job: BackgroundJobDef = {
  label: '戦法の分析の更新',
  vcpuHours: 2_000,
  onDone: [{ type: 'feature', points: 4 }],
};
const sc: Scenario = {
  ...ESTIMATE_ONLY_SCENARIOS['kifu-analysis']!,
  startCash: 1e9,
  scale: { startPV: 30_000 },
  events: [
    {
      id: 'k-job-test',
      kind: 'proposal',
      tier: 'common',
      title: '長時間の処理（テスト）',
      text: 'テスト',
      when: { type: 'window', from: 1, to: 1 },
      premiseRefs: [],
      accept: { label: '始める', effects: [{ type: 'background-job', job }] },
    },
  ],
};

const month2 = (analysis: string) => {
  const s = playMonth(
    newGame(PRO, 1, sc, DEFAULT_START_DATE, 'nextjs', { analysis }),
  );
  return playMonth(
    applyActions(s, [{ type: 'respond', eventId: 'k-job-test', accept: true }]),
  ).history[1]!;
};

describe('長時間の処理の進み具合', () => {
  it('worker の VPS は空いている CPU で進んだ量を出す', () => {
    render(<MonthCard report={month2('worker-vps-4gb')} />);
    const row = document.querySelector<HTMLElement>(
      '[data-background-job="k-job-test"]',
    )!;
    expect(row.textContent).toMatch(/長時間の処理「戦法の分析の更新」中/);
    expect(row.textContent).toMatch(/\/ 2,000 vCPU 時間/);
    expect(row.textContent).toMatch(/VPS の空いている CPU で今月/);
    expect(row.querySelector('progress')).toBeTruthy();
  });

  it('サーバーレスはその月に終わり、追加の費用を出す', () => {
    render(<MonthCard report={month2('same')} />);
    const row = document.querySelector<HTMLElement>(
      '[data-background-job="k-job-test"]',
    )!;
    expect(row.textContent).toMatch(/が終わりました/);
    expect(row.textContent).toMatch(/追加の費用 約 \$\d/);
  });
});
