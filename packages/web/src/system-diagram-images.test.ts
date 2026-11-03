// 構成図の画像の置き場の他の事業者の部品（D-114 段 2c）: 原本だけ R2（変換は Vercel の画像の最適化）と S3 + CloudFront の箱が、
// 事業者の枠に入り、差し替えの吹き出し（画像のスロット）が新しい箱にも出ること。
import { setupSlots, SCENARIOS, STACKS, type FrameworkId } from 'game';
import { describe, expect, it } from 'vitest';
import {
  diagramArchitecture,
  diagramComponents,
  diagramModel,
  slotBoxes,
  swappableSlots,
  type DiagramModel,
} from './system-diagram-model.ts';

const sc = SCENARIOS['article-community']!;
const at = (id: string) => STACKS.findIndex((s) => s.id === id);
const has = (m: DiagramModel, a: string, b: string) =>
  m.edges.some((e) => e.from === a && e.to === b);
const groupOf = (m: DiagramModel, id: string) =>
  [...m.nodes, ...m.side.flatMap((s) => s.nodes)].find((n) => n.id === id)
    ?.group;

describe('画像の置き場の他の事業者の部品の箱（D-114 段 2c）', () => {
  it('原本だけ R2: R2 の箱は Cloudflare の枠に入り、関数から書く線がある。閲覧は Vercel の CDN → 画像の最適化のまま', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const) {
      const m = diagramModel(
        diagramArchitecture(sc, at('vercel-supabase-pro'), fw, {
          images: 'cf-r2-origin',
        }),
      );
      expect(groupOf(m, 'cf-r2'), fw).toBe('cloudflare');
      expect(groupOf(m, 'image'), fw).toBe('vercel');
      expect(groupOf(m, 'blob'), fw).toBeUndefined();
      expect(has(m, 'fn', 'cf-r2'), fw).toBe(true);
      expect(has(m, 'cdn', 'image'), fw).toBe(true);
    }
  });

  it('S3 + CloudFront: CloudFront と S3 の箱は AWS の枠に入り、CloudFront → S3 の線と関数から S3 に書く線がある', () => {
    for (const [stack, writer] of [
      ['vercel-supabase-pro', 'fn'],
      ['gcp-cloud-run', 'gcp-out'],
    ] as const) {
      const m = diagramModel(
        diagramArchitecture(sc, at(stack), 'nextjs', {
          images: 'aws-s3-resize',
        }),
      );
      expect(groupOf(m, 'aws-img-cf'), stack).toBe('aws');
      expect(groupOf(m, 'aws-s3'), stack).toBe('aws');
      expect(has(m, 'aws-img-cf', 'aws-s3'), stack).toBe(true);
      expect(has(m, writer, 'aws-s3'), stack).toBe(true);
    }
  });

  it('差し替えの吹き出し: 新しい置き場・配信の箱には画像のスロットが出る。原本だけ R2 では残る画像の最適化の箱にも出る', () => {
    for (const [stack, images, ids] of [
      ['vercel-supabase-pro', 'cf-r2-origin', ['cf-r2', 'image']],
      ['vercel-supabase-pro', 'aws-s3-resize', ['aws-img-cf', 'aws-s3']],
      ['gcp-cloud-run', 'aws-s3-resize', ['aws-img-cf', 'aws-s3']],
    ] as const)
      for (const fw of [
        'nextjs',
        'vite-spa',
      ] as const satisfies FrameworkId[]) {
        const i = at(stack);
        const c = { images };
        const slots = setupSlots(sc, i, fw, c);
        const build = (x: Partial<Record<string, string>>) =>
          diagramArchitecture(sc, i, fw, x);
        const m = swappableSlots(build, c, slots);
        for (const id of ids)
          expect(m.get(id), `${stack} ${images} ${fw} ${id}`).toContain(
            'images',
          );
        // 投稿の転送の箱（Cloud Run → S3）には出さない
        expect(m.get('gcp-out'), `${stack} ${images} ${fw}`).toBeUndefined();
      }
  });

  it('幽霊の箱（slotBoxes）: 新しい画像の部品を選んでも戻しても、画像のスロットは今の箱に当たり（幽霊の箱は出ない）、箱の数は跳ねない', () => {
    const view = (stack: string, fw: FrameworkId, images?: string) => {
      const i = at(stack);
      const c = images ? { images } : {};
      const build = (x: Partial<Record<string, string>>) =>
        diagramArchitecture(sc, i, fw, x);
      const comps = diagramComponents(sc, i, fw, c);
      const { swap, ghosts } = slotBoxes(
        build,
        comps,
        setupSlots(sc, i, fw, c),
      );
      const m = diagramModel(build(comps), [], 'horizontal', ghosts);
      return {
        swap,
        ghosts,
        boxes: m.nodes.length + m.side.reduce((a, x) => a + x.nodes.length, 0),
      };
    };
    for (const [stack, fw, images] of [
      ['vercel-supabase-pro', 'nextjs', 'cf-r2-origin'],
      ['vercel-supabase-pro', 'vite-spa', 'cf-r2-origin'],
      ['vercel-supabase-pro', 'astro', 'cf-r2-origin'],
      ['vercel-supabase-pro', 'nextjs', 'aws-s3-resize'],
      ['vercel-supabase-pro', 'nextjs-export', 'aws-s3-resize'],
      ['gcp-cloud-run', 'nextjs', 'aws-s3-resize'],
    ] as const) {
      const name = `${stack} ${fw} ${images}`;
      const before = view(stack, fw);
      const picked = view(stack, fw, images);
      // 戻す（既定の部品を選び直す）と元の図と同じ
      const back = view(
        stack,
        fw,
        diagramComponents(sc, at(stack), fw, {}).images,
      );
      for (const v of [before, picked, back]) {
        expect(
          v.ghosts.some((g) => g.slot === 'images'),
          name,
        ).toBe(false);
        expect(
          [...v.swap.values()].some((x) => x.includes('images')),
          name,
        ).toBe(true);
      }
      expect(back.boxes, name).toBe(before.boxes);
      expect(back.ghosts, name).toEqual(before.ghosts);
      // 置き場と配信を替えるだけなので、箱の数の差は 2 つまで（Google Cloud は Cloud Storage が CloudFront・S3 と投稿の転送の箱になる）
      expect(Math.abs(picked.boxes - before.boxes), name).toBeLessThanOrEqual(
        2,
      );
      // 他のスロットの幽霊の箱は画像の部品で変わらない
      expect(
        picked.ghosts.map((g) => g.slot),
        name,
      ).toEqual(before.ghosts.map((g) => g.slot));
    }
  });
});
