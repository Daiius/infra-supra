// 棋譜解析のシナリオ（prd/17 PR-10・D-241）: 登録と開発中の印・出来事が起きる時期と受けたときの効果・決定論・保存と再生・
// 仮の値での基準プレイ（golden）。遊びの値は仮（PR-11 で決める）なので、golden はこの段の振る舞いの記録。
import { describe, expect, it } from 'vitest';
import { type Choices, REALTIME_OPTION } from 'catalog';
import {
  applyActions,
  DEFAULT_START_DATE,
  isPreviewScenario,
  listedScenarios,
  newGame,
  newSave,
  parseSave,
  playMonth,
  playStrategy,
  replaySave,
  rollSchedule,
  SCENARIOS,
  STACKS,
  withTurn,
  type Action,
  type FrameworkId,
  type GameState,
  type SaveData,
} from './index.ts';
import { KIFU_BACKGROUND_JOBS } from './scenarios/kifu-analysis.ts';

const K = SCENARIOS['kifu-analysis']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VISIBLE = STACKS.filter(
  (s) => s.provider !== 'netlify' && s.provider !== 'aws-opennext',
);
/**
 * 研究会の提案（4〜9 か月目）まで遊べる構成。無料のプラン（Workers Free は解析の CPU の上限で止まり続ける・Vercel Hobby は商用の規約）と、
 * 仮の値では所持金が先に尽きる Amplify は、提案の前に終わる。
 */
const PLAYABLE = VISIBLE.filter(
  (s) =>
    s.id !== 'cloudflare-vinext-free' &&
    s.id !== 'vercel-supabase-hobby' &&
    s.id !== 'aws-amplify',
);

/** その出来事が起きるシード（1 から順に探す）と月。 */
function seedFor(id: string): { seed: number; month: number } {
  for (let seed = 1; seed <= 500; seed++) {
    const x = rollSchedule(K, seed).find((e) => e.id === id);
    if (x) return { seed, month: x.month };
  }
  throw new Error(`起きるシードが無い: ${id}`);
}

/** 提案が届いた月の終わりまで遊ぶ（ほかの提案は断る）。 */
function untilProposal(
  id: string,
  stackIndex: number,
  opts: { framework?: FrameworkId; components?: Choices } = {},
): GameState {
  const { seed, month } = seedFor(id);
  let s = playMonth(
    newGame(
      stackIndex,
      seed,
      K,
      DEFAULT_START_DATE,
      opts.framework,
      opts.components,
    ),
  );
  while (s.history.length < month && s.phase === 'playing') s = playMonth(s);
  expect(s.pendingProposals, id).toContain(id);
  return s;
}

const answer = (s: GameState, id: string, accept: boolean): GameState =>
  applyActions(s, [{ type: 'respond', eventId: id, accept }]);

describe('登録と開発中の印', () => {
  it('SCENARIOS に登録され、開発中の印が付く（?preview=1 のときだけ並ぶ）', () => {
    expect(K.preview).toBe(true);
    expect(isPreviewScenario(K.id)).toBe(true);
    expect(listedScenarios(false).map((s) => s.id)).not.toContain(K.id);
    expect(listedScenarios(true).map((s) => s.id)).toContain(K.id);
  });

  it('始める画面の出来事の説明は、台本・提案のすべてに触れる', () => {
    const about = new Set(K.text!.events.flatMap((l) => l.about));
    for (const e of K.events)
      if (e.kind !== 'state') expect(about.has(e.id), e.id).toBe(true);
  });

  it('Bot と完了のメールの出来事は入れない（prd/17 §6.2）', () => {
    expect(K.events.some((e) => e.id.includes('bot'))).toBe(false);
    expect(K.hidden?.blockBots).toBe(true);
    expect(K.template(30_000).email).toBeUndefined();
  });
});

describe('出来事の時期', () => {
  it('1〜2 か月目は台本・提案も予告も出さない（D-20 V-12）', () => {
    for (let seed = 1; seed <= 300; seed++)
      for (const x of rollSchedule(K, seed)) {
        expect(x.month).toBeGreaterThanOrEqual(3);
        if (x.noticeMonth !== undefined)
          expect(x.noticeMonth).toBeGreaterThanOrEqual(3);
      }
  });

  it('大きな対局イベントは毎回 5〜10 か月目に起き、前の月に予告が出る', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const x = rollSchedule(K, seed).find((e) => e.id === 'k-tournament')!;
      expect(x.month).toBeGreaterThanOrEqual(5);
      expect(x.month).toBeLessThanOrEqual(10);
      expect(x.noticeMonth).toBe(x.month - 1);
    }
  });

  it('大きな対局イベントの月は閲覧と解析が増え、費用が上がる（一部の利用者が残る）', () => {
    const { seed, month } = seedFor('k-tournament');
    let s = playMonth(newGame(idx('cloudflare-vinext-paid'), seed, K));
    while (s.history.length < month && s.phase === 'playing') s = playMonth(s);
    const h = s.history;
    expect(h[month - 2]!.events.map((e) => `${e.id}:${e.phase}`)).toContain(
      'k-tournament:notice',
    );
    expect(h[month - 1]!.events.map((e) => `${e.id}:${e.phase}`)).toContain(
      'k-tournament:occurred',
    );
    expect(h[month - 1]!.infraCost).toBeGreaterThan(
      h[month - 2]!.infraCost * 1.5,
    );
  });
});

describe('提案を受けたときの効果', () => {
  it('過去の棋譜の取り込み: 翌月だけ解析と DB の増え方が 3 倍（端末の置き場はサーバーの解析が増えない）', () => {
    const run = (analysis: string, accept: boolean) => {
      const s = untilProposal('k-p-import', idx('cloudflare-vinext-paid'), {
        components: { analysis },
      });
      const before = s.stock.dbGB;
      const next = playMonth(answer(s, 'k-p-import', accept));
      const after = playMonth(next);
      return {
        grew: next.stock.dbGB - before,
        cost: next.history[next.history.length - 1]!,
        bursts: next.analysisBursts,
        later: after.analysisBursts,
      };
    };
    const on = run('same', true);
    const off = run('same', false);
    expect(on.grew / off.grew).toBeGreaterThan(2.5);
    expect(on.cost.infraCost).toBeGreaterThan(off.cost.infraCost * 1.5);
    expect(on.cost.notes.join('\n')).toContain('過去の棋譜の取り込み');
    // 上乗せは 1 か月で外れる（受けていないゲームは持たない）
    expect(on.bursts).toBeUndefined();
    expect(on.later).toBeUndefined();
    expect(off.bursts).toBeUndefined();
    // 端末の置き場: 在庫は増えるが、サーバーの解析（費用）は増えない
    const cOn = run('client', true);
    const cOff = run('client', false);
    expect(cOn.grew / cOff.grew).toBeGreaterThan(2.5);
    expect(cOn.cost.infraCost).toBeCloseTo(cOff.cost.infraCost, 1);
    expect(cOn.cost.notes.join('\n')).toContain('サーバーの解析は増えません');
  });

  it('画像付きのカードで共有: 成長の上乗せは、カードが出ない構成（SPA で前処理なし）では半分', () => {
    const bonus = (framework: FrameworkId, components?: Choices) => {
      const s = untilProposal('k-p-share-ogp', idx('cloudflare-vinext-paid'), {
        framework,
        ...(components ? { components } : {}),
      });
      return answer(s, 'k-p-share-ogp', true).growthBonus.at(-1)!.add;
    };
    expect(bonus('nextjs')).toBeCloseTo(0.03, 9);
    expect(bonus('vite-spa')).toBeCloseTo(0.015, 9);
    expect(bonus('vite-spa', { ogp: 'prerender' })).toBeCloseTo(0.03, 9);
  });

  it.each(PLAYABLE.map((s) => [s.id]))(
    '研究会（%s）: 提案にセッションの保ち方を出し、受けるとその構成のリアルタイムの部品が付く',
    (id) => {
      const s = untilProposal('k-p-study', idx(id));
      const ev = s.history
        .at(-1)!
        .events.find((e) => e.id === 'k-p-study' && e.phase === 'proposal')!;
      expect(ev.session?.length, id).toBeGreaterThan(0);
      const platform = STACKS[idx(id)]!.provider;
      const keeps = platform === 'cloudflare' || platform === 'sakura';
      expect(ev.session![0]).toContain(
        keeps ? 'セッションを保てます' : 'セッションを保てません',
      );
      // 効果の説明はその構成の部品の名前（Cloudflare の部品の名前を出さない。D-241）
      if (platform !== 'cloudflare')
        expect(ev.accept!.effects.join('・')).not.toContain('Durable Objects');
      const t = answer(s, 'k-p-study', true);
      expect(t.components.realtime).toBe(REALTIME_OPTION[platform]);
      expect(t.mods.realtime).toBeDefined();
      expect(playMonth(t).phase).not.toBe('lost');
    },
  );

  it('研究会: リアルタイムの手段の無い構成（隠した構成）では受けられない知らせになる', () => {
    const { seed, month } = seedFor('k-p-study');
    let s = playMonth(newGame(idx('netlify-supabase-pro'), seed, K));
    while (s.history.length < month && s.phase === 'playing') s = playMonth(s);
    if (s.phase !== 'playing') return;
    const ev = s.history.at(-1)!.events.find((e) => e.id === 'k-p-study')!;
    expect(ev.unavailable).toContain('構成の変更が要ります');
    expect(s.pendingProposals).not.toContain('k-p-study');
  });

  it('裏の長い処理: 受けると翌月から進み、VPS は追加の費用なしで進む', () => {
    for (const id of ['k-p-strategy', 'k-p-problems'] as const) {
      const s = untilProposal(id, idx('sakura-vps-2gb'));
      const t = answer(s, id, true);
      const job =
        id === 'k-p-strategy'
          ? KIFU_BACKGROUND_JOBS.strategy
          : KIFU_BACKGROUND_JOBS.problems;
      expect(t.backgroundJobs?.map((j) => j.label)).toContain(job.label);
      const n = playMonth(t);
      const run = n.history
        .at(-1)!
        .backgroundJobs!.find((r) => r.label === job.label)!;
      expect(run.where).toBe('vps');
      expect(run.ran).toBeGreaterThan(0);
      expect(run.usd).toBe(0);
    }
  });
});

describe('決定論と保存', () => {
  /** 提案を全部受ける形で 12 か月遊び、行動の列を保存に積む。 */
  function playAccepting(stackIndex: number, seed: number) {
    let s = playMonth(newGame(stackIndex, seed, K));
    let save: SaveData = newSave({
      scenarioId: K.id,
      stackIndex,
      seed,
      startDate: DEFAULT_START_DATE,
      // 始める画面と同じく、始めたときの再検証を保存に入れる（省略は古い保存の既定で読む）
      revalidateSec: s.settings.revalidateSec,
    });
    while (s.phase === 'playing') {
      const t: Action[] = s.pendingProposals.map((eventId) => ({
        type: 'respond',
        eventId,
        accept: true,
      }));
      s = playMonth(applyActions(s, t));
      save = withTurn(save, t);
    }
    return { s, save };
  }

  it('同じシード・同じ行動は同じ結果になり、保存から再生しても同じ（JSON を通しても）', () => {
    for (const id of ['cloudflare-vinext-paid', 'sakura-vps-2gb']) {
      const a = playAccepting(idx(id), 3);
      const b = playAccepting(idx(id), 3);
      expect(b.s).toEqual(a.s);
      expect(replaySave(a.save)).toEqual(a.s);
      const parsed = parseSave(JSON.parse(JSON.stringify(a.save)));
      expect(replaySave(parsed!)).toEqual(a.s);
    }
  });
});

describe('仮の値で遊べる（D-241。値は PR-11 で決める）', () => {
  it('見えている構成は、何もしなくても 1 か月目で所持金が尽きない', () => {
    for (const st of VISIBLE) {
      const s = playMonth(newGame(st.index, 1, K));
      expect(s.cash, st.id).toBeGreaterThan(0);
    }
  });

  it('基準プレイ（仮の golden。シード 1・3）', () => {
    const r = (seed: number) =>
      Object.fromEntries(
        K.baselines.map((b) => {
          const s = playStrategy(b, seed, K, DEFAULT_START_DATE);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect({ 1: r(1), 3: r(3) }).toMatchSnapshot();
  });
});
