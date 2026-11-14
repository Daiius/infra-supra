// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 月の進行・保存と再開・手間の欄と輪（App.smoke.test.tsx から分けた）。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { ARTICLE_COMMUNITY, rollSchedule } from 'game';
import { describe, expect, it } from 'vitest';
import {
  useSmokeEnv,
  renderApp,
  startGame,
  advance,
  monthHeading,
  expectGameScreen,
  ARTICLE,
  CONTRACT,
  type Setup,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
  it('W-01 記事コミュニティ × Next.js × CF Paid で始めて 3 か月進める', async () => {
    await renderApp();
    // 始める画面: シナリオ・フレームワーク・構成・部品の選択肢が出る
    expect(screen.getAllByRole('radio', { name: /^Cloudflare/ }).length).toBe(
      2,
    );
    await startGame({
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
  it.each(combos)('W-02 %s で始めて 1 か月進める', async (_, setup) => {
    await renderApp();
    await startGame(setup);
    expectGameScreen(1);
    advance(1);
    expectGameScreen(2);
  });

  // 前は Astro × Netlify Personal（3 か月目に尽きる）。Netlify は隠した（D-100）ので、1 か月目に尽きる組にした
  it('W-03 所持金が尽きる組（静的書き出し × Vercel Pro・画像を最適化しない）で結果の画面とヒントが出る', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（静的書き出し）',
      stack: 'Vercel Pro + Supabase Pro',
      // 画像の原本の配信（Blob Data Transfer）を従量で払う（既定の Flat Rate CDN では段に込み。D-120）
      parts: { 'CDN の料金のプラン': 'On-demand CDN（従量）' },
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

  it('W-04 保存して読み込み直すと同じ月から再開する', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(2);
    expectGameScreen(3);
    const before = historyText();
    // 画面を閉じて開き直す（保存は localStorage に残る）
    cleanup();
    await renderApp();
    expectGameScreen(3);
    expect(monthHeading(3)).toBeDefined();
    expect(historyText()).toEqual(before);
    advance(1);
    expectGameScreen(4);
  });

  it('W-54 手間の欄に機能開発の累計・期待と来月の見込みが出て、行動を選ぶと見込みが変わる。提案には受けたときの得を出す（D-122）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    // 月の報告の手間の棒の下: 今の累計と期待と段階（良いのときも出す）
    expect(screen.getByText(/^機能開発の累計 \d+ \/ 期待 8 →/)).toBeDefined();
    const outlook = () => screen.getByTestId('feature-outlook').textContent!;
    const feature = () =>
      Number(outlook().match(/来月の機能開発 ([\d.]+)/)![1]);
    expect(outlook()).toContain('来月の機能開発の累計');
    expect(outlook()).toContain('/ 期待 16');
    expect(outlook()).not.toContain('アクションで');
    const before = feature();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(feature()).toBeLessThan(before);
    expect(outlook()).toMatch(/（アクションで −\d/);
    // シード 42 は 6 か月目に個人向けのページの提案が届く
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    advance(m - 1);
    expectGameScreen(m);
    const card =
      screen.getByText('届いた開発依頼（選ばなければ断る）').parentElement!;
    expect(card.textContent).toContain(
      '受けると: 機能開発 +6（作業の手間 4 も機能開発に数える）',
    );
    expect(card.textContent).toContain(
      '伴うこと: 来月、アクションに使える手間が 4 減ります・使用量・費用: SSR の割合 60%',
    );
    expect(card.textContent).toContain('断る（何も変わりません）');
    // 7 か月目に記事のデザインの刷新の提案が届く。機能の加点が無くても、得と断ったときの損を出す
    advance(1);
    const months = ARTICLE_COMMUNITY.imageRedesign!.declineMonths;
    const proposals =
      screen.getByText('届いた開発依頼（選ばなければ断る）').parentElement!
        .textContent!;
    expect(proposals).toContain(
      `受けると: 画質の評価を保つ（断ると ${months} か月、画質が 1 段下がる）`,
    );
    expect(proposals).toContain(
      `断る（${months} か月、画質の評価が 1 段下がります）`,
    );
  });

  it('W-55 手間の輪を、月の報告の手間の棒の下と行動の欄の 2 か所に常に出し、行動を選ぶと中央の数と区分が変わる（D-122）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const rings = () =>
      document.querySelectorAll<HTMLElement>('[data-feature-ring]');
    expect(rings()).toHaveLength(2);
    // 月の報告の側は、その月の手間と累計
    expect(
      rings()[0]!.querySelector('svg[role="img"]')!.getAttribute('aria-label'),
    ).toMatch(/^1 か月目の機能開発 [\d.]+ \/ 期待 8・累計/);
    const ring = () => rings()[1]!;
    const label = () =>
      ring().querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
    expect(label()).toMatch(/^来月の機能開発 [\d.]+ \/ 期待 8・累計/);
    expect(ring().textContent).not.toContain('アクションで');
    // 値が 0 の区分は凡例に出さない（機能開発と、行動の欄の行動は常に出す）
    const legend = () =>
      [...ring().querySelectorAll('li')].map((li) => li.textContent);
    expect(legend().some((t) => t!.startsWith('機能開発'))).toBe(true);
    expect(legend().some((t) => t!.startsWith('アクション0'))).toBe(true);
    expect(legend().some((t) => t!.startsWith('イベントへの対応0'))).toBe(
      false,
    );
    const before = label();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(label()).not.toBe(before);
    expect(ring().textContent).toMatch(/アクションで −\d/);
    expect(legend().some((t) => t!.startsWith('アクション0'))).toBe(false);
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
