// さくらの VPS の前段の CDN（D-31）。Cloudflare の CDN（Free）を前に置く。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkAction,
  EFFORT,
  meetsRequirement,
  newGame,
  playMonth,
  type GameState,
} from './index.ts';

const VPS = 4;
const VPS_4GB = 5;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const ratio = (s: GameState, prefix: string) =>
  last(s).snapshots.find((p) => p.id.startsWith(prefix))?.ratio ?? 0;
const cdn = (option: string) =>
  ({ type: 'component', slot: 'frontCdn', option }) as const;

describe('前段の CDN', () => {
  it('静的と画像だけ: VPS の回線と CPU の使用率が下がり、費用は増えない', () => {
    const s = playMonth(newGame(VPS));
    expect(checkAction(s, cdn('static'))).toEqual({
      ok: true,
      // Cloudflare のアカウントが増えるので、差すときの一度きりの手間が付く（D-52）
      cost: EFFORT.component.frontCdn + EFFORT.accountSetup,
    });
    const withCdn = playMonth(applyAction(s, cdn('static')));
    const plain = playMonth(s);
    expect(ratio(withCdn, 'host:line:')).toBeLessThan(
      ratio(plain, 'host:line:'),
    );
    expect(ratio(withCdn, 'host:cpu:')).toBeLessThan(ratio(plain, 'host:cpu:'));
    expect(last(withCdn).infraCost).toBeCloseTo(last(plain).infraCost, 6);
    expect(last(withCdn).satisfaction.stages.freshness).toBe(
      last(plain).satisfaction.stages.freshness,
    );
  });

  it('HTML もキャッシュ: 鮮度が 1 段下がる（オンデマンドの再検証が CDN に届かない）', () => {
    const s = playMonth(newGame(VPS));
    const html = playMonth(applyAction(s, cdn('html')));
    expect(last(html).satisfaction.stages.freshness).toBe('fair');
    expect(last(html).satisfaction.reasons.freshness).toContain('CDN');
  });

  it('CDN（Free）に SLA は無いので、前に置くと SLA の要件を満たさない', () => {
    expect(meetsRequirement(VPS_4GB, 'uptime-sla')).toBe(true);
    expect(
      meetsRequirement(VPS_4GB, 'uptime-sla', { frontCdn: 'static' }),
    ).toBe(false);
  });
});
