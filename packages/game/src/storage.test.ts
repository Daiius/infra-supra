// さくらの VPS のストレージ変更オプション（D-30）。ディスク 2 倍・手数料は一度だけ・戻せない。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkAction,
  EFFORT,
  effortAvailable,
  newGame,
  playMonth,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VPS = 4;
const VPS_4GB = 5;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const diskLimit = (s: GameState) =>
  last(s).snapshots.find((p) => p.id.startsWith('host:disk:'))!;

describe('ストレージ変更オプション', () => {
  it('付けた翌月からディスクの上限が 2 倍になり、手数料はその月に一度だけ', () => {
    const s = playMonth(newGame(VPS));
    expect(checkAction(s, { type: 'storage-option' })).toEqual({
      ok: true,
      cost: EFFORT.storageOption,
    });
    const a = applyAction(s, { type: 'storage-option' });
    expect(effortAvailable(a)).toBe(effortAvailable(s) - EFFORT.storageOption);
    const m2 = playMonth(a);
    const plain = playMonth(s);
    // 使用率が半分（上限が 100 → 200 GB）
    expect(diskLimit(m2).ratio).toBeCloseTo(diskLimit(plain).ratio / 2, 6);
    const feeLine = (x: GameState) =>
      last(x).lines.filter((l) => l.label.includes('ストレージ変更オプション'));
    expect(feeLine(m2)).toHaveLength(1);
    expect(last(m2).infraCost).toBeGreaterThan(last(plain).infraCost);
    expect(last(m2).status).not.toBe('down');
    const m3 = playMonth(m2);
    expect(feeLine(m3)).toHaveLength(0);
    // 戻せない（もう一度は選べない）
    expect(checkAction(m3, { type: 'storage-option' })).toMatchObject({
      ok: false,
      reason: 'same',
    });
  });

  it('同じ月に 4GB へ上位変更しても、手数料は申し込んだときのプラン（2GB）の金額', () => {
    const s = playMonth(newGame(VPS));
    const both = playMonth(
      applyAction(applyAction(s, { type: 'storage-option' }), {
        type: 'plan',
        stackIndex: VPS_4GB,
      }),
    );
    const fee = last(both).lines.find((l) =>
      l.label.includes('ストレージ変更オプション'),
    )!;
    expect(fee.amount).toBe(2_200);
  });

  it('VPS でなければ選べない', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(checkAction(s, { type: 'storage-option' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('付けた後に 4GB へ上位変更すると、オプションは残り 400 GB（公式に記載なし・みなし）', () => {
    const a = playMonth(
      applyAction(playMonth(newGame(VPS)), { type: 'storage-option' }),
    );
    const up = playMonth(applyAction(a, { type: 'plan', stackIndex: VPS_4GB }));
    expect(up.storageOption).toBe(true);
    const plain4 = playMonth(playMonth(newGame(VPS_4GB)));
    expect(diskLimit(up).ratio).toBeLessThan(diskLimit(plain4).ratio);
  });
});
