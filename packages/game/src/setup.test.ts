// 始める画面の部品の選択（D-45）: スロットは部品の定義から引き、未選択では始められず、選んだ部品が newGame と保存の再生に反映される。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  componentConflict,
  componentFlavor,
  newGame,
  newSave,
  parseSave,
  replaySave,
  SCENARIOS,
  setupProblem,
  setupSlots,
  STACKS,
  validSetupChoices,
  withTurn,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const CF_PAID = 1;
const VPS_2GB = 4;

describe('setupSlots', () => {
  it('Cloudflare × Next.js: ISR のキャッシュ・画像・DB を選ぶ。リアルタイム（提案で付く部品を除くと 1 択）とファイルの置き場（R2）は固定で出す', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, CF_PAID, 'nextjs');
    expect(slots.map((x) => [x.slot, x.fixed])).toEqual([
      ['isrCache', false],
      ['images', false],
      ['db', false],
      ['realtime', true],
      // メール送信（D-95）
      ['email', false],
      ['files', true],
    ]);
    expect(
      slots.find((x) => x.slot === 'db')!.options.map((o) => o.id),
    ).toEqual(['d1', 'kv', 'hyperdrive']);
    expect(
      slots.find((x) => x.slot === 'email')!.options.map((o) => o.id),
    ).toEqual(['default', 'ses', 'resend-free', 'resend-pro']);
    expect(slots.find((x) => x.slot === 'realtime')!.options).toHaveLength(1);
    expect(slots.find((x) => x.slot === 'files')!.options[0]).toMatchObject({
      id: 'r2',
      label: 'R2',
    });
  });

  it('ファイルの置き場は構成ごと（Vercel は Vercel Blob・VPS はディスク。D-46）', () => {
    const files = (i: number) =>
      setupSlots(ARTICLE_COMMUNITY, i, 'nextjs').find(
        (x) => x.slot === 'files',
      )!.options[0]!.id;
    expect(files(3)).toBe('blob');
    expect(files(VPS_2GB)).toBe('host-disk');
  });

  it('フレームワークで変わる: SPA は ISR のキャッシュが無く、OGP を選ぶ', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, VPS_2GB, 'vite-spa').map(
      (x) => x.slot,
    );
    expect(slots).not.toContain('isrCache');
    expect(slots).toContain('ogp');
    expect(slots).toContain('frontCdn');
  });

  it('シナリオで効かないスロットは出さない（受託）', () => {
    const hidden = CONTRACT_OPERATIONS.hidden?.slots ?? [];
    for (const s of STACKS)
      for (const x of setupSlots(CONTRACT_OPERATIONS, s.index, 'nextjs'))
        expect(hidden).not.toContain(x.slot);
  });

  it('すべての組み合わせの選択肢に、数値を含まない短い説明がある', () => {
    for (const sc of Object.values(SCENARIOS))
      for (const fw of ['nextjs', 'vite-spa'] as const)
        for (const s of STACKS)
          for (const x of setupSlots(sc, s.index, fw))
            for (const o of x.options) {
              const text = componentFlavor(o);
              expect(text, `${o.platform}:${o.slot}:${o.id}`).toBeTruthy();
              expect(text).not.toMatch(/(?<![A-Za-z])[0-9]/);
            }
  });
});

it('画面に出る文（シナリオの文・出来事・基準プレイの名前）に「不適切」と書かない（D-45）', () => {
  for (const sc of Object.values(SCENARIOS))
    expect(JSON.stringify(sc)).not.toContain('不適切');
});

describe('setupProblem・validSetupChoices', () => {
  it('未選択のスロットがあると始められず、理由にスロットの名前が出る', () => {
    expect(setupProblem(ARTICLE_COMMUNITY, CF_PAID, 'nextjs', {})).toBe(
      '部品をまだ選んでいない: ISR のキャッシュ・画像・DB・メール送信',
    );
    expect(
      setupProblem(ARTICLE_COMMUNITY, CF_PAID, 'nextjs', {
        isrCache: 'kv',
        images: 'images',
        email: 'default',
      }),
    ).toBe('部品をまだ選んでいない: DB');
    expect(
      setupProblem(ARTICLE_COMMUNITY, CF_PAID, 'nextjs', {
        isrCache: 'kv',
        images: 'images',
        db: 'd1',
        email: 'default',
      }),
    ).toBeNull();
  });

  it('構成やフレームワークを替えたら、選べなくなった部品の選択を外す', () => {
    const cf = { isrCache: 'r2', images: 'd1', db: 'kv' };
    // さくらには D1・KV・R2 が無い
    expect(validSetupChoices(ARTICLE_COMMUNITY, VPS_2GB, 'nextjs', cf)).toEqual(
      {},
    );
    // 同じ事業者でも SPA では ISR のキャッシュを選べない
    expect(
      validSetupChoices(ARTICLE_COMMUNITY, CF_PAID, 'vite-spa', cf),
    ).toEqual({ images: 'd1', db: 'kv' });
  });
});

describe('SPA の API の応答のキャッシュ（D-37）', () => {
  it('SPA では全構成で apiCache を選び、Next.js では出ない', () => {
    for (const s of STACKS) {
      const spa = setupSlots(ARTICLE_COMMUNITY, s.index, 'vite-spa');
      const api = spa.find((x) => x.slot === 'apiCache')!;
      expect(api.fixed).toBe(false);
      expect(api.options.map((o) => o.id)).toContain('none');
      expect(
        setupSlots(ARTICLE_COMMUNITY, s.index, 'nextjs').some(
          (x) => x.slot === 'apiCache',
        ),
      ).toBe(false);
    }
    expect(
      setupSlots(ARTICLE_COMMUNITY, CF_PAID, 'vite-spa')
        .find((x) => x.slot === 'apiCache')!
        .options.map((o) => o.id),
    ).toEqual(['none', 'cdn', 'cache-api']);
  });

  it('VPS: 前段の CDN なしでは API のキャッシュを選べず、キャッシュ中は前段の CDN を外せない', () => {
    expect(componentConflict('sakura', 'apiCache', 'cdn', {})).toMatch(
      /前段の CDN が要る/,
    );
    expect(
      componentConflict('sakura', 'apiCache', 'cdn', { frontCdn: 'none' }),
    ).not.toBeNull();
    expect(
      componentConflict('sakura', 'apiCache', 'cdn', { frontCdn: 'static' }),
    ).toBeNull();
    expect(
      componentConflict('sakura', 'frontCdn', 'none', { apiCache: 'cdn' }),
    ).not.toBeNull();
    expect(componentConflict('cloudflare', 'apiCache', 'cdn', {})).toBeNull();
  });

  it('VPS: 依存の崩れた選択は API のキャッシュの方を外し、選び直すまで始められない', () => {
    const broken = {
      frontCdn: 'none',
      apiCache: 'cdn',
      images: 'default',
      ogp: 'none',
    };
    const fixed = validSetupChoices(
      ARTICLE_COMMUNITY,
      VPS_2GB,
      'vite-spa',
      broken,
    );
    expect(fixed).toEqual({ frontCdn: 'none', images: 'default', ogp: 'none' });
    expect(setupProblem(ARTICLE_COMMUNITY, VPS_2GB, 'vite-spa', fixed)).toMatch(
      /API の応答のキャッシュ/,
    );
    const ok = {
      ...fixed,
      frontCdn: 'static',
      apiCache: 'cdn',
      dbBackup: 'default',
      email: 'default',
    };
    expect(
      validSetupChoices(ARTICLE_COMMUNITY, VPS_2GB, 'vite-spa', ok),
    ).toEqual(ok);
    expect(setupProblem(ARTICLE_COMMUNITY, VPS_2GB, 'vite-spa', ok)).toBeNull();
    // 始めるとキャッシュが効く構成で始まる
    expect(
      newGame(VPS_2GB, 42, ARTICLE_COMMUNITY, undefined, 'vite-spa', ok)
        .components,
    ).toMatchObject({ frontCdn: 'static', apiCache: 'cdn' });
  });
});

describe('初期の部品', () => {
  const chosen = { isrCache: 'workers-cache', images: 'r2-variants', db: 'kv' };

  it('newGame に渡した部品で始まり、選べないものは捨てて既定にする', () => {
    const st = newGame(CF_PAID, 42, ARTICLE_COMMUNITY, undefined, 'nextjs', {
      ...chosen,
      frontCdn: 'html',
    });
    expect(st.components).toEqual({
      ...chosen,
      realtime: 'none',
      dbBackup: 'default',
      email: 'default',
      api: 'same',
    });
    expect(newGame(CF_PAID, 42).components).toEqual({
      isrCache: 'kv',
      images: 'images',
      db: 'd1',
      realtime: 'none',
      dbBackup: 'default',
      email: 'default',
      api: 'same',
    });
  });

  it('保存の再生で同じになる。部品の無い古い保存は今の既定で読む', () => {
    const save = withTurn(
      newSave({
        scenarioId: ARTICLE_COMMUNITY.id,
        stackIndex: CF_PAID,
        framework: 'nextjs',
        seed: 42,
        startDate: '2026-10-31',
        components: chosen,
      }),
      [],
    );
    const parsed = parseSave(JSON.parse(JSON.stringify(save)))!;
    expect(parsed.components).toEqual(chosen);
    const st = replaySave(parsed);
    expect(st.components).toMatchObject(chosen);
    expect(st.history[0]!.components).toMatchObject(chosen);

    const { components: _, ...old } = save;
    const oldState = replaySave(parseSave(JSON.parse(JSON.stringify(old)))!);
    expect(oldState.components.db).toBe('d1');
    // 形の壊れた部品は読まない
    expect(parseSave({ ...save, components: { db: 1 } })).toBeNull();
  });
});
