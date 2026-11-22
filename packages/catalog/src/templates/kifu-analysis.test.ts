// 棋譜解析のテンプレート（prd/17・KF-14）。値はゲーム上の仮定なので、形と範囲・定数との結び付きだけを確かめる。
// 実在の料金の金額はテストに書かない（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload, WorkloadInputSchema } from 'estimator';
import { loadPriceBooks, MVP_STACKS } from '../index.ts';
import {
  KIFU_ANALYSIS_ROUTES,
  KIFU_CANDIDATE_KB,
  KIFU_CANDIDATES,
  KIFU_DB_GB_PER_MILLION_PV,
  KIFU_GAMES_PER_MAU,
  KIFU_HOURLY_PROFILE,
  KIFU_KB_PER_GAME,
  KIFU_MOVES_PER_GAME,
  KIFU_POSITION_CPU_MS,
  KIFU_PV_PER_MAU,
  KIFU_RECORD_KB,
  kifuAnalysis,
  kifuResultKB,
} from './kifu-analysis.ts';

const books = loadPriceBooks();
const PV = 300_000;

describe('棋譜解析のテンプレート', () => {
  it('スキーマに通り、ルートの割合の合計は 1・性質はルートごとにある', () => {
    const input = kifuAnalysis(PV);
    expect(() => WorkloadInputSchema.parse(input)).not.toThrow();
    const sum = input.routes.reduce((a, r) => a + r.share, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(Object.keys(KIFU_ANALYSIS_ROUTES).sort()).toEqual(
      input.routes.map((r) => r.id).sort(),
    );
    // 最初のルートは個人の SSR（ゲームの baseSsrCpuMsOf が読む）
    expect(input.routes[0]!.rendering).toBe('ssr');
    expect(KIFU_ANALYSIS_ROUTES[input.routes[0]!.id]!.audience).toBe(
      'personal',
    );
  });

  it('個人のページが主で、共有のページ（OGP）は少なめ', () => {
    const input = kifuAnalysis(PV);
    const personal = input.routes
      .filter((r) => KIFU_ANALYSIS_ROUTES[r.id]!.audience === 'personal')
      .reduce((a, r) => a + r.share, 0);
    expect(personal).toBeGreaterThanOrEqual(0.8);
    const share = input.routes.find((r) => r.id === 'share')!;
    expect(KIFU_ANALYSIS_ROUTES.share!.needsOgp).toBe(true);
    expect(share.share).toBeGreaterThan(0);
    expect(share.share).toBeLessThanOrEqual(0.1);
    expect(share.apiCalls).toBe(0);
  });

  it('解析は局面ごとに 1 件: 月の件数 = 利用者 × 棋譜の数 × 手数、1 件の CPU は 1 局面', () => {
    const input = kifuAnalysis(PV);
    const w = resolveWorkload(input);
    const games = (PV / KIFU_PV_PER_MAU) * KIFU_GAMES_PER_MAU;
    expect(w.classes['api'].count).toBeCloseTo(games * KIFU_MOVES_PER_GAME, 0);
    expect(input.api.cpuMs).toBe(KIFU_POSITION_CPU_MS);
    // 解析は閲覧より桁違いに重い（prd/17 §2.2）
    const ssr = input.routes[0]!.processing.cpuMs;
    expect(input.api.cpuMs).toBeGreaterThanOrEqual(10 * ssr);
    // 画像は配らない
    expect(w.classes['image-read'].count).toBe(0);
    expect(w.classes['image-transform'].count).toBe(0);
  });

  it('保存: 解析 1 件に結果の 1 行、1 局の大きさは 手数 × 候補の数 × 1 候補 + 棋譜', () => {
    const input = kifuAnalysis(PV);
    expect(input.api.rowsWrittenPerWrite).toBe(1);
    expect(input.api.writesPerCall).toBeCloseTo(
      1 + 1 / KIFU_MOVES_PER_GAME,
      10,
    );
    expect(kifuResultKB()).toBeCloseTo(
      KIFU_MOVES_PER_GAME * KIFU_CANDIDATES * KIFU_CANDIDATE_KB,
      10,
    );
    expect(KIFU_KB_PER_GAME).toBeCloseTo(KIFU_RECORD_KB + kifuResultKB(), 10);
    // 候補の数に比例する（後の段の設定の口）
    expect(kifuResultKB(1)).toBeCloseTo(kifuResultKB() / KIFU_CANDIDATES, 10);
    // DB の大きさは PV に比例する
    expect(kifuAnalysis(2 * PV).db.sizeGB).toBeCloseTo(2 * input.db.sizeGB, 10);
    expect(KIFU_DB_GB_PER_MILLION_PV).toBeGreaterThan(0);
  });

  it('値の範囲（ゲーム上の仮定の桁を外れない）', () => {
    expect(KIFU_MOVES_PER_GAME).toBeGreaterThanOrEqual(50);
    expect(KIFU_MOVES_PER_GAME).toBeLessThanOrEqual(200);
    expect(KIFU_CANDIDATES).toBeGreaterThanOrEqual(1);
    expect(KIFU_CANDIDATES).toBeLessThanOrEqual(10);
    expect(KIFU_CANDIDATE_KB).toBeGreaterThan(0);
    expect(KIFU_CANDIDATE_KB).toBeLessThan(1);
    expect(KIFU_POSITION_CPU_MS).toBeGreaterThanOrEqual(100);
    expect(KIFU_POSITION_CPU_MS).toBeLessThanOrEqual(10_000);
    const db = kifuAnalysis(PV).db.sizeGB;
    expect(db).toBeGreaterThan(0.1);
    expect(db).toBeLessThan(100);
  });

  it('時間帯の形は 24 個で、夜に最も多く、平日の最も多い時間 / 平均は peakHourFactor を超えない', () => {
    const t = kifuAnalysis(PV).traffic;
    const p = KIFU_HOURLY_PROFILE;
    expect(p).toHaveLength(24);
    expect(p.indexOf(Math.max(...p))).toBeGreaterThanOrEqual(19);
    const mean = p.reduce((a, v) => a + v, 0) / 24;
    const r = t.weekdayToWeekend;
    const implied = (((7 * r) / (5 * r + 2)) * Math.max(...p)) / mean;
    expect(implied).toBeLessThanOrEqual(t.peakHourFactor);
  });

  it('どの構成でも見積もれる（解析の 1 件の CPU は Cloudflare Free の 1 リクエストの上限に当たる）', () => {
    for (const architecture of MVP_STACKS) {
      const r = estimate({ workload: kifuAnalysis(PV), architecture, books });
      expect(r.simulation.unroutedClasses).toEqual([]);
      for (const total of Object.values(r.bill.totals))
        expect(Number.isFinite(total)).toBe(true);
      const cpuLimit = r.premises.some(
        (p) => p.hit && p.id.includes(':cpu-ms-per-request:'),
      );
      if (architecture.id === 'cloudflare-vinext-free')
        expect(cpuLimit).toBe(true);
    }
  });
});
