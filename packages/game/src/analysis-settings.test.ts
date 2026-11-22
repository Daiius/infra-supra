// 設定「解析の区切り方」「1 局面に残す候補の数」（prd/17 §5.2・§5.3・D-236）: 解析のあるシナリオ（棋譜解析）だけで出し、
// 行動で替えると翌月から Workload と在庫の増え方が替わる。記事・受託では出さない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import { KIFU_ENGINE_STARTUP_CPU_MS, KIFU_MOVES_PER_GAME } from 'catalog';
import { resolveWorkload } from 'estimator';
import {
  actionEffort,
  applyAction,
  applyActions,
  checkAction,
  currentSetupDraft,
  DEFAULT_START_DATE,
  EFFORT,
  ESTIMATE_ONLY_SCENARIOS,
  estimateWorkload,
  fixedSettingValue,
  hiddenSettings,
  newGame,
  playMonth,
  SCENARIOS,
  settingInactiveReason,
  setupChangeOf,
  STACKS,
  type GameState,
} from './index.ts';

// 遊びの値（所持金など）は PR-11 で決めるまで受託の仮のもの。1 局面の重さでは 1 か月目で尽きるので、所持金だけ足す
const kifu = {
  ...ESTIMATE_ONLY_SCENARIOS['kifu-analysis']!,
  startCash: 1e7,
};
const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const HOBBY = idx('vercel-supabase-hobby');
const PRO = idx('vercel-supabase-pro');
const CF_PAID = idx('cloudflare-vinext-paid');
const unit = (value: number) =>
  ({ type: 'set', key: 'analysisUnit', value }) as const;
const candidates = (value: number) =>
  ({ type: 'set', key: 'candidates', value }) as const;
const start = (stack: number) =>
  playMonth(newGame(stack, 1, kifu, DEFAULT_START_DATE, 'nextjs'));
const last = (s: GameState) => s.history[s.history.length - 1]!;
const usd = (s: GameState) => last(s).lines.reduce((a, l) => a + l.amount, 0);
/** 当たった 1 件の上限（CPU・壁時計。D-234）の前提。 */
const perRequestHits = (s: GameState) =>
  last(s)
    .premises.filter(
      (p) =>
        p.hit &&
        /:(cpu-ms-per-request|function-max-duration|async-wall-ms):/.test(p.id),
    )
    .map((p) => p.id);

describe('解析のあるシナリオだけで出す', () => {
  it('記事・受託では隠し、行動も選べない', () => {
    for (const sc of [article, contract]) {
      const g = newGame(0, 1, sc);
      expect(hiddenSettings(g)).toEqual(
        expect.arrayContaining(['analysisUnit', 'candidates']),
      );
      expect(checkAction(g, unit(1)).ok).toBe(false);
      expect(checkAction(g, candidates(1)).ok).toBe(false);
      expect(currentSetupDraft(g).settings).toBeUndefined();
    }
  });

  it('棋譜解析では出し、既定は局面ごと・候補 3 つ', () => {
    const g = newGame(PRO, 1, kifu);
    const hidden = hiddenSettings(g);
    expect(hidden).not.toContain('analysisUnit');
    expect(hidden).not.toContain('candidates');
    expect(g.settings.analysisUnit).toBe(0);
    expect(g.settings.candidates).toBe(3);
  });
});

describe('区切り方の行動', () => {
  it('工数を使い、翌月から 1 件の重さと件数が替わる（1 局まとめては固定の重さが 1 回で、局面ごとより安い）', () => {
    const s = start(PRO);
    expect(actionEffort(s, unit(1))).toBe(EFFORT.setting.analysisUnit);
    const next = playMonth(applyAction(s, unit(1)));
    expect(next.settings.analysisUnit).toBe(1);
    // Vercel Pro の 800 秒には収まるので止まらず、固定の重さの分だけ安い
    expect(next.outages).toBe(0);
    expect(usd(next)).toBeLessThan(usd(s));
  });

  it('1 局まとめては、短い上限（Vercel Hobby の 300 秒・Workers Paid の CPU 5 分）に当たってその月は止まる', () => {
    const want = {
      [HOBBY]: 'limit:vercel:hobby:function-max-duration:fn',
      [CF_PAID]: 'limit:cloudflare:workers-paid:cpu-ms-per-request:worker',
    };
    for (const stack of [HOBBY, CF_PAID]) {
      const s = start(stack);
      expect(perRequestHits(s)).toEqual([]);
      const stopped = playMonth(applyAction(s, unit(1)));
      expect(perRequestHits(stopped), STACKS[stack]!.id).toEqual([want[stack]]);
      expect(last(stopped).status, STACKS[stack]!.id).toBe('down');
    }
    // Workers Paid はほかに当たる上限が無いので、その月だけ止まる
    const s = start(CF_PAID);
    expect(playMonth(applyAction(s, unit(1))).outages).toBe(s.outages + 1);
  });

  it('小分けに保存すると 1 件の上限に当たらず止まらない（Vercel Hobby・Workers Paid）', () => {
    for (const stack of [HOBBY, CF_PAID]) {
      const next = playMonth(applyAction(start(stack), unit(2)));
      expect(perRequestHits(next), STACKS[stack]!.id).toEqual([]);
    }
    const s = start(CF_PAID);
    expect(playMonth(applyAction(s, unit(2))).outages).toBe(s.outages);
  });

  it('Workload: 1 局まとめては 1 局 1 件、小分けは塊の数、局面ごとは手数', () => {
    const w = (analysisUnit: number, analysis = 'same') =>
      resolveWorkload(
        estimateWorkload(kifu, {
          pv: 300_000,
          stackIndex: PRO,
          framework: 'nextjs',
          components: { analysis },
          settings: {
            imageKB: 150,
            variants: 3,
            revalidateSec: 300,
            analysisUnit,
          },
        }),
      );
    const pos = w(0).classes['api-async'];
    const game = w(1).classes['api-async'];
    const res = w(2).classes['api-async'];
    expect(pos.count / game.count).toBeCloseTo(KIFU_MOVES_PER_GAME, 6);
    expect(res.count).toBeGreaterThan(game.count);
    expect(res.count).toBeLessThan(pos.count);
    expect(game.perRequest.cpuMs).toBeGreaterThan(
      KIFU_MOVES_PER_GAME * KIFU_ENGINE_STARTUP_CPU_MS,
    );
    // 端末の置き場: サーバーの上限に関係なく、結果を送る回数（API の件数）が区切り方で替わる
    expect(w(0, 'client').classes.api.count).toBeCloseTo(pos.count, 6);
    expect(w(1, 'client').classes.api.count).toBeCloseTo(game.count, 6);
    expect(w(1, 'client').classes['api-async'].count).toBe(0);
  });
});

describe('候補の数の行動', () => {
  it('候補を減らすと翌月から DB の増え方が小さくなる', () => {
    const s = start(PRO);
    expect(actionEffort(s, candidates(1))).toBe(EFFORT.setting.candidates);
    const three = playMonth(s);
    const one = playMonth(applyAction(s, candidates(1)));
    expect(one.stock.dbGB - s.stock.dbGB).toBeLessThan(
      three.stock.dbGB - s.stock.dbGB,
    );
    expect(one.stock.dbGB).toBeGreaterThan(s.stock.dbGB);
  });

  it('置き場が利用者の端末なら 1 つに固定し、選べない理由を出す（置き場を戻せば設定の値に戻る）', () => {
    const s = applyAction(start(PRO), {
      type: 'component',
      slot: 'analysis',
      option: 'client',
    });
    expect(settingInactiveReason(s, 'candidates')).toMatch(/利用者の端末/);
    expect(fixedSettingValue(s, 'candidates')).toBe(1);
    expect(s.settings.candidates).toBe(3);
    const r = checkAction(s, candidates(1));
    expect(r.ok).toBe(false);
    // 併用は端末の速報を保存しないので、サーバーの本解析は設定どおり
    const h = applyAction(start(PRO), {
      type: 'component',
      slot: 'analysis',
      option: 'hybrid',
    });
    expect(settingInactiveReason(h, 'candidates')).toBeUndefined();
  });
});

describe('構成を変える（D-185）でも選び直せる', () => {
  it('欄の設定の差を set の行動に写し取り、工数と「来月から」を出す', () => {
    const s = start(PRO);
    const draft = currentSetupDraft(s);
    expect(draft.settings).toEqual({ analysisUnit: 0, candidates: 3 });
    const change = setupChangeOf(s, {
      ...draft,
      settings: { analysisUnit: 2, candidates: 1 },
    });
    expect(change.why).toBeNull();
    expect(change.groups.settings).toEqual([unit(2), candidates(1)]);
    const items = change.items.filter((x) => x.kind === 'setting');
    expect(items.map((x) => x.meta)).toEqual([
      [`工数 ${EFFORT.setting.analysisUnit}`, '来月から'],
      [`工数 ${EFFORT.setting.candidates}`, '来月から'],
    ]);
    const after = applyActions(s, change.groups.settings);
    expect(after.settings.analysisUnit).toBe(2);
    expect(after.settings.candidates).toBe(1);
  });

  it('端末に替えると同時に候補の数を替えるのはできない（理由を出す）', () => {
    const s = start(PRO);
    const draft = currentSetupDraft(s);
    const change = setupChangeOf(s, {
      ...draft,
      components: { ...draft.components, analysis: 'client' },
      settings: { ...draft.settings, candidates: 1 },
    });
    expect(change.why).toMatch(/利用者の端末/);
  });
});
