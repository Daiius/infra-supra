// @vitest-environment jsdom
// 棋譜解析のシナリオ（prd/17 PR-10・D-241）を ?preview=1 で始めて数か月進める描画テスト。開発中の印が無ければ選べず、
// 始める画面に説明・図柄・見取り図が出て、出来事のダイアログ（予告・提案）を含めて 6 か月を描ける。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  advance,
  pickRadio,
  renderApp,
  restartFromHeader,
  showOwnSlotTab,
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

describe('始める画面の解析の設定（D-249）', () => {
  it('W-KF8 ③ 解析の置き場のタブで区切り方を選んで始めると、保存に入り、前回の構成で戻る', async () => {
    window.history.replaceState(null, '', '/?preview=1');
    await renderApp();
    await startGame({
      scenario: NAME,
      framework: 'Next.js（App Router）',
      stack: 'さくらの VPS 2GB',
      beforeStart: () => {
        const sec = showOwnSlotTab('analysis');
        const g = within(sec).getByRole('group', { name: '解析の区切り方' });
        fireEvent.click(
          within(g.querySelector<HTMLElement>('[data-option="1"]')!).getByRole(
            'button',
          ),
        );
      },
    });
    const save = JSON.parse(localStorage.getItem('infra-supra:game-save')!);
    expect(save.analysisSettings).toMatchObject({ analysisUnit: 1 });
    // 最初からに戻ると、前回の構成のボタンで区切り方も戻る
    restartFromHeader();
    pickRadio(NAME);
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-last-setup] button')!,
    );
    const g = within(showOwnSlotTab('analysis')).getByRole('group', {
      name: '解析の区切り方',
    });
    expect(
      g.querySelector('[data-option="1"] button')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
