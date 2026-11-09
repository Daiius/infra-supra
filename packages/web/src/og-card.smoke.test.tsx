// @vitest-environment jsdom
// OGP の画像の元の箱（D-191）の描画テスト。見た目（拡大・不透明度の効き）は確かめず、箱の大きさと中身を見る。
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGO_HOLD_MS, LOGO_INTRO_DELAY_MS, LOGO_NORMAL_MS } from './logo.tsx';
import {
  OG_ART_OPACITY,
  OG_HEIGHT,
  OG_LOGO_SIZE,
  OG_WIDTH,
  OgCard,
} from './og-card.tsx';
import { SCENARIO_ART } from './scenario-art.tsx';

describe('OGP の画像の箱（D-191）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 動きを減らす設定ではない環境で、それでもロゴが入れ替わらないことを見る
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('W-191a 1200×630 ちょうどの箱に、大きなロゴ（入れ替えなし）と記事コミュニティの図柄を薄く描く', () => {
    const { container } = render(<OgCard />);
    const card = container.querySelector<HTMLElement>('[data-og-card]')!;
    expect(OG_WIDTH).toBe(1200);
    expect(OG_HEIGHT).toBe(630);
    expect(card.style.width).toBe('1200px');
    expect(card.style.height).toBe('630px');

    // ロゴ: 大きな字・入れ替えない（時間がたっても・乗せても）
    const logo = screen.getByRole('img', { name: 'infra-supra' });
    expect(card.contains(logo)).toBe(true);
    expect(logo.style.getPropertyValue('--logo-size')).toBe(
      `${OG_LOGO_SIZE}px`,
    );
    act(() =>
      vi.advanceTimersByTime(
        3 * (LOGO_INTRO_DELAY_MS + LOGO_HOLD_MS + LOGO_NORMAL_MS),
      ),
    );
    fireEvent.pointerEnter(logo, { pointerType: 'mouse' });
    expect(logo.hasAttribute('data-swapped')).toBe(false);

    // 背景: 記事コミュニティの図柄（中心と周りの 6 つの印・破線 6 本）を薄く
    const art = card.querySelector<HTMLElement>('[data-og-art]')!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(Number(art.style.opacity)).toBe(OG_ART_OPACITY);
    expect(OG_ART_OPACITY).toBeGreaterThanOrEqual(0.3);
    expect(OG_ART_OPACITY).toBeLessThanOrEqual(0.7);
    const scenario = art.querySelector('[data-scenario-art]')!;
    expect(scenario.getAttribute('data-scenario-art')).toBe(
      'article-community',
    );
    expect(scenario.querySelectorAll('[data-art-node]')).toHaveLength(
      SCENARIO_ART['article-community']!.length,
    );
    expect(scenario.querySelectorAll(':scope > svg > line')).toHaveLength(
      SCENARIO_ART['article-community']!.length - 1,
    );

    expect(card.textContent).toContain(
      'Web アプリのインフラ運営シミュレーション',
    );
  });
});
