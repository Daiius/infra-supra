// 公開の口の DB を規則で一括に開く（D-114 段 2d・prd/14 §3.15）: さくらの VPS・Google Cloud・AWS（Amplify）の DB のスロットに
// 他の事業者の DB（Neon・Supabase・AWS）が出て、ゲーム中に差し替えられ、アカウントは今の数え方（D-52）で増える。
// 基準プレイ（何もしない・シード 1〜20）の達成数は prd/14 §3.15 に記録した。
import { describe, expect, it } from 'vitest';
import { meetsReference } from './reference.test-helpers.ts';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  newGame,
  newSave,
  playMonth,
  replaySave,
  SCENARIOS,
  setupSlots,
  STACKS,
  withTurn,
  type FrameworkId,
} from './index.ts';
import type { Choices } from 'catalog';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VPS_2GB = idx('sakura-vps-2gb');
const GCP = idx('gcp-cloud-run');
const AMPLIFY = idx('aws-amplify');
const article = ARTICLE_COMMUNITY;
const contract = SCENARIOS['contract-operations']!;

function won(sc: Scenario, stack: number, fw: FrameworkId, c: Choices) {
  let n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let s = playMonth(newGame(stack, seed, sc, DEFAULT_START_DATE, fw, c));
    while (s.phase === 'playing') s = playMonth(s);
    if (meetsReference(s)) n++;
  }
  return n;
}

describe('公開の口の DB（D-114 段 2d）', () => {
  it('始める画面: さくらの VPS に DB のスロットが出て、既定は VPS の MySQL', () => {
    const db = setupSlots(article, VPS_2GB, 'nextjs').find(
      (x) => x.slot === 'db',
    )!;
    expect(db.options.map((o) => o.id)).toEqual([
      'mysql',
      'neon',
      'supabase',
      'dynamodb',
      'aurora',
      'aurora-pause',
      'rds',
    ]);
    expect(
      newGame(VPS_2GB, 1, article, DEFAULT_START_DATE, 'nextjs').components.db,
    ).toBe('mysql');
    // Astro の API を Workers に置くと DB のスロットは出ない（D-65・D-69）
    expect(
      setupSlots(article, VPS_2GB, 'astro', { api: 'cf-workers-astro' }).some(
        (x) => x.slot === 'db',
      ),
    ).toBe(false);
  });

  it('アカウント: Neon・Supabase は 1 つ増え、AWS の DB は既定のメールの送信（SES）の AWS と同じなので増えない', () => {
    expect(addedAccounts(VPS_2GB, { db: 'neon' })).toEqual(['neon']);
    expect(addedAccounts(AMPLIFY, { db: 'supabase' })).toEqual(['supabase']);
    expect(addedAccounts(GCP, { db: 'dynamodb' })).toEqual([]);
    expect(addedAccounts(VPS_2GB, { db: 'rds' })).toEqual([]);
    // メールを Resend にすると、AWS は DB のために残る（既定の構成に AWS があるので、増えた数には入らない）
    expect(
      addedAccounts(GCP, { db: 'dynamodb', email: 'resend-free' }),
    ).toEqual(['resend']);
  });

  it('ゲーム中に VPS の MySQL から Neon へ差し替えられ、保存から同じ結果で再生できる', () => {
    let s = playMonth(
      newGame(VPS_2GB, 1, contract, DEFAULT_START_DATE, 'nextjs'),
    );
    const action = { type: 'component', slot: 'db', option: 'neon' } as const;
    s = playMonth(applyActions(s, [action]));
    for (let i = 0; i < 6 && s.components.db !== 'neon'; i++)
      s = playMonth(applyActions(s, []));
    expect(s.components.db).toBe('neon');
    const last = s.history[s.history.length - 1]!;
    expect(last.lines.some((l) => l.provider === 'neon')).toBe(true);
    let save = withTurn(
      newSave({
        scenarioId: contract.id,
        stackIndex: VPS_2GB,
        framework: 'nextjs',
        seed: 1,
        startDate: DEFAULT_START_DATE,
        components: {},
      }),
      [action],
    );
    for (let t = 2; t < s.history.length; t++) save = withTurn(save, []);
    expect(replaySave(save)).toEqual(s);
  });
});

describe('基準プレイ（何もしない・シード 1〜20。prd/14 §3.15）', () => {
  it('受託 × Google Cloud: DynamoDB は Firestore と同じく全シードで届く（月の費用は Firestore より安い）', () => {
    expect(won(contract, GCP, 'nextjs', { db: 'dynamodb' })).toBe(20);
    // 転送を圧縮後の大きさにして（D-211）6 → 17
    expect(won(contract, GCP, 'nextjs', { db: 'supabase' })).toBe(17);
    expect(won(contract, GCP, 'nextjs', { db: 'aurora-pause' })).toBe(0);
  });

  it('記事 × さくらの VPS 2GB × Astro: 外の DB は MySQL（17）と同じくらい。Aurora は届かない', () => {
    expect(won(article, VPS_2GB, 'astro', { db: 'mysql' })).toBe(17);
    // 転送を圧縮後の大きさにして（D-211）16 → 17
    expect(won(article, VPS_2GB, 'astro', { db: 'neon' })).toBe(17);
    expect(won(article, VPS_2GB, 'astro', { db: 'aurora' })).toBe(0);
  });

  it('受託 × Amplify の SPA: Neon は全シードで届き、Supabase は 2 シード', () => {
    expect(won(contract, AMPLIFY, 'vite-spa', { db: 'neon' })).toBe(20);
    expect(won(contract, AMPLIFY, 'vite-spa', { db: 'supabase' })).toBe(2);
  });
});
