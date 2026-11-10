// @vitest-environment jsdom
// アクセシビリティの手直し（D-194）の描画テスト: ヘッダーのランドマークと h1・モードの切り替え・折れ線のグラフの読み上げの要約。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lineChartSummary } from './charts.tsx';
import { renderApp, useSmokeEnv, waitLoaded } from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ヘッダー（D-194）', () => {
  it('header のランドマークの中に h1（ロゴ）とモードのナビがあり、画面の見出しは h2 から', async () => {
    await renderApp();
    const banner = screen.getByRole('banner');
    const h1 = within(banner).getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('Supra');
    within(h1).getByRole('img', { name: 'infra-supra' });
    // h1 はページに 1 つだけ。ほかの見出しは h2 以下
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(
      0,
    );
  });

  it('モードの切り替えはナビの中のボタンで、今のモードに aria-current="page" が付く（タブの部品にしない）', async () => {
    await renderApp();
    const nav = within(screen.getByRole('banner')).getByRole('navigation', {
      name: 'モード',
    });
    expect(within(nav).queryAllByRole('tab')).toHaveLength(0);
    const game = within(nav).getByRole('button', { name: 'ゲーム' });
    const estimate = within(nav).getByRole('button', { name: '見積' });
    expect(game.getAttribute('aria-current')).toBe('page');
    expect(estimate.hasAttribute('aria-current')).toBe(false);
    fireEvent.click(estimate);
    await waitLoaded();
    expect(estimate.getAttribute('aria-current')).toBe('page');
    expect(game.hasAttribute('aria-current')).toBe(false);
  });
});

describe('lineChartSummary（折れ線のグラフの読み上げ。D-194）', () => {
  const fmt = (v: number) => `$${v}`;

  it('1 系列: 最初と最後の月の値・最大・最小を入れる（記録のない月は飛ばす）', () => {
    expect(
      lineChartSummary(
        '所持金',
        [{ label: '所持金', values: [100, 80, null, 300, 250] }],
        fmt,
      ),
    ).toBe(
      '所持金。1 か月目 $100 → 5 か月目 $250・最大 $300（4 か月目）・最小 $80（2 か月目）',
    );
  });

  it('2 系列以上は系列の名前を前に付け、記録が 1 つ・無い系列も短く言う', () => {
    expect(
      lineChartSummary(
        '収益と費用',
        [
          { label: '収益', values: [10] },
          { label: '費用', values: [null, null] },
        ],
        fmt,
      ),
    ).toBe('収益と費用。収益: 1 か月目 $10。費用: 記録なし');
  });
});
