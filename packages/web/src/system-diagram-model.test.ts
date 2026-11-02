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
  activeLane,
  diagramArchitecture,
  diagramComponents,
  diagramModel,
  LANES,
  LAYOUT,
  VIEWER,
} from './system-diagram-model.ts';

type Combo = {
  name: string;
  arch: ReturnType<typeof diagramArchitecture>;
  pages: ReturnType<typeof pageWireframes>;
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
        for (const [v, choices] of variants)
          out.push({
            name: `${sc.id} ${s.id} ${fw} ${v}`,
            arch: diagramArchitecture(sc, s.index, fw, choices),
            pages,
          });
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

  it('どの経路も閲覧者から辿れ、経路の隣り合う組が線になり、課金されるノードはすべて図に出る', () => {
    for (const { name, arch, pages } of all) {
      const m = diagramModel(arch, pages);
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
        for (let i = 1; i < path.length; i++)
          expect(
            edge(path[i - 1]!, path[i]!)?.classes,
            `${name} ${cls} ${path[i - 1]}>${path[i]}`,
          ).toContain(cls);
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

  it('箱どうし・事業者の枠どうしが重ならず、図の中に収まる', () => {
    for (const { name, arch } of all) {
      const m = diagramModel(arch);
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

  it('強調していた流れが図から消えたら、強調をやめる（OCL-FD14A04C）', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const next = diagramModel(diagramArchitecture(sc, cf, 'nextjs'));
    const spa = diagramModel(diagramArchitecture(sc, cf, 'vite-spa'));
    expect(activeLane('isr', next)).toBe('isr');
    expect(spa.lanes.some((l) => l.id === 'isr')).toBe(false);
    expect(activeLane('isr', spa)).toBeNull();
    expect(activeLane(null, next)).toBeNull();
  });
});
