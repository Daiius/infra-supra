// @vitest-environment jsdom
// 構成図の描画テスト（D-105 の補足）。入れ物が狭いと縦の図になり、箱を押す（キーボードは Enter）と詳しい説明が出る。
// 広い入れ物・測れない（jsdom の既定の 0）ときは今までの横の図。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { pageWireframes, SCENARIOS, STACKS } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemDiagram } from './system-diagram.tsx';
import { diagramArchitecture } from './system-diagram-model.ts';

const sc = SCENARIOS['article-community']!;
const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
const arch = diagramArchitecture(sc, cf, 'nextjs');
const pages = pageWireframes(sc, 'nextjs');

/** 入れ物の幅（clientWidth）を決めて描く。 */
function renderAt(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  return render(<SystemDiagram architecture={arch} pages={pages} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('構成図の向き', () => {
  it('W-33 広い入れ物・測れないときは横の図（img）で、箱はボタンにしない', () => {
    for (const w of [0, 900]) {
      const { container } = renderAt(w);
      const root = container.querySelector('[data-diagram="system"]')!;
      expect(root.getAttribute('data-orientation')).toBe('horizontal');
      expect(screen.getByRole('img', { name: /^構成図: / })).toBeDefined();
      expect(root.querySelectorAll('[data-node] button')).toHaveLength(0);
      cleanup();
    }
  });

  it('W-34 狭い入れ物では縦の図になり、箱を押すと説明が出て、Esc で閉じる', () => {
    const { container } = renderAt(320);
    const root = container.querySelector('[data-diagram="system"]')!;
    expect(root.getAttribute('data-orientation')).toBe('vertical');
    const svg = screen.getByRole('group', { name: /^構成図: / });
    const svgEl = svg as unknown as SVGSVGElement;
    // 横にスクロールさせる最小の幅を持たない
    expect(svgEl.style.minWidth).toBe('');
    const buttons = within(svg).getAllByRole('button');
    expect(buttons.length).toBe(
      root.querySelectorAll('[data-node]').length - 1, // 閲覧者は押せない
    );
    const worker = within(svg).getByRole('button', {
      name: /Worker（vinext）.*の説明$/,
    });
    // 箱には短い名前だけ
    expect(worker.textContent).toBe('Worker');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(worker);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Worker（vinext）');
    expect(tip.textContent).toContain('関数');
    expect(within(tip).getByRole('list', { name: '通る流れ' })).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
