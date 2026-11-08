// ISR の再検証の設定の「オンデマンド」（D-49）: 再生成は内容の更新の回数・対応しない部品では届かず鮮度が下がる・
// 始める画面で選べて保存の再生で同じ・時間からの切り替えと p-ondemand の手間。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  checkAction,
  defaultRevalidateSec,
  legacyDefaultRevalidateSec,
  EFFORT,
  newGame,
  newSave,
  ON_DEMAND_MAX_AGE_NOTE,
  ON_DEMAND_MAX_AGE_SEC,
  SETTINGS,
  parseSave,
  playMonth,
  replaySave,
  setupRevalidateOptions,
  applyAction,
  withTurn,
  type GameState,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const CF_PAID = 1;
const VPS_2GB = 4;
const sc = ARTICLE_COMMUNITY;
const start = (
  stack: number,
  revalidateSec?: number,
  components?: Record<string, string>,
) => newGame(stack, 42, sc, undefined, 'nextjs', components, revalidateSec);

describe('オンデマンドの再検証（D-49）', () => {
  it('始める画面で選べる（Next.js だけ。SPA・受託では出さない）', () => {
    expect(setupRevalidateOptions(sc, 'nextjs').map((o) => o.value)).toEqual([
      0, 60, 300, 3600, 21600,
    ]);
    expect(setupRevalidateOptions(sc, 'nextjs').every((o) => o.flavor)).toBe(
      true,
    );
    expect(setupRevalidateOptions(sc, 'vite-spa')).toEqual([]);
    expect(setupRevalidateOptions(CONTRACT_OPERATIONS, 'nextjs')).toEqual([]);
    expect(start(CF_PAID, 0).settings.revalidateSec).toBe(0);
    // 選べない値・SPA は既定（5 分）
    expect(start(CF_PAID, 42).settings.revalidateSec).toBe(300);
    expect(
      newGame(CF_PAID, 42, sc, undefined, 'vite-spa', undefined, 0).settings
        .revalidateSec,
    ).toBe(300);
  });

  it('保存の再生で同じになり、無い保存は既定（5 分）で読む', () => {
    const save = withTurn(
      newSave({
        scenarioId: sc.id,
        stackIndex: CF_PAID,
        framework: 'nextjs',
        seed: 42,
        startDate: '2026-10-31',
        revalidateSec: 0,
      }),
      [],
    );
    const st = replaySave(parseSave(JSON.parse(JSON.stringify(save)))!);
    expect(st.settings.revalidateSec).toBe(0);
    expect(st.history[0]!.settings.revalidateSec).toBe(0);
    const { revalidateSec: _, ...old } = save;
    expect(replaySave(parseSave(old)!).settings.revalidateSec).toBe(300);
    expect(parseSave({ ...save, revalidateSec: 'x' })).toBeNull();
  });

  it('再生成が減り、費用は増えない', () => {
    const cost = (s: GameState) => s.history[0]!.infraCost;
    const timed = playMonth(start(CF_PAID));
    const od = playMonth(start(CF_PAID, 0));
    expect(cost(od)).toBeLessThanOrEqual(cost(timed));
  });

  it('対応する部品なら鮮度は「良い」、対応しない部品（KV）では再検証が届かず下がる（理由は既存の判定の文）', () => {
    const ok = playMonth(start(CF_PAID, 0, { isrCache: 'workers-cache' }))
      .history[0]!.satisfaction;
    expect(ok.stages.freshness).toBe('good');
    const kv = playMonth(start(CF_PAID, 0, { isrCache: 'kv' })).history[0]!
      .satisfaction;
    expect(kv.stages.freshness).not.toBe('good');
    expect(kv.reasons.freshness).toMatch(
      /^更新で消す再検証が届きません（ページのキャッシュ（ISR）: KV。/,
    );
    // VPS の前段の CDN で HTML もキャッシュしても、再検証のたびに Free の purge の API で消すので届く（D-91）
    const html = playMonth(
      start(VPS_2GB, 0, {
        isrCache: 'default',
        images: 'default',
        frontCdn: 'html',
      }),
    ).history[0]!.satisfaction;
    expect(html.stages.freshness).toBe('good');
  });

  it('ゲーム中の切り替え: 時間 → オンデマンドは手間 2、オンデマンド → 時間は 0', () => {
    const timed = playMonth(start(CF_PAID));
    const to = checkAction(timed, { type: 'set', key: 'isr', value: 0 });
    expect(to).toMatchObject({ ok: true, cost: EFFORT.onDemandSwitch });
    expect(EFFORT.onDemandSwitch).toBe(2);
    const od = playMonth(start(CF_PAID, 0));
    expect(
      checkAction(od, { type: 'set', key: 'isr', value: 300 }),
    ).toMatchObject({ ok: true, cost: 0 });
  });

  it('p-ondemand: 時間のままなら受ける手間 2 で、受けるとオンデマンドになる。すでにオンデマンドなら手間 0', () => {
    const pending = (s: GameState): GameState => ({
      ...s,
      pendingProposals: ['p-ondemand'],
    });
    const timed = pending(playMonth(start(CF_PAID)));
    const respond = {
      type: 'respond',
      eventId: 'p-ondemand',
      accept: true,
    } as const;
    expect(checkAction(timed, respond)).toMatchObject({ ok: true, cost: 2 });
    const accepted = applyAction(timed, respond);
    expect(accepted.settings.revalidateSec).toBe(0);
    expect(accepted.requirements).toContain('on-demand-isr');
    expect(accepted.interrupts.map((i) => i.points)).toEqual([2]);

    const od = pending(playMonth(start(CF_PAID, 0)));
    expect(checkAction(od, respond)).toMatchObject({ ok: true, cost: 0 });
    const acceptedOd = applyAction(od, respond);
    expect(acceptedOd.interrupts).toEqual([]);
    // 作業が無いので、機能の加点は受けたときに足す
    expect(acceptedOd.featurePoints).toBe(od.featurePoints + 5);
  });

  it('最大寿命は選択肢にせず 1 日とみなし、設定の説明（ⓘ）に書く（D-56）', () => {
    expect(ON_DEMAND_MAX_AGE_SEC).toBe(86_400);
    expect(SETTINGS.isr.options.map((o) => o.value)).toEqual([
      0, 60, 300, 3600, 21600,
    ]);
    expect(SETTINGS.isr.note).toContain(ON_DEMAND_MAX_AGE_NOTE);
    expect(ON_DEMAND_MAX_AGE_NOTE).toContain('このゲームでは 1 日とみなし');
  });

  it('最大寿命の分を足しても、オンデマンドの費用は 5 分以下（Vercel Pro・1 か月目）', () => {
    // CDN の料金は従量（既定の Flat Rate CDN の 1 か月目はクレジットが従量を覆い、差が出ない。D-120）
    const cost = (rv?: number) =>
      playMonth(start(3, rv, { cdnPlan: 'on-demand' })).history[0]!.infraCost;
    expect(cost(0)).toBeLessThanOrEqual(cost(300));
  });
});

describe('再検証の既定（D-125）: オンデマンドが選べる構成ではオンデマンド、選べなければ 5 分', () => {
  const VERCEL_PRO = 3;
  it('今の置き場・部品で決まる（未選択のスロットは既定の部品）', () => {
    // VPS・Vercel（部品ごとにキャッシュの部品の作り直しも）は消せる
    expect(defaultRevalidateSec('nextjs', VPS_2GB, sc)).toBe(0);
    expect(defaultRevalidateSec('nextjs', VERCEL_PRO, sc)).toBe(0);
    expect(start(VPS_2GB).settings.revalidateSec).toBe(0);
    // Cloudflare の既定の ISR のキャッシュ（KV）は消す呼び出しが届かないので 5 分。R2 にすると選べてオンデマンド
    expect(defaultRevalidateSec('nextjs', CF_PAID, sc)).toBe(300);
    expect(start(CF_PAID).settings.revalidateSec).toBe(300);
    expect(
      defaultRevalidateSec('nextjs', CF_PAID, sc, undefined, {
        isrCache: 'r2',
      }),
    ).toBe(0);
    expect(
      start(CF_PAID, undefined, { isrCache: 'r2' }).settings.revalidateSec,
    ).toBe(0);
    // 静的書き出しのビルドの間隔・SPA の API のキャッシュ・設定を出さない受託は 5 分のまま
    expect(defaultRevalidateSec('nextjs-export', VPS_2GB, sc)).toBe(300);
    expect(defaultRevalidateSec('vite-spa', VPS_2GB, sc)).toBe(300);
    expect(defaultRevalidateSec('nextjs', VPS_2GB, CONTRACT_OPERATIONS)).toBe(
      300,
    );
  });

  it('選んだ値は既定で上書きしない', () => {
    expect(start(VPS_2GB, 3600).settings.revalidateSec).toBe(3600);
    expect(start(CF_PAID, 0).settings.revalidateSec).toBe(0);
  });

  it('revalidateSec の無い古い保存は、遊んだときの既定（5 分）で再生する', () => {
    const save = newSave({
      scenarioId: sc.id,
      stackIndex: VPS_2GB,
      framework: 'nextjs',
      seed: 42,
      startDate: '2026-10-31',
    });
    expect(save.revalidateSec).toBeUndefined();
    expect(replaySave(parseSave(save)!).settings.revalidateSec).toBe(300);
    expect(legacyDefaultRevalidateSec('nextjs', VPS_2GB, sc)).toBe(300);
  });
});
