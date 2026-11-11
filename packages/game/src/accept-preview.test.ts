// 提案を受けたときの止まりうる上限の見込み（D-203）。
import { describe, expect, it } from 'vitest';
import {
  acceptPreview,
  applyAction,
  newGame,
  playMonth,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const VPS_4GB = 5;
const D1 = 'limit:cloudflare:workers-paid:d1-db-size:d1';
const DISK = 'host:disk:vps';

/**
 * 1 か月目の終わりに提案が届いた形の状態。出来事・料金の改定の台本は空にして、翌月に流量の出来事が起きないようにする
 * （見込みと実際に受けて進めた翌月を突き合わせるため）。
 */
function withProposal(
  stackIndex: number,
  id: string,
  stock: Partial<GameState['stock']> = {},
): GameState {
  const s = playMonth(newGame(stackIndex, 42));
  return {
    ...s,
    schedule: [],
    revisions: [],
    pendingProposals: [id],
    stock: { ...s.stock, ...stock },
  };
}
const last = (s: GameState) => s.history[s.history.length - 1]!;

describe('acceptPreview（D-203）', () => {
  it('Cloudflare D1 で記事の引き取りを受けると 10 GB を越えるなら止まる（引き上げられない）', () => {
    const s = withProposal(CF_PAID, 'p-archive', { dbGB: 1.5 });
    const [x, ...rest] = acceptPreview(s, 'p-archive');
    expect(rest).toEqual([]);
    expect(x).toMatchObject({ id: D1, unit: 'gb', limit: 10, stops: true });
    expect(x!.after - x!.before).toBeCloseTo(9);
    // D1 の 10 GB は Free・Paid のどちらでも越える（プラン変更では引き上げられない）
    expect(x!.raisable).toBe(false);
    expect(x!.monthsUntil).toBeUndefined();
  });

  it('越えなければ止まらず、ためていく量は今の規模で届く月を見込む', () => {
    const s = withProposal(CF_PAID, 'p-archive');
    const [x] = acceptPreview(s, 'p-archive');
    expect(x!.stops).toBe(false);
    expect(x!.raisable).toBeUndefined();
    expect(x!.monthsUntil).toBeGreaterThan(1);
  });

  it('今月 Cloudflare Free へのプラン変更を選んでいれば、Free の D1（0.5 GB）で止まり、Paid に戻せば止まらない（プランの替わった前提も当たる）', () => {
    const s = withProposal(CF_PAID, 'p-archive');
    const [x, ...rest] = acceptPreview(s, 'p-archive', [
      { type: 'plan', stackIndex: 0 },
    ]);
    expect(rest).toEqual([]);
    expect(x).toMatchObject({
      id: 'limit:cloudflare:workers-free:d1-db-size:d1',
      limit: 0.5,
      stops: true,
      raisable: true,
    });
  });

  it('VPS のディスクは、今月ストレージ変更オプションを選んでいれば越えない（今月の行動を当てて計算する）', () => {
    const s = withProposal(VPS, 'p-archive', { imagesGB: 85 });
    const [x] = acceptPreview(s, 'p-archive');
    expect(x).toMatchObject({ id: DISK, limit: 100, stops: true });
    // ストレージ変更オプション・4GB へのプラン変更で引き上げられる
    expect(x!.raisable).toBe(true);
    const [y] = acceptPreview(s, 'p-archive', [{ type: 'storage-option' }]);
    expect(y!.stops).toBe(false);
    expect(y!.limit).toBeGreaterThan(100);
    const [z] = acceptPreview(s, 'p-archive', [
      { type: 'plan', stackIndex: VPS_4GB },
    ]);
    expect(z!.stops).toBe(false);
  });

  it('止まりうる上限が効かない提案（保存量の効果が無い・前提が課金だけ）は空', () => {
    expect(acceptPreview(withProposal(VPS, 'p-sla'), 'p-sla')).toEqual([]);
    expect(acceptPreview(withProposal(CF_PAID, 'p-chat'), 'p-chat')).toEqual(
      [],
    );
    // Vercel Pro の Supabase のディスクは込み分の超過（課金）なので、止まる上限ではない
    expect(
      acceptPreview(withProposal(VERCEL_PRO, 'p-archive'), 'p-archive'),
    ).toEqual([]);
    // 提案でないもの
    expect(acceptPreview(withProposal(CF_PAID, 'buzz'), 'buzz')).toEqual([]);
  });

  it('入力の状態を変えず、同じ入力なら同じ結果（決定論）', () => {
    const s = withProposal(VPS, 'p-archive', { imagesGB: 85 });
    // シナリオは関数を持つので、状態は JSON で比べる
    const before = JSON.stringify(s);
    const actions = [{ type: 'storage-option' } as const];
    const a = acceptPreview(s, 'p-archive', actions);
    expect(JSON.stringify(s)).toBe(before);
    expect(acceptPreview(s, 'p-archive', actions)).toEqual(a);
  });

  it.each([
    ['越えない', CF_PAID, {}],
    ['越える', CF_PAID, { dbGB: 1.5 }],
    ['VPS', VPS, {}],
    ['VPS で越える', VPS, { imagesGB: 85 }],
  ] as const)(
    '見込みは、実際に受けて進めた翌月の使用量・当たり・止まったかと一致する（%s）',
    (_, stackIndex, stock) => {
      const s = withProposal(stackIndex, 'p-archive', stock);
      const preview = acceptPreview(s, 'p-archive');
      expect(preview.length).toBeGreaterThan(0);
      const next = playMonth(
        applyAction(s, { type: 'respond', eventId: 'p-archive', accept: true }),
      );
      const r = last(next);
      // 月の記録（snapshots）は使用率で持つ
      for (const x of preview) {
        const p = r.snapshots.find((q) => q.id === x.id)!;
        expect(p.ratio).toBeCloseTo(x.after / x.limit, 6);
        expect(p.hit).toBe(x.stops);
      }
      expect(r.status === 'down').toBe(preview.some((x) => x.stops));
      // 受けないで進めた翌月は before と一致する
      const declined = last(
        playMonth(
          applyAction(s, {
            type: 'respond',
            eventId: 'p-archive',
            accept: false,
          }),
        ),
      );
      for (const x of preview)
        expect(
          declined.snapshots.find((q) => q.id === x.id)!.ratio,
        ).toBeCloseTo(x.before / x.limit, 6);
    },
  );
});
