// 始める画面のページごとの描き方（D-107・D-112）。フレームワークの既定から、ページごとに描き方を選び直す。
// 選ぶ場所はフレームワークのカードのページの欄（見取り図の隣のチップ。D-112）。ここは行・要件の判定・選んだときの書き換えをまとめる
// フック（useRoutePlanEditor）と、表で比べるダイアログ（RoutePlanCompare）を持つ。見積モードは行と判定を自分の PV で引き、
// 選んだときの書き換え（routeChoiceOf）だけを共用する（D-115）。
// 始める前なので手間はかからない（途中で替えるときは手間がかかる。RS-08）。
import {
  partsOfComments,
  routePlanRows,
  routePlanStatus,
  STACKS,
  withRouteChoice,
  type FrameworkId,
  type RouteAlternative,
  type RouteOverrides,
  type RoutePartKey,
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
import { PortalContainer } from './info.tsx';
import { ROUTE_PLAN_NOTE, RoutePlanTable } from './route-plan-table.tsx';

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
  onPart: (row: RoutePlanRow, part: RoutePartKey, value: number) => void;
};

export function useRoutePlanEditor({
  scenario,
  stackIndex,
  framework,
  components,
  revalidateSec,
  comments,
  routes,
  onChange,
  onCommentsChange,
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
  /** 記事のページのコメント欄を選ぶ（D-109）。 */
  onCommentsChange: (comments: number) => void;
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
  return {
    rows,
    status,
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
    onPart: (_, part, v) => {
      if (part === 'comments') onCommentsChange(v);
    },
  };
}

/**
 * 「詳しく比べる」のボタンと、全部のページの描き方を表で比べるダイアログ（D-112）。表は見積モードと同じ RoutePlanTable
 * （なぜ・要件の判定・ほかの描き方の 1 か月目の差）。`<dialog>` の showModal でフォーカスを閉じ込め、Esc・背景・閉じるのボタンで閉じ、
 * 閉じたらボタンへフォーカスを戻す。表の中で選んでも閉じない（カードの見取り図はダイアログの後ろで同じ選択で描き直る）。
 */
export function RoutePlanCompare({
  editor,
  frameworkLabel,
  note = 'ページごとに、なぜその描き方か・要件の判定・ほかの描き方にしたときの 1 か月目の費用の差を並べる。ここで選んでも、カードのチップで選んでも同じ（始める前なので手間はかからない。途中で替えると手間がかかる）。',
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
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        >
          <PortalContainer.Provider value={dialogEl}>
            <div className="modal-box w-11/12 max-w-5xl">
              <div className="flex items-start justify-between gap-2">
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
              <p className="mt-1 text-xs opacity-70">{note}</p>
              <div className="mt-2">
                <RoutePlanTable
                  rows={editor.rows}
                  status={editor.status}
                  onSelect={editor.onSelect}
                  onPart={editor.onPart}
                  caption={caption}
                />
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
