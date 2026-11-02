// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 画面を何度も描き直すので、CI の遅い実行環境では既定の 5 秒を超えることがある（D-87）。
vi.setConfig({ testTimeout: 30_000 });
import {
  advance,
  expectGameScreen,
  monthHeading,
  renderApp,
  startGame,
  useSmokeEnv,
  type Setup,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const ARTICLE = '記事コミュニティ';
const CONTRACT = '受託先の業務アプリの運用';

describe('ゲームモードの画面', () => {
  it('W-01 記事コミュニティ × Next.js × CF Paid で始めて 3 か月進める', () => {
    renderApp();
    // 始める画面: シナリオ・フレームワーク・構成・部品の選択肢が出る
    expect(screen.getAllByRole('radio', { name: /^Cloudflare/ }).length).toBe(
      2,
    );
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
      parts: {
        'ISR のキャッシュ': 'KV',
        画像: 'Images（閲覧のときに変換）',
        DB: 'D1',
      },
    });
    expectGameScreen(1);
    advance(3);
    expectGameScreen(4);
    expect(screen.getByRole('button', { name: '次の月へ' })).toBeDefined();
  });

  const combos: [string, Setup][] = [
    [
      'SPA × AWS（Amplify）',
      {
        scenario: ARTICLE,
        framework: 'Vite（SPA）+ API',
        stack: 'AWS（Amplify Hosting）',
        // 「最適化しない」（最初の選択肢）は 1 か月目に所持金が尽きる（CloudFront の転送）ので縮めて置く
        parts: { 画像: '投稿のときに一律で縮めて置く' },
      },
    ],
    [
      'Astro × Vercel Pro',
      {
        scenario: ARTICLE,
        framework: 'Astro',
        stack: 'Vercel Pro + Supabase Pro',
      },
    ],
    [
      // Netlify は隠した（D-100）ので Cloudflare Paid で回す
      '静的書き出し × Cloudflare Paid',
      {
        scenario: ARTICLE,
        framework: 'Next.js（静的書き出し）',
        stack: 'Cloudflare Paid',
      },
    ],
    [
      '受託 × さくらの VPS 2GB',
      {
        scenario: CONTRACT,
        framework: 'Next.js（App Router）',
        stack: 'さくらの VPS 2GB（東京）',
      },
    ],
  ];
  it.each(combos)('W-02 %s で始めて 1 か月進める', (_, setup) => {
    renderApp();
    startGame(setup);
    expectGameScreen(1);
    advance(1);
    expectGameScreen(2);
  });

  // 前は Astro × Netlify Personal（3 か月目に尽きる）。Netlify は隠した（D-100）ので、1 か月目に尽きる組にした
  it('W-03 所持金が尽きる組（静的書き出し × Vercel Pro・画像を最適化しない）で結果の画面とヒントが出る', () => {
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（静的書き出し）',
      stack: 'Vercel Pro + Supabase Pro',
    });
    expect(screen.getByText('所持金が尽きた')).toBeDefined();
    expect(screen.getByText(/1 か月目で終了/)).toBeDefined();
    const hints = screen
      .getByRole('heading', { name: '次のプレイへのヒント' })
      .closest('section')!;
    expect(within(hints).getAllByRole('listitem').length).toBeGreaterThan(0);
    // 終わった後は進められない
    expect(screen.queryByRole('button', { name: '次の月へ' })).toBeNull();
  });

  it('W-05 Astro × CF Free: 1 リクエストの CPU の上限に当たるルートを、始める画面と月の報告に出す（D-99）', () => {
    const detail =
      '個人向けのページ（SSR・CPU 15 ms）が Workers Free の 1 リクエスト 10 ms を超える。記事のページは静的なので Worker を起動しない';
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Astro',
      stack: 'Cloudflare Free',
      // 始める画面の 1 か月目の見込みに、当たる上限とルートが出る
      beforeStart: () => expect(document.body.textContent).toContain(detail),
    });
    advance(1);
    // 月の報告の前提（SSR の CPU は開発が進むと重くなるので、数値は見ない）
    expect(document.body.textContent).toMatch(
      /個人向けのページ（SSR・CPU [\d.]+ ms）が Workers Free の 1 リクエスト 10 ms を超える。記事のページは静的なので Worker を起動しない/,
    );
  });

  it('W-06 始める画面: 記事コミュニティの前提・ページの一覧と、フレームワークごとのページの描き方が出る（D-101）', () => {
    renderApp();
    const text = document.body.textContent ?? '';
    expect(text).toContain('別の CMS は無い');
    expect(text).toContain('一覧・トップのページは記事のページに含めて数える');
    // 選ぶ前に、どのフレームワークのページの描き方も並ぶ
    expect(text).toContain(
      '個人向けのページ: アダプターで SSR（閲覧のたびにサーバーが描く。Cloudflare では Worker が描くので、1 リクエストの CPU の上限に注意）',
    );
    expect(text).toContain('記事のページ: ISR');
    // 隠した構成（D-100）は構成の一覧に出ない
    expect(
      screen.queryByRole('radio', { name: /^Netlify|^AWS（OpenNext）/ }),
    ).toBeNull();
  });

  it('W-04 保存して読み込み直すと同じ月から再開する', () => {
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(2);
    expectGameScreen(3);
    const before = historyText();
    // 画面を閉じて開き直す（保存は localStorage に残る）
    cleanup();
    renderApp();
    expectGameScreen(3);
    expect(monthHeading(3)).toBeDefined();
    expect(historyText()).toEqual(before);
    advance(1);
    expectGameScreen(4);
  });
});

const historyText = () =>
  within(
    screen
      .getByRole('heading', { name: 'これまでの運営' })
      .closest('.card-body') as HTMLElement,
  )
    .getAllByRole('row')
    .map((r) => r.textContent);
