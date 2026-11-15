// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 月の進行・保存と再開・手間の欄と輪（行動の欄）（App.smoke.test.tsx から分けた）。
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
  infoDialog,
  closeInfo,
  ARTICLE,
  CONTRACT,
  type Setup,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
  it('W-01 記事コミュニティ × Next.js × CF Paid で始めて 3 か月進める', async () => {
    await renderApp();
    // 始める画面: シナリオ・フレームワーク・構成・部品の選択肢が出る
    // Cloudflare のプランは Free と Paid（カードの中のプランのラジオ。D-221）
    expect(
      screen
        .getAllByRole<HTMLInputElement>('radio', { name: /^Cloudflare / })
        .filter((r) => r.name === 'stack-plan').length,
    ).toBe(2);
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

  it('W-54 行動の欄に来月の機能開発の累計・期待の見込みが出て、行動を選ぶと見込みが変わる。提案には受けたときの得を出す（D-122）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    // 月の報告には手間の欄を出さない（評価は累計なので、満足度の「機能」の札と行動の欄の見込みに任せる。D-222 の補足）
    expect(screen.queryByText(/^機能開発の累計 \d+ \/ 期待 8 →/)).toBeNull();
    expect(screen.queryByText(/^開発の手間 /)).toBeNull();
    const outlook = () => screen.getByTestId('feature-outlook').textContent!;
    const feature = () =>
      Number(outlook().match(/来月の機能開発 ([\d.]+)/)![1]);
    // 累計・期待の文の行と手間の残りの札は出さず、輪のグラフ（凡例の累計と段階の文字）に任せる（D-222 の補足）
    expect(outlook()).not.toContain('来月の機能開発の累計');
    expect(outlook()).not.toContain('届きません');
    expect(screen.queryByText(/^来月の手間の残り/)).toBeNull();
    expect(screen.queryByText(/来月に効く/)).toBeNull();
    expect(
      screen.getByRole('heading', { name: /^今月のアクション/ }),
    ).toBeDefined();
    expect(outlook()).toMatch(/累計 [\d.]+ \/ 期待 16（(良い|普通|悪い)）/);
    expect(outlook()).not.toContain('アクションで');
    const before = feature();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(feature()).toBeLessThan(before);
    // アクションでの増減は輪のグラフの中央に出す（prd/16）
    expect(outlook()).toMatch(/アクションで −\d/);
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

  it('W-55 手間の輪を行動の欄にだけ常に出し、行動を選ぶと中央の数と区分が変わる（D-122・D-222）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const rings = () =>
      document.querySelectorAll<HTMLElement>('[data-feature-ring]');
    expect(rings()).toHaveLength(1);
    const ring = () => rings()[0]!;
    const label = () =>
      ring().querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
    expect(label()).toMatch(/^来月の機能開発 [\d.]+ \/ 期待 8・累計/);
    expect(ring().textContent).not.toContain('アクションで');
    // 値が 0 の区分は凡例に出さない（機能開発だけは常に出す）
    const legend = () =>
      [...ring().querySelectorAll('li')].map((li) => li.textContent);
    expect(legend().some((t) => t!.startsWith('機能開発'))).toBe(true);
    expect(legend().some((t) => t!.startsWith('アクション'))).toBe(false);
    expect(legend().some((t) => t!.startsWith('イベントへの対応0'))).toBe(
      false,
    );
    const before = label();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(label()).not.toBe(before);
    expect(ring().textContent).toMatch(/アクションで −\d/);
    expect(legend().some((t) => /^アクション[\d.]+$/.test(t!))).toBe(true);
  });

  it('W-56b 満足度の理由は「改善できる項目について」の ⓘ に畳み、一番重い段階の色で出す（D-222 の補足）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    let seen = false;
    for (let m = 1; m <= 4; m++) {
      const badges = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-satisfaction-element] .badge',
        ),
      ];
      const notGood = badges.filter((b) => !b.textContent!.endsWith('良い'));
      const line = document.querySelector<HTMLElement>('[data-improve-info]');
      if (notGood.length === 0) expect(line).toBeNull();
      else {
        seen = true;
        expect(line).not.toBeNull();
        const bad = notGood.some((b) => b.textContent!.endsWith('悪い'));
        expect(
          line!.classList.contains(bad ? 'text-error-strong' : 'text-warning'),
        ).toBe(true);
        fireEvent.click(
          within(line!).getByRole('button', { name: '改善できる項目について' }),
        );
        const d = infoDialog()!;
        // 中は札と同じ色・同じ名前の札と理由
        expect(d.querySelectorAll('.badge')).toHaveLength(notGood.length);
        closeInfo();
      }
      if (m < 4) advance(1);
    }
    expect(seen).toBe(true);
  });

  it('W-56c 上限・制限は札の種類ごとの見出しにまとめ、行は印・短い名前・使用率の棒。棒の目盛りは共通で、100% を超えたら込みの分と超えた分を塗り分け、課金なら費用を出す。全文は ⓘ の中（D-222 の補足）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(2);
    const groups = [
      ...document
        .querySelector<HTMLElement>('[data-premise-list]')!
        .querySelectorAll<HTMLElement>('[data-premise-group]'),
    ];
    expect(groups.length).toBeGreaterThan(0);
    let over = 0;
    const within: string[] = [];
    for (const g of groups) {
      // 見出しは札でなく、印と文字
      const head = g.querySelector('[data-premise-heading]')!;
      expect(head.textContent).toBe(g.dataset.premiseGroup);
      expect(head.querySelector('.badge')).toBeNull();
      for (const li of g.querySelectorAll<HTMLElement>('li')) {
        expect(li.querySelector('.badge')).toBeNull();
        expect(li.firstElementChild!.querySelector('svg')).not.toBeNull();
        const m = li.textContent!.match(/(\d+)%/);
        if (!m) continue;
        const split = li.querySelector('[data-usage-over]');
        if (Number(m[1]) > 100) {
          over++;
          const bars = split!.querySelectorAll<HTMLElement>('progress');
          expect(bars).toHaveLength(2);
          within.push(bars[0]!.style.width);
          // 超えて課金になる行は、明細と結んだ費用を棒の右に出す
          if (g.dataset.premiseGroup === '超過（課金）')
            expect(
              li.querySelector('[data-premise-cost]')!.textContent,
            ).toMatch(/^\$[\d,.]+$/);
        } else expect(split).toBeNull();
      }
    }
    expect(over).toBeGreaterThan(0);
    // 100% の位置（込みの分の長さ）は全部の行でそろう
    expect(new Set(within).size).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '上限・制限の説明' }));
    expect(infoDialog()!.textContent).toContain('100% を超えたときは');
    closeInfo();
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
