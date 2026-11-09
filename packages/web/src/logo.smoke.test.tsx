// @vitest-environment jsdom
// ヘッダーのロゴ（D-184）の描画テスト。見た目（CSS の動き）は確かめず、入れ替えの状態（data-swapped）が付く・付かないを見る。
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGO_HOLD_MS, LOGO_INTRO_DELAY_MS, Logo } from './logo.tsx';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

function stubReducedMotion(reduced: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

const logo = () => screen.getByRole('img', { name: 'infra-supra' });
const swapped = () => logo().hasAttribute('data-swapped');

describe('ヘッダーのロゴ（D-184）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('W-184a 分子に Supra・分母に Infra を並べ、読み上げの名前は infra-supra', () => {
    stubReducedMotion(false);
    render(<Logo />);
    // 普段の形（分子 Supra・分母 Infra）と、入れ替えた形を重ねて持つ（不透明度で切り替える）
    const normal = logo().querySelector('.logo-layer-normal')!;
    const swappedLayer = logo().querySelector('.logo-layer-swapped')!;
    expect(normal.querySelector('.logo-numerator')?.textContent).toBe('Supra');
    expect(normal.querySelector('.logo-denominator')?.textContent).toBe(
      'Infra',
    );
    expect(swappedLayer.querySelector('.logo-numerator')?.textContent).toBe(
      'Infra',
    );
    expect(swappedLayer.querySelector('.logo-denominator')?.textContent).toBe(
      'Supra',
    );
    expect(swapped()).toBe(false);
  });

  it('W-184b 開いて数秒後に 1 回だけ入れ替わり、少しして戻る', () => {
    stubReducedMotion(false);
    render(<Logo />);
    act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS - 1));
    expect(swapped()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(swapped()).toBe(true);
    act(() => vi.advanceTimersByTime(LOGO_HOLD_MS));
    expect(swapped()).toBe(false);
    act(() => vi.advanceTimersByTime(60_000));
    expect(swapped()).toBe(false);
  });

  it('W-184c マウスを乗せている間だけ入れ替わり、タッチは押すと入れ替わって少しして戻る', () => {
    stubReducedMotion(false);
    render(<Logo />);
    // 開いたときの 1 回の入れ替えが済んでから確かめる
    act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS + LOGO_HOLD_MS));
    expect(swapped()).toBe(false);
    fireEvent.pointerEnter(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(true);
    fireEvent.pointerLeave(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(false);
    fireEvent.pointerDown(logo(), { pointerType: 'touch' });
    expect(swapped()).toBe(true);
    act(() => vi.advanceTimersByTime(LOGO_HOLD_MS));
    expect(swapped()).toBe(false);
  });

  it('W-184d 動きを減らす設定では、時間がたっても・乗せても・押しても入れ替えない', () => {
    stubReducedMotion(true);
    render(<Logo />);
    act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS));
    expect(swapped()).toBe(false);
    fireEvent.pointerEnter(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(false);
    fireEvent.pointerDown(logo(), { pointerType: 'touch' });
    expect(swapped()).toBe(false);
  });
});

describe('ヘッダーのロゴ（画面全体）', () => {
  useSmokeEnv();
  // 上の describe が差し替えた matchMedia を、描画テストの共通の準備と同じ「動きを減らす」に戻す
  beforeEach(() => stubReducedMotion(true));

  it('W-184e ヘッダーに infra-supra のロゴが出て、「（仮称）」と副題は出ない', async () => {
    await renderApp();
    expect(screen.getByRole('img', { name: 'infra-supra' })).toBeTruthy();
    expect(screen.queryByText('（仮称）')).toBeNull();
    expect(screen.queryByText(/インフラ運営シミュレーション/)).toBeNull();
  });
});
