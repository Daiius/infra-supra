// 選択のカルーセル（D-102 のフレームワークの欄から切り出した。D-105 でインフラの構成にも使う）。
// 名前とロゴのタブ（ラジオ）で選び、選んだものを中央の大きいカードに出す。前後のボタン・タブの ←/→・カードを押して切り替える。
// 前後のカードも同じ中身で両脇に見える（daisyUI の carousel）。選んでいる＝中央のカード（「これにする」のボタンは置かない）。
// groups を渡すと、タブを事業者などの組にまとめ、組の中の選択肢を小さいチップで出す（インフラの構成。D-105 の補足）。
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/** タブの組（事業者など）。chip は組の中の選択肢の短い文字（「Free」「2GB」）。 */
export type ChoiceGroup<T extends string> = {
  key: string;
  /** 組の名前（文字で出す）。 */
  label: string;
  /** 組のロゴ（装飾）。 */
  mark: ReactNode;
  items: readonly T[];
  chip: (id: T) => ReactNode;
};

const ARROW: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function ChoiceCarousel<T extends string>({
  heading,
  name,
  noun,
  items,
  value,
  onChange,
  label,
  tab,
  describedBy,
  renderCard,
  groups,
}: {
  heading: ReactNode;
  /** タブのラジオの name。 */
  name: string;
  /** 前後のボタンの名前（「前の選択肢（…）」の「選択肢」）。 */
  noun: string;
  items: readonly T[];
  value: T;
  onChange: (id: T) => void;
  /** 選択肢の名前（前後のボタンの名前に使う）。 */
  label: (id: T) => string;
  /** タブの中身（ロゴと名前）。 */
  tab: (id: T) => ReactNode;
  /** タブのラジオの説明にする要素があるか（カードの要約の id は `${idPrefix}-${id}`）。 */
  describedBy?: (id: T) => boolean;
  /** カード。idPrefix はタブの aria-describedby に結ぶ要素の id の頭。 */
  renderCard: (id: T, o: { selected: boolean; idPrefix: string }) => ReactNode;
  /**
   * タブの組（並びを flat にしたものが items と同じ順）。1 つだけの組は組の名前のチップ（枠で囲まない）、2 つ以上の組は組の名前の後ろに
   * 選択肢のチップ（chip。join の btn-xs）を並べる。ラジオの名前は label（チップの短い文字でなく、選択肢の名前で読む）。
   */
  groups?: readonly ChoiceGroup<T>[] | undefined;
}) {
  const track = useRef<HTMLDivElement>(null);
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});
  const els = useRef<Partial<Record<string, HTMLDivElement | null>>>({});
  // 選んだカードを中央へ。scrollLeft なので動きは CSS に任せる（daisyUI の carousel は reduced-motion では滑らかにしない）
  useEffect(() => {
    const t = track.current;
    const el = els.current[value];
    if (!t || !el) return;
    t.scrollLeft = el.offsetLeft - (t.clientWidth - el.clientWidth) / 2;
  }, [value, items]);
  const headingId = useId();
  if (items.length < 2) {
    const id = items[0] ?? value;
    return (
      <div className="space-y-2">
        <h3 className="font-bold">{heading}</h3>
        {renderCard(id, { selected: true, idPrefix: headingId })}
      </div>
    );
  }
  const i = Math.max(0, items.indexOf(value));
  const at = (d: number) => items[(i + d + items.length) % items.length]!;
  // ←/→（↑/↓）で全部の選択肢を items の順に移る（組をまたいでも同じ。ブラウザのラジオの動きを、組にまとめても崩れないよう自前で持つ）
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = ARROW[e.key];
    if (!d || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    const next = at(d);
    onChange(next);
    inputs.current[next]?.focus();
  };
  const radio = (id: T, ariaLabel?: string) => (
    <input
      ref={(el) => {
        inputs.current[id] = el;
      }}
      type="radio"
      name={name}
      className="sr-only"
      aria-label={ariaLabel}
      // 要約だけを説明にする（カード全体は長いので、カードは下に領域として読める）
      aria-describedby={describedBy?.(id) ? `${headingId}-${id}` : undefined}
      checked={value === id}
      onChange={() => onChange(id)}
    />
  );
  const focusRing =
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary';
  const chipClass = (id: T) =>
    `btn btn-xs gap-1 whitespace-nowrap ${focusRing} ${
      value === id ? 'btn-primary' : 'btn-ghost bg-base-100'
    }`;
  return (
    <div className="space-y-2">
      <h3 id={headingId} className="font-bold">
        {heading}
      </h3>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-circle shrink-0 btn-ghost btn-sm"
          aria-label={`前の${noun}（${label(at(-1))}）`}
          onClick={() => onChange(at(-1))}
        >
          ‹
        </button>
        {groups ? (
          // 組ごとの枠（ロゴと名前）に、選択肢のチップを並べる。狭い画面では枠ごと折り返す（横にスクロールしない）
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-box bg-base-200 p-1.5"
            onKeyDown={onKeyDown}
          >
            {groups.map((g) => {
              const on = g.items.includes(value);
              const box = `inline-flex items-center gap-1 rounded-field border px-1 py-0.5 ${
                on ? 'border-primary' : 'border-base-300'
              }`;
              const only = g.items.length === 1 ? g.items[0] : undefined;
              // 1 つだけの組は枠で囲まず、チップ 1 つにする（枠とチップの線が二重にならない）。高さは組の枠
              // （チップ + 上下の py-0.5 + 線 1px）にそろえ、選んでいないときの線も組の枠の色にする
              if (only !== undefined)
                return (
                  <label
                    key={g.key}
                    data-tab-group={g.key}
                    className={`${chipClass(only)} h-[calc(var(--size)+0.25rem+2px)] ${
                      on ? '' : 'border-base-300'
                    }`}
                  >
                    {radio(only, label(only))}
                    {g.mark}
                    {g.label}
                  </label>
                );
              return (
                <div
                  key={g.key}
                  role="group"
                  aria-label={g.label}
                  data-tab-group={g.key}
                  className={box}
                >
                  <span
                    aria-hidden
                    className="inline-flex items-center gap-1 px-1 text-xs font-semibold whitespace-nowrap"
                  >
                    {g.mark}
                    {g.label}
                  </span>
                  <div className="join">
                    {g.items.map((id) => (
                      <label key={id} className={`join-item ${chipClass(id)}`}>
                        {radio(id, label(id))}
                        {g.chip(id)}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // 名前とロゴのタブ。ラジオなので ←/→ で選べる。狭い画面では横にスクロールする
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            className="tabs-box tabs min-w-0 flex-1 flex-nowrap overflow-x-auto tabs-sm"
            onKeyDown={onKeyDown}
          >
            {items.map((id) => (
              // ロゴを添えるので input でなく label をタブにする（daisyUI の label:has(:checked)）。名前は文字で出す
              <label
                key={id}
                className={`tab shrink-0 gap-1 whitespace-nowrap ${focusRing}`}
              >
                {radio(id)}
                {tab(id)}
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-circle shrink-0 btn-ghost btn-sm"
          aria-label={`次の${noun}（${label(at(1))}）`}
          onClick={() => onChange(at(1))}
        >
          ›
        </button>
      </div>
      {/* 全部のカードを同じ中身で並べ、選んでいるものを本文の列の中央へ。読むのは選んでいる 1 枚で、本文の列の 85%（狭い画面は 88%）を
          使う。前後のカードは両脇の端だけ薄く見え、押すと選ぶ。カードの高さは carousel の行で最も高いものに揃う（切り替えてもページが跳ねない）。
          指でのスクロールでは選ばない（選ぶのはタブ・前後のボタン・カードを押す）。overflow を隠し、位置は scrollLeft で動かす */}
      <div
        ref={track}
        className="relative carousel w-full carousel-center gap-3 overflow-x-hidden py-2"
      >
        {/* 最初と最後のカードも中央に来るように、両端に空きを置く（カードの幅の残りの半分 − 間隔） */}
        <div
          aria-hidden
          className="w-[calc(6%-0.75rem)] shrink-0 lg:w-[calc(7.5%-0.75rem)]"
        />
        {items.map((id) => (
          <div
            key={id}
            ref={(el) => {
              els.current[id] = el;
            }}
            className={`carousel-item w-[88%] lg:w-[85%] ${id === value ? '' : 'cursor-pointer'}`}
            // 選んでいないカードを押すと選ぶ（キーボードはタブの ←/→ と前後のボタン）。カードの中の ⓘ などのボタンを押したときは選ばない
            onClick={
              id === value
                ? undefined
                : (e) => {
                    // ⓘ の説明はポータルで描くので、その中の操作も React の木を伝ってここへ届く。DOM でカードの中の操作だけを選ぶ
                    const target = e.target as Element;
                    if (!e.currentTarget.contains(target)) return;
                    if (target.closest('button')) return;
                    onChange(id);
                  }
            }
          >
            {renderCard(id, { selected: id === value, idPrefix: headingId })}
          </div>
        ))}
        <div
          aria-hidden
          className="w-[calc(6%-0.75rem)] shrink-0 lg:w-[calc(7.5%-0.75rem)]"
        />
      </div>
    </div>
  );
}
