// 始める画面のページごとの描き方（D-107・D-112）。フレームワークの既定から、ページごとに描き方を選び直す。
// 選ぶ場所はフレームワークのカードのページの欄（見取り図の隣のチップ。D-112）。ここは行・要件の判定・選んだときの書き換えをまとめる
// フック（useRoutePlanEditor）と、表で比べるダイアログ（RoutePlanCompare）を持つ。見積モードは行と判定を自分の PV で引き、
// 選んだときの書き換え（routeChoiceOf）だけを共用する（D-115）。
// 始める前なので手間はかからない（途中で替えるときは手間がかかる。RS-08）。
import {
  articleFamily,
  COMMENTS_IN_BROWSER,
  invalidationNote,
  isOnDemand,
  onDemandBlocker,
  partsOfComments,
  publicRouteId,
  revalidateSettingOf,
  routePlanRows,
  routePlanStatus,
  SETTINGS,
  setupInvalidationEstimate,
  setupRevalidateOptions,
  STACKS,
  withRouteChoice,
  type FrameworkId,
  type SettingKey,
  type RouteAlternative,
  type RouteOverrides,
  type RoutePlanRow,
  type RouteRowStatus,
  type Scenario,
} from 'game';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ROUTE_STRATEGIES } from 'catalog';
import { PortalContainer } from './info.tsx';
import { ROUTE_PLAN_NOTE, RoutePlanTable } from './route-plan-table.tsx';
import { SettingChips } from './setup-components.tsx';
import { commentOptionsOf } from './comments-choice.ts';

/**
 * ページの描き方を選んだときの書き換え（始める画面と見積モードで共用。D-115）: 選んだ描き方（フレームワークの既定と違うものだけ
 * 残す。game の withRouteChoice）と、一緒に替える revalidateSec（S3 はオンデマンドなど。undefined は今のまま）。
 */
export function routeChoiceOf(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  routes: RouteOverrides,
  row: RoutePlanRow,
  alt: RouteAlternative,
): { routes: RouteOverrides; revalidateSec: number | undefined } {
  return {
    routes: withRouteChoice(
      scenario,
      { framework, platform: STACKS[stackIndex]!.provider },
      routes,
      row.route,
      alt.strategy,
    ),
    revalidateSec: alt.value,
  };
}

/** 選んでいるフレームワークのページごとの描き方を選ぶのに要るもの（カードのチップと比べる表で共有する）。 */
export type RoutePlanEditor = {
  rows: RoutePlanRow[];
  status: RouteRowStatus[];
  onSelect: (row: RoutePlanRow, alt: RouteAlternative) => void;
  /** 記事のページの行で選ぶ描き方の設定（再検証の間隔など。選べなければ undefined。D-119）。 */
  setting?: RouteSettingEditor | undefined;
};

/**
 * 描き方の設定（revalidateSec。ISR の再検証・Astro の記事のキャッシュ・静的書き出しのビルドの間隔・SPA の API のキャッシュの期間・
 * 部品ごとにキャッシュの期限）。記事のページ（全員に同じ中身のページ）の行の描き方のチップの下で選ぶ（D-119）。
 */
export type RouteSettingEditor = {
  /** 設定を出す行（記事のページ）。 */
  route: string;
  key: SettingKey;
  value: number;
  options: readonly { value: number; label: string; flavor?: string }[];
  onChange: (v: number) => void;
  /** オンデマンドを選べない理由（今の部品・置き場では消せない。onDemandBlocker）。 */
  onDemandBlocked?: string | undefined;
  /** オンデマンドの注記（CloudFront の無効化の見込み。D-66）。 */
  onDemandNote?: string | undefined;
};

/** 描き方の設定の行の組み立て（始める画面と見積モードで共用。選べる選択肢は画面ごとに渡す。D-119）。 */
export function routeSettingOf(p: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: Partial<Record<string, string>>;
  routes: RouteOverrides;
  value: number;
  options: readonly { value: number; label: string; flavor?: string }[];
  onChange: (v: number) => void;
  onDemandNote?: string | undefined;
}): RouteSettingEditor | undefined {
  const route = publicRouteId(p.scenario);
  if (route === undefined || p.options.length === 0) return undefined;
  const fam = articleFamily(p);
  const chosen = Object.fromEntries(
    Object.entries(p.components).filter(
      (x): x is [string, string] => x[1] !== undefined,
    ),
  );
  const blocker = onDemandBlocker(p.stackIndex, chosen, p.framework, fam);
  return {
    route,
    key: revalidateSettingOf(p.framework, fam),
    value: p.value,
    options: p.options,
    onChange: p.onChange,
    ...(blocker
      ? {
          onDemandBlocked: `${blocker.label}: ${blocker.reason.replace(/。$/, '')}`,
        }
      : {}),
    ...(p.onDemandNote ? { onDemandNote: p.onDemandNote } : {}),
  };
}

/** 描き方の設定を出す描き方（毎回描く・サーバーの島には期限が無い。Next.js の「キャッシュしない」で毎回描くときも出さない）。 */
const SETTING_STRATEGIES: ReadonlySet<string> = new Set([
  'static-build',
  'cached-ttl',
  'cached-purge',
  'cache-components',
  'shell-api',
]);

/** 描き方の設定の文（チップの見出し・注記と、カードの ⓘ の SettingExplain で共用）。 */
function settingTexts(x: RouteSettingEditor, row: RoutePlanRow) {
  const def = SETTINGS[x.key];
  const cc = row.strategy === 'cache-components';
  const cached =
    row.strategy === 'cached-ttl' || row.strategy === 'cached-purge';
  const label = cc ? '部品の作り直し（cacheLife・タグ）' : def.label;
  const onDemand = x.options.find((o) =>
    isOnDemand({ revalidateSec: o.value }),
  );
  const options = [
    ...x.options.filter((o) => o !== onDemand),
    ...(onDemand ? [onDemand] : []),
  ].map((o) => ({
    ...o,
    why: o === onDemand ? (x.onDemandBlocked ?? null) : null,
  }));
  // 描き方の名前は表の行と同じ（選んだフレームワークでの呼び名。D-193）
  const nameOf = (s: 'cached-ttl' | 'cached-purge') =>
    s === row.strategy
      ? row.strategyLabel
      : (row.alternatives.find((a) => a.strategy === s)?.label ??
        ROUTE_STRATEGIES[s].label);
  const relation =
    cached && onDemand
      ? `時間を選ぶと「${nameOf('cached-ttl')}」、「${onDemand.label}」を選ぶと「${nameOf('cached-purge')}」（上の 2 つの描き方は、この設定で切り替わります）`
      : undefined;
  const note =
    cc && onDemand
      ? `時間は部品の期限（cacheLife）、「${onDemand.label}」は投稿・編集でタグを消して作り直します（updateTag）。${def.note}`
      : def.note;
  const blocked =
    onDemand && x.onDemandBlocked
      ? `「${onDemand.label}」は選べない（${x.onDemandBlocked}）`
      : undefined;
  const ifOnDemand =
    onDemand && !x.onDemandBlocked && x.onDemandNote
      ? `「${onDemand.label}」にすると: ${x.onDemandNote}`
      : undefined;
  return { label, note, options, relation, blocked, ifOnDemand };
}

/**
 * 記事のページの行の描き方の設定のチップ（D-119）。時間を先に、オンデマンドを最後に並べる。S2（時間で取り直す）と S3（更新で消す）は
 * 同じ設定なので、その関係をチップの下に添える。オンデマンドを選べない置き場では灰色にして理由を ⓘ に出す。
 * info={false}（フレームワークのカード）は ⓘ と下の注記を出さず、文はカードの ⓘ の SettingExplain にまとめる（D-219）。
 */
export function RouteSettingChips({
  setting: x,
  row,
  info = true,
}: {
  setting: RouteSettingEditor;
  row: RoutePlanRow;
  info?: boolean;
}) {
  if (!SETTING_STRATEGIES.has(row.strategy)) return null;
  const t = settingTexts(x, row);
  return (
    <SettingChips
      setting={x.key}
      label={t.label}
      note={t.note}
      options={t.options}
      value={x.value}
      onChange={x.onChange}
      info={info}
    >
      {info && t.relation && (
        <p className="text-[11px] opacity-70">{t.relation}</p>
      )}
      {info && t.blocked && (
        <p className="text-[11px] opacity-70">{t.blocked}</p>
      )}
      {info && t.ifOnDemand && (
        <p className="text-[11px] text-warning">{t.ifOnDemand}</p>
      )}
    </SettingChips>
  );
}

/** 描き方の設定の選べない選択肢と理由（カードの「選べない選択肢について」に使う。D-220）。 */
export function settingUnavailableOf(
  x: RouteSettingEditor,
  row: RoutePlanRow,
): { label: string; why: string }[] {
  if (!SETTING_STRATEGIES.has(row.strategy)) return [];
  const t = settingTexts(x, row);
  return t.options.flatMap((o) =>
    o.why && o.value !== x.value
      ? [{ label: `${o.label}（${t.label}）`, why: o.why }]
      : [],
  );
}

/** カードの ⓘ に出す、描き方の設定の説明（RouteSettingChips の ⓘ と注記の文。D-219）。 */
export function SettingExplain({
  setting: x,
  row,
}: {
  setting: RouteSettingEditor;
  row: RoutePlanRow;
}) {
  if (!SETTING_STRATEGIES.has(row.strategy)) return null;
  const t = settingTexts(x, row);
  const flavors = t.options.filter((o) => o.flavor);
  return (
    <div className="space-y-1" data-setting-explain>
      <p className="font-semibold">{t.label}</p>
      {t.note && <p>{t.note}</p>}
      {flavors.length > 0 && (
        <dl aria-label={`${t.label}の選択肢`} className="space-y-1">
          {flavors.map((o) => (
            <div key={o.value}>
              <dt className="inline font-semibold">{o.label}</dt>:{' '}
              <dd className="inline">{o.flavor}</dd>
            </div>
          ))}
        </dl>
      )}
      {t.relation && <p>{t.relation}</p>}
      {t.blocked && <p>{t.blocked}</p>}
      {t.ifOnDemand && <p className="text-warning">{t.ifOnDemand}</p>}
    </div>
  );
}

export function useRoutePlanEditor({
  scenario,
  stackIndex,
  framework,
  components,
  revalidateSec,
  comments,
  routes,
  onChange,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: Partial<Record<string, string>>;
  revalidateSec: number;
  /** 記事のページのコメント欄（ページの部品。D-82・D-109）。 */
  comments: number;
  routes: RouteOverrides;
  /** 選んだ描き方と、一緒に替える revalidateSec（S3 はオンデマンドなど。省略は今のまま）。 */
  onChange: (routes: RouteOverrides, revalidateSec?: number) => void;
}): RoutePlanEditor {
  const chosen = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(components).filter(
          (x): x is [string, string] => x[1] !== undefined,
        ),
      ),
    [components],
  );
  const rows = useMemo(
    () =>
      routePlanRows(scenario, {
        framework,
        stackIndex,
        settings: { revalidateSec },
        components: chosen,
        routes,
        routeParts: partsOfComments(scenario, comments),
      }),
    [scenario, framework, stackIndex, revalidateSec, comments, chosen, routes],
  );
  const status = useMemo(
    () =>
      routePlanStatus(scenario, {
        framework,
        stackIndex,
        components: chosen,
        revalidateSec,
        comments,
        routes,
      }),
    [scenario, framework, stackIndex, chosen, revalidateSec, comments, routes],
  );
  const revalidateOptions = useMemo(
    () => setupRevalidateOptions(scenario, framework, routes),
    [scenario, framework, routes],
  );
  // OpenNext で ISR を CloudFront にキャッシュするとき、オンデマンドの無効化の見込み（1 か月目の規模。D-66）
  const invalidation = useMemo(() => {
    if (revalidateOptions.length === 0) return undefined;
    const e = setupInvalidationEstimate(
      scenario,
      stackIndex,
      framework,
      chosen,
      // コメント欄を選べない描き方では、ブラウザで読み込む（無効化の見込みに含めない。D-82・D-109）
      commentOptionsOf(scenario, framework, routes).length > 0
        ? comments
        : COMMENTS_IN_BROWSER,
    );
    return e && invalidationNote(e);
  }, [
    scenario,
    stackIndex,
    framework,
    chosen,
    routes,
    revalidateOptions,
    comments,
  ]);
  return {
    rows,
    status,
    setting: routeSettingOf({
      scenario,
      stackIndex,
      framework,
      components,
      routes,
      value: revalidateSec,
      options: revalidateOptions,
      onChange: (v) => onChange(routes, v),
      onDemandNote: invalidation,
    }),
    onSelect: (row, alt) => {
      const next = routeChoiceOf(
        scenario,
        stackIndex,
        framework,
        routes,
        row,
        alt,
      );
      onChange(next.routes, next.revalidateSec);
    },
  };
}

/**
 * ⚠ 今は画面から参照していない（D-220。使い方が分かりにくい割に情報が多いので、カードの ⓘ から外した。ソースだけ残す）。
 * 「詳しく比べる」のボタンと、全部のページの描き方を表で比べるダイアログ（D-112）。表は見積モードと同じ RoutePlanTable
 * （なぜ・要件の判定・ほかの描き方の 1 か月目の差）。`<dialog>` の showModal でフォーカスを閉じ込め、Esc・背景・閉じるのボタンで閉じ、
 * 閉じたらボタンへフォーカスを戻す。表の中で選んでも閉じない（カードの見取り図はダイアログの後ろで同じ選択で描き直る）。
 */
export function RoutePlanCompare({
  editor,
  frameworkLabel,
  note = 'ページごとに、なぜその描き方か・要件の判定・ほかの描き方にしたときの 1 か月目の費用の差を並べます。ここで選んでも、カードのチップで選んでも同じです（始める前なので手間はかかりません。途中で替えると手間がかかります）。',
  caption = ROUTE_PLAN_NOTE,
}: {
  editor: RoutePlanEditor;
  frameworkLabel: string;
  /** ダイアログの見出しの下の説明（画面ごと。D-115）。 */
  note?: string;
  /** 表の説明。 */
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  // ⓘ の吹き出しをダイアログの中に描く（body に描くと top layer のダイアログの後ろに隠れる。OCL-8E844E7C）
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const dialogRef = useCallback((el: HTMLDialogElement | null) => {
    dialog.current = el;
    setDialogEl(el);
  }, []);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-outline btn-sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        詳しく比べる
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="modal"
          aria-labelledby={titleId}
          onClose={(e) => {
            // ⓘ の中に重ねて開くので、close を親の ⓘ のダイアログへ伝えない（D-219）
            e.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
          }}
        >
          <PortalContainer.Provider value={dialogEl}>
            <div className="modal-box flex flex-col overflow-hidden w-11/12 max-w-5xl">
              {/* 見出しと × は固定し、表だけスクロールする（D-208） */}
              <div className="flex shrink-0 items-start justify-between gap-2">
                <h2 id={titleId} className="text-lg font-bold">
                  ページの描き方を比べる（{frameworkLabel}）
                </h2>
                <form method="dialog">
                  <button
                    className="btn btn-circle btn-ghost btn-sm"
                    aria-label="閉じる"
                    autoFocus
                  >
                    ✕
                  </button>
                </form>
              </div>
              <div
                className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain"
                data-modal-scroll
              >
                <p className="text-xs opacity-70">{note}</p>
                <div className="mt-2">
                  <RoutePlanTable
                    rows={editor.rows}
                    status={editor.status}
                    onSelect={editor.onSelect}
                    caption={caption}
                  />
                </div>
              </div>
            </div>
          </PortalContainer.Provider>
          <form method="dialog" className="modal-backdrop">
            <button aria-label="背景を押して閉じる" tabIndex={-1}>
              閉じる
            </button>
          </form>
        </dialog>
      )}
    </>
  );
}
