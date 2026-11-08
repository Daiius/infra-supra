// 構成（STACKS）の一覧と、構成・部品について引く値（名前・確約の前の乗り換え・バックアップ・保存の置き場・構成のフレーバー）。
import {
  apiPlacedElsewhere,
  backupStatus,
  browserCallsApi,
  type Choices,
  componentsOf,
  crossDbName,
  composeStack,
  DEFAULT_CHOICES,
  deployTarget,
  type FrameworkId,
  frameworkSupported,
  imagesBehavior,
  MVP_STACKS,
  type Platform,
  type SlotId,
  STACK_DEFS,
  STACK_FLAVOR,
  stackHidden,
  withCrossDbName,
} from 'catalog';
import type { Scenario, Strategy, WorkloadMods } from './scenario.ts';
import type { ArchitectureInput } from 'estimator';
import { EFFORT } from './rules.ts';
import { books, frameworkDefaults, frameworksOf } from './core.ts';
import type { GameState } from './state.ts';

/**
 * データの移行を伴う差し替え（DB・API の置き場）。乗り換えと同じく進行中の状態を持ち、手間を入れ終えた翌月に切り替える
 * （期間中は新旧の両方の費用）。API の置き場は DB も一緒に移す（API と DB は同じ事業者。D-65）。
 */
export const isDataSwap = (slot: SlotId): slot is 'db' | 'api' =>
  slot === 'db' || slot === 'api';

/** 差し替えの進行の名前（画面・通知）。 */
export const swapLabel = (slot: SlotId): string =>
  slot === 'api'
    ? 'API の置き場の移し替え（API と DB のデータの移行）'
    : 'DB の差し替え（データの移行）';

/**
 * 今の選択で効かない（選んでも変わらない）スロット（出さない）。API を他の事業者に置くと、DB はその事業者の部品になるので、
 * 構成の DB のスロットは出さない（D-65）。ISR をキャッシュしない部品では CDN の無効化が起きないので、
 * 無効化のまとめ方も出さない（D-79）。
 * 判定はここ 1 か所に置き、ゲームの部品の欄（componentSlots）・始める画面と見積モード（setupSlots）・月の報告の部品の要約が使う（D-94）。
 */
export function slotIneffective(
  slot: SlotId,
  choices: Choices,
  /** DB のバックアップは今の DB で決まる（D1 のように既定で足りる・延ばせない DB では出さない。D-93）。必須にして渡し忘れを防ぐ（D-94）。 */
  stack: { stackIndex: number; framework: FrameworkId },
): boolean {
  if (slot === 'cdnInvalidation') return choices.isrCache === 'none';
  // Vercel の CDN の料金（Flat Rate / On-demand。D-120）は Pro だけ（Hobby は込み分のまま）
  if (slot === 'cdnPlan' && STACKS[stack.stackIndex]?.provider === 'vercel')
    return STACKS[stack.stackIndex]!.plan !== 'pro';
  if (slot === 'dbBackup')
    return !dbBackupStatus(stack.stackIndex, choices, stack.framework).some(
      (s) => s.extendable,
    );
  return slot === 'db' && apiPlacedElsewhere(choices);
}

/** 構成の DB ごとのバックアップの状態（D-93。catalog の backupStatus）。 */
export function dbBackupStatus(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
) {
  const c = { ...DEFAULT_CHOICES[STACKS[stackIndex]!.provider], ...components };
  return backupStatus(
    composeStack(STACK_DEFS[stackIndex]!, c, { framework }),
    c.dbBackup,
  );
}

/** 自前で取るバックアップ（VPS）を選んでいるか（毎月の維持の手間。D-93）。 */
export function selfBackupOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): boolean {
  return dbBackupStatus(stackIndex, components, framework).some(
    (s) => s.selfManaged,
  );
}

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
  /** 事業者（同じ事業者のあいだはプラン変更。さくらの VPS 2GB ↔ 4GB も含む。D-24）。 */
  provider: STACK_DEFS[i]!.platform as Platform,
  plan: STACK_DEFS[i]!.plan,
  selfHosted: s.nodes.some((n) => n.config.kind === 'host'),
  /** 自分で組む構成（OpenNext など。維持の手間がかかる。D-63）。 */
  assembled: STACK_DEFS[i]!.assembled ?? false,
  /** コンテナで動かすマネージドの構成（Cloud Run。維持の手間が少しかかる。D-88）。 */
  containerized: STACK_DEFS[i]!.containerized ?? false,
  /** 一時的に隠している構成（catalog の HIDDEN_PLATFORMS。選ぶ場所に出さない。計算はそのまま。D-100）。 */
  hidden: stackHidden(STACK_DEFS[i]!),
  /** ホストのディスク（VPS だけ。下位のプランへ変更できるかの判定に使う）。 */
  diskGB: s.nodes.reduce(
    (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
    0,
  ),
}));

/**
 * その構成にフレームワークを載せられるか（catalog の DeployTarget が unsupported でない。Astro は AWS に公式のアダプターが無い。D-68）。
 * 始める画面の構成の一覧と乗り換え先に使う。
 */
export function stackSupports(
  stackIndex: number,
  framework: FrameworkId,
): boolean {
  const s = STACKS[stackIndex];
  return s !== undefined && frameworkSupported(framework, s.provider);
}

/**
 * 構成にフレームワークを載せられない理由（載せられるなら undefined）。DeployTarget の説明（note）を添える。
 * 始める画面で、インフラの構成を先に選んだときのフレームワークのカード・構成のカードの注意に使う（D-113）。
 */
export function stackUnsupportedReason(
  stackIndex: number,
  framework: FrameworkId,
): string | undefined {
  if (stackSupports(stackIndex, framework)) return undefined;
  const note = deployTarget(framework, STACKS[stackIndex]!.provider)?.note;
  return `公式のアダプターが無く載せられません${note ? `（${note}）` : ''}`;
}

/**
 * その構成で使うフレームワーク（D-113）: 望むもの（シナリオで選べて、構成に載せられる）か、載せられなければシナリオの並びで
 * 最初の載せられるもの。始める画面でインフラの構成を先に選んだとき、載せられないフレームワークから戻す先。
 */
export function frameworkOnStack(
  sc: Scenario,
  stackIndex: number,
  want: FrameworkId,
): FrameworkId {
  const { allowed, default: def } = frameworksOf(sc);
  if (allowed.includes(want) && stackSupports(stackIndex, want)) return want;
  return allowed.find((f) => stackSupports(stackIndex, f)) ?? def;
}

/**
 * 選ぶ場所に出す構成か（載せられて、隠していない。D-100）。始める画面の一覧・乗り換え先・見積モードの構成と比較・総当たりに使う。
 * 隠した構成でも、保存の再生・newGame・行動の検査（rules）は今までどおり通す（古い保存を同じ結果で開けるように）。
 */
export function stackOffered(
  stackIndex: number,
  framework: FrameworkId,
): boolean {
  return stackSupports(stackIndex, framework) && !STACKS[stackIndex]!.hidden;
}

/** 結果の比較に出す基準プレイ（隠した構成で始めるものを除く。D-100）。 */
export function offeredBaselines(sc: Scenario): Strategy[] {
  return sc.baselines.filter((b) => !STACKS[b.stackIndex]!.hidden);
}

/** API を他の事業者に置いたときの、API と DB の名前（D-65・D-67）。 */
const API_PLACEMENT_NAME: Readonly<Record<string, string>> = {
  'cf-workers': 'Cloudflare Workers・D1',
  'aws-lambda': 'AWS Lambda・DynamoDB',
  'cf-workers-server': 'Cloudflare Workers・D1',
  'cf-workers-astro': 'Cloudflare Workers・D1',
  'sakura-vps-2gb': 'さくらの VPS 2GB（API・MySQL）',
  'sakura-vps-4gb': 'さくらの VPS 4GB（API・MySQL）',
};

/** Next.js の構成で API を他の事業者に置いたときの、Next.js を載せている側の名前（D-67）。 */
const NEXT_HOST_NAME: Readonly<Record<string, string>> = {
  'aws-amplify': 'AWS Amplify の Next.js',
  'aws-opennext': 'AWS の OpenNext',
};

/**
 * 構成に自前運用のサーバー（VPS のホスト）があるか。構成そのもの（さくらの VPS）に加えて、部品で VPS を使うとき
 * （Cloudflare の静的 + VPS の API。D-67）も含む。standby（差し替えの途中で新旧の両方を動かしている部品）も数える。
 * serving が true なら、経路に載っている（リクエストを受けている）ホストだけ。
 */
export function selfHostedOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  standby: Choices = {},
  serving = false,
): boolean {
  if (STACKS[stackIndex]!.selfHosted) return true;
  const arch = composeStack(STACK_DEFS[stackIndex]!, components, {
    framework,
    standby,
  });
  const routed = new Set(Object.values(arch.routes).flat());
  return arch.nodes.some(
    (n) => n.config.kind === 'host' && (!serving || routed.has(n.id)),
  );
}

/**
 * 構成の名前（SPA では vinext を使わないので外し、フレームワークを添える。prd/10）。
 * components を渡すと、SPA の API を他の事業者に置いているときは実際の組で出す（例「Vercel Pro の静的 + Cloudflare Workers・D1」。
 * 構成の既定の DB の名前を出さない。D-65）。始める画面の構成の一覧は渡さない（構成の名前のまま）。
 */
/**
 * DB を他の事業者に替えた構成の名前（Neon は D-77・AWS の DynamoDB・Aurora は D-114 段 2・Cloudflare は段 2b）。
 * 「Supabase Pro」を実際の組（「Neon（Launch）」「AWS DynamoDB」など）に替え、名前に DB の無い構成（Cloudflare）は後ろに足す
 * （「Cloudflare Paid + vinext + Hyperdrive + Neon（Launch）」。Neon は土台が Hobby・Free なら Neon（Free））。
 * API を他の事業者に置くと DB の名前は使わないので、そのまま。
 */
function withDbName<T extends { name: string; id: string; provider: Platform }>(
  s: T,
  components: Choices,
): T {
  const name = crossDbName(
    components.db,
    /-(hobby|free)$/.test(s.id),
    s.provider,
  );
  if (name === undefined) return s;
  return { ...s, name: withCrossDbName(s.name, name) };
}

export function stackName(
  stackIndex: number,
  framework: FrameworkId = 'nextjs',
  /** false なら「（Vite の SPA）」を添えない（フレームワークをすぐ隣で選んでいる始める画面。D-35）。 */
  withFramework = true,
  components: Choices = {},
): string {
  const s = withDbName(STACKS[stackIndex]!, components);
  const api = apiPlacedElsewhere(components)
    ? API_PLACEMENT_NAME[components.api!]
    : undefined;
  // Astro は vinext を使わないので外し、フレームワークを添える（D-68）。API を他の事業者に置くと、Astro を載せている側 + API と DB（D-69）
  if (framework === 'astro') {
    const base = api
      ? `${s.name.split(' + ')[0]} + ${api}`
      : s.name.replace(' + vinext', '');
    return withFramework ? `${base}（Astro）` : base;
  }
  // Next.js のサーバーから別の事業者の API を呼ぶ（D-67）: Next.js を載せている側 + API と DB
  if (!browserCallsApi(framework))
    return api
      ? `${NEXT_HOST_NAME[s.id] ?? s.name.split(' + ')[0]} + ${api}`
      : s.name;
  const base = api
    ? `${s.provider === 'aws' ? 'AWS の S3 + CloudFront' : s.name.split(' + ')[0]} の静的 + ${api}`
    : s.name.replace(' + vinext', '');
  // Next.js の静的書き出し（D-80）は SPA と同じ形（静的 + API）で、添える名前だけ違う
  const label =
    framework === 'nextjs-export'
      ? '（Next.js の静的書き出し）'
      : '（Vite の SPA）';
  return withFramework ? `${base}${label}` : base;
}

/** 部品の選択と席を足した構成（席課金のプランだけ費用が変わる）。standby は差し替えの途中の新しい部品。 */
/**
 * ドメインの登録のノードを外した構成（D-96）。乗り換え中の新しい構成は同じドメインを使うので、登録料を二重に数えない
 * （DNS のゾーンは並行して動かす間それぞれにあるので残す）。
 */
export function withoutDomainRegistration(
  arch: ArchitectureInput,
): ArchitectureInput {
  return {
    ...arch,
    nodes: arch.nodes.filter((n) => n.config.kind !== 'domain-registration'),
  };
}

/** 構成が使うプランのメンバー（席）の料金の文（catalog の members）。 */
export function membersOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.members) out.add(plan.members.premise);
  }
  return [...out];
}

/** 構成が使うプランの SLA の扱いの文（catalog の uptimeSla）。 */
export function slaOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.uptimeSla) out.add(plan.uptimeSla.premise);
  }
  return [...out];
}

/** 乗り換えた先の部品の選択（既定。チャットを持っていれば Durable Objects を付ける。D-24 X-9）。 */
export function componentsAfterMigration(
  to: number,
  mods: WorkloadMods,
  framework: FrameworkId,
  scenario: Scenario,
): Choices {
  const platform = STACKS[to]!.provider;
  const base = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(framework, platform, scenario),
  };
  if (mods.realtime && platform === 'cloudflare')
    base.realtime = 'durable-objects';
  return base;
}

export function withoutRealtime(mods: WorkloadMods): WorkloadMods {
  const out = { ...mods };
  delete out.realtime;
  return out;
}

/** その事業者で、今の部品の選択がリアルタイムを持てるか（チャットを受けたあと）。 */
export function realtimeSupported(platform: Platform): boolean {
  return componentsOf(platform, 'realtime').length > 0;
}

export function componentLabel(
  platform: Platform,
  slot: SlotId,
  option: string | undefined,
): string {
  return (
    componentsOf(platform, slot).find((c) => c.id === option)?.label ??
    option ??
    '—'
  );
}

/** 今の構成のプランのストレージ変更オプション（さくらの VPS だけ。catalog の addons。D-30）。 */
export function storageOptionAddon(stackIndex: number) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const a = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.addons.find((x) => x.id === 'storage-change');
    if (a) return a;
  }
  return undefined;
}

/** ストレージ変更オプションの選択肢の文（名前・メタ情報・説明）。VPS でなければ undefined。 */
export function storageOptionText(
  stackIndex: number,
): { name: string; meta: string[]; detail: string } | undefined {
  const addon = storageOptionAddon(stackIndex);
  if (!addon) return undefined;
  const disk = (option: boolean) =>
    composeStack(
      STACK_DEFS[stackIndex]!,
      {},
      { storageOption: option },
    ).nodes.reduce(
      (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
      0,
    );
  const scaleUp = STACKS.filter(
    (x) => x.provider === STACKS[stackIndex]!.provider,
  )
    .map((x) => stackFact(x.index, 'scale-up'))
    .find((f) => f !== undefined);
  return {
    name: 'ストレージ変更オプションを付ける',
    meta: [
      `ディスク ${disk(false)} → ${disk(true)} GB`,
      `手数料 ${addon.oneTimeFee.toLocaleString('ja-JP')} 円（一度だけ）`,
      `手間 ${EFFORT.storageOption}`,
      '来月から',
    ],
    detail: `${addon.premise}。申し込みはスケールアップと同じ手順で、${scaleUp?.premise ?? 'サーバーを停止して行います'}。計画的な短い停止なので、止まった月には数えません。戻せません（${addon.interpretation?.adopted ?? ''}）。性能差はこの計算に入れていません。上位のプランへ変更してもオプションは残るとみなします（公式に記載なし）。乗り換え・契約し直しでは外れます。`,
  };
}

/** 同じ事業者のプランの変更か（Cloudflare Free ↔ Paid・Vercel Hobby ↔ Pro）。 */
export function isPlanChange(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    !isRecontract(from, to)
  );
}

/** 構成のプランが持つ事実（catalog の Plan の facts）。 */
function stackFact(stackIndex: number, factId: string) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const f = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.facts.find((x) => x.id === factId);
    if (f) return f;
  }
  return undefined;
}

/**
 * 同じ事業者でも、下位のプランへは変更できず契約し直す（さくらの VPS は今よりディスクが少ないプランへ変更できない。D-27）。
 * 乗り換えと同じ仕組み（手間・期間・新旧両方の費用）で扱う。
 */
export function isRecontract(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    STACKS[to]!.diskGB < STACKS[from]!.diskGB &&
    stackFact(from, 'no-smaller-disk') !== undefined
  );
}

/** プラン変更の手間（さくらの VPS の上位への変更は停止とディスクの拡張の作業がある。D-27）。 */
export function planChangeEffort(from: number): number {
  return stackFact(from, 'scale-up') ? EFFORT.scaleUp : EFFORT.plan;
}

/** 乗り換えに必要な手間の合計（VPS が絡むと長い。下位のプランへの契約し直しは別の値）。 */
export function migrationEffort(from: number, to: number): number {
  const m = EFFORT.migrationMonths;
  const months = isRecontract(from, to)
    ? m.recontract
    : STACKS[from]!.selfHosted || STACKS[to]!.selfHosted
      ? m.selfHosted
      : m.serverless;
  return months * EFFORT.migrationPerMonth;
}

/**
 * 構成を変える選択肢（プラン変更・契約し直し・乗り換え）。label は判断に直接効く数だけの短い文、
 * detail は理由・事実の説明（画面の ⓘ に出す。前提の文は catalog の facts）。
 */
export function stackChangeText(
  from: number,
  to: number,
  framework: FrameworkId = 'nextjs',
  /** 今の部品（プラン変更は部品を引き継ぐので、API の置き場を名前に出す。乗り換えは既定の部品に戻る。D-65）。 */
  components: Choices = {},
): { name: string; meta: string[]; detail: string } {
  const target = stackName(
    to,
    framework,
    true,
    isPlanChange(from, to) ? components : {},
  );
  const months = migrationEffort(from, to) / EFFORT.migrationPerMonth;
  const per = EFFORT.migrationPerMonth;
  const both = '期間中は新旧両方の費用';
  if (isPlanChange(from, to)) {
    const effort = planChangeEffort(from);
    const fact = stackFact(from, 'scale-up');
    return effort === 0
      ? {
          name: `${target} にプラン変更`,
          meta: ['手間なし', '来月から'],
          detail:
            '同じ事業者のプランの変更です。上限と込み分が変わり、来月から効きます。',
        }
      : {
          name: `${target} にプラン変更`,
          meta: [`手間 ${effort}`, '来月から'],
          detail: `${fact?.premise ?? ''}。計画的な短い停止なので、止まった月には数えません。`,
        };
  }
  if (isRecontract(from, to))
    return {
      name: `${target} へ契約し直す`,
      meta: [`${per} × ${months} か月`, both],
      detail: `${stackFact(from, 'no-smaller-disk')!.premise}。新しく契約してデータを移す間は、新旧両方を動かして両方の費用を払います。`,
    };
  return {
    name: `${target} へ乗り換える`,
    meta: [`${per} × ${months} か月`, both],
    detail:
      '別の事業者へ移します。作業の間は新旧両方の構成を動かして両方の費用を払い、済んだ翌月に切り替わります（その月は収益が少し減ります）。部品は乗り換え先の既定の選択から始まります。',
  };
}

/** 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品の id。D-52）。 */
export function imagesOf(
  state: Pick<GameState, 'stackIndex' | 'components'>,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  return imagesBehavior(
    platform,
    { ...DEFAULT_CHOICES[platform], ...state.components }.images,
  );
}

/** 構成の短い説明（始める画面のフレーバー。catalog の STACK_FLAVOR。D-41）。 */
export function stackFlavor(stackIndex: number): string | undefined {
  return STACK_FLAVOR[STACKS[stackIndex]!.id];
}
