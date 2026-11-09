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
import {
  LOGO_HOLD_MS,
  LOGO_INTRO_DELAY_MS,
  LOGO_NORMAL_MS,
  Logo,
} from './logo.tsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('W-184b 開いて数秒後に入れ替わり、しばらくして戻り、それを何周も繰り返す', () => {
    stubReducedMotion(false);
    render(<Logo />);
    act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS - 1));
    expect(swapped()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(swapped()).toBe(true);
    for (let round = 0; round < 3; round++) {
      act(() => vi.advanceTimersByTime(LOGO_HOLD_MS - 1));
      expect(swapped()).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(swapped()).toBe(false);
      act(() => vi.advanceTimersByTime(LOGO_NORMAL_MS - 1));
      expect(swapped()).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(swapped()).toBe(true);
    }
  });

  it('W-184f タブが見えていない間は周期を止め、見えるようになったら続きから進める', () => {
    stubReducedMotion(false);
    let hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    try {
      render(<Logo />);
      act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS - 3000));
      hidden = true;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      // 見えていない間は、いくら時間がたっても入れ替わらない
      act(() => vi.advanceTimersByTime(10 * (LOGO_HOLD_MS + LOGO_NORMAL_MS)));
      expect(swapped()).toBe(false);
      hidden = false;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      // 残りの 3 秒から再開する
      act(() => vi.advanceTimersByTime(2999));
      expect(swapped()).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(swapped()).toBe(true);
      // 入れ替えた形のまま隠れても、その形のまま止まり、続きの時間で戻る
      act(() => vi.advanceTimersByTime(LOGO_HOLD_MS - 5000));
      hidden = true;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => vi.advanceTimersByTime(60_000));
      expect(swapped()).toBe(true);
      hidden = false;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => vi.advanceTimersByTime(4999));
      expect(swapped()).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(swapped()).toBe(false);
    } finally {
      // 足した getter を消し、Document.prototype の本来の hidden に戻す
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('W-184c マウスを乗せている間は入れ替えた形を保ち、離すと周期の形に戻る。タッチは押すと入れ替わって少しして戻る', () => {
    stubReducedMotion(false);
    render(<Logo />);
    // 開いたときの 1 回の入れ替えが済んでから確かめる（普段の形が LOGO_NORMAL_MS 続く間）
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

  it('W-184g 周期で入れ替わる間に乗せても入れ替えた形のままで、周期が戻っても乗せている間は保つ', () => {
    stubReducedMotion(false);
    render(<Logo />);
    act(() => vi.advanceTimersByTime(LOGO_INTRO_DELAY_MS));
    expect(swapped()).toBe(true);
    fireEvent.pointerEnter(logo(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LOGO_HOLD_MS));
    expect(swapped()).toBe(true);
    // 離すと周期の形（今は普段の形）に戻り、周期はそのまま続く
    fireEvent.pointerLeave(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(false);
    act(() => vi.advanceTimersByTime(LOGO_NORMAL_MS));
    expect(swapped()).toBe(true);
  });

  it('W-184d 動きを減らす設定では、時間がたっても・乗せても・押しても入れ替えない', () => {
    stubReducedMotion(true);
    render(<Logo />);
    act(() =>
      vi.advanceTimersByTime(
        5 * (LOGO_INTRO_DELAY_MS + LOGO_HOLD_MS + LOGO_NORMAL_MS),
      ),
    );
    expect(swapped()).toBe(false);
    fireEvent.pointerEnter(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(false);
    fireEvent.pointerDown(logo(), { pointerType: 'touch' });
    expect(swapped()).toBe(false);
  });

  it('W-184h still では、時間がたっても・乗せても・押しても入れ替えない（OGP の画像）', () => {
    stubReducedMotion(false);
    render(<Logo still size={150} />);
    act(() =>
      vi.advanceTimersByTime(
        5 * (LOGO_INTRO_DELAY_MS + LOGO_HOLD_MS + LOGO_NORMAL_MS),
      ),
    );
    expect(swapped()).toBe(false);
    fireEvent.pointerEnter(logo(), { pointerType: 'mouse' });
    expect(swapped()).toBe(false);
    fireEvent.pointerDown(logo(), { pointerType: 'touch' });
    expect(swapped()).toBe(false);
    expect(logo().style.getPropertyValue('--logo-size')).toBe('150px');
  });
});

describe('ロゴの寸法（styles.css）', () => {
  /** .logo-fraction〜.logo-bar の規則（動きを減らす設定の @media の手前まで）。 */
  const logoRules = () => {
    // vitest は CSS の import（?raw を含む）を空にするので、ファイルを直に読む
    const stylesCss = readFileSync(
      join(import.meta.dirname, 'styles.css'),
      'utf8',
    );
    const start = stylesCss.indexOf('.logo-fraction {');
    const end = stylesCss.indexOf('@media', start);
    return stylesCss.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('W-184i 括線の太さ・上下の空き・詰めは em で決め、px は既定の字の大きさ（18px）だけ', () => {
    const css = logoRules();
    expect(css).toContain('--logo-rule: 0.085em;');
    expect(css).toContain('--logo-gap-above: 0.12em;');
    expect(css).toContain('--logo-pull-denominator: -0.08em;');
    expect(css).toContain('font-size: var(--logo-size, 18px);');
    expect(css.match(/[\d.]+px/g)).toEqual(['18px']);
    expect(css).not.toMatch(/margin-block/);
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
