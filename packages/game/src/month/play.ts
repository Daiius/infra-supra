// 1 か月を進める（playMonth）と、その中で使う成長・境目の越え・終わりの判定。
import type { Scenario, Scheduled, Stock, WorkloadMods } from '../scenario.ts';
import {
  apiCacheActive,
  apiPlacedElsewhere,
  astroPageCacheChoice,
  type Choices,
  componentsOf,
  DEFAULT_CHOICES,
  FRAMEWORKS,
  imagesBehavior,
  MVP_STACKS,
  SLOT_LABELS,
  type SlotId,
} from 'catalog';
import { commitmentEligible, commitmentLines } from '../commitments.ts';
import {
  allocateEffort,
  buzzLasting,
  COLD_START,
  FLAT_PLAN_ADJUST,
  growthFromReputation,
  judgeStages,
  policyStep,
  reputation,
  satisfactionScore,
  speedHeaviness,
} from '../rules.ts';
import { nextRandom } from '../random.ts';
import type { ArchitectureInput, PlatformPremise, PriceBook } from 'estimator';
import { BOT_BLOCK } from '../actions/check.ts';
import {
  booksAt,
  estimate,
  eventDef,
  revisionText,
  scenarioOf,
  SCHEDULED_CHANGES,
  USD_JPY,
} from '../core.ts';
import {
  accountUpkeepFor,
  featureBonusOf,
  featureWorkOf,
  interruptOf,
  migrationWanted,
  nextSsrCpuMs,
  rewriteWanted,
  swapWanted,
  upkeepFor,
} from '../effort.ts';
import {
  acceptEffort,
  applyEffects,
  describeEffect,
  imageRedesignQuality,
  premiseRefsOf,
} from '../events.ts';
import { fmtFactor, lineLabel, toUsd, usdOf } from '../format.ts';
import { COMMITMENTS } from '../offers.ts';
import {
  FRONT_CDN_DELAY_FACTOR,
  htmlCachedAtFront,
  meetsRequirement,
  onDemandBlocker,
  REQUIREMENT_LABEL,
  requirementStatus,
  unavailableReason,
} from '../requirements.ts';
import { componentsAfterRewrite, revalidateAfterRewrite } from '../rewrite.ts';
import { commentsInPage, commentsOf } from '../routes/comments.ts';
import {
  articleFamily,
  articleShellPerPage,
  validRouteOverrides,
} from '../routes/strategy.ts';
import {
  autoImageFormat,
  deliveredImageKB,
  IMAGE_FORMAT_KB,
  imageFormatOf,
  isOnDemand,
  pageWeightKB,
  pageWeightLabel,
  type Settings,
} from '../settings.ts';
import { INVALIDATION_METER } from '../setup/estimates.ts';
import {
  componentLabel,
  componentsAfterMigration,
  imagesOf,
  membersOf,
  realtimeSupported,
  selfHostedOf,
  slaOf,
  slotIneffective,
  stackName,
  STACKS,
  swapLabel,
  withoutDomainRegistration,
  withoutRealtime,
} from '../stacks.ts';
import type { Crossing, GameState, MonthEvent, MonthReport } from '../state.ts';
import {
  architectureFor,
  coldStartViewShare,
  type Spike,
  staticBuildOf,
  workloadFor,
  type WorkloadParts,
} from '../workload.ts';
import {
  averageSatisfaction,
  noSocialCards,
  stageReasons,
} from './satisfaction.ts';

/** 1 か月を進める（出来事 → 見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 在庫 → 終わりの判定）。 */
export function playMonth(input: GameState): GameState {
  if (input.phase !== 'playing') return input;
  const sc = scenarioOf(input);
  const month = input.history.length + 1;
  const prev = input.history[input.history.length - 1];

  // 返事のない提案は断ったことにする（罰はない。D-20 V-11）
  let state: GameState = input.pendingProposals.length
    ? {
        ...input,
        responses: {
          ...input.responses,
          ...Object.fromEntries(
            input.pendingProposals.map((id) => [id, 'declined' as const]),
          ),
        },
        pendingProposals: [],
      }
    : input;

  // 台本: 今月起きる出来事と予告（事業者を限った出来事は、その事業者の構成のときだけ。D-24 X-5）
  const events: MonthEvent[] = [];
  const platformNow = STACKS[state.stackIndex]!.provider;
  const forPlatform = (x: Scheduled) => {
    const ps = eventDef(sc, x.id)!.platforms;
    return !ps || ps.includes(platformNow);
  };
  const due = state.schedule.filter((x) => x.month === month && forPlatform(x));
  const noticed = state.schedule.filter(
    (x) => x.noticeMonth === month && forPlatform(x),
  );
  let humanFactor = 1;
  let botExtra = 0;
  let peakFactor = 1;
  let lasting = false;
  // 記事ごとの SNS のカードが出ないと、話題の伸びが小さい（SPA で OGP の前処理なし。ゲーム上の仮定・prd/10 F-05）
  const cardFactor = noSocialCards(state)
    ? (sc.frameworks?.spa?.socialCardFactor ?? 1)
    : 1;
  let socialLasting = false;
  const trafficEvents: {
    id: string;
    title: string;
    bot: boolean;
    factor: number;
    peak?: number;
    spikeDays?: number;
  }[] = [];
  const trafficNotes: string[] = [];
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    const n = def.notice!;
    if (n.pvFactor && n.bot) {
      // Bot の前兆（収益にならない。遮断していれば半分）
      const extra =
        (n.pvFactor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
      botExtra += extra;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: true,
        factor: 1 + extra,
      });
      trafficNotes.push(n.title);
    } else if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: false,
        factor: n.pvFactor,
      });
      trafficNotes.push(n.text);
    }
  }
  // 続いている流量の出来事（Bot は 2 か月など）
  for (const x of state.schedule) {
    if (x.month > month) continue;
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    for (const e of def.effects ?? []) {
      if (e.type !== 'traffic' || month >= x.month + e.months) continue;
      if (e.bot) {
        const extra =
          (e.factor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
        botExtra += extra;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: true,
          factor: 1 + extra,
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        trafficNotes.push(`${def.title}（Bot は収益にならない）`);
      } else {
        const factor = e.social ? 1 + (e.factor - 1) * cardFactor : e.factor;
        humanFactor *= factor;
        if (e.peakFactor) peakFactor *= e.peakFactor;
        if (e.lasting) lasting = true;
        if (e.lasting && e.social) socialLasting = true;
        if (e.social && cardFactor !== 1)
          trafficNotes.push(
            `記事ごとの SNS のカードが出ないので、話題の伸びが小さい（${fmtFactor(e.factor)} → ${fmtFactor(factor)}・ゲーム上の仮定）`,
          );
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: false,
          factor,
          ...(e.peakFactor ? { peak: e.peakFactor } : {}),
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        if (!e.lasting) trafficNotes.push(def.title);
      }
    }
  }
  // 台本の効果（流量以外）は起きた月から効く
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    state = applyEffects(state, def.effects ?? [], def.id);
  }
  const buzz = lasting;
  // 話題の後に残る伸びも、カードが出ないと小さい（同じ仮定）
  const buzzRule =
    socialLasting && cardFactor !== 1
      ? { ...sc.buzz, extra: sc.buzz.extra * cardFactor }
      : sc.buzz;
  const basePV = state.basePV;
  const humanPV = basePV * humanFactor;
  const botPV = humanPV * botExtra;
  const pv = humanPV + botPV;
  // 話題・Bot の上乗せ分は短い期間に集中する（容量の判定だけ。D-44）
  const spikes: Spike[] = trafficEvents.flatMap((t) =>
    t.spikeDays
      ? [
          {
            id: t.id,
            extraPV: t.bot
              ? humanPV * (t.factor - 1)
              : humanPV * (1 - 1 / t.factor),
            days: t.spikeDays,
          },
        ]
      : [],
  );

  const stackIndexNow = state.stackIndex;
  const stack = MVP_STACKS[stackIndexNow]!;
  const ssrCpuMs = nextSsrCpuMs(state);
  const parts: WorkloadParts = {
    pv,
    settings: state.settings,
    ssrCpuMs,
    mods: state.mods,
    stock: sc.stock ? state.stock : null,
    platform: platformNow,
    components: state.components,
    framework: state.framework,
    routes: state.routes,
    routeParts: state.routeParts,
    ...(peakFactor !== 1 ? { peakFactor } : {}),
    ...(spikes.length ? { spikes } : {}),
  };
  const workload = workloadFor(sc, parts);
  const swap = state.componentSwap;
  const architecture = architectureFor(
    stackIndexNow,
    state.seats,
    state.framework,
    state.components,
    swap ? { [swap.slot]: swap.option } : {},
    state.storageOption,
    staticBuildOf(sc, stackIndexNow, state.framework, state.routes),
  );
  const monthBooks = booksAt(state, month);
  const r = estimate({ workload, architecture, books: monthBooks });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）。乗り換え先は既定の部品（D-24 X-9）
  const target = state.migration
    ? (() => {
        const to = state.migration.to;
        const components = componentsAfterMigration(
          to,
          state.mods,
          state.framework,
          sc,
        );
        return estimate({
          workload: workloadFor(sc, {
            ...parts,
            platform: STACKS[to]!.provider,
            components,
          }),
          // 同じドメイン（.com 1 つ）の登録料は今の構成で払っているので、乗り換え先では数えない（D-96・OCL-A580D510）
          architecture: withoutDomainRegistration(
            architectureFor(
              to,
              state.seats,
              state.framework,
              components,
              {},
              false,
              staticBuildOf(sc, to, state.framework, state.routes),
            ),
          ),
          books: monthBooks,
        });
      })()
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  // ストレージ変更オプションの手数料（付けた次の月に一度だけ。D-30）
  // 申し込んだときのプランの金額を一度だけ払う（同じ月に上位へ変更しても変わらない）
  const fee = state.storageOptionFeeDue;
  const feeUsd = fee ? fee.amount / USD_JPY : 0;
  // 確約（D-97）: 今と乗り換え先の明細の対象の額に、結んだ確約を当てる（対象を使わなくなっても支払いは残る）
  const eligibleNow = commitmentEligible(
    [...r.bill.lines, ...(target?.bill.lines ?? [])],
    COMMITMENTS,
  );
  const commitLines = commitmentLines(
    state.commitments ?? [],
    eligibleNow,
    month,
  );
  const commitUsd = commitLines.reduce(
    (a, l) => a + usdOf(l.amount, l.currency),
    0,
  );
  const infraCost =
    toUsd(r.bill.totals) + parallelInfraCost + feeUsd + commitUsd;

  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    // 予告を持ちうる台本は、予告どおり起きたか、予告なしで起きたか（D-28）
    const announced =
      def.notice && def.kind !== 'proposal'
        ? { announced: x.noticeMonth !== undefined }
        : {};
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      ...announced,
      title: def.title,
      text:
        def.notice && x.noticeMonth === undefined && def.surpriseText
          ? def.surpriseText
          : def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, r.premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...(def.previewRequirement
        ? {
            requirementStatus: requirementStatus(
              stackIndexNow,
              state.components,
              def.previewRequirement,
              state.framework,
              articleFamily(state),
            ),
          }
        : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def, state),
              ...(unavailableReason(state, def)
                ? { unavailable: unavailableReason(state, def)! }
                : {}),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.notice!.title,
      text: def.notice!.text,
      effects: [],
      premises: premiseRefsOf(def, r.premises),
    });
  }
  // 状態で起きる出来事（前提の使用率が境目を越えた。一度だけ）
  let fired = state.fired;
  for (const def of sc.events) {
    if (def.when.type !== 'premise' || fired.includes(def.id)) continue;
    const w = def.when;
    // 前の月は境目より下で、今月越えた前提（1 か月目から越えているものは「近づいた」と呼ばない）
    const p = r.premises.find(
      (q) =>
        w.premiseIds.some((id) => q.id.startsWith(id)) &&
        (q.ratio ?? 0) >= w.atLeast &&
        (prev?.snapshots.find((x) => x.id === q.id)?.ratio ?? Infinity) <
          w.atLeast,
    );
    if (!p) continue;
    fired = [...fired, def.id];
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'occurred',
      title: def.title,
      text: def.text,
      effects: [],
      premises: premiseRefsOf(
        { premiseRefs: w.premiseIds },
        r.premises.filter((q) => (q.ratio ?? 0) >= w.atLeast),
      ),
    });
  }
  // 実際に予告されている改定（始めた日が施行日より前のものだけ。D-21）
  const used = new Set(
    stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    events.push({
      id: c.id,
      kind: 'script',
      tier: 'common',
      phase: 'occurred',
      title: `${c.kind === 'pricing' ? '料金' : c.kind === 'limit' ? '制限' : '提供条件'}の改定が予告された（${c.provider}・施行日 ${c.effectiveFrom}）`,
      text: revisionText(c, used.has(c.provider)),
      effects: [],
      premises: [],
    });
  }

  // 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    accounts: accountUpkeepFor(state),
    interrupt: interruptOf(state),
    featureWork: featureWorkOf(state),
    featureBonus: featureBonusOf(state),
    // 乗り換え・DB の差し替え・作り直しは同時に進めない（どれか 1 つだけ。D-81）
    migrationWanted:
      migrationWanted(state.migration) +
      swapWanted(state.componentSwap) +
      rewriteWanted(state),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;
  let componentSwap = swap
    ? { ...swap, done: swap.done + effort.migration }
    : null;
  let rewrite = state.rewrite
    ? { ...state.rewrite, done: state.rewrite.done + effort.migration }
    : null;

  const [rand, seed] = nextRandom(state.seed);
  // 自前運用のサーバーの偶発的な障害。部品で VPS を使うとき（VPS の API。D-67）も、そのホストがリクエストを受けていれば当たる
  const apiOnlyHost = !STACKS[stackIndexNow]!.selfHosted;
  const incident =
    selfHostedOf(stackIndexNow, state.components, state.framework, {}, true) &&
    rand < sc.incidents.selfHostedChancePerMonth;

  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = r.premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = r.premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  // CDN の定額のプランの込みを超えた前提（請求は増えない）。急増が大きいか、続けて超えると性能が調整される（D-61）
  const prevAdjust = new Set(
    (state.history[state.history.length - 1]?.premises ?? [])
      .filter((p) => p.hit && p.effect === 'adjust')
      .map((p) => p.id),
  );
  const adjusted = r.premises.filter(
    (p) =>
      p.hit &&
      p.effect === 'adjust' &&
      ((p.ratio ?? 0) > FLAT_PLAN_ADJUST.spikeRatio ||
        // 続けて超えた: 前の月も同じ前提で超えていた（sustainedMonths = 2 か月）
        prevAdjust.has(p.id)),
  );
  const loss = sc.revenue.loss;
  let revenue =
    (sc.revenue.fixedUsdPerMonth ?? 0) +
    (humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - loss.block;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - loss.incident;
    outages++;
    status = 'incident';
    notes.push(
      apiOnlyHost
        ? 'API の VPS の障害で数時間止まった（SLA なし・1 台構成。シェルは出るが中身が読めない）'
        : 'VPS の障害で数時間止まった（SLA なし・1 台構成）',
    );
  } else if (throttling.length) {
    revenue *= 1 - loss.throttle;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - loss.migration;
    notes.push('乗り換えの切り替えで収益が減った');
  }
  // 契約の収益（要件を満たす構成の月だけ。SLA の出来事・D-24）
  let contractRevenue = 0;
  for (const c of state.contracts) {
    if (
      meetsRequirement(
        stackIndexNow,
        c.requires,
        state.components,
        state.framework,
        articleFamily(state),
      )
    )
      contractRevenue += c.usdPerMonth;
    else
      notes.push(
        `契約の収益が入らなかった（${REQUIREMENT_LABEL[c.requires]}でない）`,
      );
  }
  revenue += contractRevenue;

  // 規約違反: 最初の月は指摘（警告）、翌月も違反したままならアカウント停止（D-19）
  const ps = policyStep({
    warnedMonth: state.policyWarnedMonth,
    violating: policy.length > 0,
    migrating: state.migration !== null,
    month,
  });
  const policyWarnedMonth = ps.warnedMonth;
  const policyWarning = ps.outcome === 'warned';
  const accountSuspended = ps.outcome === 'suspended';
  if (ps.outcome === 'warned')
    notes.push(
      `運営元から指摘が来た（規約違反の警告: ${policy[0]!.text}）。来月も違反したままならアカウントが停止される`,
    );
  else if (ps.outcome === 'grace')
    notes.push('規約違反のまま乗り換えの作業中（猶予中）');
  else if (accountSuspended)
    notes.push('規約違反が続いたため、アカウントが停止された');

  // 満足度と評判（prd/07 §9.1〜9.3）
  const sat = sc.satisfaction;
  // 部品で変わる判定の入力（D-24）: 最適化しない画像は原本の大きさ・キャッシュしないと記事は常に新しい・
  // KV を DB の代わりにすると書き込みがすぐ見えない
  const comps = { ...DEFAULT_CHOICES[platformNow], ...state.components };
  // 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品として見る。D-52）
  const imgs = imagesBehavior(platformNow, comps.images);
  const viewed: Settings = {
    ...state.settings,
    imageKB: deliveredImageKB(
      sc,
      state.settings,
      imgs,
      autoImageFormat(platformNow, state.framework, comps.images),
    ),
    // 最適化しない・一律で縮めて置くは、サイズ違いを作らず 1 種を配る（D-47）
    ...(imgs === 'resize' || imgs === 'none' ? { variants: 1 } : {}),
  };
  // 画質: 最適化しないは原本、それ以外は JPEG と同じ見た目（形式では下げない。D-58）。記事のデザインの刷新を断った月・
  // 受けたあと粗い画像（一律で縮めた原本の無い画像）が多い月は 1 段下げる（D-47）
  // 画像の形式は同じ見た目の画質で小さくするので、画質は下げない（D-58）。JPEG の大きさで判定する
  const qualityImageKB =
    imgs === 'none' ? viewed.imageKB : IMAGE_FORMAT_KB.jpeg;
  const redesign = imageRedesignQuality(state, sc, month, imgs);
  // SPA は ISR を持たず、ページの中身を毎回 API で読む（記事は常に新しい。prd/10）。
  // API の応答をキャッシュすると、記事はキャッシュの期間だけ古く見える（ISR の間隔と同じ判定。D-37）
  // 記事のページの描き方（D-107）: 枠 + API（S5）なら SPA と同じ判定、静的（S1）なら静的書き出しと同じ判定、毎回描く（S4）ならキャッシュなし。
  // 記事のページの無いシナリオ（受託）はフレームワークで決める（今までどおり）
  const fam = articleFamily(state);
  const spaFramework = state.framework === 'vite-spa';
  const spa = fam !== undefined ? fam === 'api' : spaFramework;
  const astro = state.framework === 'astro';
  // Next.js の静的書き出し（D-80）: 記事は静的なページ（鮮度はビルドの間隔）、マイページの中身は SPA と同じく API
  const nextExport = state.framework === 'nextjs-export';
  const rebuilds = fam !== undefined ? fam === 'static' : nextExport;
  const ssrArticle = fam === 'ssr';
  // Astro の記事は閲覧のときに描いて事業者の置き場にキャッシュする（D-103）。キャッシュしない形は無く、鮮度は Next.js の ISR と同じ
  // （オンデマンドで消す・期限で取り直す）。置き場は事業者で決まるので、ISR のキャッシュの部品の選択は見ない
  const cacheComps: Choices = astro
    ? { ...comps, isrCache: astroPageCacheChoice(platformNow) }
    : comps;
  const uncached = spa
    ? !apiCacheActive(platformNow, state.components, state.framework)
    : ssrArticle || (!rebuilds && cacheComps.isrCache === 'none');
  // SPA の API の CPU（速さの「SSR の重さ」の代わりに使う。SSR の CPU × dataCpuFactor）。初回表示の重さと速さの CPU は
  // フレームワークの性質のまま（Next.js・Astro のページを S5 にしても、静的書き出しのマイページと同じく SSR の値で見る。D-80・D-107）
  const firstLoad =
    spaFramework && (sc.frameworks?.spa?.firstLoadHeavy ?? false);
  // Astro の初回表示の軽さ（JS はアイランドの分だけ。速さの重さを 1 つ減らす。ゲーム上の仮定・D-68）
  const firstLoadLight =
    astro && (sc.frameworks?.astro?.firstLoadLight ?? false);
  // コンテナの冷えた起動（Cloud Run の最小インスタンス 0。D-88）
  const coldShare = coldStartViewShare(r);
  const coldStart = coldShare >= COLD_START.heavyShare;
  // 静的書き出しのマイページは、サーバーの描画が無い代わりにブラウザが HTML → JS → API の順に待つ。速さ・初回表示は
  // Next.js と同じ扱い（SSR の CPU の値をそのまま重さに使う。ゲーム上の仮定・D-80）
  const serverCpuMs = spaFramework
    ? ssrCpuMs * (sc.frameworks?.spa?.shape.dataCpuFactor ?? 1)
    : ssrCpuMs;
  // API を他の事業者に置いている間は、構成の DB の選択は使われない（DB は API の事業者の部品。OCL-5A7916E6）
  // ISR のページを前段の CDN でもキャッシュし、時間で再検証するなら、CDN は s-maxage（= 間隔）まで写しを返すので、
  // 更新は最大で間隔の約 2 倍遅れて見える（記事・ページに含めたコメントとも。D-91）。オンデマンドでは、再検証と一緒に
  // CDN のキャッシュを消せる部品（さくらの VPS の Cloudflare は Free の purge の API）なら遅れず、消せない部品
  // （AWS の自前の CloudFront）は古いページが残る（D-31 と同じく 1 段下げ、さらに即時反映を満たさない）
  const frontHtml =
    !spa && !rebuilds && !ssrArticle && htmlCachedAtFront(cacheComps);
  const frontDelayed = frontHtml && !isOnDemand(viewed);
  const frontUnpurged =
    frontHtml &&
    isOnDemand(viewed) &&
    componentsOf(platformNow, 'frontCdn').find((o) => o.id === comps.frontCdn)
      ?.onDemandIsr?.ok === false;
  const eventuallyConsistent =
    (comps.db === 'kv' && !apiPlacedElsewhere(comps)) || frontUnpurged;
  // 記事をビルドし直す形（静的書き出し）は、更新が載るまで間隔にビルドの時間を足した分だけ遅れる（オンデマンドでもビルドの時間は待つ。D-104）
  const buildDelaySec = rebuilds
    ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
    : 0;
  const judgedDelaySec =
    (frontDelayed
      ? viewed.revalidateSec * FRONT_CDN_DELAY_FACTOR
      : viewed.revalidateSec) + buildDelaySec;
  // 新しい記事は、ビルドが終わるまでページが無い。投稿した人が開けるまでの許容を超えたら、コミュニティの要件を満たさない（D-104）。
  // 記事ごとの枠（S5。D-109）も枠をビルドで書き出すので、中身は API で常に新しくても、新しい記事は枠のビルドが終わるまで開けない
  const shellBuildSec =
    spa && articleShellPerPage(state)
      ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
      : 0;
  const newPostLimit = sat.freshness.newPostVisibleSec;
  const newPostDelayed =
    newPostLimit !== undefined &&
    ((buildDelaySec > 0 && judgedDelaySec > newPostLimit) ||
      shellBuildSec > newPostLimit);
  // 即時反映（オンデマンド ISR）の要件を満たさない構成（D-32）。再検証の設定をオンデマンドにしたときも、
  // 対応しない部品があると再検証が届かず古いページが出る（同じ判定・同じ理由の文。D-49）
  const onDemandSetting = !spa && isOnDemand(state.settings);
  const onDemand =
    state.requirements.includes('on-demand-isr') || onDemandSetting
      ? onDemandBlocker(stackIndexNow, state.components, state.framework, fam)
      : undefined;
  // コメントを記事のページに含め、時間で再検証・ビルドするなら、コメントは間隔の分だけ遅れて見える（D-85）。
  // オンデマンド（コメントのたびに作り直す）・キャッシュしない（毎回 SSR）なら遅れない。ビルドし直す形はオンデマンドでもビルドの時間は遅れる（D-104）
  const commentsDelayed =
    sc.comments !== undefined &&
    commentsInPage(
      commentsOf(sc, state.routeParts),
      state.framework,
      sc,
      state.routes,
    ) &&
    !uncached &&
    (!isOnDemand(viewed) || buildDelaySec > 0);
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs: serverCpuMs,
      firstLoadHeavy: firstLoad,
      firstLoadLight,
      coldStart,
      imageKB: viewed.imageKB,
      variants: viewed.variants,
      revalidateSec: judgedDelaySec,
      qualityImageKB,
      qualityDown: redesign !== undefined,
      featurePoints,
      month,
      premises: r.premises,
      uncached,
      eventuallyConsistent,
      onDemandUnmet: onDemand !== undefined,
      newPostDelayed,
      ...(commentsDelayed
        ? {
            commentFreshness: {
              delaySec: judgedDelaySec,
              ...sc.comments!.freshness,
            },
          }
        : {}),
      speedDown: adjusted.length > 0,
    },
    sat,
  );
  if (adjusted.length)
    notes.push(
      'CDN の定額のプランの込みを超え続け、配信の性能が調整された（請求は増えない。ゲーム上の仮定）',
    );
  const reasons = stageReasons(sc, stages, {
    blocking,
    throttling,
    adjusted,
    incident,
    switching: state.switching,
    ssrCpuMs: serverCpuMs,
    spa,
    spaFramework,
    apiOnly: nextExport,
    rebuilds,
    astro,
    settings: viewed,
    heaviness: speedHeaviness(
      {
        ...viewed,
        ssrCpuMs: serverCpuMs,
        premises: r.premises,
        firstLoadHeavy: firstLoad,
        firstLoadLight,
        coldStart,
      },
      sat,
    ),
    coldShare: coldStart ? coldShare : undefined,
    featurePoints,
    month,
    imagesUnoptimized: imgs === 'none',
    pageWeight: pageWeightLabel(
      pageWeightKB(
        sc,
        state.settings,
        state.mods,
        imgs,
        autoImageFormat(platformNow, state.framework, comps.images),
      ),
    ),
    qualityReason: redesign,
    eventuallyConsistent,
    frontDelayed,
    uncached,
    buildDelaySec,
    newPostDelayed,
    shellBuilds: shellBuildSec > 0,
    // 遅れがコメントの「良い」の境目を超えたときだけ理由に出す
    commentsDelayed:
      commentsDelayed && judgedDelaySec > sc.comments!.freshness.good,
    onDemandReason: onDemand
      ? state.requirements.includes('on-demand-isr')
        ? `即時反映の要件を満たさない（${onDemand.label}。${onDemand.reason}）`
        : `オンデマンドの再検証が届かない（${onDemand.label}。${onDemand.reason}）`
      : undefined,
  });
  const score = satisfactionScore(stages, sat.weights);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad', sc.growth);
  const bonus = state.growthBonus.reduce(
    (a, b) => a + (b.months > 0 ? b.add : 0),
    0,
  );
  // 速さが「悪い」月は、離脱と検索からの流入の減りで PV の伸びが下がる（ゲーム上の仮定・D-47）
  const slowPenalty = stages.speed === 'bad' ? (sc.growth.slowPenalty ?? 0) : 0;
  if (slowPenalty > 0 && reasons.speed)
    reasons.speed += `。速さが悪く PV の伸びが約 ${Math.round(slowPenalty * 100)}% 下がった`;
  const net = g.net + bonus - slowPenalty;

  const cash = state.cash + revenue - infraCost;

  // 前提が初めて境目を越えた月: 出来事を外して見積を引き直し、理由を確かめる（prd/07 §10.7）
  const crossings = crossingsOf(sc, {
    prev,
    premises: r.premises,
    parts,
    architecture,
    books: monthBooks,
    humanPV,
    basePV,
    trafficEvents,
    state,
  });

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = stackIndexNow;
  let switching = false;
  let components = state.components;
  let mods = state.mods;
  let storageOption = state.storageOption;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    components = componentsAfterMigration(
      migration.to,
      state.mods,
      state.framework,
      scenarioOf(state),
    );
    // 乗り換え・契約し直しは新しいサーバーなので、ストレージ変更オプションは付いていない
    storageOption = false;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${stackName(migration.to, state.framework)} に切り替える（部品は既定の選択から始まる）`,
    );
    if (mods.realtime && !realtimeSupported(STACKS[migration.to]!.provider)) {
      mods = withoutRealtime(mods);
      notes.push(
        'チャットは乗り換え先のリアルタイムのデータを取得していないため、乗り換えとともに止めた',
      );
    }
    migration = null;
  }
  // DB の差し替えが済んだら、次の月から新しい DB に切り替える
  if (componentSwap && componentSwap.done >= componentSwap.required) {
    components = { ...components, [componentSwap.slot]: componentSwap.option };
    // API を他の事業者に移したら、構成の DB の選択は既定に戻す（DB は API の事業者に移った。
    // 同じ事業者へ戻すときは既定の DB へ移す。OCL-5A7916E6）
    if (componentSwap.slot === 'api' && apiPlacedElsewhere(components)) {
      const { db: _db, ...rest } = components;
      components = rest;
    }
    notes.push(
      `${swapLabel(componentSwap.slot)}が済んだ。来月から ${componentLabel(platformNow, componentSwap.slot, componentSwap.option)} を使う`,
    );
    componentSwap = null;
  }
  // 作り直しが済んだら、次の月から新しいフレームワークで動かす（事業者はそのまま。D-81）
  let framework = state.framework;
  let settings = state.settings;
  let routes = state.routes;
  if (rewrite && rewrite.done >= rewrite.required) {
    framework = rewrite.to;
    // 描き方は新しいフレームワークの既定に戻る（D-107）
    routes = undefined;
    components = componentsAfterRewrite({ ...state, components }, rewrite.to);
    settings = {
      ...settings,
      revalidateSec: revalidateAfterRewrite(settings.revalidateSec, rewrite.to),
    };
    notes.push(
      `作り直しが済んだ。来月から ${FRAMEWORKS[rewrite.to].label} で動かす（${stackName(stackIndex, rewrite.to, true, components)}。新しいフレームワークで選べない部品は既定に戻した）`,
    );
    rewrite = null;
  }

  // ためていく量（月ごとに増える。prd/07 §10.4）
  const stock = sc.stock ? grow(sc, state, humanPV) : state.stock;
  // 一律で縮めて置いた画像（原本が無い）は、記事のデザインの刷新を受ける前の分だけ粗い画像として数える（D-47）
  const coarseImages =
    (state.coarseImages ?? 0) +
    (imgs === 'resize' && !state.imageRedesign
      ? stock.images - state.stock.images
      : 0);

  const report: MonthReport = {
    month,
    stackName: stackName(
      stackIndexNow,
      state.framework,
      true,
      state.components,
    ),
    buzz,
    ...(trafficNotes.length ? { trafficNote: trafficNotes.join('・') } : {}),
    pv,
    humanPV,
    botPV,
    basePV,
    revenue,
    infraCost,
    parallelInfraCost,
    cash,
    status,
    notes,
    events,
    crossings,
    policyWarning,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    snapshots: r.premises
      .filter(
        (p) =>
          p.kind === 'threshold' &&
          p.ratio !== undefined &&
          Number.isFinite(p.ratio),
      )
      .map((p) => ({
        id: p.id,
        text: p.text,
        effect: p.effect,
        ratio: p.ratio!,
        hit: p.hit,
        accumulates: p.accumulates ?? false,
      })),
    lines: [
      ...[r, ...(target ? [target] : [])].flatMap((x) =>
        x.bill.lines
          .filter((l) => l.amount)
          .map((l) => ({
            label: lineLabel(l),
            provider: l.priceRef.provider,
            kind: l.kind,
            ...(l.priceRef.meterId ? { meterId: l.priceRef.meterId } : {}),
            amount: l.amount!,
            currency: l.currency,
            ...(l.priceRef.meterId === INVALIDATION_METER
              ? { quantity: l.quantity ?? 0 }
              : {}),
          })),
      ),
      ...(fee
        ? [
            {
              label: fee.label ?? `sakura-vps ${fee.name}（手数料・一度だけ）`,
              provider: 'sakura-vps',
              kind: 'fee' as const,
              amount: fee.amount,
              currency: 'JPY',
            },
          ]
        : []),
      ...commitLines.map((l) => ({
        label: l.label,
        provider: l.key.split(':')[0]!,
        kind: 'commitment' as const,
        amount: l.amount,
        currency: l.currency,
      })),
    ],
    unpricedLines: r.bill.unpricedLines + (target?.bill.unpricedLines ?? 0),
    settings: state.settings,
    ssrCpuMs,
    stock: state.stock,
    seats: state.seats,
    satisfaction: {
      stages,
      reasons,
      score,
      reputation: rep,
      acquisition: g.acquisition,
      churn: g.churn,
      growth: buzz ? buzzLasting(rep, buzzRule) * (1 - slowPenalty) - 1 : net,
      ...(slowPenalty > 0 ? { slowPenalty } : {}),
    },
    effort,
    featurePoints,
    components: comps,
    componentSummary: (Object.keys(SLOT_LABELS) as SlotId[])
      .filter(
        (slot) =>
          componentsOf(platformNow, slot, state.framework).length > 1 &&
          !slotIneffective(slot, comps, {
            stackIndex: stackIndexNow,
            framework: state.framework,
          }),
      )
      .map(
        (slot) =>
          `${SLOT_LABELS[slot]}: ${componentLabel(platformNow, slot, comps[slot])}`,
      )
      .join('・'),
    contractRevenue,
    ...(Object.keys(eligibleNow).length
      ? { commitmentEligible: eligibleNow }
      : {}),
    ...(commitLines.length ? { commitmentNet: -commitUsd } : {}),
    ...(swap
      ? {
          componentSwap: {
            label: `${SLOT_LABELS[swap.slot]}を ${componentLabel(platformNow, swap.slot, swap.option)} へ`,
            done: swap.done + effort.migration,
            required: swap.required,
          },
        }
      : {}),
    ...(state.migration
      ? {
          migration: {
            toName: stackName(state.migration.to, state.framework),
            done: state.migration.done + effort.migration,
            required: state.migration.required,
          },
        }
      : {}),
    ...(state.rewrite
      ? {
          rewrite: {
            toLabel: FRAMEWORKS[state.rewrite.to].label,
            done: state.rewrite.done + effort.migration,
            required: state.rewrite.required,
          },
        }
      : {}),
    framework: state.framework,
  };

  // 今月届いた提案は、月の終わりに返事を待つ
  const proposals = due.filter((x) => eventDef(sc, x.id)!.kind === 'proposal');

  const history = [...state.history, report];
  const finished = month >= sc.months;
  const end: GameState['end'] = accountSuspended
    ? { reason: 'policy', month }
    : outages > sc.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes(sc, { cash, outages, history }) ? 'won' : 'goal',
              month,
            }
          : undefined;
  // 乗り換え先で使えない描き方は既定に戻す（D-107）
  if (routes !== undefined) {
    const valid = validRouteOverrides(sc, stackIndex, framework, routes);
    routes = Object.keys(valid).length > 0 ? valid : undefined;
  }
  const { routes: _routes, ...base } = state;
  return {
    ...base,
    ...(routes !== undefined ? { routes } : {}),
    seed,
    stackIndex,
    framework,
    rewrite,
    settings,
    components,
    componentSwap,
    mods,
    storageOption,
    storageOptionFeeDue: null,
    cash,
    outages,
    featurePoints,
    migration,
    switching,
    plannedEffort: 0,
    policyWarnedMonth,
    stock,
    ...(coarseImages > 0 ? { coarseImages } : {}),
    fired,
    pendingProposals: end ? [] : proposals.map((x) => x.id),
    interrupts: state.interrupts
      .map((i) => ({ ...i, months: i.months - 1 }))
      .filter((i) => i.months > 0),
    growthBonus: state.growthBonus
      .map((b) => ({ ...b, months: b.months - 1 }))
      .filter((b) => b.months > 0),
    basePV: buzz
      ? basePV * buzzLasting(rep, buzzRule) * (1 - slowPenalty)
      : basePV * (1 + net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

function grow(sc: Scenario, state: GameState, humanPV: number): Stock {
  const rule = sc.stock!;
  const w = sc.template(1);
  // 1 MAU あたりの PV はテンプレートから読む（記事コミュニティは 10・業務アプリは 200。D-33）
  const mau = humanPV / Math.round(1 / w.traffic.mau);
  const uploads =
    mau * w.images.uploadsPerMau * (state.mods.uploadsFactor ?? 1);
  const s = state.stock;
  // 一律で縮めて置く部品なら、保存するのは縮めた大きさ（原本は残さない。D-47）
  const resize = imagesOf(state) === 'resize';
  const gbPerUpload = resize
    ? // 一律で縮めて置く: 形式が JPEG でなければ、古いブラウザ向けの JPEG も置く（MDN の推奨。D-58）
      (deliveredImageKB(sc, state.settings, 'resize') +
        (imageFormatOf(state.settings.imageKB) === 'jpeg'
          ? 0
          : sc.resizedImageKB)) /
      1e6
    : // 原本はそのまま置く（形式は閲覧・投稿のときに変える。D-58 で圧縮の比を掛けるのをやめた）
      rule.gbPerImage;
  return {
    dbGB:
      s.dbGB +
      (rule.dbGBPerMillionPV * humanPV * (state.mods.dbRateFactor ?? 1)) / 1e6,
    imagesGB: s.imagesGB + uploads * gbPerUpload,
    images: s.images + uploads,
    articlePages: s.articlePages,
  };
}

/** 境目を初めて越えた前提について、出来事ごとに効果を外した見積を引き直す（表示のためだけ）。 */
function crossingsOf(
  sc: Scenario,
  c: {
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    parts: WorkloadParts;
    architecture: ArchitectureInput;
    books: PriceBook[];
    humanPV: number;
    basePV: number;
    trafficEvents: {
      id: string;
      title: string;
      bot: boolean;
      factor: number;
      peak?: number;
    }[];
    state: GameState;
  },
): Crossing[] {
  const crossed = c.premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.hit &&
      Number.isFinite(p.ratio ?? NaN) &&
      // 前の月にも同じ前提があり、境目より下だった（1 か月目・乗り換えの直後は数えない）
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? Infinity) <= 1,
  );
  if (!crossed.length) return [];
  // 外してみる候補: 流量の出来事・受けた提案（Workload の変化・在庫の一括の増加）
  const variants: { eventId: string; title: string; parts: WorkloadParts }[] =
    [];
  for (const t of c.trafficEvents) {
    const pv = t.bot
      ? c.parts.pv - c.humanPV * (t.factor - 1)
      : c.parts.pv / t.factor;
    const peakFactor = (c.parts.peakFactor ?? 1) / (t.peak ?? 1);
    // 外した出来事の集中を除き、人の流量の出来事を外すなら残りの上乗せも同じ割合で小さくする
    const spikes = (c.parts.spikes ?? [])
      .filter((s) => s.id !== t.id)
      .map((s) => (t.bot ? s : { ...s, extraPV: s.extraPV / t.factor }));
    variants.push({
      eventId: t.id,
      title: t.title,
      parts: { ...c.parts, pv, peakFactor, spikes },
    });
  }
  for (const [id, res] of Object.entries(c.state.responses)) {
    if (res !== 'accepted') continue;
    const def = eventDef(sc, id);
    if (!def?.accept) continue;
    let mods = c.parts.mods;
    let stock = c.parts.stock;
    let pv = c.parts.pv;
    // basePV を外すと、話題・Bot の上乗せ（集中する分）も同じ割合で小さくなる（OCL-37A91830）
    let baseFactor = 1;
    for (const e of def.accept.effects) {
      if (e.type === 'workload') {
        const next = { ...mods };
        for (const k of Object.keys(e.mods) as (keyof WorkloadMods)[])
          delete next[k];
        mods = next;
      } else if (e.type === 'stock' && stock) {
        stock = {
          dbGB: stock.dbGB - (e.add.dbGB ?? 0),
          imagesGB: stock.imagesGB - (e.add.imagesGB ?? 0),
          images: stock.images - (e.add.images ?? 0),
          articlePages: stock.articlePages - (e.add.articlePages ?? 0),
        };
      } else if (e.type === 'basePV') {
        pv /= e.factor;
        baseFactor *= e.factor;
      }
    }
    const spikes = (c.parts.spikes ?? []).map((s) => ({
      ...s,
      extraPV: s.extraPV / baseFactor,
    }));
    variants.push({
      eventId: id,
      title: def.title,
      parts: { ...c.parts, mods, stock, pv, spikes },
    });
  }
  const ratios = variants.map((v) => {
    const r = estimate({
      workload: workloadFor(sc, v.parts),
      architecture: c.architecture,
      books: c.books,
    });
    return new Map(r.premises.map((p) => [p.id, p.ratio ?? 0]));
  });
  return crossed.map((p) => ({
    premiseId: p.id,
    text: p.text,
    causes: variants.flatMap((v, i) => {
      const without = ratios[i]!.get(p.id) ?? 0;
      return without <= 1
        ? [{ eventId: v.eventId, title: v.title, ratioWithout: without }]
        : [];
    }),
  }));
}

function passes(
  sc: Scenario,
  s: {
    cash: number;
    outages: number;
    history: readonly MonthReport[];
  },
): boolean {
  return (
    s.cash >= sc.goal.cash &&
    averageSatisfaction(s.history) >= sc.goal.satisfaction &&
    s.outages <= sc.goal.maxOutageMonths
  );
}

/** 今月見込みを出さない理由（一時的に流量が増えた月。プレイヤーにも見えている出来事。prd/07 §10.7）。 */
export function projectionNote(r: MonthReport): string | undefined {
  if (r.buzz)
    return '話題になった月の伸びは続かないかもしれないので、今月は見込みを出さない';
  if (r.trafficNote)
    return `一時的に流量が増えた月（${r.trafficNote}）なので、今月は見込みを出さない`;
  return undefined;
}
