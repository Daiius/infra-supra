// 部品を選び残したまま「運営を始める」に来たときの手段（D-125）。ゲームの始める画面の「運営を始める」の上に出す。
// - ジャンプ: 未選択のスロットの名前を押すと ① のタブを開き、そのスロットの選択 UI（構成図の箱・機能のチップ）へ移る（SetupTabs の focusSlot）。
// - ダイアログ: 「残りを選ぶ」で、未選択のスロットだけを ① の「機能から選ぶ」と同じチップ（PartChips）で並べて、その場で選ぶ。
// - 全部既定: 「残りを既定にする」で、未選択のスロットを既定の部品（game の setupWithDefaults）で埋める。
// 状態（部品の選択と整合）は画面が持ち、ここは選択を受けて描き、変更を返すだけ。
import {
  setupMissingSlots,
  setupWithDefaults,
  type FrameworkId,
  type Scenario,
} from 'game';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { PortalContainer } from './info.tsx';
import {
  isUnselected,
  PartChips,
  usePartSlots,
  type PartsCompare,
  type SetupChoices,
} from './setup-components.tsx';

export function MissingParts({
  scenario,
  stackIndex,
  framework,
  value,
  onChange,
  compare,
  onJump,
  onComplete,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  /** 選んだ部品（選べなくなったものは画面が外してある）。 */
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  /** 部品の ⓘ の比較（D-124。① のチップと同じ）。 */
  compare?: PartsCompare | undefined;
  /** スロットの選択 UI へ移る（① のタブを開いてフォーカスする）。 */
  onJump: (slot: string) => void;
  /** 残りが無くなったとき（既定で埋めた・ダイアログで選び終えて閉じた）。「運営を始める」へフォーカスを移すのに使う。 */
  onComplete?: (() => void) | undefined;
}) {
  const missing = useMemo(
    () => setupMissingSlots(scenario, stackIndex, framework, value),
    [scenario, stackIndex, framework, value],
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const fill = () =>
    onChange(setupWithDefaults(scenario, stackIndex, framework, value));
  return (
    <>
      {missing.length > 0 && (
        // 始める前に気づけるよう、警告の色の面で左寄せに出す（D-219）
        <div
          className="flex w-full flex-col items-start gap-2 rounded-box border border-warning/60 bg-warning/10 p-3"
          data-missing-parts
        >
          <p className="flex items-start gap-2 text-sm" role="status">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <span>
              <span className="font-semibold">部品をまだ選んでいません:</span>{' '}
              {missing.map((x, i) => (
                <Fragment key={x.slot}>
                  {i > 0 && '・'}
                  <button
                    type="button"
                    className="link font-semibold decoration-warning decoration-2 underline-offset-2"
                    title={`① インフラの構成で${x.label}を選ぶ`}
                    data-missing-slot={x.slot}
                    onClick={() => onJump(x.slot)}
                  >
                    {x.label}
                  </button>
                </Fragment>
              ))}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={trigger}
              type="button"
              className="btn btn-outline btn-sm"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              残りを選ぶ
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="未選択のスロットを、この構成の既定の部品で埋めます（選んだ部品は替えません）"
              onClick={() => {
                // 埋めた選択を描き終えてから（「運営を始める」が押せるようになってから）フォーカスを移す
                flushSync(fill);
                onComplete?.();
              }}
            >
              残りを既定にする
            </button>
          </div>
        </div>
      )}
      {open && (
        <MissingPartsDialog
          scenario={scenario}
          stackIndex={stackIndex}
          framework={framework}
          value={value}
          onChange={onChange}
          compare={compare}
          remaining={missing.length}
          onFill={fill}
          onClose={() => {
            setOpen(false);
            // 選び終えていれば「運営を始める」へ、残っていれば開いたボタンへ戻す
            if (missing.length === 0) onComplete?.();
            else trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * 未選択のスロットだけを並べたダイアログ（D-125）。開いたときに未選択だったスロットは、選んだ後も（畳んだ行で）出したままにし、
 * 選ぶと出てくるスロット（DB で決まる DB のバックアップなど）で未選択のものも足す。`<dialog>` の showModal でフォーカスを閉じ込め、
 * Esc・背景・閉じるのボタンで閉じる（RoutePlanCompare と同じ作り）。
 */
function MissingPartsDialog({
  scenario,
  stackIndex,
  framework,
  value,
  onChange,
  compare,
  remaining,
  onFill,
  onClose,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  compare?: PartsCompare | undefined;
  remaining: number;
  onFill: () => void;
  onClose: () => void;
}) {
  const all = usePartSlots(scenario, stackIndex, framework, value);
  // 開いたときに未選択だったスロット（選んだ後も畳んだ行で残す）
  const [initial] = useState(
    () => new Set(all.filter((x) => isUnselected(x, value)).map((x) => x.slot)),
  );
  const slots = all.filter(
    (x) => initial.has(x.slot) || isUnselected(x, value),
  );
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
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      data-missing-parts-dialog
      // 中の部品の ⓘ の比較のダイアログ（portal でも React の木では子）の close が伝わってくるので、自分の close だけで閉じる（OCL-763C2E15）
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <PortalContainer.Provider value={dialogEl}>
        <div className="modal-box flex flex-col overflow-hidden w-11/12 max-w-3xl px-3 sm:px-6">
          {/* 見出しと × と下のボタンは固定し、説明と部品の一覧だけスクロールする（D-208） */}
          <div className="flex shrink-0 items-start justify-between gap-2">
            <h2 id={titleId} className="text-lg font-bold">
              残りの部品を選ぶ
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
            <p className="text-xs opacity-70">
              まだ選んでいないスロットだけを並べています。①
              インフラの構成のカードで選ぶのと同じです（始める前なので手間はかかりません）。
            </p>
            <div className="mt-3">
              <PartChips
                stackIndex={stackIndex}
                framework={framework}
                slots={slots}
                value={value}
                onChange={onChange}
                compare={compare}
              />
            </div>
          </div>
          <div className="modal-action mt-4 shrink-0 flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-sm" role="status">
              {remaining > 0
                ? `残り ${remaining} 個`
                : 'すべて選びました。閉じると「運営を始める」を押せます'}
            </p>
            {remaining > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onFill}
              >
                残りを既定にする
              </button>
            )}
            <form method="dialog">
              <button
                className={`btn btn-sm ${remaining > 0 ? 'btn-outline' : 'btn-primary'}`}
              >
                閉じる
              </button>
            </form>
          </div>
        </div>
      </PortalContainer.Provider>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>
  );
}
