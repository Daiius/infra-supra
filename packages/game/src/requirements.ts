// 出来事の要件（満たしているか・届くか・状態の表示）と、オンデマンドの無効化を妨げる理由。
import type { EventDef, Requirement } from './scenario.ts';
import {
  type Choices,
  componentsOf,
  composeStack,
  DEFAULT_CHOICES,
  deployTarget,
  type FrameworkId,
  FRAMEWORKS,
  PITR_REQUIRED_DAYS,
  type Platform,
  rebuildsStaticPages,
  SLOT_LABELS,
  type SlotId,
  STACK_DEFS,
} from 'catalog';
import { books } from './core.ts';
import { articleFamily } from './routes/strategy.ts';
import { dbBackupStatus, STACKS } from './stacks.ts';
import type { GameState, StrategyFamily } from './state.ts';

/** 構成が要件を満たすか。uptime-sla: 課金先のプランがすべて稼働率の SLA を持つ（catalog の uptimeSla）。 */
export function meetsRequirement(
  stackIndex: number,
  requirement: Requirement,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  /** 記事のページの描き方（D-107。省略はフレームワークの既定）。 */
  fam?: StrategyFamily,
): boolean {
  switch (requirement) {
    case 'on-demand-isr':
      return (
        onDemandBlocker(stackIndex, components, framework, fam) === undefined
      );
    case 'db-pitr': {
      const st = dbBackupStatus(stackIndex, components, framework);
      return st.length > 0 && st.every((s) => s.pitrDays >= PITR_REQUIRED_DAYS);
    }
    case 'uptime-sla': {
      // バックアップの置き場（VPS の自前のバックアップのオブジェクトストレージ。D-93）とメールの送信（D-95）は
      // アプリの稼働に関わらないので見ない。ドメインの登録と DNS（D-96）も構成の既定のまま見ない（残した点）
      const plans = composeStack(STACK_DEFS[stackIndex]!, components)
        .nodes.flatMap((n) =>
          n.billing &&
          n.config.kind !== 'db-backup' &&
          n.config.kind !== 'email-sender' &&
          n.config.kind !== 'dns-zone' &&
          n.config.kind !== 'domain-registration'
            ? [n.billing]
            : [],
        )
        .map((b) =>
          books
            .find((x) => x.provider === b.provider)
            ?.plans.find((p) => p.id === b.planId),
        );
      return (
        plans.length > 0 &&
        plans.every((p) => p?.uptimeSla?.status === 'offered')
      );
    }
  }
}

/** 今の構成のプラン変更で要件を満たせるか（受けられない提案の判定）。 */
export function requirementReachable(
  stackIndex: number,
  requirement: Requirement,
  framework: FrameworkId = 'nextjs',
  fam?: StrategyFamily,
): boolean {
  return STACKS.some(
    (s) =>
      s.provider === STACKS[stackIndex]!.provider &&
      (meetsRequirement(s.index, requirement, {}, framework, fam) ||
        // DB のバックアップは部品で満たせる（D-93）
        (requirement === 'db-pitr' &&
          meetsRequirement(
            s.index,
            requirement,
            { dbBackup: 'pitr' },
            framework,
          ))),
  );
}

export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  'uptime-sla': '稼働率の SLA があるプラン',
  'on-demand-isr': '即時反映（オンデマンド ISR）',
  'db-pitr': `DB を直近 ${PITR_REQUIRED_DAYS} 日の任意の時点に戻せる構成`,
};

/** catalog の事実を「provider:planId:factId」で引く。 */
function factByRef(ref: string) {
  const [provider, planId, factId] = ref.split(':');
  return books
    .find((b) => b.provider === provider)
    ?.plans.find((p) => p.id === planId)
    ?.facts.find((f) => f.id === factId);
}

/** 即時反映を妨げている部品（無ければ undefined）。理由は catalog の事実の文（D-32）。 */
/**
 * HTML も前段の CDN でキャッシュし、時間で再検証するときの、更新が見えるまでの遅れの倍率（D-91）。CDN の写しは s-maxage（= 間隔）まで
 * 残り、その間にサーバーで作り直したページは次に CDN が取りに来るまで見えないので、最大で間隔の約 2 倍（ゲーム上の読み）。
 */
export const FRONT_CDN_DELAY_FACTOR = 2;

/** 前段の CDN が ISR のページ（HTML）を実際にキャッシュするか（HTML もキャッシュ × ISR のキャッシュが有効）。 */
export function htmlCachedAtFront(c: Choices): boolean {
  return c.frontCdn === 'html' && c.isrCache !== 'none';
}

export function onDemandBlocker(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  /** 記事のページの描き方（D-107）。S2/S3 のときだけ置き場・部品で決まる。省略はフレームワークの既定。 */
  fam?: StrategyFamily,
): { slot: SlotId; label: string; reason: string } | undefined {
  return onDemandBlockerOn(
    STACKS[stackIndex]!.provider,
    components,
    framework,
    fam,
  );
}

/** onDemandBlocker を事業者で引く（Workload の組み立てでも同じ判定を使う。D-111・OCL-FC4A03B7）。 */
export function onDemandBlockerOn(
  platform: Platform,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  fam?: StrategyFamily,
): { slot: SlotId; label: string; reason: string } | undefined {
  // 記事を毎回描く（S4）・枠 + API（S5）なら、キャッシュが無いのでいつも即時に反映される（prd/10・D-107）。
  // 静的にビルドし直す（S1）は記事を更新するたびにビルドし直せる（ビルドの数分は待つ。即時反映とみなすのはゲーム上の仮定。D-80）。
  // 新しい記事がビルドまで開けない分は、鮮度の判定で別に下げる（D-104）
  if (fam !== undefined && fam !== 'cached') return undefined;
  // SPA は ISR を持たず、ページの中身を毎回 API で読むので、いつも即時に反映される（prd/10）
  if (framework === 'vite-spa') return undefined;
  if (rebuildsStaticPages(framework)) return undefined;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  // Astro は記事のキャッシュの置き場が事業者で決まる（D-103）。消せない置き場（Hosting の CDN）なら届かない
  const astroCache =
    framework === 'astro'
      ? deployTarget('astro', platform)?.pageCache
      : undefined;
  if (astroCache && !astroCache.onDemand)
    return {
      slot: 'isrCache',
      label: `記事のキャッシュ: ${astroCache.label}`,
      reason: astroCache.reason,
    };
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[]) {
    // Astro は ISR のキャッシュの部品を使わない（D-103）
    if (framework === 'astro' && slot === 'isrCache') continue;
    // ISR をキャッシュしない（毎回 SSR）なら、前段の CDN に HTML のキャッシュは載らない（OCL-490F1874）
    if (slot === 'frontCdn' && !htmlCachedAtFront(c)) continue;
    const opt = componentsOf(platform, slot).find((o) => o.id === c[slot]);
    if (opt?.onDemandIsr && !opt.onDemandIsr.ok)
      return {
        slot,
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
      };
  }
  return undefined;
}

/**
 * 要件を満たせるかを、今の事業者の部品ごとに並べる（受ける前のカードに出す。D-32）。
 * 今の部品の組み合わせと、要件にかかわるスロットの選択肢それぞれ。
 */
export function requirementStatus(
  stackIndex: number,
  components: Choices,
  requirement: Requirement,
  framework: FrameworkId = 'nextjs',
  /** 記事のページの描き方（D-107）。 */
  fam?: StrategyFamily,
): { label: string; ok: boolean; reason: string; current: boolean }[] {
  if (requirement === 'db-pitr') {
    // DB のバックアップの選択肢ごとに、今の DB で何日戻せるか（D-93）
    const platform = STACKS[stackIndex]!.provider;
    const c = { ...DEFAULT_CHOICES[platform], ...components };
    return componentsOf(platform, 'dbBackup').flatMap((opt) =>
      dbBackupStatus(
        stackIndex,
        { ...components, dbBackup: opt.id },
        framework,
      ).map((s) => ({
        label: `${SLOT_LABELS.dbBackup}: ${opt.label}（${s.dbLabel}）`,
        ok: s.pitrDays >= PITR_REQUIRED_DAYS,
        reason: s.text,
        current: c.dbBackup === opt.id,
      })),
    );
  }
  if (requirement !== 'on-demand-isr') return [];
  if (fam === 'ssr' || (fam === 'api' && framework !== 'vite-spa'))
    return [
      {
        label:
          fam === 'ssr'
            ? '記事のページを毎回描く'
            : '記事のページを枠 + API に',
        ok: true,
        reason: 'キャッシュが無いので、更新はいつもすぐ見える',
        current: true,
      },
    ];
  if (fam === 'static' && !rebuildsStaticPages(framework))
    return [
      {
        label: '記事のページを静的にビルドし直す',
        ok: true,
        reason:
          '記事を更新するたびにビルドし直す（ビルドの数分は待つ。ゲーム上の仮定）。ビルドの回数と時間が増える',
        current: true,
      },
    ];
  if (framework === 'vite-spa')
    return [
      {
        label: 'Vite の SPA',
        ok: true,
        reason: 'ISR を持たず、ページの中身を毎回 API で読む',
        current: true,
      },
    ];
  if (rebuildsStaticPages(framework))
    return [
      {
        label: FRAMEWORKS[framework].label,
        ok: true,
        reason:
          '記事を更新するたびにビルドし直す（ビルドの数分は待つ。ゲーム上の仮定）。ビルドの回数と時間が増える',
        current: true,
      },
    ];
  const platform = STACKS[stackIndex]!.provider;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  const out: {
    label: string;
    ok: boolean;
    reason: string;
    current: boolean;
  }[] = [];
  // Astro の記事のキャッシュの置き場は事業者で決まる（D-103）
  const astroCache =
    framework === 'astro'
      ? deployTarget('astro', platform)?.pageCache
      : undefined;
  if (astroCache)
    out.push({
      label: `記事のキャッシュ: ${astroCache.label}`,
      ok: astroCache.onDemand,
      reason: astroCache.reason,
      current: true,
    });
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[])
    for (const opt of componentsOf(platform, slot)) {
      if (!opt.onDemandIsr) continue;
      if (framework === 'astro' && slot === 'isrCache') continue;
      out.push({
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        ok: opt.onDemandIsr.ok,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
        current: c[slot] === opt.id,
      });
    }
  return out;
}

/** 提案を受けられない理由（要件を満たせる構成がプラン変更でも無い）。 */
export function unavailableReason(
  state: Pick<GameState, 'stackIndex' | 'framework' | 'scenario' | 'routes'>,
  def: EventDef,
): string | undefined {
  if (
    !def.requires ||
    requirementReachable(
      state.stackIndex,
      def.requires,
      state.framework,
      articleFamily(state),
    )
  )
    return undefined;
  return `今の事業者では「${REQUIREMENT_LABEL[def.requires]}」を選べない（セルフサービスのプランに無く、Enterprise などの契約の料金は取得していない）`;
}
