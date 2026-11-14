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
import {
  PLAY_NONCE_KEY,
  PLAY_TOKEN_KEY,
  STATS_PLAY_ID_PATTERN,
} from './play-nonce.ts';
import { playId } from './results-history.ts';
import {
  advance,
  closeEventsDialog,
  nextMonth,
  readEventPages,
  renderApp,
  startGame,
  useSmokeEnv,
  expectFixedChrome,
} from './smoke.test-helpers.tsx';

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

/** 送信（POST /api/results）の呼び出しだけ（完走すると分布の GET も、始めると開始のトークンの POST も呼ぶ。D-161・D-174）。 */
const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(
    (c) =>
      (c[1] as RequestInit | undefined)?.method === 'POST' &&
      String(c[0]) === '/api/results',
  );

/** 開始のトークン（POST /api/plays）の呼び出し（D-174）。 */
const tokenRequests = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter((c) => String(c[0]) === '/api/plays');

const TOKEN = 'T'.repeat(43);

/** 開始のトークンを返し（fail なら通信の失敗）、ほかは送信の成功を返す fetch。 */
const tokenFetch = (fail = false) =>
  vi.fn(async (input: unknown, _init?: RequestInit) => {
    if (String(input) === '/api/plays') {
      if (fail) throw new TypeError('network');
      return new Response(JSON.stringify({ token: TOKEN }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ ok: true, duplicate: false, inHistogram: true }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  });

const SETUP = {
  scenario: '記事コミュニティ',
  framework: 'Next.js（App Router）',
  stack: 'Cloudflare Paid + vinext',
};

/** 終わるまで進める（何もしない）。出来事のダイアログは advance と同じく読んで閉じ、ほかのダイアログ（完走）が開いたら止める。 */
function playToEnd() {
  for (let i = 0; i < 24; i++) {
    if (!screen.queryByRole('button', { name: '次の月へ' })) return;
    nextMonth();
    const dialog = screen.queryByRole('dialog');
    if (!dialog) continue;
    // 出来事のダイアログでなければ（完走のダイアログ）終わり
    if (!within(dialog).queryByRole('heading', { name: /か月目のイベント/ }))
      return;
    readEventPages(dialog);
    closeEventsDialog(dialog);
  }
}

const sentBody = (f: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((posts(f)[0]![1] as RequestInit).body)) as Record<
    string,
    unknown
  >;

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
    expect(Object.keys(body).sort()).toEqual(['axes', 'end', 'playId', 'save']);
    // プレイの id は nonce（UUID）と手元の履歴の id。nonce は保存と並べて持つ（D-169）
    expect(body.playId).toMatch(STATS_PLAY_ID_PATTERN);
    expect(body.playId.split('.')[0]).toBe(
      localStorage.getItem(PLAY_NONCE_KEY),
    );
    expect(body.save).not.toHaveProperty('nonce');
    expect(body.end.reason).toBe('completed');
    expect(body.save.turns).toHaveLength(save.turns.length + 1);
    expect(body.save).not.toHaveProperty('previous');
    expect(Object.keys(body.axes)).toEqual([
      'cash',
      'satisfaction',
      'featurePoints',
      'totalCost',
    ]);
    // 終わった状態のまま開き直しても、手元の履歴に同じプレイがあるので送らない
    screen.getByRole('dialog', { name: /完走/ });
    cleanup();
    await renderApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(posts(fetch)).toHaveLength(1);
  });

  it('W-94b プレイの id: 開き直しても nonce は同じ・別の端末（nonce も履歴も無い）の同じプレイは別の id（D-169）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    const playIdOf = (i: number) =>
      JSON.parse(String((posts(fetch)[i]![1] as RequestInit).body))
        .playId as string;
    await finish(almostDone());
    await waitFor(() => expect(posts(fetch)).toHaveLength(1));
    const first = playIdOf(0);
    const nonce = localStorage.getItem(PLAY_NONCE_KEY);
    cleanup();
    // 開き直しても nonce は替えない（送り直さない）
    await renderApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem(PLAY_NONCE_KEY)).toBe(nonce);
    expect(posts(fetch)).toHaveLength(1);
    cleanup();
    // 別の端末で同じ遊び方（同じシード・構成・何もしない）: 手元の記録が無いので新しい nonce で送る
    for (const k of [
      PLAY_NONCE_KEY,
      'infra-supra:results',
      'infra-supra:stats-membership',
    ])
      localStorage.removeItem(k);
    await finish(almostDone());
    await waitFor(() => expect(posts(fetch)).toHaveLength(2));
    const second = playIdOf(1);
    expect(second).toMatch(STATS_PLAY_ID_PATTERN);
    expect(second).not.toBe(first);
    // 後ろ（手元の履歴の id）は同じプレイなので同じ
    expect(second.split('.')[1]).toBe(first.split('.')[1]);
  });

  it('W-94c 前の版（版 1）の履歴にある終わったプレイは、開き直しても送り直さず、今の版の履歴に足し直す（OCL-46A5876A）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    // 前の版で完走して送ったプレイ: 終わった保存と、版 1 の履歴（④ がギリギリを攻めるだった形）が残っている
    let save = almostDone();
    save = withTurn(save, []);
    expect(replaySave(save).phase).toBe('completed');
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    localStorage.setItem(
      'infra-supra:results',
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: playId(save),
            scenarioId: 'article-community',
            seed: 42,
            startDate: '2026-11-02',
            finishedAt: '2026-11-08',
            setup: 'x',
            axes: { cash: 1, satisfaction: 1, featurePoints: 1, edgeMonths: 0 },
            outages: 0,
            end: { reason: 'completed', month: 12 },
          },
        ],
      }),
    );
    await renderApp();
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('infra-supra:results')!).entries,
      ).toHaveLength(1),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(posts(fetch)).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem('infra-supra:results')!);
    expect(stored.version).toBe(2);
    expect(stored.entries[0].id).toBe(playId(save));
    expect(stored.entries[0].axes).toHaveProperty('totalCost');
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

  it('W-103 フラグがあると、新しいプレイを始めたときに開始のトークンを 1 回取り、nonce と組で持って、再開しても同じトークンを送信に添える（D-174）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = tokenFetch();
    vi.stubGlobal('fetch', fetch);
    await renderApp();
    await startGame(SETUP);
    await waitFor(() =>
      expect(localStorage.getItem(PLAY_TOKEN_KEY)).not.toBeNull(),
    );
    expect(tokenRequests(fetch)).toHaveLength(1);
    expect(
      (tokenRequests(fetch)[0]![1] as RequestInit | undefined)?.method,
    ).toBe('POST');
    expect(JSON.parse(localStorage.getItem(PLAY_TOKEN_KEY)!)).toEqual({
      nonce: localStorage.getItem(PLAY_NONCE_KEY),
      token: TOKEN,
    });
    // 再開しても取り直さない
    advance(1);
    cleanup();
    await renderApp();
    playToEnd();
    await waitFor(() => expect(posts(fetch)).toHaveLength(1));
    expect(tokenRequests(fetch)).toHaveLength(1);
    expect(sentBody(fetch).token).toBe(TOKEN);
  });

  it('W-103b 開始のトークンが取れなくても（通信の失敗）遊べて、トークン無しで送る（D-174）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = tokenFetch(true);
    vi.stubGlobal('fetch', fetch);
    await renderApp();
    await startGame(SETUP);
    await waitFor(() => expect(tokenRequests(fetch)).toHaveLength(1));
    playToEnd();
    await waitFor(() => expect(posts(fetch)).toHaveLength(1));
    expect(sentBody(fetch)).not.toHaveProperty('token');
    expect(localStorage.getItem(PLAY_TOKEN_KEY)).toBeNull();
  });

  it('W-103c フラグが無い・開発用の架空の分布（VITE_STATS_MOCK）のときは、始めても開始のトークンを取りに行かない（D-174）', async () => {
    const fetch = tokenFetch();
    vi.stubGlobal('fetch', fetch);
    await renderApp();
    await startGame(SETUP);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    cleanup();
    localStorage.clear();
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubEnv('VITE_STATS_MOCK', '1');
    await renderApp();
    await startGame(SETUP);
    await new Promise((r) => setTimeout(r, 0));
    expect(tokenRequests(fetch)).toHaveLength(0);
  });

  it('W-96 プライバシーポリシーは画面の下のリンクと設定のダイアログから開き、送る情報と送らない情報を書いている', async () => {
    await renderApp();
    fireEvent.click(
      screen.getByRole('button', { name: 'プライバシーポリシー' }),
    );
    const d = screen.getByRole('dialog', { name: 'プライバシーポリシー' });
    // 見出しと × は固定し、本文だけスクロールする（D-208）
    expectFixedChrome(d);
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
