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
import { pageWireframes, SCENARIOS, setupSlots, STACKS } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemDiagram } from './system-diagram.tsx';
import {
  diagramArchitecture,
  diagramComponents,
  slotBoxes,
} from './system-diagram-model.ts';

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
    // 箱に見えるのは短い名前だけ（名前は見えている短い名前で始め、正式の名前などは読み上げだけに足す。D-196）
    expect(worker.querySelector('[data-short]')!.textContent).toBe('Worker');
    expect(worker.hasAttribute('aria-label')).toBe(false);
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

describe('構成図の矢印の先端', () => {
  it('先端は線と同じ流れの色の marker を参照する（context-stroke を使わない）', () => {
    const { container } = renderAt(900);
    const path = container.querySelector('path[data-lane][marker-end]')!;
    const lane = path.getAttribute('data-lane')!;
    const id = /url\(#(.+)\)/.exec(path.getAttribute('marker-end')!)![1]!;
    const marker = container.querySelector(`marker[id="${id}"]`)!;
    expect(id.endsWith(`-${lane}`)).toBe(true);
    const fill = marker.querySelector('path')!.getAttribute('fill');
    expect(fill).not.toBe('context-stroke');
    expect((path as SVGElement).style.stroke).toBe(fill);
  });
});

describe('幽霊の箱（D-116 の補足）', () => {
  // Cloudflare × Next.js で ISR のキャッシュを Workers Cache にすると、KV の箱は無くなり、点線・半透明の箱が残る
  const comps = diagramComponents(sc, cf, 'nextjs', {
    isrCache: 'workers-cache',
  });
  const wc = diagramArchitecture(sc, cf, 'nextjs', comps);
  const { ghosts } = slotBoxes(
    (c) => diagramArchitecture(sc, cf, 'nextjs', c),
    comps,
    setupSlots(sc, cf, 'nextjs', comps),
  );
  const renderGhost = (width: number, withParts: boolean) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
      width,
    );
    const picked = vi.fn();
    const parts = {
      slotsOf: () => [],
      render: (slot: string, close: () => void) => (
        <button
          type="button"
          onClick={() => {
            close();
            picked(slot);
          }}
        >
          KV に戻す
        </button>
      ),
    };
    return {
      picked,
      ...render(
        <SystemDiagram
          architecture={wc}
          pages={pages}
          ghosts={ghosts}
          parts={withParts ? parts : undefined}
        />,
      ),
    };
  };

  it('W-41 横の図: 点線・半透明の箱で、線は引かず、押すとそのスロットの差し替えが出る', () => {
    const { container, picked } = renderGhost(900, true);
    const g = container.querySelector('[data-ghost="true"]')!;
    expect(g.getAttribute('data-node')).toBe('ghost:isrCache');
    expect(g.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe(
      '4 3',
    );
    expect(g.textContent).toContain('ISR のキャッシュ');
    expect(g.textContent).toContain('Workers Cache');
    expect(container.querySelector('[data-edge*="ghost:"]')).toBeNull();
    const box = within(g as HTMLElement).getByRole('button', {
      name: /ISR のキャッシュ.*を替える$/,
    });
    expect(g.querySelector('[data-swap-mark]')).not.toBeNull();
    fireEvent.click(box);
    const popover = screen.getByRole('dialog');
    expect(popover.textContent).toContain('経路の線は引きません');
    fireEvent.click(within(popover).getByRole('button', { name: 'KV に戻す' }));
    expect(picked).toHaveBeenCalledWith('isrCache');
  });

  it('W-42 縦の図・部品を選べない図でも幽霊の箱は残る', () => {
    const { container } = renderGhost(320, false);
    expect(
      container
        .querySelector('[data-diagram="system"]')!
        .getAttribute('data-orientation'),
    ).toBe('vertical');
    const g = container.querySelector('[data-ghost="true"]')!;
    expect(g.getAttribute('data-node')).toBe('ghost:isrCache');
    within(g as HTMLElement).getByRole('button');
    // 点線の枠は SVG の rect（D-213）
    expect(
      g
        .querySelector('rect[stroke-dasharray]')!
        .getAttribute('stroke-dasharray'),
    ).toBe('4 3');
    expect(g.querySelector('[data-swap-mark]')).toBeNull();
    cleanup();
    vi.restoreAllMocks();
    const wide = renderGhost(900, false);
    const h = wide.container.querySelector('[data-ghost="true"]')!;
    expect(h.querySelector('button')).toBeNull();
  });
});

describe('未選択の箱（D-116 の補足）', () => {
  // 幽霊の箱（ISR のキャッシュ）と、箱を持つスロットの 1 つを未選択とみなす
  const comps = diagramComponents(sc, cf, 'nextjs', {
    isrCache: 'workers-cache',
  });
  const wc = diagramArchitecture(sc, cf, 'nextjs', comps);
  const { swap, ghosts } = slotBoxes(
    (c) => diagramArchitecture(sc, cf, 'nextjs', c),
    comps,
    setupSlots(sc, cf, 'nextjs', comps),
  );
  const [nodeId, nodeSlots] = [...swap.entries()][0]!;
  const targets = [`ghost:isrCache`, nodeId];
  const view = (unselected: boolean) => (
    <SystemDiagram
      architecture={wc}
      pages={pages}
      ghosts={ghosts}
      parts={{
        slotsOf: (id) => swap.get(id) ?? [],
        render: () => null,
        unselected: (slot) =>
          unselected && (slot === 'isrCache' || slot === nodeSlots[0]),
      }}
    />
  );

  it('W-47 未選択の箱は警告色の枠と ! の印・読み上げの「未選択」で、選ぶと ⇄ に戻る（横の図・縦の図・幽霊の箱）', () => {
    for (const w of [900, 320]) {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w);
      const { container, rerender } = render(view(true));
      const box = (id: string) =>
        container.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
      for (const id of targets) {
        expect(box(id).getAttribute('data-unselected'), id).toBe('true');
        within(box(id)).getByRole('button', { name: /未選択/ });
        // 印はボタンの外の SVG（箱の右上。D-213）
        expect(box(id).querySelector('[data-unselected-mark]')).not.toBeNull();
        expect(box(id).querySelector('[data-swap-mark]')).toBeNull();
      }
      if (w === 900) {
        // 横の図の箱の枠は警告色
        expect(
          box(nodeId).querySelector<SVGRectElement>('rect')!.style.stroke,
        ).toBe('var(--color-warning)');
      }
      // 未選択でない箱には印を付けない（同じスロットに当たる箱が複数あれば、どれにも付ける）
      const expected = [
        'ghost:isrCache',
        ...[...swap.entries()]
          .filter(([, s]) => s.includes(nodeSlots[0]!))
          .map(([id]) => id),
      ].sort();
      expect(
        [...container.querySelectorAll('[data-node][data-unselected]')]
          .map((g) => g.getAttribute('data-node'))
          .sort(),
      ).toEqual(expected);
      expect(
        container.querySelectorAll('[data-node] [data-unselected-mark]'),
      ).toHaveLength(expected.length);
      rerender(view(false));
      for (const id of targets) {
        expect(box(id).hasAttribute('data-unselected')).toBe(false);
        within(box(id)).getByRole('button');
        expect(
          within(box(id)).queryByRole('button', { name: /未選択/ }),
        ).toBeNull();
        expect(box(id).querySelector('[data-unselected-mark]')).toBeNull();
        expect(box(id).querySelector('[data-swap-mark]')).not.toBeNull();
      }
      expect(container.textContent).not.toMatch(/まだ選んでいない/);
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

describe('箱の吹き出しで選んだ後の focus（OCL-131BD89D・D-116 の補足）', () => {
  it('W-49 押した箱が残っていればその箱、消えていればそのスロットの最初の箱、それも無ければ図の頭へ移す', () => {
    // 1 つのスロットが複数の箱に当たる構成（Vercel Pro × Next.js で画像を他の事業者に出したもの）
    const v = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    const build = (c: Partial<Record<string, string>>) =>
      diagramArchitecture(sc, v, 'nextjs', c);
    const found = setupSlots(sc, v, 'nextjs')
      .find((x) => x.slot === 'images')!
      .options.map((o) => {
        const comps = diagramComponents(sc, v, 'nextjs', { images: o.id });
        return {
          comps,
          ...slotBoxes(build, comps, setupSlots(sc, v, 'nextjs', comps)),
        };
      })
      .find(
        (b) =>
          [...b.swap.values()].filter((s) => s.includes('images')).length >= 2,
      )!;
    expect(found).toBeDefined();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    const onFocused = vi.fn();
    const view = (focusTarget: { slot: string; box: string } | null) => (
      <SystemDiagram
        architecture={build(found.comps)}
        pages={pages}
        ghosts={found.ghosts}
        parts={{
          slotsOf: (id) => found.swap.get(id) ?? [],
          render: () => null,
        }}
        focusTarget={focusTarget}
        onFocused={onFocused}
      />
    );
    const { container, rerender } = render(view(null));
    const buttons = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slots~="images"] button',
      ),
    ];
    expect(buttons.length).toBeGreaterThan(1);
    const boxOf = (b: HTMLElement) =>
      b.closest('[data-box]')!.getAttribute('data-box')!;
    // DOM で最初の箱でなく、押した箱へ
    const pressed = buttons[buttons.length - 1]!;
    rerender(view({ slot: 'images', box: boxOf(pressed) }));
    expect(document.activeElement).toBe(pressed);
    // 押した箱が差し替えで消えたら、そのスロットの最初の箱へ
    rerender(view({ slot: 'images', box: 'gone' }));
    expect(document.activeElement).toBe(buttons[0]);
    // スロットの箱も無ければ（スロットが消えたなど）図の頭へ
    rerender(view({ slot: 'gone', box: 'gone' }));
    expect(document.activeElement).toBe(
      container.querySelector('[data-diagram="system"]'),
    );
    expect(onFocused).toHaveBeenCalledTimes(3);
  });
});

describe('foreignObject の中に独自のレイヤーを作らない（D-213）', () => {
  // WebKit（iPhone の Safari）は foreignObject の中で独自のレイヤーを持つ要素（位置指定・opacity・transform・filter・overflow など）を、
  // viewBox の拡大縮小と foreignObject の位置を受けずに描き、箱が枠・線とずれる。jsdom では描画を測れないので、規則を固定する
  const LAYER_CLASS =
    /^(relative|absolute|fixed|sticky|sr-only|opacity-|transform|translate-|-translate-|scale-|rotate-|skew-|filter|blur|drop-shadow|backdrop-|overflow-|line-clamp-|isolate|z-|will-change|mix-blend|clip-|contain-)/;
  const LAYER_STYLE = [
    'position',
    'opacity',
    'transform',
    'translate',
    'scale',
    'rotate',
    'filter',
    'backdrop-filter',
    'overflow',
    'overflow-x',
    'overflow-y',
    'clip-path',
    'mask',
    'will-change',
    'z-index',
    'mix-blend-mode',
    'isolation',
    'contain',
  ];
  const comps = diagramComponents(sc, cf, 'nextjs', {
    isrCache: 'workers-cache',
  });
  const wc = diagramArchitecture(sc, cf, 'nextjs', comps);
  const { swap, ghosts } = slotBoxes(
    (c) => diagramArchitecture(sc, cf, 'nextjs', c),
    comps,
    setupSlots(sc, cf, 'nextjs', comps),
  );
  const [, firstSlots] = [...swap.entries()][0]!;

  it('W-213 横の図・縦の図（部品を選べる図・選べない図・幽霊の箱・未選択の箱）', () => {
    for (const w of [900, 320])
      for (const withParts of [true, false]) {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
          w,
        );
        const { container } = render(
          <SystemDiagram
            architecture={wc}
            pages={pages}
            ghosts={ghosts}
            parts={
              withParts
                ? {
                    slotsOf: (id) => swap.get(id) ?? [],
                    render: () => null,
                    unselected: (slot) =>
                      slot === 'isrCache' || slot === firstSlots[0],
                  }
                : undefined
            }
          />,
        );
        const where = `幅 ${w}・部品を選べる ${withParts}`;
        const fos = [...container.querySelectorAll('foreignObject')];
        expect(fos.length).toBeGreaterThan(0);
        for (const el of fos.flatMap((fo) => [...fo.querySelectorAll('*')])) {
          const tokens = (el.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            // hover: などの前置きを外す
            .map((t) => t.split(':').pop()!);
          expect(
            tokens.filter((t) => LAYER_CLASS.test(t)),
            `${where} ${el.outerHTML.slice(0, 120)}`,
          ).toEqual([]);
          const style = (el as HTMLElement).style;
          for (const p of LAYER_STYLE)
            expect(
              style?.getPropertyValue(p) ?? '',
              `${where} ${p} ${el.outerHTML.slice(0, 120)}`,
            ).toBe('');
        }
        if (withParts) {
          // 箱の印（! と ⇄）は foreignObject の外の SVG の円と字
          const marks = container.querySelectorAll(
            '[data-node] [data-unselected-mark], [data-node] [data-swap-mark]',
          );
          expect(marks.length, where).toBeGreaterThan(0);
          for (const m of marks) {
            expect(m.closest('foreignObject')).toBeNull();
            expect(m.querySelector('circle')).not.toBeNull();
          }
        }
        if (w === 320 && withParts) {
          // 縦の図の未選択の幽霊の箱の枠は、foreignObject の外の rect（警告色の点線）
          const g = container.querySelector('[data-node="ghost:isrCache"]')!;
          const frame = [...g.querySelectorAll<SVGRectElement>('rect')].find(
            (r) => r.style.fill === 'none',
          )!;
          expect(frame.style.stroke).toBe('var(--color-warning)');
          expect(frame.getAttribute('stroke-dasharray')).toBe('4 3');
        }
        cleanup();
        vi.restoreAllMocks();
      }
  });
});
