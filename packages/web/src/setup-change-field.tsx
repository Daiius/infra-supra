// ゲームの途中の「構成を変える」の畳んだ欄（D-185）。始める画面・見積モードの ①② のタブ（SetupTabs・StackField・FrameworkField）を
// 使い回し、今の状態を選んだ状態から選び直す。選び直した差は game の setupChangeOf が今ある行動（plan・migrate・component・
// rewrite・route・route-part）に写し取り、欄の下に変更の内訳（手間・期間・並行の費用・選べない理由）を出す。
// 「来月の行動にする」で今月の行動に登録し、「構成はこのまま」で取り消す。状態（選び直しの途中）はこの欄が持つ（D-115 の境目）。
import { useState } from 'react';
import {
  componentComparison,
  componentPreview,
  componentSlots,
  currentSetupDraft,
  draftComponentsFor,
  FRAMEWORKS,
  frameworkOnStack,
  frameworksOf,
  partsOfComments,
  resolvedRouteStrategies,
  rewriteRouteNotice,
  routePlanOf,
  routePlanRows,
  sameAsCurrent,
  scenarioOf,
  setupChangeOf,
  setupChangeSummary,
  setupCommentOptions,
  stackChangeRouteNotice,
  stackName,
  STACKS,
  stackUnsupportedReason,
  strategyFamily,
  swapLabel,
  validRouteOverrides,
  validSetupChoices,
  withRouteChoice,
  type Action,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
  type RoutePlanRow,
  type SetupChangeGroups,
  type SetupDraft,
} from 'game';
import type { SlotId } from 'catalog';
import { Info } from './info.tsx';
import { OptionText } from './option-text.tsx';
import type { RoutePlanEditor } from './route-plan-field.tsx';
import { FrameworkField } from './scenario-briefing.tsx';
import { SetupTabs, type SetupChoices } from './setup-components.tsx';
import { frameworkFallbackNotice, StackField } from './stack-field.tsx';

/** 選んだ部品（undefined を除く）。 */
const chosenOf = (c: SetupChoices) =>
  Object.fromEntries(
    Object.entries(c).filter((x): x is [string, string] => x[1] !== undefined),
  );

/**
 * 欄で見せる描き方の選択（今の選択に、選び直したページを重ねたもの）。フレームワークを替えると今の選択は持ち越さない
 * （作り直すと既定に戻る。D-107）。構成を替えると、替えた先で選べないものは外す。
 */
function draftOverrides(state: GameState, draft: SetupDraft): RouteOverrides {
  const sc = scenarioOf(state);
  const base =
    draft.framework === state.framework
      ? validRouteOverrides(
          sc,
          draft.stackIndex,
          draft.framework,
          state.routes,
          state.legacyRouteDefaults,
        )
      : {};
  let out = base;
  for (const [route, want] of Object.entries(draft.routes))
    if (want)
      out = withRouteChoice(
        sc,
        {
          framework: draft.framework,
          platform: STACKS[draft.stackIndex]!.provider,
          legacyRouteDefaults: state.legacyRouteDefaults,
        },
        out,
        route,
        want.strategy,
      );
  return out;
}

/** 欄で見せる revalidateSec（選び直した描き方が一緒に替えるもの。S3 はオンデマンドなど）。 */
function draftRevalidate(state: GameState, draft: SetupDraft): number {
  let v = state.settings.revalidateSec;
  for (const want of Object.values(draft.routes))
    if (want?.value !== undefined) v = want.value;
  return v;
}

/**
 * 描き方のチップに出す選択肢（今の描き方と同じ分け方のものは出さない。期限と「更新で消す」（S2 ↔ S3）は設定の欄で替える。
 * 前の行動の欄と同じ絞り方）。
 */
function alternativesOf(row: RoutePlanRow, now: RoutePlanRow['strategy']) {
  const fam = strategyFamily(now);
  const hasTtl = row.alternatives.some((b) => b.strategy === 'cached-ttl');
  return row.alternatives.filter(
    (a) =>
      a.strategy === now ||
      (strategyFamily(a.strategy) !== fam &&
        !(a.strategy === 'cached-purge' && hasTtl)),
  );
}

export function SetupChangeField({
  state,
  registered,
  onRegister,
  wrap,
}: {
  state: GameState;
  /** 来月の行動として登録した選び直し（無ければ null）。 */
  registered: SetupDraft | null;
  onRegister: (d: SetupDraft | null) => void;
  /** 写し取った行動を今月の行動の並び全体に入れる（ほかの行動と合わせて選べるかを見る）。 */
  wrap: (g: SetupChangeGroups) => Action[];
}) {
  const sc = scenarioOf(state);
  // 開いたときだけ中身を描く（構成のカードは図を描くので重い）。開閉は summary を押して切り替える
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SetupDraft>(
    () => registered ?? currentSetupDraft(state),
  );
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const registeredChange = registered ? setupChangeOf(state, registered) : null;
  const summary = registeredChange
    ? setupChangeSummary(registeredChange)
    : null;
  const busy = [
    state.rewrite
      ? `${FRAMEWORKS[state.rewrite.to].label} へ作り直し中（${state.rewrite.done} / ${state.rewrite.required} ポイント）です。済むまで今のアプリのまま動き、乗り換え・部品の差し替えはできません。`
      : null,
    state.componentSwap
      ? `${swapLabel(state.componentSwap.slot)}の最中（${state.componentSwap.done} / ${state.componentSwap.required} ポイント）です。済むまで部品は差し替えられません。`
      : null,
  ].filter((x): x is string => x !== null);
  return (
    <details
      className="collapse collapse-arrow bg-base-200"
      open={open}
      data-setup-change
    >
      <summary
        className="collapse-title min-h-0 py-2 text-sm"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <span className="font-bold">構成を変える</span>
        <span className="opacity-70">
          （今:{' '}
          {stackName(
            state.stackIndex,
            state.framework,
            false,
            state.components,
          )}
          ・{FRAMEWORKS[state.framework].label}）
        </span>
        {summary && (
          <span className="block break-words text-primary">
            来月の行動: {summary}
          </span>
        )}
        {busy.map((b) => (
          <span key={b} className="block text-xs">
            {b}
          </span>
        ))}
      </summary>
      <div className="collapse-content min-w-0 space-y-2 px-1 sm:px-4">
        {open && (
          <ChangeBody
            state={state}
            draft={draft}
            setDraft={setDraft}
            fallbackNotice={fallbackNotice}
            setFallbackNotice={setFallbackNotice}
            registered={registered}
            onRegister={onRegister}
            wrap={wrap}
            scenarioHidden={STACKS[state.stackIndex]!.hidden === true}
            allowed={frameworksOf(sc).allowed}
          />
        )}
      </div>
    </details>
  );
}

function ChangeBody({
  state,
  draft,
  setDraft,
  fallbackNotice,
  setFallbackNotice,
  registered,
  onRegister,
  wrap,
  scenarioHidden,
  allowed,
}: {
  state: GameState;
  draft: SetupDraft;
  setDraft: (d: SetupDraft) => void;
  fallbackNotice: string | null;
  setFallbackNotice: (s: string | null) => void;
  registered: SetupDraft | null;
  onRegister: (d: SetupDraft | null) => void;
  wrap: (g: SetupChangeGroups) => Action[];
  scenarioHidden: boolean;
  allowed: FrameworkId[];
}) {
  const sc = scenarioOf(state);
  const routes = draftOverrides(state, draft);
  const revalidateSec = draftRevalidate(state, draft);
  const routeParts = partsOfComments(sc, draft.comments);
  const commentsOn =
    setupCommentOptions(sc, draft.framework, routes).length > 0
      ? draft.comments
      : undefined;
  // 今の描き方（選び直したページを「今」に戻すと、選び直しを消す）
  const now = Object.fromEntries(
    routePlanOf(state).map((r) => [r.route, r.strategy]),
  );
  const sameFw = draft.framework === state.framework;
  const rows = routePlanRows(sc, {
    framework: draft.framework,
    stackIndex: draft.stackIndex,
    settings: { revalidateSec },
    components: chosenOf(draft.components),
    routes,
    legacyRouteDefaults: sameFw ? state.legacyRouteDefaults : undefined,
    routeParts,
  }).map((r) => ({
    ...r,
    alternatives: alternativesOf(
      r,
      (sameFw ? now[r.route] : undefined) ?? r.strategy,
    ),
  }));
  const editor: RoutePlanEditor = {
    rows,
    // 要件の判定（1 か月目の見込み）は始める画面のもの。途中では出さない
    status: [],
    onSelect: (row, alt) => {
      const next = { ...draft.routes };
      const from = sameFw ? now[row.route] : undefined;
      if (
        from !== undefined &&
        strategyFamily(from) === strategyFamily(alt.strategy)
      )
        delete next[row.route];
      else
        next[row.route] = {
          strategy: alt.strategy,
          ...(alt.value !== undefined ? { value: alt.value } : {}),
        };
      setDraft({ ...draft, routes: next });
    },
    onPart: (_, part, v) => {
      if (part === 'comments') setDraft({ ...draft, comments: v });
    },
  };
  /** その構成・フレームワークで欄が始める部品（同じ事業者のプランの間は選び直した部品を引き継ぐ。D-176）。 */
  const componentsFor = (i: number, fw: FrameworkId): SetupChoices =>
    STACKS[i]!.provider === STACKS[draft.stackIndex]!.provider &&
    fw === draft.framework
      ? validSetupChoices(sc, i, fw, chosenOf(draft.components))
      : draftComponentsFor(state, i, fw);
  const onStack = (i: number) => {
    const fw = frameworkOnStack(sc, i, draft.framework);
    setFallbackNotice(
      fw === draft.framework
        ? null
        : frameworkFallbackNotice(
            i,
            draft.framework,
            fw,
            Object.keys(draft.routes).length > 0,
          ),
    );
    setDraft({
      ...draft,
      stackIndex: i,
      framework: fw,
      components: componentsFor(i, fw),
      routes: fw === draft.framework ? draft.routes : {},
    });
  };
  const onFramework = (fw: FrameworkId) => {
    setFallbackNotice(null);
    setDraft({
      ...draft,
      framework: fw,
      components: draftComponentsFor(state, draft.stackIndex, fw),
      routes: {},
    });
  };
  const onComponents = (v: SetupChoices) =>
    setDraft({
      ...draft,
      components: validSetupChoices(
        sc,
        draft.stackIndex,
        draft.framework,
        chosenOf(v),
      ),
    });
  // 部品の ⓘ の比較は、今の構成のまま部品だけ替えるときだけ（今月の規模で、そのスロットだけ替えた月の費用。D-124）
  const slots = componentSlots(state);
  const partsCompare =
    draft.stackIndex === state.stackIndex && sameFw
      ? (slot: string) => {
          const x = slots.find((s) => s.slot === slot);
          return {
            rows: x ? componentComparison(state, x.slot, x.current) : [],
            basis: `今月の基準の規模（月 ${state.basePV.toLocaleString('ja-JP')} PV）と今の他の部品で、${x?.label ?? slot}だけを替えた月の費用（構成全体）。出来事・話題の上乗せ・差し替えの期間の二重の費用は含めない目安です。縦の線は今の部品の額です${
              slot === 'db' || slot === 'api'
                ? '。データの移行があるので、手間を入れ終えた翌月に切り替わり、期間中は新旧両方の費用を払います（変更の内訳の ⓘ に詳しく出します）'
                : ''
            }`,
          };
        }
      : undefined;
  const same = sameAsCurrent(state, draft);
  const change = setupChangeOf(state, draft, wrap);
  const isRegistered =
    registered !== null && JSON.stringify(registered) === JSON.stringify(draft);
  return (
    <>
      {/* 隠した構成（D-100）で始めた古い保存はそのまま続けられる。選び直す先には出さない */}
      {scenarioHidden && (
        <p className="text-xs opacity-70">
          今の構成は、新しく始めるときには選べなくしています（一時的）。このまま続けられますが、同じ事業者のプラン変更や、乗り換えてから戻ることはできません。
        </p>
      )}
      <p className="text-xs opacity-70">
        今の構成・部品・フレームワーク・ページの描き方を選んだ状態から始まります。選び直すと、下に変更の内訳（手間・期間・選べない理由）が出ます。
      </p>
      <SetupTabs
        storageKey="infra-supra:setup-tab:game-change"
        stack={{
          label: '① インフラの構成',
          summary: stackName(
            draft.stackIndex,
            draft.framework,
            false,
            draft.components,
          ),
          panel: (
            <StackField
              scenario={sc}
              framework={draft.framework}
              value={draft.stackIndex}
              onChange={onStack}
              components={draft.components}
              rememberedOf={(i) =>
                componentsFor(i, frameworkOnStack(sc, i, draft.framework))
              }
              comments={commentsOn}
              routes={routes}
              routeNotice={(i) =>
                i === state.stackIndex ? null : stackChangeRouteNotice(state, i)
              }
              onComponentsChange={onComponents}
              partsNote="役割ごとに選び直します。差し替えの手間と期間は下の変更の内訳に出ます"
              partsCompare={partsCompare}
              diagramCaption={(selected) =>
                selected
                  ? '選んでいる部品で描いています。'
                  : 'この構成にしたときに始まる部品で描いています。'
              }
              alsoShow={state.stackIndex}
            />
          ),
        }}
        framework={{
          label: '② フレームワークと描き方',
          summary: FRAMEWORKS[draft.framework].label,
          warn: fallbackNotice,
          live: fallbackNotice,
          panel: (
            <FrameworkField
              scenario={sc}
              allowed={allowed}
              value={draft.framework}
              onChange={onFramework}
              comments={commentsOn}
              routePlan={(id) =>
                routePlanRows(sc, {
                  framework: id,
                  stackIndex: draft.stackIndex,
                  settings: { revalidateSec },
                  components: chosenOf(
                    draftComponentsFor(state, draft.stackIndex, id),
                  ),
                  routeParts,
                })
              }
              routes={routes}
              resolvedRoutes={(id, selected) =>
                resolvedRouteStrategies(sc, {
                  framework: id,
                  stackIndex: draft.stackIndex,
                  settings: { revalidateSec },
                  components: chosenOf(
                    selected
                      ? draft.components
                      : draftComponentsFor(state, draft.stackIndex, id),
                  ),
                  ...(selected ? { routes } : {}),
                })
              }
              routeNotice={(id) =>
                id === state.framework ? null : rewriteRouteNotice(state, id)
              }
              editor={editor}
              unsupported={(id) => stackUnsupportedReason(draft.stackIndex, id)}
              notice={fallbackNotice}
              text={{
                heading: '② フレームワークとページの描き方',
                footnote:
                  'フレームワークを替えるのはアプリの作り直しです（大きな手間・数か月。その間は機能開発がほぼ止まります）。ページの描き方とコメント欄は来月から替わります。期限と「更新で消す」は下の設定の欄で替えます。',
                compareHint: null,
              }}
            />
          ),
        }}
      />
      <section aria-label="変更の内訳" className="space-y-1">
        <h3 className="text-sm font-bold">変更の内訳</h3>
        {same ? (
          <p className="text-sm opacity-70">
            今の構成と同じです（変更はありません）。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {change.items.map((x) => (
              <li
                key={`${x.kind}:${x.name}`}
                data-change-kind={x.kind}
                className={`text-sm ${x.why ? 'opacity-80' : ''}`}
              >
                <OptionText
                  name={x.name}
                  meta={x.meta}
                  info={
                    x.detail ? (
                      <Info title={x.name}>{x.detail}</Info>
                    ) : undefined
                  }
                  why={x.why ? `できません: ${x.why}` : null}
                  notice={x.notice ?? null}
                />
                {x.action?.type === 'component' && (
                  <PartPreview
                    state={state}
                    slot={x.action.slot}
                    option={x.action.option}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {!same && change.why && (
          <p className="text-xs text-error" role="note">
            この組み合わせでは来月の行動にできません。
          </p>
        )}
      </section>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(registered !== null || !same) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDraft(currentSetupDraft(state));
              onRegister(null);
            }}
          >
            構成はこのまま
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={same || change.why !== null || isRegistered}
          onClick={() => onRegister(draft)}
        >
          {isRegistered ? '来月の行動にしました' : '来月の行動にする'}
        </button>
      </div>
    </>
  );
}

/** 部品に替えると当たりうる上限（選ぶ前に前提の文を出す。D-24）。 */
function PartPreview({
  state,
  slot,
  option,
}: {
  state: GameState;
  slot: SlotId;
  option: string;
}) {
  const preview = componentPreview(state, slot, option);
  if (preview.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {preview.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-1">
          <span
            className={`badge badge-xs ${p.hit ? 'badge-error' : 'badge-ghost'}`}
          >
            {p.hit ? '✗ 上限に達する' : '○ 達する可能性のある上限'}
          </span>
          {p.text}
          {p.ratio !== undefined && (
            <span className="tabular-nums opacity-70">
              （今の規模で {(p.ratio * 100).toFixed(0)}%）
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
