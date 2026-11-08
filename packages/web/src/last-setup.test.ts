// 前回の構成（D-127）の純粋な部分: 形の確かめ・保存する中身・戻すときの整合・同じかの判定。
import {
  ARTICLE_COMMUNITY,
  COMMENTS_IN_BROWSER,
  STACKS,
  setupWithDefaults,
} from 'game';
import { describe, expect, it } from 'vitest';
import {
  LAST_SETUP_VERSION,
  lastSetupLabel,
  lastSetupOf,
  parseLastSetups,
  restoreLastSetup,
  sameAsRestored,
  withLastSetup,
  type SetupState,
} from './last-setup.ts';

const sc = ARTICLE_COMMUNITY;
const indexOf = (id: string) => STACKS.findIndex((s) => s.id === id);
const PAID = indexOf('cloudflare-vinext-paid');

/** Cloudflare Paid × Next.js で、部品を既定で埋めた選択。 */
const filled = (over: Partial<SetupState> = {}): SetupState => ({
  stack: PAID,
  framework: 'nextjs',
  components: setupWithDefaults(sc, PAID, 'nextjs', {}),
  routes: {},
  revalidateSec: undefined,
  comments: COMMENTS_IN_BROWSER,
  commitments: {},
  ...over,
});

describe('前回の構成の保存の形', () => {
  it('保存した中身を読み戻せる（JSON を通しても同じ）', () => {
    const entry = lastSetupOf(sc, filled());
    expect(entry.stackId).toBe('cloudflare-vinext-paid');
    const store = withLastSetup(parseLastSetups(null), sc.id, entry);
    const back = parseLastSetups(JSON.parse(JSON.stringify(store)));
    expect(back.scenarios[sc.id]).toEqual(entry);
  });

  it('版が違う・形が壊れていれば空。壊れたシナリオの分だけを捨てる', () => {
    const entry = lastSetupOf(sc, filled());
    expect(parseLastSetups(null).scenarios).toEqual({});
    expect(parseLastSetups('壊れた').scenarios).toEqual({});
    expect(
      parseLastSetups({
        version: LAST_SETUP_VERSION + 1,
        scenarios: { a: entry },
      }).scenarios,
    ).toEqual({});
    const mixed = parseLastSetups({
      version: LAST_SETUP_VERSION,
      scenarios: {
        ok: entry,
        noStack: { ...entry, stackId: 3 },
        badParts: { ...entry, components: { db: 1 } },
        badRevalidate: { ...entry, revalidateSec: 'x' },
        badCommit: { ...entry, commitments: [{ key: 'k', payment: 'x' }] },
      },
    });
    expect(Object.keys(mixed.scenarios)).toEqual(['ok']);
  });

  it('ボタンに構成の名前とフレームワークを添える', () => {
    expect(lastSetupLabel(lastSetupOf(sc, filled()))).toBe(
      'Cloudflare Paid + vinext・Next.js（App Router）',
    );
  });

  it('選ばなかった再検証の間隔は書かない（戻すと部品で既定が決まる。D-125）', () => {
    expect(lastSetupOf(sc, filled()).revalidateSec).toBeUndefined();
    expect(lastSetupOf(sc, filled({ revalidateSec: 300 })).revalidateSec).toBe(
      300,
    );
  });
});

describe('前回の構成を戻す', () => {
  it('全部選べれば、そのまま戻り、知らせは無く、今の選択と同じになる', () => {
    const s = filled({ revalidateSec: 300 });
    const r = restoreLastSetup(sc, lastSetupOf(sc, s), { stack: 0 });
    expect(r.notice).toBeNull();
    expect(r.stack).toBe(PAID);
    expect(r.framework).toBe('nextjs');
    expect(r.components).toEqual(s.components);
    expect(r.revalidateSec).toBe(300);
    expect(sameAsRestored(sc, s, r)).toBe(true);
    expect(sameAsRestored(sc, filled({ stack: 0 }), r)).toBe(false);
    expect(sameAsRestored(sc, filled({ revalidateSec: 60 }), r)).toBe(false);
  });

  it('既定のまま始めた部品（値が default）も選んだ状態で戻る（実機で保存された中身）', () => {
    const store = parseLastSetups({
      version: LAST_SETUP_VERSION,
      scenarios: {
        [sc.id]: {
          stackId: 'vercel-supabase-pro',
          framework: 'nextjs',
          components: {
            isrCache: 'default',
            images: 'default',
            api: 'same',
            db: 'supabase',
            cdnPlan: 'flat-rate',
            dbBackup: 'default',
            email: 'default',
          },
          comments: 0,
        },
      },
    });
    const last = store.scenarios[sc.id]!;
    const r = restoreLastSetup(sc, last, { stack: 0 });
    expect(r.notice).toBeNull();
    expect(r.stack).toBe(indexOf('vercel-supabase-pro'));
    expect(r.components).toEqual(last.components);
  });

  it('今は選べない部品は未選択にして知らせる', () => {
    const entry = lastSetupOf(sc, filled());
    const r = restoreLastSetup(
      sc,
      { ...entry, components: { ...entry.components, db: 'もう無い-db' } },
      { stack: 0 },
    );
    expect(r.components.db).toBeUndefined();
    expect(r.components.images).toBe(entry.components.images);
    expect(r.notice).toBe(
      '前回の DB（もう無い-db）は今は選べないので選び直してください。',
    );
  });

  it('隠した構成・無い構成は今の構成のままにして知らせる', () => {
    const hidden = STACKS.find((s) => s.hidden)!;
    const entry = { ...lastSetupOf(sc, filled()), stackId: hidden.id };
    const r = restoreLastSetup(sc, entry, { stack: 0 });
    expect(r.stack).toBe(0);
    expect(r.notice).toMatch(
      /^前回の構成（.+）.*は今は選べないので選び直してください。$/,
    );
    const gone = restoreLastSetup(
      sc,
      { ...entry, stackId: 'no-such-stack' },
      { stack: 2 },
    );
    expect(gone.stack).toBe(2);
    expect(gone.notice).toMatch(/^前回の構成（no-such-stack）/);
  });

  it('今は選べないフレームワークは、構成に載せられるものにして知らせる', () => {
    const entry = { ...lastSetupOf(sc, filled()), framework: 'no-such-fw' };
    const r = restoreLastSetup(sc, entry, { stack: 0 });
    expect(r.framework).toBe('nextjs');
    expect(r.notice).toMatch(
      /前回のフレームワーク（no-such-fw）は今は選べないので Next\.js/,
    );
  });

  it('無い描き方は外して知らせる', () => {
    const entry = {
      ...lastSetupOf(sc, filled()),
      routes: { article: 'no-such-strategy' },
    };
    const r = restoreLastSetup(sc, entry, { stack: 0 });
    expect(r.routes).toEqual({});
    expect(r.notice).toMatch(/の描き方（no-such-strategy）/);
  });
});
