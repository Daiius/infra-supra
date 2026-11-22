// @vitest-environment jsdom
// 満足度の要素「解析の速さ」「解析の正確さ」（D-238・prd/17 §5.5）を月の報告の札と「改善できる項目について」の ⓘ に出す。
// 棋譜解析のシナリオはまだ遊べない（SCENARIOS に無い。PR-10 で登録）ので、月の報告のカードだけを描いて確かめる。
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  STACKS,
  type Scenario,
} from 'game';
import { describe, expect, it } from 'vitest';
import { MonthCard } from './game-screen/month-card.tsx';
import { useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

const PRO = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
// 30 万 PV（解析する worker の VPS が滞る規模。シナリオの仮の規模は 3 万 PV。D-241）
const kifu = {
  ...SCENARIOS['kifu-analysis']!,
  startCash: 1e7,
  scale: { startPV: 300_000 },
};

const draw = (scenario: Scenario, analysis?: string) => {
  const state = playMonth(
    newGame(
      PRO,
      1,
      scenario,
      DEFAULT_START_DATE,
      'nextjs',
      analysis ? { analysis } : undefined,
    ),
  );
  render(<MonthCard report={state.history[0]!} />);
};
const elements = () =>
  [
    ...document.querySelectorAll<HTMLElement>('[data-satisfaction-element]'),
  ].map((e) => e.dataset.satisfactionElement);

describe('解析の要素の札', () => {
  it('棋譜解析では解析の速さ・正確さの札を出す', () => {
    draw(kifu);
    expect(elements()).toEqual(
      expect.arrayContaining(['analysisSpeed', 'analysisAccuracy']),
    );
    const badge = document.querySelector<HTMLElement>(
      '[data-satisfaction-element="analysisSpeed"] .badge',
    )!;
    expect(badge.textContent).toBe('解析の速さ良い');
  });

  it('記事・受託では解析の札を出さない（今までの 5 つのまま）', () => {
    for (const sc of [
      SCENARIOS['article-community']!,
      SCENARIOS['contract-operations']!,
    ]) {
      draw(sc);
      expect(elements()).toEqual([
        'availability',
        'speed',
        'feature',
        'freshness',
        'quality',
      ]);
      document.body.innerHTML = '';
    }
  });

  it('worker の VPS が滞ると解析の速さが下がり、理由を ⓘ に出す', () => {
    draw(kifu, 'worker-vps-2gb');
    const badge = document.querySelector<HTMLElement>(
      '[data-satisfaction-element="analysisSpeed"] .badge',
    )!;
    expect(badge.textContent).toBe('解析の速さ悪い');
    const line = document.querySelector<HTMLElement>('[data-improve-info]')!;
    fireEvent.click(
      within(line).getByRole('button', { name: '改善できる項目について' }),
    );
    expect(
      screen.getByText(/1 日を通しても追いつかず、たまり続けます/),
    ).toBeTruthy();
  });
});
