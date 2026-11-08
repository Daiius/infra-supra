// @vitest-environment jsdom
// 集計への送信（D-152）とプライバシーポリシーの画面（D-153）の描画テスト（D-86）。
// 照合と保存は packages/stats のテストが持つので、ここでは送る・送らない・回数・壊れないことと、ポリシーが開くことだけを見る。
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { newSave, replaySave, withTurn, type SaveData } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOT_SENT_ITEMS, SENT_ITEMS } from './privacy-policy.tsx';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SAVE_KEY = 'infra-supra:game-save';

/** CF Paid（構成の 2 番目）・何もしないで 11 か月目まで進めた保存（次の月へで完走する）。 */
function almostDone(seed = 42): SaveData {
  let save = newSave({
    scenarioId: 'article-community',
    stackIndex: 1,
    seed,
    startDate: '2026-11-02',
  });
  while (replaySave(save).history.length < 11) save = withTurn(save, []);
  return save;
}

const victory = () => screen.getByRole('dialog', { name: /完走/ });

async function finish(save: SaveData) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  await renderApp();
  fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
}

/** 送信（POST /api/results）の呼び出しだけ（完走すると分布の GET も呼ぶ。D-161）。 */
const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
  );

const okFetch = () =>
  vi.fn(
    async (_input: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ ok: true, duplicate: false, inHistogram: true }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
  );

describe('集計への送信とプライバシーポリシー', () => {
  it('W-93 VITE_STATS_ENABLED が無ければ、完走しても送らない', async () => {
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    await finish(almostDone());
    expect(victory()).toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('W-94 フラグがあると、終わったプレイを /api/results に 1 回だけ送る（再読み込みしても送り直さない）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    const save = almostDone();
    await finish(save);
    await waitFor(() => expect(posts(fetch)).toHaveLength(1));
    const [url, init] = posts(fetch)[0]! as Parameters<typeof globalThis.fetch>;
    expect(String(url)).toBe('/api/results');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(['axes', 'end', 'save']);
    expect(body.end.reason).toBe('completed');
    expect(body.save.turns).toHaveLength(save.turns.length + 1);
    expect(body.save).not.toHaveProperty('previous');
    expect(Object.keys(body.axes)).toEqual([
      'cash',
      'satisfaction',
      'featurePoints',
      'edgeMonths',
    ]);
    // 終わった状態のまま開き直しても、手元の履歴に同じプレイがあるので送らない
    screen.getByRole('dialog', { name: /完走/ });
    cleanup();
    await renderApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(posts(fetch)).toHaveLength(1);
  });

  it('W-95 送信に失敗しても（通信の失敗・500）画面は壊れない', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', '1');
    const fail = vi.fn(async () => {
      throw new TypeError('network');
    });
    vi.stubGlobal('fetch', fail);
    await finish(almostDone());
    await waitFor(() => expect(posts(fail)).toHaveLength(1));
    expect(victory()).toBeDefined();
    cleanup();
    const err = vi.fn(async () => new Response('oops', { status: 500 }));
    vi.stubGlobal('fetch', err);
    await finish(almostDone(7));
    await waitFor(() => expect(posts(err)).toHaveLength(1));
    expect(victory()).toBeDefined();
  });

  it('W-96 プライバシーポリシーは画面の下のリンクと設定のダイアログから開き、送る情報と送らない情報を書いている', async () => {
    await renderApp();
    fireEvent.click(
      screen.getByRole('button', { name: 'プライバシーポリシー' }),
    );
    const d = screen.getByRole('dialog', { name: 'プライバシーポリシー' });
    const sent = d.querySelector('[data-privacy-sent]')!.textContent!;
    for (const x of SENT_ITEMS) expect(sent).toContain(x);
    const notSent = d.querySelector('[data-privacy-not-sent]')!.textContent!;
    for (const x of NOT_SENT_ITEMS) expect(notSent).toContain(x);
    expect(notSent).toContain('IP アドレス');
    // フラグが無い間は、まだ送っていないことを書く
    expect(d.querySelector('[data-privacy-off]')).not.toBeNull();
    fireEvent.click(
      within(d).getByRole('button', { name: 'プライバシーポリシーを閉じる' }),
    );
    fireEvent(d, new Event('close'));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'プライバシーポリシー' }),
      ).toBeNull(),
    );
    // 設定のダイアログから
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    const settings = screen.getByRole('dialog', { name: '設定' });
    fireEvent.click(
      within(settings).getByRole('button', { name: 'プライバシーポリシー' }),
    );
    expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'プライバシーポリシー' }),
    ).toBeDefined();
  });
});
