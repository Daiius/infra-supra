// @vitest-environment jsdom
// 棋譜解析のシナリオ（prd/17 PR-10・D-241）を ?preview=1 で始めて数か月進める描画テスト。開発中の印が無ければ選べず、
// 始める画面に説明・図柄・見取り図が出て、出来事のダイアログ（予告・提案）を含めて 6 か月を描ける。
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  advance,
  renderApp,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const NAME = '棋譜解析サービス';
const scenarioNames = () =>
  screen
    .queryAllByRole('radio')
    .filter((r) => (r as HTMLInputElement).name === 'scenario')
    .map((r) => r.closest('label')!.textContent);

describe('棋譜解析のシナリオ（D-241）', () => {
  it('W-KF1 ?preview が無ければ始める画面に出さない', async () => {
    window.history.replaceState(null, '', '/');
    await renderApp();
    expect(scenarioNames()).not.toContain(NAME);
  });

  it('W-KF2 ?preview=1 で選び、説明・図柄を出して始め、6 か月進められる', async () => {
    window.history.replaceState(null, '', '/?preview=1');
    await renderApp();
    expect(scenarioNames()).toContain(NAME);
    await startGame({
      scenario: NAME,
      framework: 'Next.js（App Router）',
      stack: 'さくらの VPS 2GB',
      beforeStart: () => {
        const art = document.querySelector(
          '[data-scenario-art="kifu-analysis"]',
        );
        expect(art).not.toBeNull();
        expect(document.body.textContent).toContain('棋譜解析の Web サービス');
      },
    });
    advance(6);
    expect(
      screen.getByRole('heading', { level: 2, name: /^7 か月目/ }),
    ).toBeTruthy();
  });
});
