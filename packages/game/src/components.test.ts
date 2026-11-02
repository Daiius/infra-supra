// 部品の選択（GD-4・D-24・prd/07 §11.7）。値に依存しない性質を確かめる。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  applyAction,
  applyActions,
  checkAction,
  componentPreview,
  EFFORT,
  effortAvailable,
  isPlanChange,
  newGame,
  playMonth,
  type Action,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const VPS_4GB = 5;

/** n か月進めた状態（各月の終わりに actions(s) を選ぶ）。 */
function until(
  stackIndex: number,
  months: number,
  seed = 42,
  actions: (s: GameState) => Action[] = () => [],
): GameState {
  let s = playMonth(newGame(stackIndex, seed));
  while (s.history.length < months && s.phase === 'playing')
    s = playMonth(applyActions(s, actions(s)));
  return s;
}
const last = (s: GameState) => s.history[s.history.length - 1]!;
const comp = (
  slot: 'isrCache' | 'images' | 'db' | 'realtime',
  option: string,
) => ({ type: 'component', slot, option }) as const;

describe('部品の差し替え', () => {
  it('既定の部品で始まり、同じ部品への差し替えは選べない', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(s.components).toEqual({
      isrCache: 'kv',
      images: 'images',
      db: 'd1',
      realtime: 'none',
      dbBackup: 'default',
      api: 'same',
    });
    expect(actionEffort(s, comp('db', 'd1'))).toBeNull();
    expect(actionEffort(s, comp('isrCache', 'r2'))).toBe(
      EFFORT.component.isrCache,
    );
  });

  it('ISR のキャッシュ・画像は翌月から効き、手間を使う', () => {
    const s = playMonth(newGame(CF_PAID));
    const a = applyAction(s, comp('isrCache', 'none'));
    expect(effortAvailable(a)).toBe(
      effortAvailable(s) - EFFORT.component.isrCache,
    );
    const next = playMonth(a);
    expect(last(next).components.isrCache).toBe('none');
    // キャッシュしないと記事は常に新しい（鮮度は良い）
    expect(last(next).satisfaction.stages.freshness).toBe('good');
  });

  it('DB の差し替えは進行中の状態を持ち、期間中は新旧両方の DB の費用を払い、済んだ翌月に切り替わる', () => {
    const s = playMonth(newGame(CF_PAID));
    const a = applyAction(s, comp('db', 'hyperdrive'));
    expect(a.componentSwap?.option).toBe('hyperdrive');
    // Supabase のアカウントが増えるので、設定の一度きりの手間も今月使う（D-52・OCL-B6A107A3）
    expect(effortAvailable(a)).toBe(
      effortAvailable(s) - EFFORT.dbSwap.perMonth - EFFORT.accountSetup,
    );
    // 進行中は部品の差し替え・乗り換え・プラン変更を選べない
    expect(actionEffort(a, comp('images', 'none'))).toBeNull();
    expect(
      actionEffort(a, { type: 'migrate', stackIndex: VERCEL_PRO }),
    ).toBeNull();
    const during = playMonth(a);
    const plain = playMonth(s);
    expect(last(during).componentSwap).toBeDefined();
    expect(last(during).infraCost).toBeGreaterThan(last(plain).infraCost);
    expect(last(during).lines.some((l) => l.provider === 'supabase')).toBe(
      true,
    );
    expect(during.componentSwap).toBeNull();
    const after = playMonth(during);
    expect(last(after).components.db).toBe('hyperdrive');
  });

  it('KV を DB の代わりにすると、鮮度が 1 段下がり、同じキーの書き込みの前提が仮定の印つきで出る', () => {
    const s = until(CF_PAID, 3, 42, (x) =>
      x.history.length === 1 ? [comp('db', 'kv')] : [],
    );
    const r = last(s);
    expect(r.components.db).toBe('kv');
    expect(r.satisfaction.stages.freshness).toBe('fair');
    expect(r.satisfaction.reasons.freshness).toContain('KV を DB の代わり');
    const key = r.snapshots.find((p) => p.id.includes(':kv-same-key-writes:'));
    expect(key?.effect).toBe('throttle');
  });

  it('画像を D1 に置くと、翌月から D1 の 10 GB に当たって止まる', () => {
    const s = applyAction(playMonth(newGame(CF_PAID)), comp('images', 'd1'));
    const r = last(playMonth(s));
    expect(r.status).toBe('down');
    expect(r.satisfaction.reasons.availability).toContain('10 GB');
  });

  it('選ぶ前に、当たりうる前提が出る（状態は変えない）', () => {
    const s = playMonth(newGame(CF_PAID));
    const p = componentPreview(s, 'images', 'd1');
    expect(p.find((x) => x.id.includes(':d1-db-size:'))?.hit).toBe(true);
    expect(p.some((x) => x.id.endsWith(':d1-row-size'))).toBe(true);
    expect(s.components.images).toBe('images');
  });

  it('Cloudflare で画像を最適化しないと、費用は増えず、速さが下がり画質は良い', () => {
    const s = playMonth(newGame(CF_PAID));
    const none = last(playMonth(applyAction(s, comp('images', 'none'))));
    const base = last(playMonth(s));
    expect(none.infraCost).toBeLessThanOrEqual(base.infraCost);
    expect(none.satisfaction.stages.quality).toBe('good');
    expect(none.satisfaction.reasons.speed).toContain('最適化していない');
  });

  it('乗り換えた先は既定の部品で始まる', () => {
    const s = until(VERCEL_PRO, 1);
    const a = applyAction(s, comp('isrCache', 'none'));
    expect(last(playMonth(a)).components.isrCache).toBe('none');
    const m = until(CF_PAID, 6, 42, (x) =>
      x.history.length === 1
        ? [comp('isrCache', 'r2')]
        : x.history.length === 2
          ? [{ type: 'migrate', stackIndex: VERCEL_PRO }]
          : [],
    );
    expect(m.stackIndex).toBe(VERCEL_PRO);
    expect(m.components).toEqual({
      isrCache: 'default',
      images: 'default',
      db: 'supabase',
      dbBackup: 'default',
      api: 'same',
    });
  });
});

describe('チャットの提案（W-1）', () => {
  const chatMonth = (seed: number) =>
    newGame(CF_PAID, seed).schedule.find((x) => x.id === 'p-chat')!.month;

  it('Cloudflare の構成のときだけ出て、受けると Durable Objects が付く', () => {
    const m = chatMonth(42);
    const cf = until(CF_PAID, m);
    expect(cf.pendingProposals).toContain('p-chat');
    const vercel = until(VERCEL_PRO, m);
    expect(
      vercel.history.some((r) => r.events.some((e) => e.id === 'p-chat')),
    ).toBe(false);
    const accepted = playMonth(
      applyAction(cf, { type: 'respond', eventId: 'p-chat', accept: true }),
    );
    expect(last(accepted).components.realtime).toBe('durable-objects');
    expect(
      last(accepted).lines.some((l) => l.label.includes('durable-objects')) ||
        last(accepted).snapshots.some((p) => p.id.includes('durable-objects')),
    ).toBe(true);
    // チャットを受けたあとはリアルタイムを外せない
    expect(actionEffort(accepted, comp('realtime', 'none'))).toBeNull();
  });

  it('部品の欄で Durable Objects を選ぶのは提案を受けるのと同じ（どちらの順でも同じ状態・同じ手間）', () => {
    const cf = until(CF_PAID, chatMonth(42));
    const viaProposal = applyAction(cf, {
      type: 'respond',
      eventId: 'p-chat',
      accept: true,
    });
    const viaComponent = applyAction(cf, comp('realtime', 'durable-objects'));
    expect(viaComponent.mods).toEqual(viaProposal.mods);
    expect(viaComponent.components).toEqual(viaProposal.components);
    expect(viaComponent.responses).toEqual(viaProposal.responses);
    expect(viaComponent.featurePoints).toBe(viaProposal.featurePoints);
    expect(effortAvailable(viaComponent)).toBe(effortAvailable(viaProposal));
    expect(effortAvailable(viaComponent)).toBe(effortAvailable(cf) - 4);
    // 片方を選んだあとにもう片方を選んでも、二重には付かない（理由は「すでに」）
    expect(
      checkAction(viaComponent, {
        type: 'respond',
        eventId: 'p-chat',
        accept: true,
      }),
    ).toMatchObject({ ok: false, reason: 'same' });
    expect(
      checkAction(viaProposal, comp('realtime', 'durable-objects')),
    ).toMatchObject({ ok: false, reason: 'same' });
    expect(playMonth(viaComponent).mods).toEqual(playMonth(viaProposal).mods);
  });

  it('機能追加の提案を受けると、翌月の機能開発に作業の手間と加点が数えられる（D-29）', () => {
    const cf = until(CF_PAID, chatMonth(42));
    const accepted = applyAction(cf, {
      type: 'respond',
      eventId: 'p-chat',
      accept: true,
    });
    // 加点は受けた瞬間には足さない
    expect(accepted.featurePoints).toBe(cf.featurePoints);
    const a = last(playMonth(accepted)).effort;
    const d = last(
      playMonth(
        applyAction(cf, { type: 'respond', eventId: 'p-chat', accept: false }),
      ),
    ).effort;
    expect(a.featureWork).toBe(4);
    expect(a.featureBonus).toBe(6);
    expect(a.interrupt).toBe(d.interrupt);
    // 断った月と比べ、作業の手間は機能開発のままで、加点の分だけ多い
    expect(a.feature).toBe(d.feature + 6);
  });

  it('提案が届いていない月は、部品の欄では選べず「提案を受けると付く」と理由が出る', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(checkAction(s, comp('realtime', 'durable-objects'))).toMatchObject({
      ok: false,
      reason: 'via-proposal',
    });
  });
});

describe('選べない理由の区別', () => {
  it('手間が足りない・同じ・最中・要件を区別する', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(checkAction(s, comp('isrCache', 'kv'))).toMatchObject({
      ok: false,
      reason: 'same',
    });
    const swapping = applyAction(s, comp('db', 'hyperdrive'));
    expect(checkAction(swapping, comp('images', 'none'))).toMatchObject({
      ok: false,
      reason: 'busy',
    });
    expect(
      checkAction(swapping, { type: 'migrate', stackIndex: VERCEL_PRO }),
    ).toMatchObject({ ok: false, reason: 'busy' });
    // 手間を使い切ると、手間の理由になる
    const tired = applyActions(s, [
      { type: 'optimize' },
      { type: 'set', key: 'format', value: 105 },
      { type: 'set', key: 'variants', value: 2 },
      comp('isrCache', 'r2'),
      { type: 'block-bots' },
    ]);
    expect(effortAvailable(tired)).toBeLessThan(EFFORT.component.images);
    expect(checkAction(tired, comp('images', 'none'))).toMatchObject({
      ok: false,
      reason: 'effort',
    });
  });
});

describe('SLA の打診（SC-5・W-2）', () => {
  // シード 3 は、まれな出来事が SLA の打診
  const slaMonth = newGame(VPS, 3).schedule.find(
    (x) => x.id === 'p-sla',
  )!.month;

  it('Cloudflare では受けられない理由が出て、受けることを選べない', () => {
    const s = until(CF_PAID, slaMonth, 3);
    const e = last(s).events.find((x) => x.id === 'p-sla')!;
    expect(e.accept?.unavailable).toBeDefined();
    expect(e.sla?.length).toBeGreaterThan(0);
    expect(
      actionEffort(s, { type: 'respond', eventId: 'p-sla', accept: true }),
    ).toBeNull();
  });

  it('VPS 2GB は受けられ、4GB にプラン変更した月から契約の収益が入る', () => {
    const s = until(VPS, slaMonth, 3);
    expect(isPlanChange(VPS, VPS_4GB)).toBe(true);
    // 上位への変更はプラン変更（来月から）だが、停止とディスクの拡張の手間がある（D-27）
    expect(actionEffort(s, { type: 'plan', stackIndex: VPS_4GB })).toBe(
      EFFORT.scaleUp,
    );
    const accepted = applyAction(s, {
      type: 'respond',
      eventId: 'p-sla',
      accept: true,
    });
    const on2gb = playMonth(accepted);
    expect(last(on2gb).contractRevenue).toBe(0);
    expect(last(on2gb).notes.join()).toContain('契約の収益が入らなかった');
    const on4gb = playMonth(
      applyAction(on2gb, { type: 'plan', stackIndex: VPS_4GB }),
    );
    expect(last(on4gb).contractRevenue).toBeGreaterThan(0);
    // 計画的な停止は止まった月に数えない
    expect(last(on4gb).status).not.toBe('down');
  });

  it('4GB → 2GB はプラン変更ではなく契約し直し（6 ポイント × 2 か月・期間中は新旧両方の費用）', () => {
    const s = playMonth(newGame(VPS_4GB));
    expect(isPlanChange(VPS_4GB, VPS)).toBe(false);
    expect(checkAction(s, { type: 'plan', stackIndex: VPS })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const m = applyAction(s, { type: 'migrate', stackIndex: VPS });
    expect(m.migration?.required).toBe(
      EFFORT.migrationPerMonth * EFFORT.migrationMonths.recontract,
    );
    const next = playMonth(m);
    expect(last(next).parallelInfraCost).toBeGreaterThan(0);
    // 他の VPS が絡む乗り換え（6 × 3）とは別の値
    expect(EFFORT.migrationMonths.recontract).not.toBe(
      EFFORT.migrationMonths.selfHosted,
    );
  });
});
