// 前回の構成（D-127）。ゲームの始める画面で「運営を始める」を押したときの選択を、シナリオごとに 1 つ覚えて戻す。
// ここは純粋な部分だけ（形の確かめ・保存する中身・戻すときの整合・同じかの判定）。localStorage の読み書きは App.tsx。
// 形はゲームのセーブ（game の save.ts）の始めたときの選択にそろえるが、構成は並びが変わっても壊れないよう index でなく id で持つ。
// 乱数のシードと始めた日は戻さない（構成ではなく、始めた日は既定が今日）。
import {
  COMPONENTS,
  ROUTE_STRATEGIES,
  SLOT_LABELS,
  slotLabel,
  strategyTitle,
  type SlotId,
} from 'catalog';
import {
  COMMENTS_IN_BROWSER,
  FRAMEWORKS,
  STACKS,
  defaultRevalidateSec,
  frameworkOnStack,
  frameworksOf,
  setupCommentOptions,
  setupCommitments,
  setupProblem,
  setupRevalidateOptions,
  stackName,
  validRouteOverrides,
  validSetupChoices,
  type CommitmentPaymentId,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
} from 'game';
import type { SetupChoices } from './setup-components.tsx';

/** localStorage のキー（値は LastSetupStore の JSON）。 */
export const LAST_SETUP_KEY = 'infra-supra:last-setup';

/** 保存の版。形を変えたら上げる（読めない版は捨てて、ボタンを出さない）。 */
export const LAST_SETUP_VERSION = 1;

/** 1 つのシナリオの前回の選択。 */
export type LastSetup = {
  /** 構成（STACKS の id）。 */
  stackId: string;
  framework: string;
  /** 部品（スロット → 部品の id）。 */
  components: Partial<Record<string, string>>;
  /** 選んだ再検証の間隔（秒。オンデマンドは 0）。選ばずに既定のままなら無い（戻すと部品で既定が決まる。D-125）。 */
  revalidateSec?: number;
  /** 記事のページのコメント欄（選べたときだけ）。 */
  comments?: number;
  /** 選んだページごとの描き方（ルートの id → 描き方の id）。 */
  routes?: Partial<Record<string, string>>;
  /** 始めから結んだ確約。 */
  commitments?: { key: string; payment: CommitmentPaymentId }[];
};

export type LastSetupStore = {
  version: typeof LAST_SETUP_VERSION;
  /** シナリオの id → 前回の選択。 */
  scenarios: Partial<Record<string, LastSetup>>;
};

/** 始める画面の今の選択（Briefing の状態そのまま）。 */
export type SetupState = {
  stack: number;
  framework: FrameworkId;
  components: SetupChoices;
  routes: RouteOverrides;
  /** 選んだ再検証の間隔（選んでいなければ undefined）。 */
  revalidateSec: number | undefined;
  comments: number;
  commitments: Record<string, CommitmentPaymentId>;
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const stringRecord = (v: unknown): v is Record<string, string> =>
  isObject(v) && Object.values(v).every((x) => typeof x === 'string');

/** 1 つの前回の選択の形を確かめる（読めなければ null）。中身が今のデータで選べるかは戻すときに見る。 */
function parseEntry(raw: unknown): LastSetup | null {
  if (!isObject(raw)) return null;
  const { stackId, framework, components, revalidateSec, comments } = raw;
  const { routes, commitments } = raw;
  if (typeof stackId !== 'string' || typeof framework !== 'string') return null;
  if (!stringRecord(components)) return null;
  if (revalidateSec !== undefined && !isNum(revalidateSec)) return null;
  if (comments !== undefined && !isNum(comments)) return null;
  if (routes !== undefined && !stringRecord(routes)) return null;
  if (
    commitments !== undefined &&
    !(
      Array.isArray(commitments) &&
      commitments.every(
        (c) =>
          isObject(c) &&
          typeof c.key === 'string' &&
          (c.payment === 'no-upfront' || c.payment === 'all-upfront'),
      )
    )
  )
    return null;
  return {
    stackId,
    framework,
    components: { ...components },
    ...(revalidateSec !== undefined ? { revalidateSec } : {}),
    ...(comments !== undefined ? { comments } : {}),
    ...(routes !== undefined ? { routes: { ...routes } } : {}),
    ...(commitments !== undefined
      ? {
          commitments: (commitments as LastSetup['commitments'])!.map((c) => ({
            key: c.key,
            payment: c.payment,
          })),
        }
      : {}),
  };
}

/** 保存の形を確かめる。版が違う・形が壊れていれば空（ボタンを出さない）。壊れたシナリオの分だけを捨てる。 */
export function parseLastSetups(raw: unknown): LastSetupStore {
  const empty: LastSetupStore = { version: LAST_SETUP_VERSION, scenarios: {} };
  if (
    !isObject(raw) ||
    raw.version !== LAST_SETUP_VERSION ||
    !isObject(raw.scenarios)
  )
    return empty;
  const scenarios: LastSetupStore['scenarios'] = {};
  for (const [id, v] of Object.entries(raw.scenarios)) {
    const e = parseEntry(v);
    if (e) scenarios[id] = e;
  }
  return { version: LAST_SETUP_VERSION, scenarios };
}

/** そのシナリオの前回を差し替えた保存。 */
export function withLastSetup(
  store: LastSetupStore,
  scenarioId: string,
  entry: LastSetup,
): LastSetupStore {
  return {
    version: LAST_SETUP_VERSION,
    scenarios: { ...store.scenarios, [scenarioId]: entry },
  };
}

/** 今の選択で効く再検証の間隔（選んだ値が選べればそれ、ほかは既定。Briefing と同じ規則）。選べなければ undefined。 */
function effectiveRevalidate(sc: Scenario, s: SetupState): number | undefined {
  const options = setupRevalidateOptions(sc, s.framework, s.routes);
  if (options.length === 0) return undefined;
  return s.revalidateSec !== undefined &&
    options.some((o) => o.value === s.revalidateSec)
    ? s.revalidateSec
    : defaultRevalidateSec(s.framework, s.stack, sc, s.routes, s.components);
}

/** 今の選択で効く確約（選べるものだけ。Briefing の chosenCommits と同じ）。 */
function effectiveCommitments(
  sc: Scenario,
  s: SetupState,
): { key: string; payment: CommitmentPaymentId }[] {
  if (setupProblem(sc, s.stack, s.framework, s.components)) return [];
  return setupCommitments(sc, s.stack, s.framework, s.components)
    .filter((o) => s.commitments[o.key] === o.payment)
    .map((o) => ({ key: o.key, payment: o.payment }));
}

/** 「運営を始める」を押したときの選択から、保存する中身を作る。 */
export function lastSetupOf(sc: Scenario, s: SetupState): LastSetup {
  const revalidateOk =
    s.revalidateSec !== undefined &&
    setupRevalidateOptions(sc, s.framework, s.routes).some(
      (o) => o.value === s.revalidateSec,
    );
  const commentsOk = setupCommentOptions(sc, s.framework, s.routes).length > 0;
  const commitments = effectiveCommitments(sc, s);
  return {
    stackId: STACKS[s.stack]!.id,
    framework: s.framework,
    components: { ...s.components },
    ...(revalidateOk ? { revalidateSec: s.revalidateSec! } : {}),
    ...(commentsOk ? { comments: s.comments } : {}),
    ...(Object.keys(s.routes).length ? { routes: { ...s.routes } } : {}),
    ...(commitments.length ? { commitments } : {}),
  };
}

/** 前回の選択を戻した結果。notice は戻せなかったものの知らせ（全部戻せれば null）。 */
export type RestoredSetup = SetupState & { notice: string | null };

const optionLabel = (slot: string, id: string) =>
  COMPONENTS.find((o) => o.slot === slot && o.id === id)?.label ?? id;
const frameworkLabel = (id: string) =>
  id in FRAMEWORKS ? FRAMEWORKS[id as FrameworkId].label : id;

/** 前回の構成の index（今は無い・隠した構成なら undefined）。 */
const offeredStack = (id: string): number | undefined => {
  const s = STACKS.find((x) => x.id === id);
  return s && !s.hidden ? s.index : undefined;
};

/**
 * 前回の選択を、今のデータで選べるものだけ戻す。順は始める画面と同じ: 構成 → フレームワーク（構成に載せられるもの）→ 部品
 * （validSetupChoices で依存の崩れたものも外す）→ ページごとの描き方 → 描き方の設定 → 確約。選べないものは捨てて未選択にする
 * （構成とフレームワークは未選択にできないので、構成は今のまま・フレームワークは載せられるものにする）。
 */
export function restoreLastSetup(
  sc: Scenario,
  last: LastSetup,
  current: Pick<SetupState, 'stack'>,
): RestoredSetup {
  const lost: string[] = [];
  const notes: string[] = [];
  const savedStack = offeredStack(last.stackId);
  const stack = savedStack ?? current.stack;
  if (savedStack === undefined) lost.push(`構成（${lastStackName(last)}）`);
  const fws = frameworksOf(sc);
  const want = fws.allowed.includes(last.framework as FrameworkId)
    ? (last.framework as FrameworkId)
    : fws.default;
  const framework = frameworkOnStack(sc, stack, want);
  // 前回の選択の名前は前回のフレームワークでの呼び名（D-193）。今は無いフレームワークなら一般の言葉
  const lastFramework =
    last.framework in FRAMEWORKS ? (last.framework as FrameworkId) : undefined;
  if (framework !== last.framework)
    notes.push(
      `前回のフレームワーク（${frameworkLabel(last.framework)}）は今は選べないので ${FRAMEWORKS[framework].label} にしました。`,
    );
  const saved = Object.fromEntries(
    Object.entries(last.components).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );
  const components = validSetupChoices(sc, stack, framework, saved);
  for (const [slot, id] of Object.entries(saved))
    if (components[slot as SlotId] !== id)
      lost.push(
        `${slot in SLOT_LABELS ? slotLabel(slot as SlotId, lastFramework) : slot}（${optionLabel(slot, id)}）`,
      );
  const wantRoutes = Object.fromEntries(
    Object.entries(last.routes ?? {}).filter(
      (e): e is [string, keyof typeof ROUTE_STRATEGIES] =>
        e[1] !== undefined && e[1] in ROUTE_STRATEGIES,
    ),
  );
  const routes = validRouteOverrides(sc, stack, framework, wantRoutes);
  const routeLabels = sc.template(1).routes;
  for (const [route, id] of Object.entries(last.routes ?? {}))
    if (id !== undefined && routes[route] !== id)
      lost.push(
        `${routeLabels.find((r) => r.id === route)?.label ?? route}の描き方（${
          id in ROUTE_STRATEGIES
            ? strategyTitle(id as keyof typeof ROUTE_STRATEGIES, lastFramework)
            : id
        }）`,
      );
  const revalidateOptions = setupRevalidateOptions(sc, framework, routes);
  let revalidateSec: number | undefined;
  if (last.revalidateSec !== undefined && revalidateOptions.length > 0) {
    const o = revalidateOptions.find((x) => x.value === last.revalidateSec);
    if (o) revalidateSec = o.value;
    else lost.push('再検証の間隔');
  }
  const commentOptions = setupCommentOptions(sc, framework, routes);
  let comments = COMMENTS_IN_BROWSER;
  if (last.comments !== undefined && commentOptions.length > 0) {
    if (commentOptions.some((o) => o.value === last.comments))
      comments = last.comments;
    else lost.push('コメント欄の描き方');
  }
  const commitments: SetupState['commitments'] = {};
  for (const c of last.commitments ?? []) commitments[c.key] = c.payment;
  // 部品を選び終えていれば、今は結べない確約を知らせる（選び残しがあるうちは結べる確約が決まらないので、残して選び終えたときに効かせる）
  if (!setupProblem(sc, stack, framework, components)) {
    const offers = setupCommitments(sc, stack, framework, components);
    for (const c of last.commitments ?? [])
      if (!offers.some((o) => o.key === c.key && o.payment === c.payment)) {
        delete commitments[c.key];
        lost.push('1 年契約');
      }
  }
  const unique = [...new Set(lost)];
  if (unique.length)
    notes.unshift(
      // 英字で始まる名前（DB など）の前は空ける
      `前回の${/^[\x21-\x7e]/.test(unique[0]!) ? ' ' : ''}${unique.join('・')}は今は選べないので選び直してください。`,
    );
  return {
    stack,
    framework,
    components,
    routes,
    revalidateSec,
    comments,
    commitments,
    notice: notes.length ? notes.join('') : null,
  };
}

/** 前回の構成の名前（ボタンに出す。今は無い構成なら id）。 */
function lastStackName(last: LastSetup): string {
  const s = STACKS.find((x) => x.id === last.stackId);
  if (!s) return last.stackId;
  const fw = (
    last.framework in FRAMEWORKS ? last.framework : 'nextjs'
  ) as FrameworkId;
  return stackName(s.index, fw, false, last.components);
}

/** ボタンに添える前回の構成とフレームワーク（「Cloudflare Paid + vinext・Next.js（App Router）」）。 */
export function lastSetupLabel(last: LastSetup): string {
  return `${lastStackName(last)}・${frameworkLabel(last.framework)}`;
}

/** 選択の比べる形（効く値だけ。並びに依らない）。 */
function setupKey(sc: Scenario, s: SetupState): string {
  const sorted = (r: Partial<Record<string, unknown>>) =>
    Object.entries(r)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    s.stack,
    s.framework,
    sorted(s.components),
    sorted(s.routes),
    effectiveRevalidate(sc, s) ?? null,
    setupCommentOptions(sc, s.framework, s.routes).length > 0
      ? s.comments
      : null,
    effectiveCommitments(sc, s)
      .map((c) => `${c.key}:${c.payment}`)
      .sort(),
  ]);
}

/** 今の選択が、前回を戻したときと同じか（同じならボタンを押せなくする）。 */
export function sameAsRestored(
  sc: Scenario,
  current: SetupState,
  restored: SetupState,
): boolean {
  return setupKey(sc, current) === setupKey(sc, restored);
}
