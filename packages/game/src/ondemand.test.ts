// 即時反映（オンデマンド ISR）の提案と要件（D-32）。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  meetsRequirement,
  newGame,
  playMonth,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const month = (seed: number) =>
  newGame(CF_PAID, seed).schedule.find((x) => x.id === 'p-ondemand')!.month;
const until = (stackIndex: number, months: number, seed: number) => {
  let s = playMonth(newGame(stackIndex, seed));
  while (s.history.length < months && s.phase === 'playing') s = playMonth(s);
  return s;
};

describe('即時反映の要件', () => {
  it('満たせる構成・満たせない構成（部品しだい）', () => {
    expect(meetsRequirement(CF_PAID, 'on-demand-isr')).toBe(false); // KV
    expect(
      meetsRequirement(CF_PAID, 'on-demand-isr', { isrCache: 'workers-cache' }),
    ).toBe(true);
    expect(meetsRequirement(CF_PAID, 'on-demand-isr', { isrCache: 'r2' })).toBe(
      true,
    );
    expect(meetsRequirement(VERCEL_PRO, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(VPS, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(VPS, 'on-demand-isr', { frontCdn: 'static' })).toBe(
      true,
    );
    expect(meetsRequirement(VPS, 'on-demand-isr', { frontCdn: 'html' })).toBe(
      false,
    );
  });

  it('受ける前のカードに部品ごとの満たせる / 満たせないが出る', () => {
    const s = until(CF_PAID, month(42), 42);
    const e = last(s).events.find((x) => x.id === 'p-ondemand')!;
    const st = e.requirementStatus!;
    expect(st.find((x) => x.label.includes('KV'))).toMatchObject({
      ok: false,
      current: true,
    });
    expect(st.find((x) => x.label.includes('Workers Cache'))?.ok).toBe(true);
  });

  it('受けて満たさない構成では鮮度が 1 段下がり、Workers Cache に替えると戻る', () => {
    const s = until(CF_PAID, month(42), 42);
    const accepted = playMonth(
      applyAction(s, { type: 'respond', eventId: 'p-ondemand', accept: true }),
    );
    const declined = playMonth(
      applyAction(s, { type: 'respond', eventId: 'p-ondemand', accept: false }),
    );
    expect(last(declined).satisfaction.stages.freshness).toBe('good');
    expect(last(accepted).satisfaction.stages.freshness).toBe('fair');
    expect(last(accepted).satisfaction.reasons.freshness).toContain(
      '即時反映の要件を満たさない',
    );
    const fixed = playMonth(
      applyAction(accepted, {
        type: 'component',
        slot: 'isrCache',
        option: 'workers-cache',
      }),
    );
    expect(last(fixed).satisfaction.stages.freshness).toBe('good');
  });
});
