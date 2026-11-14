// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 始める画面の「前回の構成を選ぶ」（D-127）（App.smoke.test.tsx から分けた）。
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { LAST_SETUP_KEY } from './last-setup.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  useSmokeEnv,
  closeHowtoIfOpen,
  waitLoaded,
  renderApp,
  getRadio,
  pickRadio,
  pickPart,
  startGame,
  slotGroup,
  restartFromHeader,
  expectGameScreen,
  ARTICLE,
  CONTRACT,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

/** 「前回の構成を選ぶ」（D-127）。出ていなければ null。 */
const lastButton = () =>
  document.querySelector<HTMLButtonElement>('[data-last-setup] button');

describe('ゲームモードの画面', () => {
  it('W-64 始める画面: 始めたあと最初からに戻ると「前回の構成を選ぶ」に構成とフレームワークが出て、押すと構成・部品が戻る（D-127）', async () => {
    await renderApp();
    // 前回が無ければ出ない
    expect(lastButton()).toBeNull();
    await startGame({
      scenario: ARTICLE,
      stack: 'Vercel Pro + Supabase Pro',
      framework: 'Vite（SPA）+ API',
      parts: { 'CDN の料金のプラン': 'On-demand CDN（従量）' },
    });
    restartFromHeader();
    const b = lastButton()!;
    expect(b.textContent).toBe(
      '前回の構成を選ぶ（Vercel Pro + Supabase Pro・Vite（SPA）+ API）',
    );
    expect(b.disabled).toBe(false);
    // 既定（一覧の 1 番目）から、前回の構成・フレームワーク・部品に戻る
    expect(
      (getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    fireEvent.click(b);
    expect(
      (getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (getRadio({ name: /^Vite（SPA）\+ API/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      slotGroup('CDN の料金のプラン').querySelector('[data-selected="true"]')!
        .textContent,
    ).toMatch(/On-demand CDN（従量）/);
    expect(document.querySelector('[data-missing-parts]')).toBeNull();
    // 戻せないものは無いので知らせは出ない。今は前回と同じなので押せない
    expect(
      document.querySelector('[data-last-setup] [role="status"]'),
    ).toBeNull();
    expect(lastButton()!.disabled).toBe(true);
    expect(document.querySelector('[data-last-setup]')!.textContent).toContain(
      '前回と同じ',
    );
    // 1 つ替えるとまた押せる
    pickPart('Flat Rate CDN', slotGroup('CDN の料金のプラン'));
    expect(lastButton()!.disabled).toBe(false);
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' }),
    );
    await waitLoaded();
    expectGameScreen(1);
  });

  it('W-65 始める画面: 前回はシナリオごとに持ち、そのシナリオの前回が無ければボタンを出さない（D-127）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      stack: 'Cloudflare Paid + vinext',
      framework: 'Next.js（App Router）',
    });
    restartFromHeader();
    pickRadio(CONTRACT);
    expect(lastButton()).toBeNull();
    pickRadio(ARTICLE);
    expect(lastButton()!.textContent).toBe(
      '前回の構成を選ぶ（Cloudflare Paid + vinext・Next.js（App Router））',
    );
  });

  it('W-66 始める画面: 前回の中身が壊れている・版が違う・localStorage が使えないときはボタンを出さず、画面は落ちない（D-127）', async () => {
    for (const raw of [
      '{壊れた',
      JSON.stringify({ version: 999, scenarios: { 'article-community': {} } }),
      JSON.stringify({
        version: 1,
        scenarios: { 'article-community': { stackId: 3 } },
      }),
    ]) {
      localStorage.setItem(LAST_SETUP_KEY, raw);
      await renderApp();
      pickRadio(ARTICLE);
      expect(lastButton()).toBeNull();
      cleanup();
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    await renderApp();
    // 見た記録を読めないので遊び方が自動で開く（D-146）。閉じてから続ける
    closeHowtoIfOpen();
    pickRadio(ARTICLE);
    expect(lastButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '残りを既定にする' }));
    fireEvent.click(screen.getByRole('button', { name: '運営を始める' }));
    await waitLoaded();
    expectGameScreen(1);
  });

  it('W-68 始める画面: 「残りを既定にする」で始めた前回（部品の値が default）も、押すと構成・部品が選んだ状態で戻る（D-127）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    pickRadio('Vercel Pro + Supabase Pro');
    pickRadio('Next.js（App Router）');
    fireEvent.click(screen.getByRole('button', { name: '残りを既定にする' }));
    fireEvent.click(screen.getByRole('button', { name: '運営を始める' }));
    await waitLoaded();
    const saved = JSON.parse(localStorage.getItem(LAST_SETUP_KEY)!);
    expect(saved.scenarios['article-community'].components.isrCache).toBe(
      'default',
    );
    restartFromHeader();
    const tab = () =>
      document.querySelector('[data-setup-tab-button="stack"]')!.textContent;
    expect(tab()).toMatch(/Cloudflare Free \+ vinext/);
    fireEvent.click(lastButton()!);
    expect(tab()).toBe('① インフラの構成：Vercel Pro + Supabase Pro');
    expect(document.querySelector('[data-missing-parts]')).toBeNull();
    expect(
      document.querySelector('[data-last-setup] [role="status"]'),
    ).toBeNull();
    expect(lastButton()!.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' })
        .disabled,
    ).toBe(false);
  });

  it('W-67 始める画面: 前回の部品が今は選べなければ、その部品だけ未選択にして知らせる（D-127）', async () => {
    localStorage.setItem(
      LAST_SETUP_KEY,
      JSON.stringify({
        version: 1,
        scenarios: {
          'article-community': {
            stackId: 'cloudflare-vinext-paid',
            framework: 'nextjs',
            components: {
              isrCache: 'kv',
              images: 'images',
              db: 'no-such-db',
              email: 'default',
            },
          },
        },
      }),
    );
    await renderApp();
    pickRadio(ARTICLE);
    fireEvent.click(lastButton()!);
    expect(
      (getRadio({ name: /^Cloudflare Paid \+ vinext/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      document.querySelector('[data-last-setup] [role="status"]')!.textContent,
    ).toBe('前回の DB（no-such-db）は今は選べないので選び直してください。');
    expect(slotGroup('DB').getAttribute('data-unselected')).toBe('true');
    expect(
      slotGroup('ISR のキャッシュ').querySelector('[data-selected="true"]')!
        .textContent,
    ).toMatch(/:KV/);
    expect(
      document.querySelector('[data-missing-parts]')!.textContent,
    ).toContain('部品をまだ選んでいません: DB');
    // 今の選択は前回を戻した結果と同じなので押せない（押しても同じ）
    expect(lastButton()!.disabled).toBe(true);
  });
});
