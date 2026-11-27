// 設定「解析の区切り方」「1 局面に残す候補の数」（prd/17 §5.2・§5.3・D-236）: 解析のあるシナリオ（棋譜解析）だけで出し、
// 行動で替えると翌月から Workload と在庫の増え方が替わる。記事・受託では出さない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import {
  KIFU_ENGINE_STARTUP_CPU_MS,
  KIFU_GAMES_PER_MAU,
  KIFU_MOVES_PER_GAME,
  KIFU_PV_PER_MAU,
} from 'catalog';
import { resolveWorkload } from 'estimator';
import { commitmentTerms } from './commitments.ts';
import {
  actionEffort,
  applyAction,
  applyActions,
  checkAction,
  currentSetupDraft,
  DEFAULT_START_DATE,
  EFFORT,
  estimateWorkload,
  fixedSettingValue,
  hiddenSettings,
  newGame,
  newSave,
  parseSave,
  playMonth,
  replaySave,
  SCENARIOS,
  selfHostedOf,
  settingInactiveReason,
  setupChangeOf,
  setupCommitments,
  STACKS,
  withTurn,
  type GameState,
} from './index.ts';

// 遊びの値（所持金など）は PR-11 で決めるまで受託の仮のもの。1 局面の重さでは 1 か月目で尽きるので、所持金だけ足す
const kifu = {
  ...SCENARIOS['kifu-analysis']!,
  startCash: 1e7,
};
/**
 * 止まった月の数（outages）で 1 件の上限の効き目を見るための小さい規模（月 4,000 局。D-242 のときの普段の月）。
 * シナリオの規模（12 万 PV・月 9 万局）では Workers Paid も 1 か月目から D1 の 10 GB に当たって毎月止まるので、
 * 1 件の上限で止まったかどうかが outages に出ない。
 */
const kifuSmall = {
  ...kifu,
  scale: {
    ...kifu.scale,
    startPV: (4_000 / KIFU_GAMES_PER_MAU) * KIFU_PV_PER_MAU,
  },
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
const start = (stack: number, sc = kifu) =>
  playMonth(newGame(stack, 1, sc, DEFAULT_START_DATE, 'nextjs'));
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
    // Workers Paid はほかに当たる上限が無い規模なら、1 件の上限でその月だけ止まる
    const s = start(CF_PAID, kifuSmall);
    expect(s.outages).toBe(0);
    expect(playMonth(applyAction(s, unit(1))).outages).toBe(1);
  });

  it('小分けに保存すると 1 件の上限に当たらず止まらない（Vercel Hobby・Workers Paid）', () => {
    for (const stack of [HOBBY, CF_PAID]) {
      const next = playMonth(applyAction(start(stack), unit(2)));
      expect(perRequestHits(next), STACKS[stack]!.id).toEqual([]);
    }
    // ほかに当たる上限が無い規模なら、止まらない
    const s = start(CF_PAID, kifuSmall);
    expect(s.outages).toBe(0);
    expect(playMonth(applyAction(s, unit(2))).outages).toBe(0);
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
    // 併用は端末の簡易解析を保存しないので、サーバーの詳細解析は設定どおり
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
    expect(draft.settings).toEqual({
      analysisUnit: 0,
      candidates: 3,
      analysisScope: 0,
      analysisMachines: 1,
    });
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

describe('詳細解析の範囲（D-246・prd/17 §5.6）', () => {
  const scope = (value: number) =>
    ({ type: 'set', key: 'analysisScope', value }) as const;
  /** 解析の置き場を選んで始めた 1 か月目（区切り方は 1 局まとめて）。 */
  const startWith = (analysis: string) =>
    playMonth(
      applyAction(
        playMonth(
          newGame(PRO, 1, kifu, DEFAULT_START_DATE, 'nextjs', { analysis }),
        ),
        unit(1),
      ),
    );
  const asyncCount = (s: GameState) =>
    resolveWorkload(
      estimateWorkload(kifu, {
        pv: kifu.scale.startPV,
        stackIndex: s.stackIndex,
        framework: s.framework,
        components: s.components,
        settings: s.settings,
      }),
    ).classes['api-async']!.count;

  it('既定は全局（始めた状態に値を持たない）。併用のときだけ選べる', () => {
    const g = newGame(PRO, 1, kifu);
    expect(g.settings.analysisScope).toBeUndefined();
    expect(hiddenSettings(g)).not.toContain('analysisScope');
    expect(currentSetupDraft(g).settings?.analysisScope).toBe(0);
    expect(settingInactiveReason(g, 'analysisScope')).toMatch(/併用|詳細解析/);
    expect(checkAction(start(PRO), scope(1)).ok).toBe(false);
    const h = startWith('hybrid');
    expect(settingInactiveReason(h, 'analysisScope')).toBeUndefined();
    expect(checkAction(h, scope(1)).ok).toBe(true);
    expect(actionEffort(h, scope(1))).toBe(EFFORT.setting.analysisScope);
  });

  it('併用で希望した棋譜だけにすると、翌月からサーバーの詳細解析の件数と費用が減り、在庫の増え方も減る', () => {
    const h = startWith('hybrid-fn-lambda');
    const next = playMonth(applyAction(h, scope(1)));
    expect(next.settings.analysisScope).toBe(1);
    const stay = playMonth(h);
    expect(asyncCount(next) / asyncCount(stay)).toBeCloseTo(0.5, 6);
    expect(usd(next)).toBeLessThan(usd(stay));
    expect(next.stock.dbGB - h.stock.dbGB).toBeLessThan(
      stay.stock.dbGB - h.stock.dbGB,
    );
  });

  it('併用でない置き場では、値が残っていても全局として数える', () => {
    const h = startWith('hybrid');
    const asked = applyAction(h, scope(1));
    const server = {
      ...asked,
      components: { ...asked.components, analysis: 'same' },
    };
    const base = { ...h, components: { ...h.components, analysis: 'same' } };
    expect(asyncCount(server)).toBe(asyncCount(base));
  });

  it('保存から再生しても同じ（行動の列だけで再現する）', () => {
    let save = newSave({
      scenarioId: 'kifu-analysis',
      stackIndex: PRO,
      seed: 1,
      startDate: DEFAULT_START_DATE,
      framework: 'nextjs',
      components: { analysis: 'hybrid' },
    });
    let s = replaySave(save, { 'kifu-analysis': kifu });
    for (const t of [[unit(1)], [scope(1)], []] as const) {
      s = playMonth(applyActions(s, t));
      save = withTurn(save, t);
    }
    expect(s.settings.analysisScope).toBe(1);
    expect(replaySave(save, { 'kifu-analysis': kifu })).toEqual(s);
  });
});

describe('始める画面で選んだ解析の設定（D-249）', () => {
  const awsIdx = STACKS.findIndex((s) => s.id === 'aws-amplify');
  const start = (settings?: Parameters<typeof newGame>[11]) =>
    newGame(
      awsIdx,
      7,
      kifu,
      DEFAULT_START_DATE,
      'nextjs',
      { analysis: 'hybrid' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
    );

  it('選んだ値で始まり、省略・選べない値は既定', () => {
    const s = start({ analysisUnit: 1, candidates: 1, analysisScope: 1 });
    expect(s.settings.analysisUnit).toBe(1);
    expect(s.settings.candidates).toBe(1);
    expect(s.settings.analysisScope).toBe(1);
    const d = start({ analysisUnit: 9, candidates: 2 });
    expect(d.settings.analysisUnit).toBe(0);
    expect(d.settings.candidates).toBe(3);
    expect(d.settings.analysisScope).toBeUndefined();
    expect(start().settings).toEqual(start({}).settings);
  });

  it('解析の無いシナリオでは効かない', () => {
    const s = newGame(
      awsIdx,
      7,
      SCENARIOS['article-community']!,
      DEFAULT_START_DATE,
      'nextjs',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { analysisUnit: 1 },
    );
    expect(s.settings.analysisUnit).toBe(0);
  });

  it('保存に書いて再生すると、同じ設定で同じ結果になる（集計の再生と同じ口）', () => {
    const save = newSave({
      scenarioId: 'kifu-analysis',
      stackIndex: awsIdx,
      framework: 'nextjs',
      seed: 7,
      startDate: DEFAULT_START_DATE,
      components: { analysis: 'hybrid' },
      analysisSettings: { analysisUnit: 1, analysisScope: 1 },
    });
    const played = replaySave(withTurn(save, []), { 'kifu-analysis': kifu });
    expect(played.settings.analysisUnit).toBe(1);
    expect(played.settings.analysisScope).toBe(1);
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    expect(parsed?.analysisSettings).toEqual({
      analysisUnit: 1,
      analysisScope: 1,
    });
    expect(
      parseSave({ ...save, analysisSettings: { analysisUnit: 'x' } }),
    ).toBeNull();
  });
});

describe('台で借りるマシンの台数（D-251）', () => {
  const ec2 = { analysis: 'ec2-c7g-2xlarge' };
  const startN = (n?: number, analysis: Record<string, string> = ec2) =>
    playMonth(
      newGame(
        PRO,
        1,
        kifu,
        DEFAULT_START_DATE,
        'nextjs',
        analysis,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        n === undefined ? undefined : { analysisMachines: n },
      ),
    );
  const machineUsd = (s: GameState) =>
    last(s)
      .lines.filter((l) => l.planId === 'ec2-c7g-2xlarge')
      .reduce((a, l) => a + l.amount, 0);

  it('始める画面で選んだ台数で始まり、マシンの時間の課金が台数倍になる', () => {
    const one = startN();
    const four = startN(4);
    expect(four.settings.analysisMachines).toBe(4);
    expect(machineUsd(one)).toBeGreaterThan(0);
    expect(machineUsd(four)).toBeCloseTo(machineUsd(one) * 4, 6);
  });

  it('台数は台で借りるマシンのときだけ選べ、ほかの実行先では 1 台として効かない', () => {
    const s = startN(4, { analysis: 'fn-lambda' });
    expect(settingInactiveReason(s, 'analysisMachines')).toMatch(/台で借りる/);
    expect(fixedSettingValue(s, 'analysisMachines')).toBe(1);
    expect(settingInactiveReason(startN(), 'analysisMachines')).toBeUndefined();
  });

  it('2 台以上なら worker が止まっても残りで続く（偶発的な障害に数えない）', () => {
    expect(selfHostedOf(PRO, ec2, 'nextjs', {}, true)).toBe(true);
    expect(selfHostedOf(PRO, ec2, 'nextjs', {}, true, 2)).toBe(false);
  });

  it('時間あたりの額の確約は台数ぶん結ぶ（対象のオンデマンドの額から台数を出す）', () => {
    const def = {
      key: 'k',
      provider: 'aws',
      planId: 'p',
      currency: 'USD' as const,
      onDemandMonthly: 100,
      commitment: {
        id: 'ri',
        label: 'RI',
        kind: 'instance' as const,
        termMonths: 12,
        meterIds: ['instance'],
        payments: [{ payment: 'no-upfront' as const, hourly: 0.1 }],
        premise: '',
        sourceIds: [],
      },
    };
    const one = commitmentTerms(def as never, 'no-upfront');
    const three = commitmentTerms(def as never, 'no-upfront', 300);
    expect(three!.covers).toBe(one!.covers * 3);
    expect(three!.monthly).toBeCloseTo(one!.monthly * 3, 9);
  });

  it('始める画面の確約の額は、選択肢の外の台数（3・1.5）を 1 台として出す（newGame の設定と同じ。OCL-DE5F7BC2）', () => {
    const offers = (n?: number) =>
      setupCommitments(
        kifu,
        PRO,
        'nextjs',
        ec2,
        n === undefined ? undefined : { analysisMachines: n },
      )
        .filter((o) => o.key.includes('ec2-c7g-2xlarge'))
        .map((o) => [o.key, o.payment, o.usd.monthly, o.usd.upfront]);
    const one = offers();
    expect(one.length).toBeGreaterThan(0);
    expect(offers(3)).toEqual(one);
    expect(offers(1.5)).toEqual(one);
    expect(offers(4)).not.toEqual(one);
  });
});
