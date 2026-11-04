// 画像の置き場の他の事業者の部品（D-114 段 2c・prd/14 §3.14）: 原本だけ R2 に置き変換は Vercel の画像の最適化（cf-r2-origin）、
// 画像だけ S3 + CloudFront（aws-s3-resize）。選べる組・振る舞い（画像の形式・サイズ違い）・アカウント・プレイが壊れないこと。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  ARTICLE_COMMUNITY,
  fixedImageFormat,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  STACKS,
  usesNextImage,
  type FrameworkId,
} from './index.ts';
import { astroImage } from './settings.ts';

const at = (id: string) => STACKS.findIndex((s) => s.id === id);
const VERCEL_PRO = at('vercel-supabase-pro');
const VERCEL_HOBBY = at('vercel-supabase-hobby');
const GCP = at('gcp-cloud-run');
const AWS = at('aws-amplify');
const CF_PAID = at('cloudflare-vinext-paid');

const imageOptions = (stack: number, fw: FrameworkId) =>
  setupSlots(ARTICLE_COMMUNITY, stack, fw)
    .find((x) => x.slot === 'images')
    ?.options.map((o) => o.id) ?? [];

describe('始める画面で選べる組', () => {
  it('Vercel: 原本だけ R2 は画像の最適化を使える形（Next.js・SPA・Astro）だけ、S3 + CloudFront はどのフレームワークでも', () => {
    for (const stack of [VERCEL_PRO, VERCEL_HOBBY]) {
      for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
        expect(imageOptions(stack, fw), fw).toEqual(
          expect.arrayContaining(['cf-r2-origin', 'aws-s3-resize']),
        );
      expect(imageOptions(stack, 'nextjs-export')).not.toContain(
        'cf-r2-origin',
      );
      expect(imageOptions(stack, 'nextjs-export')).toContain('aws-s3-resize');
    }
  });

  it('Google Cloud は S3 + CloudFront だけ（変換は Vercel の画像の最適化の部品なので出ない）。AWS・Cloudflare には出ない', () => {
    expect(imageOptions(GCP, 'nextjs')).toContain('aws-s3-resize');
    expect(imageOptions(GCP, 'nextjs')).not.toContain('cf-r2-origin');
    for (const stack of [AWS, CF_PAID])
      for (const id of ['cf-r2-origin', 'aws-s3-resize'])
        expect(imageOptions(stack, 'nextjs'), id).not.toContain(id);
  });

  it('受託は画像のスロットを出さない（今までどおり）', () => {
    expect(
      setupSlots(SCENARIOS['contract-operations']!, VERCEL_PRO, 'nextjs').some(
        (x) => x.slot === 'images',
      ),
    ).toBe(false);
  });
});

describe('振る舞い', () => {
  it('原本だけ R2 は Vercel の画像の最適化のまま: next/image・Astro の <Image /> と同じく閲覧のときに WebP で配る', () => {
    expect(usesNextImage('vercel', 'nextjs', 'cf-r2-origin')).toBe(true);
    expect(astroImage('vercel', 'astro', 'cf-r2-origin')).toBe(true);
    expect(fixedImageFormat('vercel', 'vite-spa', 'cf-r2-origin')).toEqual(
      fixedImageFormat('vercel', 'vite-spa', 'default'),
    );
    // S3 + CloudFront は投稿のときに一律で縮めるので、閲覧のときの形式の選択は無い
    expect(
      fixedImageFormat('vercel', 'nextjs', 'aws-s3-resize'),
    ).toBeUndefined();
  });

  it('アカウント: 原本だけ R2 は Cloudflare が増え、S3 + CloudFront は既定のメール（SES）の AWS と同じで増えない', () => {
    expect(addedAccounts(VERCEL_PRO, { images: 'cf-r2-origin' })).toEqual([
      'cloudflare',
    ]);
    expect(addedAccounts(VERCEL_PRO, { images: 'aws-s3-resize' })).toEqual([]);
    // メールを Resend にしても、S3 の AWS は既定の構成のアカウントと同じなので増えたのは Resend だけ
    expect(
      addedAccounts(VERCEL_PRO, {
        images: 'aws-s3-resize',
        email: 'resend-free',
      }),
    ).toEqual(['resend']);
  });

  it('最後まで遊べて、毎月の費用に部品の事業者の明細が出る', () => {
    for (const [stack, images, provider] of [
      [VERCEL_PRO, 'cf-r2-origin', 'cloudflare'],
      [VERCEL_PRO, 'aws-s3-resize', 'aws'],
      [GCP, 'aws-s3-resize', 'aws'],
    ] as const) {
      let s = newGame(stack, 7, ARTICLE_COMMUNITY, undefined, 'nextjs', {
        images,
      });
      expect(s.components.images).toBe(images);
      s = playMonth(s);
      expect(
        s.history[0]!.lines.some(
          (l) =>
            l.provider === provider &&
            (l.meterId === 'storage' ||
              l.meterId === 'cloudfront-transfer-out'),
        ),
        `${images}`,
      ).toBe(true);
    }
  });
});
