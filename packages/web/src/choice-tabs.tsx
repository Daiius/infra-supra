// 選択のタブ（インフラの構成の事業者・フレームワーク。D-102・D-105 のカルーセルを D-221 でタブにした）。
// ① ② のタブ（SetupTabs。灰色の面の tabs-box）の中に入れ子で置くので、見た目を変えて持ち上がったタブ（daisyUI の tabs-lift）にし、
// タブの下の枠に選んでいるもののカードを 1 枚だけ出す。タブはラジオで、←/→（↑/↓）で選べないものを飛ばして移る。
import clsx from 'clsx';
import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/**
 * 見出しを画面から隠すか（① ② のタブの中。タブの見出しと重なるので。D-116 の補足）。隠しても sr-only で残し、
 * radiogroup の名前（aria-labelledby）と見出しの読み上げは変えない。
 */
export const ChoiceHeadingHidden = createContext(false);

const ARROW: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function ChoiceTabs<T extends string>({
  heading,
  name,
  items,
  value,
  onChange,
  tab,
  renderCard,
  disabled,
  flag,
}: {
  heading: ReactNode;
  /** タブのラジオの name。 */
  name: string;
  items: readonly T[];
  value: T;
  onChange: (id: T) => void;
  /**
   * タブの中身（ロゴと名前）。狭い画面（sm 未満）では、どのタブもロゴだけにして行いっぱいに均等に広げる（選んでも幅が変わらず、押しやすい。名前は読み上げと
   * カードの見出しに残す）。
   */
  tab: (id: T) => { mark: ReactNode; label: string };
  /** 選んでいるもののカード。 */
  renderCard: (id: T) => ReactNode;
  /**
   * 選べない選択肢（D-113。今の構成に載せられないフレームワーク）。タブは薄くしてラジオを無効にし、←/→ は飛ばす。
   * 今選んでいるものは選べる前提。
   */
  disabled?: ((id: T) => boolean) | undefined;
  /**
   * 選べるが注意のある選択肢の印（D-113。今のフレームワークを載せられない構成）。タブに「※」を添え、文は読み上げ・title に出す。
   */
  flag?: ((id: T) => string | undefined) | undefined;
}) {
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});
  const headingId = useId();
  const headingClass = useContext(ChoiceHeadingHidden)
    ? 'sr-only'
    : 'font-bold';
  const off = (id: T) => disabled?.(id) ?? false;
  const card = (
    <div
      className="min-w-0 rounded-box border border-base-300 bg-base-100 p-2 sm:p-3"
      data-card={value}
    >
      {renderCard(value)}
    </div>
  );
  if (items.length < 2)
    return (
      <div className="space-y-2">
        <h3 className={headingClass}>{heading}</h3>
        {card}
      </div>
    );
  const i = Math.max(0, items.indexOf(value));
  // d の向きに、選べる選択肢まで進む（全部選べなければ今のもの）
  const at = (d: number) => {
    for (let k = 1; k <= items.length; k++) {
      const id = items[(i + d * k + items.length * k) % items.length]!;
      if (!off(id)) return id;
    }
    return value;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = ARROW[e.key];
    if (!d || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    const next = at(d);
    onChange(next);
    inputs.current[next]?.focus();
  };
  const flagged = flag ? items.filter((id) => flag(id)) : [];
  return (
    <div className="min-w-0">
      <h3 id={headingId} className={headingClass}>
        {heading}
      </h3>
      {/* タブは 1 行。狭い画面ではロゴだけの同じ幅のタブにして収め、収まらなければ横にスクロールする。持ち上がったタブ（tabs-lift）の下の枠とつながって見える */}
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="tabs-lift tabs min-w-0 flex-nowrap overflow-x-auto tabs-sm"
        onKeyDown={onKeyDown}
      >
        {items.map((id) => {
          const f = flag?.(id);
          return (
            // ロゴを添えるので input でなく label をタブにする（daisyUI の label:has(:checked)）。名前は文字で出す
            <label
              key={id}
              className={clsx(
                'tab min-w-12 flex-1 justify-center gap-1 whitespace-nowrap sm:min-w-0 sm:flex-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary',
                value === id && 'tab-active font-semibold',
                off(id) && 'tab-disabled cursor-not-allowed opacity-50',
              )}
            >
              <input
                ref={(el) => {
                  inputs.current[id] = el;
                }}
                type="radio"
                name={name}
                value={id}
                className="sr-only"
                checked={value === id}
                disabled={off(id)}
                onChange={() => onChange(id)}
              />
              {tab(id).mark}
              <span className="sr-only sm:not-sr-only">{tab(id).label}</span>
              {f && (
                <span className="text-warning" title={f}>
                  <span aria-hidden>※</span>
                  <span className="sr-only">（{f}）</span>
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="-mt-px">{card}</div>
      {flagged.length > 0 && flag && (
        <p className="mt-1 text-xs opacity-70" aria-hidden>
          <span className="text-warning">※</span> {flag(flagged[0]!)}
        </p>
      )}
    </div>
  );
}
