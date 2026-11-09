// ゲームの途中の「構成を変える」（D-185）: 選び直した差を今ある行動に写し取る。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyActions,
  checkActions,
  COMMENTS_IN_PAGE,
  currentSetupDraft,
  draftComponentsFor,
  flattenSetupChange,
  isDataSwap,
  newGame,
  playMonth,
  routePlanOf,
  sameAsCurrent,
  setupChangeOf,
  setupChangeSummary,
  setupSlots,
  STACKS,
  type GameState,
  type SetupDraft,
} from './index.ts';
import type { SlotId } from 'catalog';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_FREE = idx('cloudflare-vinext-free');
const CF_PAID = idx('cloudflare-vinext-paid');
const VERCEL_PRO = idx('vercel-supabase-pro');
const AWS = STACKS.findIndex((s) => s.provider === 'aws' && !s.hidden);

const start = (stackIndex: number, fw: GameState['framework'] = 'nextjs') =>
  playMonth(newGame(stackIndex, 1, ARTICLE_COMMUNITY, undefined, fw));

const kinds = (s: GameState, d: SetupDraft) =>
  setupChangeOf(s, d).items.map((x) => x.kind);

describe('構成を変える（D-185）', () => {
  it('開いたときは今の状態で、変更も行動も無い', () => {
    const s = start(CF_PAID);
    const d = currentSetupDraft(s);
    expect(d.stackIndex).toBe(CF_PAID);
    expect(d.framework).toBe('nextjs');
    expect(sameAsCurrent(s, d)).toBe(true);
    const c = setupChangeOf(s, d);
    expect(c.items).toEqual([]);
    expect(flattenSetupChange(c.groups)).toEqual([]);
    expect(c.why).toBeNull();
  });

  it('同じ事業者のプランは plan、別の事業者は migrate。文と手間は今までの行動の文', () => {
    const s = start(CF_FREE);
    const plan = setupChangeOf(s, {
      ...currentSetupDraft(s),
      stackIndex: CF_PAID,
      components: draftComponentsFor(s, CF_PAID, 'nextjs'),
    });
    expect(plan.groups.stack).toEqual({ type: 'plan', stackIndex: CF_PAID });
    expect(plan.items[0]!.name).toMatch(/にプラン変更$/);
    expect(plan.items[0]!.meta).toContain('来月から');
    expect(plan.why).toBeNull();
    // 前の行動の欄で選んだときと同じ行動・同じ結果
    expect(applyActions(s, flattenSetupChange(plan.groups))).toEqual(
      applyActions(s, [{ type: 'plan', stackIndex: CF_PAID }]),
    );

    const mig = setupChangeOf(s, {
      ...currentSetupDraft(s),
      stackIndex: VERCEL_PRO,
      components: draftComponentsFor(s, VERCEL_PRO, 'nextjs'),
    });
    expect(mig.groups.stack).toEqual({
      type: 'migrate',
      stackIndex: VERCEL_PRO,
    });
    // 部品は乗り換え先の既定から始まるので、部品の行動は無い
    expect(mig.groups.components).toEqual([]);
    expect(mig.items.map((x) => x.kind)).toEqual(['migrate']);
    expect(mig.items[0]!.meta.join('・')).toMatch(/か月/);
    expect(mig.why).toBeNull();
    expect(setupChangeSummary(mig)).toMatch(/へ乗り換える$/);
  });

  it('乗り換え先で部品を選び直すと、写し取らずに理由を出す（乗り換えでは部品は既定から始まる。D-24 X-9）', () => {
    const s = start(CF_PAID);
    const base = draftComponentsFor(s, VERCEL_PRO, 'nextjs');
    const slot = setupSlots(ARTICLE_COMMUNITY, VERCEL_PRO, 'nextjs', base).find(
      (x) =>
        !x.fixed &&
        x.slot !== 'files' &&
        x.options.some((o) => o.id !== base[x.slot as SlotId]),
    )!;
    const other = slot.options.find((o) => o.id !== base[slot.slot as SlotId])!;
    const c = setupChangeOf(s, {
      ...currentSetupDraft(s),
      stackIndex: VERCEL_PRO,
      components: { ...base, [slot.slot]: other.id },
    });
    const item = c.items.find((x) => x.kind === 'component')!;
    expect(item.action).toBeNull();
    expect(item.why).toMatch(/乗り換えが済んでから差し替えられます/);
    expect(c.why).not.toBeNull();
  });

  it('同じ構成で部品を選び直すと component（前の部品の欄と同じ行動）', () => {
    const s = start(CF_PAID);
    const d = currentSetupDraft(s);
    const slots = setupSlots(
      ARTICLE_COMMUNITY,
      CF_PAID,
      'nextjs',
      d.components,
    );
    let found = false;
    for (const x of slots) {
      if (x.fixed || x.slot === 'files' || isDataSwap(x.slot as SlotId))
        continue;
      for (const o of x.options) {
        if (o.id === d.components[x.slot as SlotId]) continue;
        const c = setupChangeOf(s, {
          ...d,
          components: { ...d.components, [x.slot]: o.id },
        });
        if (c.why !== null) continue;
        expect(c.groups.components).toEqual([
          { type: 'component', slot: x.slot, option: o.id },
        ]);
        expect(c.items[0]!.kind).toBe('component');
        expect(c.items[0]!.name).toMatch(/に差し替える$/);
        found = true;
        break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it('フレームワークを替えると rewrite。描き方の選び直しは作り直しと一緒には写し取らない', () => {
    const s = start(CF_PAID);
    const d: SetupDraft = {
      ...currentSetupDraft(s),
      framework: 'astro',
      components: draftComponentsFor(s, CF_PAID, 'astro'),
    };
    const c = setupChangeOf(s, d);
    expect(c.groups.rewrite).toEqual({ type: 'rewrite', framework: 'astro' });
    expect(c.items.map((x) => x.kind)).toEqual(['rewrite']);
    expect(c.items[0]!.name).toBe('Astro に作り直す');
    expect(c.why).toBeNull();
    const withRoute = setupChangeOf(s, {
      ...d,
      routes: { personal: { strategy: 'shell-api' } },
    });
    const route = withRoute.items.find((x) => x.kind === 'route')!;
    expect(route.action).toBeNull();
    expect(route.why).toMatch(/作り直しが済んでから選べます/);
  });

  it('乗り換えと作り直しを一緒に選ぶと、今の行動の検査の理由を作り直しの行に出す', () => {
    const s = start(CF_PAID);
    const c = setupChangeOf(s, {
      ...currentSetupDraft(s),
      stackIndex: VERCEL_PRO,
      framework: 'astro',
      components: draftComponentsFor(s, VERCEL_PRO, 'astro'),
    });
    expect(kinds(s, { ...currentSetupDraft(s) })).toEqual([]);
    const rw = c.items.find((x) => x.kind === 'rewrite')!;
    expect(rw.why).toBe('乗り換えの最中は選べません');
    expect(c.why).toMatch(/乗り換えの最中は選べません/);
  });

  it('載せられないフレームワークへの作り直しは、今の検査の理由（公式のアダプターが無い）', () => {
    if (AWS < 0) return;
    const s = start(AWS);
    const c = setupChangeOf(s, {
      ...currentSetupDraft(s),
      framework: 'astro',
      components: draftComponentsFor(s, AWS, 'astro'),
    });
    expect(c.items.find((x) => x.kind === 'rewrite')!.why).toMatch(
      /公式のアダプターがありません/,
    );
  });

  it('描き方の分け方が違うページは route、コメント欄は route-part（前の行動の欄と同じ並び）', () => {
    const s = start(CF_PAID);
    expect(routePlanOf(s).find((r) => r.route === 'personal')!.strategy).toBe(
      'ssr',
    );
    const c = setupChangeOf(s, {
      ...currentSetupDraft(s),
      routes: { personal: { strategy: 'shell-api' } },
      comments: COMMENTS_IN_PAGE,
    });
    expect(flattenSetupChange(c.groups)).toEqual([
      { type: 'route', route: 'personal', strategy: 'shell-api' },
      {
        type: 'route-part',
        route: 'article',
        part: 'comments',
        value: COMMENTS_IN_PAGE,
      },
    ]);
    expect(c.items.map((x) => x.meta.join('・'))).toEqual([
      '手間 4・来月から',
      '手間 2・来月から',
    ]);
    expect(c.why).toBeNull();
    // 今と同じ分け方を選んだものは写し取らない
    const same = setupChangeOf(s, {
      ...currentSetupDraft(s),
      routes: { personal: { strategy: 'ssr' } },
    });
    expect(same.items).toEqual([]);
  });
  it('依存のある部品は、選べる順に当てる（定額の CDN のプランを従量に戻してから CloudFront を外す。OCL-099AD8D5）', () => {
    const s = playMonth(
      newGame(AWS, 1, ARTICLE_COMMUNITY, undefined, 'nextjs', {
        images: 'cf-images',
        frontCdn: 'static',
        cdnPlan: 'flat-free',
      }),
    );
    const d = currentSetupDraft(s);
    expect(d.components.cdnPlan).toBe('flat-free');
    expect(d.components.images).toBe('cf-images');
    const c = setupChangeOf(s, {
      ...d,
      components: { ...d.components, frontCdn: 'none', cdnPlan: 'payg' },
    });
    // 前段を先に外すと選べない（今の検査）。写し取りでは従量に戻す行動を先にする
    expect(
      checkActions(s, [
        { type: 'component', slot: 'frontCdn', option: 'none' },
        { type: 'component', slot: 'cdnPlan', option: 'payg' },
      ]).ok,
    ).toBe(false);
    expect(c.groups.components).toEqual([
      { type: 'component', slot: 'cdnPlan', option: 'payg' },
      { type: 'component', slot: 'frontCdn', option: 'none' },
    ]);
    expect(c.why).toBeNull();
  });

  it('提案で付いた部品（チャットの Durable Objects）は今の部品として残し、変更に数えない（OCL-80A47F1A）', () => {
    const s0 = start(CF_PAID);
    const s: GameState = {
      ...s0,
      components: { ...s0.components, realtime: 'durable-objects' },
    };
    const d = currentSetupDraft(s);
    expect(d.components.realtime).toBe('durable-objects');
    expect(sameAsCurrent(s, d)).toBe(true);
    expect(setupChangeOf(s, d).items).toEqual([]);
    // 同じ事業者のプランへ替えても持ち越す
    expect(draftComponentsFor(s, CF_FREE, 'nextjs').realtime).toBe(
      'durable-objects',
    );
  });
});
