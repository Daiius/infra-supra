// 構成図のモデル（D-105）。選べる構成 × フレームワーク × 部品の選択で、費用の計算と同じ構成から図が描けることを見る。
import {
  DEFAULT_START_DATE,
  frameworksOf,
  newGame,
  pageWireframes,
  SCENARIOS,
  setupSlots,
  stackOffered,
  STACKS,
  type FrameworkId,
} from 'game';
import type { RequestClass } from 'estimator';
import { describe, expect, it } from 'vitest';
import {
  ARROW,
  COMPACT_TEXT,
  compactLineWidth,
  compactText,
  diagramArchitecture,
  diagramComponents,
  diagramModel,
  EDGE_TAIL,
  edgeGeometry,
  isCallerKind,
  isNarrow,
  lanesThrough,
  laneLabel,
  LANE_ORDER,
  LANES,
  LAYOUT,
  LAYOUT_VERTICAL,
  looseSlots,
  nodeSlots,
  shortLabel,
  slotBoxes,
  swappableSlots,
  VIEWER,
  type DiagramModel,
  type GhostSlot,
} from './system-diagram-model.ts';

type Combo = {
  name: string;
  arch: ReturnType<typeof diagramArchitecture>;
  pages: ReturnType<typeof pageWireframes>;
  /** 今の選択が箱を持たないスロットの幽霊の箱（D-116 の補足）。 */
  ghosts: GhostSlot[];
};

/** シナリオ × 選べる構成 × フレームワーク × （既定 + 部品のスロットの選択肢を 1 つずつ）。 */
function combos(): Combo[] {
  const out: Combo[] = [];
  for (const sc of Object.values(SCENARIOS))
    for (const fw of frameworksOf(sc).allowed as FrameworkId[])
      for (const s of STACKS) {
        if (!stackOffered(s.index, fw)) continue;
        const pages = pageWireframes(sc, fw);
        const variants: [string, Record<string, string>][] = [['既定', {}]];
        for (const slot of setupSlots(sc, s.index, fw))
          if (slot.slot !== 'files')
            for (const o of slot.options)
              variants.push([`${slot.slot}=${o.id}`, { [slot.slot]: o.id }]);
        for (const [v, choices] of variants) {
          const build = (c: Partial<Record<string, string>>) =>
            diagramArchitecture(sc, s.index, fw, c);
          out.push({
            name: `${sc.id} ${s.id} ${fw} ${v}`,
            arch: build(choices),
            pages,
            ghosts: slotBoxes(
              build,
              diagramComponents(sc, s.index, fw, choices),
              setupSlots(sc, s.index, fw, choices),
            ).ghosts,
          });
        }
      }
  return out;
}

const INTERNAL: RequestClass[] = ['isr-revalidate'];

describe('diagramModel', () => {
  const all = combos();

  it('組み合わせを総当たりできている', () => {
    expect(all.length).toBeGreaterThan(100);
    // 隠した構成（D-100）は出ない
    expect(all.some((c) => /netlify|opennext/.test(c.name))).toBe(false);
  });

  it('どの経路も閲覧者から辿れ、経路の各ノードへ直前の呼ぶ側から線が引かれ、課金されるノードはすべて図に出る', () => {
    for (const { name, arch, pages } of all) {
      const m = diagramModel(arch, pages);
      const kindOf = (id: string) =>
        arch.nodes.find((n) => n.id === id)?.config.kind;
      const placed = new Set(m.nodes.map((n) => n.id));
      const side = new Set(m.side.flatMap((s) => s.nodes.map((n) => n.id)));
      const edge = (a: string, b: string) =>
        m.edges.find((e) => e.from === a && e.to === b);
      // 閲覧者から届くノード
      const seen = new Set([VIEWER]);
      for (let changed = true; changed;) {
        changed = false;
        for (const e of m.edges)
          if (seen.has(e.from) && !seen.has(e.to)) {
            seen.add(e.to);
            changed = true;
          }
      }
      for (const [cls, path] of Object.entries(arch.routes) as [
        RequestClass,
        string[],
      ][]) {
        if (!INTERNAL.includes(cls))
          expect(edge(VIEWER, path[0]!)?.classes, `${name} ${cls}`).toContain(
            cls,
          );
        for (let i = 1; i < path.length; i++) {
          // 直前の呼ぶ側（処理を動かすノード・中継）。無ければ直前のノード
          let from = path[i - 1]!;
          for (let j = i - 1; j >= 0; j--)
            if (isCallerKind(kindOf(path[j]!)!)) {
              from = path[j]!;
              break;
            }
          expect(
            edge(from, path[i]!)?.classes,
            `${name} ${cls} ${from}>${path[i]}`,
          ).toContain(cls);
        }
        for (const id of path) {
          expect(placed.has(id), `${name} ${cls} ${id}`).toBe(true);
          expect(seen.has(id), `${name} ${cls} ${id} に届かない`).toBe(true);
        }
      }
      // 処理を動かすノード（関数・コンテナ・VPS）で経路に載るものは、閲覧者から届く
      for (const n of m.nodes)
        if (n.compute) expect(seen.has(n.id), `${name} ${n.id}`).toBe(true);
      for (const n of arch.nodes) {
        if (n.billing)
          expect(placed.has(n.id) || side.has(n.id), `${name} ${n.id}`).toBe(
            true,
          );
        // 1 つのノードは図と下の一覧のどちらか一方だけ
        expect(placed.has(n.id) && side.has(n.id), `${name} ${n.id}`).toBe(
          false,
        );
      }
      // 線は左から右へ（列が増える向き）。戻る線は経路の輪のときだけ（戻り先から戻り元へ右向きに辿れる）
      for (const e of m.edges) {
        if (e.back) {
          const reach = new Set([e.to]);
          for (let changed = true; changed;) {
            changed = false;
            for (const f of m.edges)
              if (!f.back && reach.has(f.from) && !reach.has(f.to)) {
                reach.add(f.to);
                changed = true;
              }
          }
          expect(reach.has(e.from), `${name} ${e.from}>${e.to}`).toBe(true);
          continue;
        }
        const d = (id: string) =>
          id === VIEWER ? 0 : m.nodes.find((n) => n.id === id)!.depth!;
        expect(d(e.to), `${name} ${e.from}>${e.to}`).toBeGreaterThan(d(e.from));
      }
    }
  });

  it('箱どうし・事業者の枠どうしが重ならず、図の中に収まる（幽霊の箱も）', () => {
    for (const { name, arch, ghosts } of all) {
      const m = diagramModel(arch, [], 'horizontal', ghosts);
      for (const [i, a] of m.nodes.entries()) {
        expect(a.x + LAYOUT.nodeW, name).toBeLessThanOrEqual(m.width);
        expect(a.y + LAYOUT.nodeH, name).toBeLessThanOrEqual(m.height);
        for (const b of m.nodes.slice(i + 1))
          expect(
            a.x + LAYOUT.nodeW <= b.x ||
              b.x + LAYOUT.nodeW <= a.x ||
              a.y + LAYOUT.nodeH <= b.y ||
              b.y + LAYOUT.nodeH <= a.y,
            `${name} ${a.id} / ${b.id}`,
          ).toBe(true);
      }
      const boxes = m.groups.flatMap((g) => (g.box ? [g.box] : []));
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1))
          expect(a.y + a.h <= b.y || b.y + b.h <= a.y, name).toBe(true);
      // 箱は自分の事業者の枠の中
      for (const n of m.nodes) {
        const box = m.groups.find((g) => g.account === n.group)!.box!;
        expect(n.x >= box.x && n.x + LAYOUT.nodeW <= box.x + box.w, name).toBe(
          true,
        );
        expect(n.y >= box.y && n.y + LAYOUT.nodeH <= box.y + box.h, name).toBe(
          true,
        );
      }
    }
  });

  it('線は呼ぶ側（処理を動かすノード・中継）からだけ出る: KV・DB・ストレージ・ISR のキャッシュから別のノードへの線は無い（横・縦とも）', () => {
    for (const { name, arch, pages } of all)
      for (const o of ['horizontal', 'vertical'] as const) {
        const m = diagramModel(arch, pages, o);
        for (const e of m.edges) {
          if (e.from === VIEWER) continue;
          const kind = arch.nodes.find((n) => n.id === e.from)!.config.kind;
          expect(isCallerKind(kind), `${name} ${o} ${e.from}>${e.to}`).toBe(
            true,
          );
        }
      }
  });

  it('Cloudflare の既定（Next.js）: Worker が KV・D1 に直接つながり、KV → D1 の線は無い。流れは Worker → D1 に載る', () => {
    const sc = SCENARIOS['article-community']!;
    for (const id of ['cloudflare-vinext-paid', 'cloudflare-vinext-free']) {
      const cf = STACKS.findIndex((s) => s.id === id);
      const arch = diagramArchitecture(sc, cf, 'nextjs');
      // 費用の計算の経路はそのまま（Worker → KV → D1 の順に通る）
      expect(arch.routes['isr-revalidate'], id).toEqual(['worker', 'kv', 'd1']);
      for (const o of ['horizontal', 'vertical'] as const) {
        const m = diagramModel(arch, pageWireframes(sc, 'nextjs'), o);
        const edge = (a: string, b: string) =>
          m.edges.find((e) => e.from === a && e.to === b);
        expect(edge('kv', 'd1'), `${id} ${o}`).toBeUndefined();
        expect(edge('worker', 'kv')?.lanes, `${id} ${o}`).toEqual(
          expect.arrayContaining(['isr', 'revalidate']),
        );
        expect(edge('worker', 'd1')?.lanes, `${id} ${o}`).toEqual(
          expect.arrayContaining(['ssr', 'api', 'revalidate']),
        );
        expect(
          m.edges.filter((e) => e.from === 'kv' || e.from === 'd1'),
          `${id} ${o}`,
        ).toEqual([]);
        // KV と D1 は同じ段（どちらも Worker の次）
        const depth = (n: string) => m.nodes.find((x) => x.id === n)!.depth;
        expect(depth('kv'), `${id} ${o}`).toBe(depth('d1'));
        expect(
          m.edges.some((e) => e.back),
          `${id} ${o}`,
        ).toBe(false);
        // 流れの凡例のページの名前は今までどおり
        expect(m.lanes.find((l) => l.id === 'isr')!.pages).toContain(
          '記事のページ',
        );
      }
    }
  });

  it('中継の組は隣り合う組のまま: Hyperdrive → 外部の DB、転送 → R2、Vercel の再生成は関数が ISR のキャッシュと DB に直接つながる', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const hd = diagramArchitecture(sc, cf, 'nextjs', { db: 'hyperdrive' });
    expect(hd.routes['isr-revalidate']).toEqual([
      'worker',
      'kv',
      'hyperdrive',
      'supabase',
    ]);
    const mh = diagramModel(hd);
    const has = (m: DiagramModel, a: string, b: string) =>
      m.edges.some((e) => e.from === a && e.to === b);
    expect(has(mh, 'worker', 'hyperdrive')).toBe(true);
    expect(has(mh, 'hyperdrive', 'supabase')).toBe(true);
    expect(has(mh, 'kv', 'hyperdrive')).toBe(false);

    const spa = diagramModel(
      diagramArchitecture(sc, cf, 'vite-spa', { api: 'aws-lambda' }),
    );
    expect(has(spa, 'lambda', 'aws-out')).toBe(true);
    expect(has(spa, 'aws-out', 'r2')).toBe(true);

    const vercel = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    const va = diagramArchitecture(sc, vercel, 'nextjs');
    expect(va.routes['isr-revalidate']).toEqual(['fn', 'isr', 'db']);
    const mv = diagramModel(va);
    expect(has(mv, 'fn', 'isr')).toBe(true);
    expect(has(mv, 'fn', 'db')).toBe(true);
    expect(has(mv, 'isr', 'db')).toBe(false);
    // 閲覧者の ISR のページは CDN が ISR のキャッシュから取る（中継 → キャッシュ）
    expect(has(mv, 'cdn', 'isr')).toBe(true);
  });

  it('事業者をまたぐ部品は別の枠に入る（課金の無い中継は隣の事業者の枠）', () => {
    const sc = SCENARIOS['article-community']!;
    const vercel = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    const m = diagramModel(
      diagramArchitecture(sc, vercel, 'nextjs', { images: 'cf-images' }),
    );
    const group = (id: string) => m.nodes.find((n) => n.id === id)?.group;
    expect(group('fn')).toBe('vercel');
    expect(group('db')).toBe('supabase');
    expect(group('cf-r2')).toBe('cloudflare');
    // 課金の無い Cloudflare のキャッシュは、次の R2 と同じ枠
    expect(group('cf-cache')).toBe('cloudflare');
    expect(m.groups.find((g) => g.account === 'cloudflare')?.brand).toBe(
      'cloudflare',
    );
  });

  it('流れの凡例に、見取り図のページの名前が添う（Next.js の記事のページは ISR）', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const m = diagramModel(
      diagramArchitecture(sc, cf, 'nextjs'),
      pageWireframes(sc, 'nextjs'),
    );
    const isr = m.lanes.find((l) => l.id === 'isr')!;
    expect(isr.label).toBe(LANES.isr.label);
    expect(isr.pages).toContain('記事のページ');
    expect(m.lanes.find((l) => l.id === 'ssr')!.pages).toContain(
      '個人向けのページ',
    );
  });

  it('Astro の記事のページ（閲覧時に描いてキャッシュ。D-103）も ISR の流れに載り、Cloudflare では Worker を通る', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const arch = diagramArchitecture(sc, cf, 'astro');
    expect(arch.routes['document-isr']).toEqual(['worker']);
    const m = diagramModel(arch, pageWireframes(sc, 'astro'));
    expect(m.lanes.find((l) => l.id === 'isr')!.pages).toContain(
      '記事のページ',
    );
    expect(m.lanes.some((l) => l.id === 'revalidate')).toBe(true);
  });

  it('記事を記事ごとの枠（S5。D-109）にすると、記事のページは静的な流れ（枠）と API（中身）に載り、ビルドのノードが増える', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const routes = { article: 'shell-api' } as const;
    const arch = diagramArchitecture(sc, cf, 'astro', {}, routes);
    expect(arch.nodes.some((n) => n.config.kind === 'ci-build')).toBe(true);
    const m = diagramModel(
      arch,
      pageWireframes(sc, 'astro', undefined, routes),
    );
    expect(m.lanes.find((l) => l.id === 'static')!.pages).toContain(
      '記事のページ',
    );
    expect(m.lanes.find((l) => l.id === 'api')!.pages).toContain(
      '記事のページ',
    );
  });

  it('コメント欄を記事のページに含めると（D-109）、記事のページの見取り図のコメント欄は記事と同じ作られ方になる', () => {
    const sc = SCENARIOS['article-community']!;
    const comments = (cm?: number) =>
      pageWireframes(sc, 'nextjs', cm)
        .find((p) => p.route === 'article')!
        .regions.find((r) => r.id === 'comments')!.source;
    expect(comments()).toBe('api');
    expect(comments(1)).toBe('isr');
  });

  it('VPS の構成は 1 台に全部の経路が集まり、メールの送信・ドメインは経路の外に出る', () => {
    const sc = SCENARIOS['article-community']!;
    const vps = STACKS.findIndex((s) => s.id === 'sakura-vps-2gb');
    const m = diagramModel(diagramArchitecture(sc, vps, 'nextjs'));
    expect(m.nodes.map((n) => n.id)).toEqual(['vps']);
    expect(m.side.flatMap((s) => s.nodes.map((n) => n.kind)).sort()).toEqual(
      ['domain-registration', 'email-sender'].sort(),
    );
  });

  it('選ぶ前の部品は、ゲームを始めたときと同じ既定で描く（静的書き出し × Vercel の画像は投稿時の縮小。OCL-144712AB）', () => {
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed as FrameworkId[])
        for (const s of STACKS) {
          if (!stackOffered(s.index, fw)) continue;
          expect(
            diagramComponents(sc, s.index, fw),
            `${sc.id} ${s.id} ${fw}`,
          ).toEqual(newGame(s.index, 0, sc, DEFAULT_START_DATE, fw).components);
        }
    const sc = SCENARIOS['article-community']!;
    const vercel = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    expect(diagramComponents(sc, vercel, 'nextjs-export').images).toBe(
      'resize',
    );
    const kinds = diagramArchitecture(sc, vercel, 'nextjs-export').nodes.map(
      (n) => n.config.kind,
    );
    expect(kinds).not.toContain('image-optimizer');
    // 選んだ部品はその上に重なる
    expect(
      diagramComponents(sc, vercel, 'nextjs-export', { images: 'default' })
        .images,
    ).toBe('default');
  });

  it('縦の図（狭い幅）: 段が上→下に積まれ、箱は小さく、箱どうし・枠どうしが重ならず、図の中に収まる', () => {
    let widest = 0;
    for (const { name, arch, pages, ghosts } of all) {
      const h = diagramModel(arch, pages, 'horizontal', ghosts);
      const m = diagramModel(arch, pages, 'vertical', ghosts);
      expect(m.orientation, name).toBe('vertical');
      expect(m.node, name).toEqual({
        w: LAYOUT_VERTICAL.nodeW,
        h: LAYOUT_VERTICAL.nodeH,
      });
      // 同じ箱・線・流れで、置き方だけが違う
      expect(
        m.nodes.map((n) => [n.id, n.depth]),
        name,
      ).toEqual(h.nodes.map((n) => [n.id, n.depth]));
      expect(m.edges, name).toEqual(h.edges);
      expect(m.lanes, name).toEqual(h.lanes);
      // 深い段ほど下。閲覧者は一番上
      for (const a of m.nodes) {
        expect(a.y, name).toBeGreaterThan(m.viewer.y + m.viewer.h);
        for (const b of m.nodes)
          if (a.depth! < b.depth!)
            expect(a.y + m.node.h, `${name} ${a.id} / ${b.id}`).toBeLessThan(
              b.y,
            );
      }
      for (const [i, a] of m.nodes.entries()) {
        expect(a.x, name).toBeGreaterThanOrEqual(0);
        expect(a.x + m.node.w, name).toBeLessThanOrEqual(m.width);
        expect(a.y + m.node.h, name).toBeLessThanOrEqual(m.height);
        for (const b of m.nodes.slice(i + 1))
          expect(
            a.x + m.node.w <= b.x ||
              b.x + m.node.w <= a.x ||
              a.y + m.node.h <= b.y ||
              b.y + m.node.h <= a.y,
            `${name} ${a.id} / ${b.id}`,
          ).toBe(true);
        const box = m.groups.find((g) => g.account === a.group)!.box!;
        expect(a.x >= box.x && a.x + m.node.w <= box.x + box.w, name).toBe(
          true,
        );
        expect(a.y >= box.y && a.y + m.node.h <= box.y + box.h, name).toBe(
          true,
        );
      }
      // 事業者の枠は左→右に並ぶ（横には重ならない）
      const boxes = m.groups.flatMap((g) => (g.box ? [g.box] : []));
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1))
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x, name).toBe(true);
      expect(m.viewer.x, name).toBeGreaterThanOrEqual(0);
      expect(m.viewer.x + m.viewer.w, name).toBeLessThanOrEqual(m.width);
      widest = Math.max(widest, m.width);
    }
    // 幅 360px の画面のカードの中でも、縮めすぎずに収まる大きさ（横の図は最小 560px だった）
    expect(widest).toBeLessThanOrEqual(360);
  });

  it('横の図の置き方は向きを渡しても変わらない', () => {
    for (const { name, arch, pages } of all.slice(0, 40)) {
      const m = diagramModel(arch, pages);
      expect(diagramModel(arch, pages, 'horizontal'), name).toEqual(m);
      expect(m.orientation).toBe('horizontal');
      expect(m.node).toEqual({ w: LAYOUT.nodeW, h: LAYOUT.nodeH });
    }
  });

  it('線の終わりは矢印より長いまっすぐな線で、箱に入る向きにそろい、曲線の終わりの接線とも一致する（矢印の先端の向き）', () => {
    const dirOf = (m: DiagramModel, back: boolean | undefined) =>
      m.orientation === 'horizontal'
        ? back
          ? { x: 0, y: -1 }
          : { x: 1, y: 0 }
        : back
          ? { x: -1, y: 0 }
          : { x: 0, y: 1 };
    for (const { name, arch, pages } of all)
      for (const m of [
        diagramModel(arch, pages),
        diagramModel(arch, pages, 'vertical'),
      ])
        for (const e of m.edges)
          for (const off of [-6, 0, 6]) {
            const at = `${name} ${m.orientation} ${e.from}>${e.to} ${off}`;
            const g = edgeGeometry(m, e, off)!;
            expect(g, at).toBeDefined();
            const want = dirOf(m, e.back);
            // mid → end: 入る向きにまっすぐ、矢印の先端より長い
            const tail = { x: g.end.x - g.mid.x, y: g.end.y - g.mid.y };
            const len = Math.hypot(tail.x, tail.y);
            expect(len, at).toBeGreaterThanOrEqual(ARROW);
            expect(tail.x / len, at).toBeCloseTo(want.x);
            expect(tail.y / len, at).toBeCloseTo(want.y);
            // c2 → mid（ベジェの終わりの接線）も同じ向き（つなぎ目で折れない）
            const t = { x: g.mid.x - g.c2.x, y: g.mid.y - g.c2.y };
            const tl = Math.hypot(t.x, t.y);
            expect(tl, at).toBeGreaterThan(0);
            expect(t.x / tl, at).toBeCloseTo(want.x);
            expect(t.y / tl, at).toBeCloseTo(want.y);
            // 終わりは行き先の箱の縁（1 px 手前）
            const n =
              e.to === VIEWER
                ? { ...m.viewer }
                : {
                    ...m.nodes.find((x) => x.id === e.to)!,
                    w: m.node.w,
                    h: m.node.h,
                  };
            const edgeAt =
              m.orientation === 'horizontal'
                ? e.back
                  ? g.end.y - (n.y + n.h)
                  : n.x - g.end.x
                : e.back
                  ? g.end.x - (n.x + n.w)
                  : n.y - g.end.y;
            expect(Math.abs(edgeAt), at).toBeLessThanOrEqual(1);
            expect(g.d.startsWith('M'), at).toBe(true);
          }
    expect(EDGE_TAIL).toBeGreaterThan(ARROW);
  });

  it('入れ物が sm より狭く、横の図が収まらないときだけ縦の図にする（測れていない 0 は横）', () => {
    expect(isNarrow(0, 852)).toBe(false);
    expect(isNarrow(320, 852)).toBe(true);
    expect(isNarrow(639, 852)).toBe(true);
    expect(isNarrow(640, 852)).toBe(false);
    expect(isNarrow(900, 852)).toBe(false);
    // 小さい図（VPS 1 台）は収まるうちは横のまま
    expect(isNarrow(300, 276)).toBe(false);
    expect(isNarrow(260, 276)).toBe(true);
  });

  it('縦の図の箱に出す短い名前は括弧の補足を外す・箱を通る流れ', () => {
    expect(shortLabel('Worker（vinext）')).toBe('Worker');
    expect(shortLabel('KV（ISR のキャッシュ）')).toBe('KV');
    expect(shortLabel('Workers 静的アセット')).toBe('Workers 静的アセット');
    expect(shortLabel('（だけ）')).toBe('（だけ）');
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const m = diagramModel(
      diagramArchitecture(sc, cf, 'nextjs'),
      pageWireframes(sc, 'nextjs'),
      'vertical',
    );
    const worker = m.nodes.find((n) => n.kind === 'function')!;
    expect(worker.short).toBe(shortLabel(worker.label));
    const through = lanesThrough(m, worker.id);
    expect(through).toContain('ssr');
    expect(through).toContain('api');
  });
});

describe('縦の図の箱の短い名前の行（compactText。D-213 の補足）', () => {
  // 今ある構成 × フレームワーク × 部品（1 つずつ替える）の縦の図の箱の短い名前
  const shorts = new Set<string>();
  for (const sc of Object.values(SCENARIOS))
    for (const fw of frameworksOf(sc).allowed as FrameworkId[])
      STACKS.forEach((_, i) => {
        const slots = setupSlots(sc, i, fw);
        const variants: Record<string, string>[] = [
          {},
          ...slots.flatMap((x) => x.options.map((o) => ({ [x.slot]: o.id }))),
        ];
        for (const v of variants) {
          const comps = diagramComponents(sc, i, fw, v);
          const build = (c: Partial<Record<string, string>>) =>
            diagramArchitecture(sc, i, fw, c);
          const { ghosts } = slotBoxes(
            build,
            comps,
            setupSlots(sc, i, fw, comps),
          );
          const m = diagramModel(
            build(comps),
            pageWireframes(sc, fw),
            'vertical',
            ghosts,
            fw,
          );
          for (const n of m.nodes) shorts.add(n.short);
        }
      });
  const words = (s: string): string[] => s.match(/[A-Za-z0-9.+\-/]+/g) ?? [];

  it('どの名前も 3 行以内で、行は箱の幅に収まり（印のある箱は 3 行なら 1 行目が印を避け）、英数字の語を途中で切らない', () => {
    expect(shorts.size).toBeGreaterThan(30);
    for (const short of shorts)
      for (const mark of [false, true]) {
        const t = compactText(short, mark);
        const where = `${short}（印 ${mark}）`;
        expect(t.lines.length, where).toBeGreaterThan(0);
        expect(t.lines.length, where).toBeLessThanOrEqual(COMPACT_TEXT.lines);
        expect(COMPACT_TEXT.sizes as readonly number[]).toContain(t.size);
        t.lines.forEach((l, i) =>
          expect(
            compactLineWidth(l, t.size),
            `${where} ${l}`,
          ).toBeLessThanOrEqual(
            i === 0 && mark && t.lines.length === COMPACT_TEXT.lines
              ? COMPACT_TEXT.firstWithMark
              : COMPACT_TEXT.width,
          ),
        );
        if (!t.truncated) {
          // 省略しないときは、空白を除けば名前そのままで、英数字の語はどれも 1 つの行にある
          expect(t.lines.join('').replace(/ /g, ''), where).toBe(
            short.replace(/ /g, ''),
          );
          for (const w of words(short))
            expect(
              t.lines.some((l) => words(l).includes(w)),
              `${where} ${w}`,
            ).toBe(true);
        } else expect(t.lines.at(-1)!.endsWith('…'), where).toBe(true);
      }
  });

  it('報告のあった名前: 単語の途中で折らず、長い名前は小さい字か「…」で 3 行に収める', () => {
    expect(compactText('Firebase Hosting', true)).toEqual({
      lines: ['Firebase', 'Hosting'],
      size: 10,
      truncated: false,
    });
    expect(compactText('Firestore', true).lines).toEqual(['Firestore']);
    const r2 = compactText('R2 公開バケットのキャッシュ', true);
    expect(r2.lines.length).toBeLessThanOrEqual(3);
    expect(r2.lines[0]!.startsWith('R2 ')).toBe(true);
    // 小さい仮名・長音は行頭に置かない
    for (const l of r2.lines.slice(1)) expect(l).not.toMatch(/^[ーッュャョ]/);
  });
});

describe('swappableSlots（箱 → 差し替えられるスロット。D-116）', () => {
  it('当たるのは選べるスロットだけで、箱は今の構成の箱。差し替えると、その箱は消えるか名前が変わる', () => {
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed as FrameworkId[])
        for (const s of STACKS) {
          if (!stackOffered(s.index, fw)) continue;
          const slots = setupSlots(sc, s.index, fw);
          const build = (c: Partial<Record<string, string>>) =>
            diagramArchitecture(sc, s.index, fw, c);
          const base = build({});
          const m = swappableSlots(build, {}, slots);
          for (const [id, hit] of m) {
            const node = base.nodes.find((n) => n.id === id);
            expect(node, `${s.id} ${fw} ${id}`).toBeDefined();
            for (const slot of hit) {
              const x = slots.find((y) => y.slot === slot)!;
              expect(x.fixed, `${s.id} ${fw} ${slot}`).toBe(false);
              expect(
                x.options.some((o) => {
                  const alt = build({ [slot]: o.id }).nodes.find(
                    (n) => n.id === id,
                  );
                  return alt?.label !== node!.label;
                }),
                `${s.id} ${fw} ${id} ${slot}`,
              ).toBe(true);
            }
          }
        }
  });

  it('Vercel × Next.js: Supabase の箱は DB のスロット・CDN の箱は当たらない・並びは slots の順', () => {
    const sc = SCENARIOS['article-community']!;
    const i = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    const slots = setupSlots(sc, i, 'nextjs');
    const build = (c: Partial<Record<string, string>>) =>
      diagramArchitecture(sc, i, 'nextjs', c);
    const base = build({});
    const m = swappableSlots(build, {}, slots);
    const db = base.nodes.find((n) => n.label.startsWith('Supabase'))!;
    // Supabase の役割は DB だけなので、API の置き場（替えると消える）は出さない（D-116 の補足）
    expect(m.get(db.id)).toEqual(['db']);
    // 差し替えのきかない入口（CDN）には当たらない
    const cdn = base.nodes.find((n) => n.label === 'Vercel CDN')!;
    expect(m.get(cdn.id)).toBeUndefined();
    // 並びは slots の順
    const order = slots.map((x) => x.slot as string);
    for (const hit of m.values())
      expect(
        [...hit].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      ).toEqual(hit);
  });

  it('箱には役割に当たるスロットだけ: D1 の箱は DB だけ（「D1 に BLOB で置く」で名前が変わる画像は出さない）', () => {
    for (const fw of ['nextjs', 'vite-spa'] as const) {
      const sc = SCENARIOS['article-community']!;
      const i = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
      const slots = setupSlots(sc, i, fw);
      const build = (c: Partial<Record<string, string>>) =>
        diagramArchitecture(sc, i, fw, c);
      const d1 = build({}).nodes.find((n) => n.label === 'D1')!;
      expect(swappableSlots(build, {}, slots).get(d1.id), fw).toEqual(['db']);
    }
  });

  it('他の事業者の DB（D-114 段 2・段 2b）: 吹き出しは DB の箱だけで、自動で足す中継（Hyperdrive）・応答の転送の箱には出ない', () => {
    const sc = SCENARIOS['article-community']!;
    for (const [stack, db] of [
      ['cloudflare-vinext-paid', 'aurora'],
      ['cloudflare-vinext-paid', 'neon'],
      ['cloudflare-vinext-paid', 'dynamodb'],
      ['cloudflare-vinext-paid', 'hyperdrive'],
      ['vercel-supabase-pro', 'dynamodb'],
    ] as const)
      for (const fw of ['nextjs', 'vite-spa'] as const) {
        const i = STACKS.findIndex((s) => s.id === stack);
        const slots = setupSlots(sc, i, fw, { db });
        const build = (c: Partial<Record<string, string>>) =>
          diagramArchitecture(sc, i, fw, c);
        const c = { db };
        const nodes = build(c).nodes;
        const m = swappableSlots(build, c, slots);
        const dbNode = nodes.find(
          (n) => n.role === 'sql-db' && n.billing?.provider !== 'cloudflare',
        )!;
        expect(m.get(dbNode.id), `${stack} ${db} ${fw}`).toContain('db');
        for (const id of ['hyperdrive', 'aws-db-out'])
          expect(m.get(id), `${stack} ${db} ${fw} ${id}`).toBeUndefined();
      }
  });
});

describe('slotBoxes（どのスロットにも箱。今の選択が箱を持たなければ幽霊の箱。D-116 の補足）', () => {
  /** シナリオ × 構成 × フレームワーク × （既定 + スロットの選択肢を 1 つずつ）。 */
  function cases() {
    const out: {
      name: string;
      build: (
        c: Partial<Record<string, string>>,
      ) => ReturnType<typeof diagramArchitecture>;
      comps: Partial<Record<string, string>>;
      slots: ReturnType<typeof setupSlots>;
    }[] = [];
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed as FrameworkId[])
        for (const s of STACKS) {
          if (!stackOffered(s.index, fw)) continue;
          const build = (c: Partial<Record<string, string>>) =>
            diagramArchitecture(sc, s.index, fw, c);
          const variants: Record<string, string>[] = [{}];
          for (const x of setupSlots(sc, s.index, fw))
            if (x.slot !== 'files')
              for (const o of x.options) variants.push({ [x.slot]: o.id });
          for (const v of variants)
            out.push({
              name: `${sc.id} ${s.id} ${fw} ${JSON.stringify(v)}`,
              build,
              comps: diagramComponents(sc, s.index, fw, v),
              slots: setupSlots(sc, s.index, fw, v),
            });
        }
    return out;
  }
  const all = cases();
  const find = (stack: string, fw: FrameworkId, c: Record<string, string>) => {
    const sc = SCENARIOS['article-community']!;
    const i = STACKS.findIndex((s) => s.id === stack);
    const build = (x: Partial<Record<string, string>>) =>
      diagramArchitecture(sc, i, fw, x);
    const comps = diagramComponents(sc, i, fw, c);
    const slots = setupSlots(sc, i, fw, c);
    const { swap, ghosts } = slotBoxes(build, comps, slots);
    return {
      swap,
      ghosts,
      model: diagramModel(build(comps), [], 'horizontal', ghosts),
    };
  };

  it('差し替えられるスロット 1 つにつき箱が 1 つ以上ある（今の箱か幽霊の箱。替えても図の形が大きく跳ねない）', () => {
    expect(all.length).toBeGreaterThan(100);
    for (const { name, build, comps, slots } of all) {
      const { swap, ghosts } = slotBoxes(build, comps, slots);
      const arch = build(comps);
      const swappable = slots.filter(
        (x) => !x.fixed && x.slot !== 'files' && x.options.length >= 2,
      );
      for (const x of swappable) {
        const boxes = [...swap].filter(([, v]) => v.includes(x.slot)).length;
        const ghost = ghosts.filter((g) => g.slot === x.slot).length;
        expect(boxes + ghost, `${name} ${x.slot}`).toBeGreaterThan(0);
        // 幽霊の箱は、今の箱の無いスロットに 1 つだけ
        expect(ghost, `${name} ${x.slot}`).toBe(boxes > 0 ? 0 : 1);
      }
      // 幽霊の箱は今の選択の名前で、線は引かず、図か経路に載らない部品の並びのどちらか一方に 1 つだけ出る
      for (const o of ['horizontal', 'vertical'] as const) {
        const m = diagramModel(arch, [], o, ghosts);
        for (const g of ghosts) {
          const x = slots.find((y) => y.slot === g.slot)!;
          expect(g.label, `${name} ${g.slot}`).toBe(
            x.options.find((op) => op.id === comps[g.slot])?.label ??
              x.options[0]!.label,
          );
          const id = `ghost:${g.slot}`;
          const placed = m.nodes.filter((n) => n.id === id);
          const side = m.side
            .flatMap((s) => s.nodes)
            .filter((n) => n.id === id);
          expect(placed.length + side.length, `${name} ${o} ${id}`).toBe(1);
          expect(placed.length, `${name} ${o} ${id}`).toBe(
            g.depth === undefined ? 0 : 1,
          );
          expect(
            m.edges.some((e) => e.from === id || e.to === id),
            `${name} ${o} ${id}`,
          ).toBe(false);
        }
        // 線・流れの凡例は幽霊の箱で変わらない
        const plain = diagramModel(arch, [], o);
        expect(m.edges, name).toEqual(plain.edges);
        expect(m.lanes, name).toEqual(plain.lanes);
      }
    }
  });

  it('どのスロットも図の中で選べる・見える: 選べるスロットは経路の箱か一番下の段の部品の箱、1 択は段のスロットの箱（横の図・縦の図。D-116 の補足）', () => {
    const inBand = new Set<string>();
    for (const { name, build, comps, slots } of all) {
      const { swap, ghosts } = slotBoxes(build, comps, slots);
      const slotsOf = (id: string) => swap.get(id) ?? [];
      for (const o of ['horizontal', 'vertical'] as const) {
        const m = diagramModel(build(comps), [], o, ghosts);
        const routed = new Set(m.nodes.flatMap((n) => nodeSlots(n, slotsOf)));
        const side = new Set(
          m.side.flatMap((s) => s.nodes).flatMap((n) => nodeSlots(n, slotsOf)),
        );
        const loose = looseSlots(m, slotsOf, slots);
        for (const x of slots) {
          const swappable =
            !x.fixed && x.slot !== 'files' && x.options.length >= 2;
          const places = [
            routed.has(x.slot),
            !routed.has(x.slot) && side.has(x.slot),
            loose.includes(x.slot),
          ].filter(Boolean).length;
          // 経路の箱・段の部品の箱・段のスロットの箱のどれか 1 つの形で出る
          expect(places, `${name} ${o} ${x.slot}`).toBe(1);
          // 選べるスロットは押せる箱（経路の箱か、段の部品の箱）に当たる。段のスロットの箱は 1 択だけ
          expect(loose.includes(x.slot), `${name} ${o} ${x.slot}`).toBe(
            !swappable,
          );
          if (!routed.has(x.slot)) inBand.add(x.slot);
        }
      }
    }
    // 今の構成で段に出るもの（経路に載らないメールの送信・バックアップ、1 択のリアルタイム・ファイルの置き場）
    expect([...inBand].sort()).toEqual(
      ['dbBackup', 'email', 'files', 'realtime'].sort(),
    );
  });

  it('Cloudflare × Next.js の ISR のキャッシュ: Workers Cache・キャッシュしないは、KV の箱があった帯・段に幽霊の箱を残す', () => {
    for (const stack of ['cloudflare-vinext-free', 'cloudflare-vinext-paid']) {
      const kv = find(stack, 'nextjs', { isrCache: 'kv' });
      const kvNode = kv.model.nodes.find((n) =>
        (kv.swap.get(n.id) ?? []).includes('isrCache'),
      )!;
      expect(kvNode.ghost, stack).toBeUndefined();
      expect(
        kv.ghosts.some((g) => g.slot === 'isrCache'),
        stack,
      ).toBe(false);
      for (const choice of ['workers-cache', 'none']) {
        const { ghosts, model, swap } = find(stack, 'nextjs', {
          isrCache: choice,
        });
        expect(
          [...swap.values()].some((v) => v.includes('isrCache')),
          `${stack} ${choice}`,
        ).toBe(false);
        const g = model.nodes.find((n) => n.id === 'ghost:isrCache')!;
        expect(g.ghost?.slot, `${stack} ${choice}`).toBe('isrCache');
        expect(g.caption).toBe('ISR のキャッシュ');
        expect(g.label, `${stack} ${choice}`).toBe(
          ghosts.find((x) => x.slot === 'isrCache')!.label,
        );
        expect([g.group, g.depth], `${stack} ${choice}`).toEqual([
          kvNode.group,
          kvNode.depth,
        ]);
        expect(g.billed).toBe(false);
      }
    }
  });

  it('さくらの VPS: 前段の CDN なし・画像の変換は VPS の帯に幽霊の箱、バックアップの既定は経路に載らない部品の並び', () => {
    const { model } = find('sakura-vps-2gb', 'nextjs', {
      frontCdn: 'none',
      dbBackup: 'default',
    });
    const front = model.nodes.find((n) => n.id === 'ghost:frontCdn')!;
    expect(front.group).toBe('sakura');
    expect(front.label).toBe('なし');
    expect(model.nodes.some((n) => n.id === 'ghost:images')).toBe(true);
    // Cloudflare の帯を幽霊の箱だけのために作らない
    expect(model.groups.some((g) => g.account === 'cloudflare')).toBe(false);
    expect(
      model.side.flatMap((s) => s.nodes).some((n) => n.id === 'ghost:dbBackup'),
    ).toBe(true);
  });

  it('値だけが替わるスロットは、役割の合う今の箱に当てる（Amplify の CloudFront の料金のプラン・Cloud Run の最小のインスタンス数）', () => {
    const amplify = find('aws-amplify', 'vite-spa', {});
    expect(amplify.swap.get('cf')).toContain('cdnPlan');
    expect(amplify.ghosts.some((g) => g.slot === 'cdnPlan')).toBe(false);
    const run = find('gcp-cloud-run', 'nextjs', {});
    expect(run.swap.get('run')).toContain('minInstances');
  });

  it('ISR のキャッシュを R2 にしたとき（画像と共用の R2 の箱）は R2 の箱に当て、Workers Cache のときは当てない', () => {
    const { swap, ghosts } = find('cloudflare-vinext-paid', 'nextjs', {
      isrCache: 'r2',
    });
    expect(swap.get('r2')).toContain('isrCache');
    expect(ghosts.some((g) => g.slot === 'isrCache')).toBe(false);
    const wc = find('cloudflare-vinext-paid', 'nextjs', {
      isrCache: 'workers-cache',
    });
    expect(wc.swap.get('r2') ?? []).not.toContain('isrCache');
  });
});

describe('流れの名前（D-193）', () => {
  it('呼び名の無いフレームワークでは一般の言葉だけで、Next.js・Astro の名前を出さない', () => {
    expect(laneLabel('isr', 'nextjs')).toBe('ISR');
    expect(laneLabel('island', 'astro')).toBe('Server islands');
    expect(laneLabel('isr', 'astro')).toBe('Route caching');
    for (const fw of ['vite-spa', 'nextjs-export', undefined] as const)
      for (const l of LANE_ORDER) {
        expect(laneLabel(l, fw)).toBe(LANES[l].label);
        expect(laneLabel(l, fw)).not.toMatch(
          /ISR|PPR|Cache Components|Dynamic rendering|Server islands|Route caching/,
        );
      }
    for (const l of LANE_ORDER)
      expect(laneLabel(l, 'astro')).not.toMatch(
        /ISR|PPR|Cache Components|Dynamic rendering/,
      );
  });
});
