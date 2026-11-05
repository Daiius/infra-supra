// 部品のスロットの ⓘ（D-124）: 選択肢を比べる表と、今の規模での月の費用の横棒を、広さのあるダイアログに出す。
// ゲームの部品の欄・始める画面と見積モードの ① の部品（チップ・構成図の箱の吹き出し）で同じ部品を使う。
// 表の列は game の analyzeSlot が見積の結果から機械的に出すもの（課金の形・上限・請求先のアカウント）だけで、
// どの行にも値の無い列は出さない（スロットごとに列が変わる）。選択肢の説明文は行ごとに「詳細」に畳む。
// 見積は開いたときだけ引く（選択肢 × 見積の計算を、ⓘ を押すまでしない）。
import type { SlotCompareRow } from 'game';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CostBars, type CostBar } from './charts.tsx';
import { InfoIcon, PortalContainer } from './info.tsx';

/** 比較の中身（開いたときに load で引く）。 */
export type SlotCompareData = {
  rows: SlotCompareRow[];
  /** 棒の基準の説明（どの規模・条件の見込みか）。 */
  basis: string;
};

export type SlotCompareProps = {
  /** スロットの名前（ダイアログの見出し「〜を比べる」）。 */
  slotLabel: string;
  load: () => SlotCompareData;
  /** 今の部品（表と棒の「今」。差の基準）。未選択なら undefined。 */
  current?: string | undefined;
  /** 選べない理由（薄く出して理由を添える）。 */
  why?: ((option: string) => string | null | undefined) | undefined;
  /** 開いたときに詳細を開いておく選択肢（チップの ⓘ から開いたとき）。 */
  focus?: string | undefined;
  /** 表の下の注記（スロット固有の説明。DB の移行など）。 */
  footnote?: ReactNode;
};

/** 金額（$10 未満は小数 2 桁。小さい部品の差が $0 に丸まって見えないように）。 */
export const money = (x: number) => {
  const a = Math.abs(x);
  const s = a < 10 ? a.toFixed(2) : Math.round(a).toLocaleString('en-US');
  return `${x < 0 ? '−' : ''}$${s}`;
};
const signed = (x: number) =>
  Math.abs(x) < 0.005 ? '±$0' : `${x > 0 ? '+' : '−'}${money(Math.abs(x))}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 課金の形の列の文（部品のノードの明細）。 */
function chargeText(c: NonNullable<SlotCompareRow['charge']>): string {
  const parts: string[] = [];
  if (c.fixedUsd > 0.005) parts.push(`基本料 ${money(c.fixedUsd)}`);
  if (Math.abs(c.usageUsd) > 0.005 || parts.length === 0)
    parts.push(`従量 ${money(c.usageUsd)}`);
  return parts.join(' + ');
}

/** 上限の列の文（止まる・遅くなる上限の数と、今の規模での最大の使用率。当たっていれば先に）。 */
function limitText(ls: SlotCompareRow['limits']): string {
  if (ls.length === 0) return '—';
  const hit = ls.filter((l) => l.hit);
  const stop = ls.filter((l) => l.effect !== 'throttle').length;
  const slow = ls.length - stop;
  const kinds = [
    stop ? `止まる ${stop}` : '',
    slow ? `遅くなる ${slow}` : '',
  ].filter(Boolean);
  const top = ls.find((l) => l.ratio !== undefined)?.ratio;
  return `${hit.length ? `✗ 当たる ${hit.length}・` : ''}${kinds.join('・')}${
    top !== undefined ? `（今の最大 ${pct(top)}）` : ''
  }`;
}

/** 比較の本体（棒と表）。ダイアログの中身。 */
export function SlotCompareBody({
  data,
  current,
  why,
  focus,
  footnote,
}: {
  data: SlotCompareData;
  current?: string | undefined;
  why?: SlotCompareProps['why'];
  focus?: string | undefined;
  footnote?: ReactNode;
}) {
  const { rows } = data;
  const base = rows.find((r) => r.id === current)?.costUsd ?? null;
  const reason = (r: SlotCompareRow) =>
    r.id === current ? null : (why?.(r.id) ?? null);
  const bars: CostBar[] = rows.map((r) => {
    const w = reason(r);
    const isNow = r.id === current;
    return {
      key: r.id,
      label: (
        <>
          {r.label}
          {isNow && (
            <span className="ml-1 badge badge-xs badge-primary">今</span>
          )}
        </>
      ),
      value: r.costUsd,
      valueText:
        r.costUsd === null
          ? '計算できない'
          : `${money(r.costUsd)}/月${
              base !== null && !isNow ? `（${signed(r.costUsd - base)}）` : ''
            }`,
      note:
        [
          w ? `選べない: ${w}` : '',
          r.blocking ? `当たって止まる・遅くなる前提 ${r.blocking} 件` : '',
        ]
          .filter(Boolean)
          .join('・') || undefined,
      current: isNow,
      muted: w !== null,
    };
  });
  const hasCharge = rows.some((r) => r.charge);
  const hasLimits = rows.some((r) => r.limits.length > 0);
  const hasAccounts = rows.some((r) => r.accounts.length > 0);
  const cols = 1 + Number(hasCharge) + Number(hasLimits) + Number(hasAccounts);
  return (
    <div className="space-y-4" data-slot-compare>
      <section aria-label="月の費用の見込み">
        <h3 className="mb-1 text-sm font-semibold">
          月の費用の見込み（構成全体）
        </h3>
        <CostBars items={bars} caption={data.basis} />
      </section>
      <section aria-label="選択肢の比較">
        <h3 className="mb-1 text-sm font-semibold">選択肢の比較</h3>
        <div className="overflow-x-auto">
          <table className="table table-xs min-w-[32rem]">
            <thead>
              <tr>
                <th scope="col">部品</th>
                {hasCharge && (
                  <th scope="col" title="この部品だけが持つ課金の明細（月）">
                    部品の分の課金
                  </th>
                )}
                {hasLimits && (
                  <th
                    scope="col"
                    title="この部品の上限（当たると止まる・遅くなる）"
                  >
                    上限
                  </th>
                )}
                {hasAccounts && <th scope="col">請求先</th>}
              </tr>
            </thead>
            {rows.map((r) => {
              const w = reason(r);
              const isNow = r.id === current;
              return (
                <tbody
                  key={r.id}
                  data-option={r.id}
                  data-current={isNow ? 'true' : undefined}
                  className={w ? 'opacity-60' : ''}
                >
                  <tr className={isNow ? 'bg-primary/10' : ''}>
                    <th scope="row" className="font-medium">
                      {r.label}
                      {isNow && (
                        <span className="ml-1 badge badge-xs badge-primary">
                          今
                        </span>
                      )}
                      {r.other && (
                        <span className="ml-1 badge badge-ghost badge-xs">
                          別の事業者
                        </span>
                      )}
                      {w && (
                        <span className="block text-xs font-normal">
                          選べない: {w}
                        </span>
                      )}
                    </th>
                    {hasCharge && (
                      <td className="tabular-nums">
                        {r.charge ? (
                          <>
                            {chargeText(r.charge)}
                            {r.charge.allowance && (
                              <span className="block opacity-70">
                                無料 / 込みの分を使う
                              </span>
                            )}
                          </>
                        ) : (
                          <span title="この部品は自分の課金のノードを持たない（差は他の明細に出る）">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {hasLimits && (
                      <td
                        className={
                          r.limits.some((l) => l.hit) ? 'text-error' : ''
                        }
                      >
                        {limitText(r.limits)}
                      </td>
                    )}
                    {hasAccounts && (
                      <td>
                        {r.accounts.length
                          ? r.accounts.map((a, i) => (
                              <span key={a.id}>
                                {i > 0 && '・'}
                                {a.label}
                                {a.added && (
                                  <span className="ml-1 badge badge-warning badge-xs">
                                    増える
                                  </span>
                                )}
                              </span>
                            ))
                          : '—'}
                      </td>
                    )}
                  </tr>
                  <tr className={isNow ? 'bg-primary/10' : ''}>
                    <td colSpan={cols} className="pt-0">
                      <details open={r.id === focus}>
                        <summary className="cursor-pointer text-xs opacity-80">
                          詳細
                        </summary>
                        <div className="mt-1 space-y-1 text-xs">
                          {r.flavor && <p className="opacity-80">{r.flavor}</p>}
                          <p>
                            {r.note}
                            {r.extra && `（${r.extra}）`}
                          </p>
                          {r.limits.length > 0 && (
                            <ul className="list-disc pl-4">
                              {r.limits.map((l) => (
                                <li key={l.text}>
                                  {l.hit ? '✗ ' : ''}
                                  {l.text}
                                  {l.ratio !== undefined &&
                                    `（今の規模で ${pct(l.ratio)}）`}
                                </li>
                              ))}
                            </ul>
                          )}
                          {r.facts.length > 0 && (
                            <ul className="list-disc pl-4 opacity-80">
                              {r.facts.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="mt-1 text-xs opacity-70">
          部品の分の課金・上限・請求先は、この部品だけが持つ課金のノード（どの選択肢にもあるノードを除いたもの）から数える。
          自分のノードを持たない部品（設定だけが替わるもの）は「—」で、差は上の棒に出る。
        </p>
      </section>
      {footnote && <div className="text-xs opacity-80">{footnote}</div>}
    </div>
  );
}

/**
 * 比較のダイアログ（開閉は呼び出し側）。body に portal で出す。`<dialog>` の showModal でフォーカスを閉じ込め、Esc・背景・閉じるのボタンで閉じる。
 * 中身は開いている間だけ描く（見積は開いたときだけ引く）。
 */
export function SlotCompareDialog({
  open,
  onClose,
  slotLabel,
  load,
  current,
  why,
  focus,
  footnote,
}: SlotCompareProps & { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
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
  if (!open) return null;
  // body に出す（ⓘ が見出しの nowrap・太字の中にあっても、ダイアログの文字が引き継がない）
  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      data-slot-compare-dialog
      onClose={onClose}
      // label の中に置かれても、ダイアログの中のクリックで選択肢が切り替わらないように
      onClick={(e) => e.stopPropagation()}
    >
      <PortalContainer.Provider value={dialogEl}>
        <div className="modal-box w-11/12 max-w-3xl px-3 sm:px-6">
          <div className="flex items-start justify-between gap-2">
            <h2 id={titleId} className="text-lg font-bold">
              {slotLabel}を比べる
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
          <div className="mt-2 text-sm">
            <LoadedBody
              load={load}
              current={current}
              why={why}
              focus={focus}
              footnote={footnote}
            />
          </div>
        </div>
      </PortalContainer.Provider>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>,
    document.body,
  );
}

/** 開いたときに一度だけ見積を引く（開いている間に親が描き直しても引き直さない）。 */
function LoadedBody({ load, ...rest }: Omit<SlotCompareProps, 'slotLabel'>) {
  const [data] = useState(load);
  return <SlotCompareBody data={data} {...rest} />;
}

/**
 * 部品のスロットの ⓘ（説明のボタン）: 押すと比較のダイアログを開く。閉じたらボタンへフォーカスを戻す。
 */
export function SlotCompareInfo({
  label,
  className = 'btn btn-ghost btn-xs btn-circle align-middle',
  ...props
}: SlotCompareProps & {
  /** ボタンの読み上げ（既定「〜の説明」。開くのがダイアログなのは aria-haspopup で伝える）。 */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label ?? `${props.slotLabel}の説明`}
        aria-haspopup="dialog"
        data-slot-compare-trigger
        onClick={(e) => {
          // label の中に置かれても、選択肢を切り替えない
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <InfoIcon />
      </button>
      <SlotCompareDialog
        {...props}
        open={open}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      />
    </>
  );
}
