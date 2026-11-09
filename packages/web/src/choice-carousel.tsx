// 選択のカルーセル（D-102 のフレームワークの欄から切り出した。D-105 でインフラの構成にも使う）。
// 名前とロゴのタブ（ラジオ）で選び、選んだものを中央の大きいカードに出す。前後のボタン・タブの ←/→・カードを押して切り替える。
// 前後のカードも同じ中身で両脇に見える（daisyUI の carousel）。選んでいる＝中央のカード（「これにする」のボタンは置かない）。
// groups を渡すと、タブを事業者などの組にまとめ、組の中の選択肢を小さいチップで出す（インフラの構成。D-105 の補足）。
// カードは組ごとに 1 枚で、チップで組の中の選択肢を替えるとカードは動かず中身だけが替わる（D-105 の補足）。
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
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

/**
 * カルーセルが今見えているか（① ② のタブの隠れた側は false。D-116 の補足）。隠れている間は幅が 0 で中央へ寄せられないので、
 * 見えたときに選んだカードへ寄せ直す。
 */
export const CarouselVisible = createContext(true);

/**
 * 見出しを画面から隠すか（① ② のタブの中。タブの見出しと重なるので。D-116 の補足）。隠しても sr-only で残し、
 * radiogroup の名前（aria-labelledby）と見出しの読み上げは変えない。
 */
export const CarouselHeadingHidden = createContext(false);

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
  disabled,
  flag,
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
  /**
   * 選べない選択肢（D-113。今の構成に載せられないフレームワーク）。タブは薄くしてラジオを無効にし、←/→・前後のボタンは飛ばし、
   * カードを押しても選ばない（カードには理由を出す）。今選んでいるものは選べる前提。
   */
  disabled?: ((id: T) => boolean) | undefined;
  /**
   * 選べるが注意のある選択肢の印（D-113。今のフレームワークを載せられない構成）。タブ・チップに「※」を添え、文は読み上げ・title に出す。
   */
  flag?: ((id: T) => string | undefined) | undefined;
}) {
  const track = useRef<HTMLDivElement>(null);
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});
  const els = useRef<Partial<Record<string, HTMLDivElement | null>>>({});
  // 直前の操作が Tab だったか（その時刻）。Tab で選んでいないカードの中へ進んだときだけ、そのカードを選ぶ。
  // ほかのキー（説明を閉じる Escape など）・ポインターの操作で解き、使ったら消す（説明を閉じてフォーカスが戻ったときは選ばない。OCL-2B972F69）
  const lastTab = useRef(-Infinity);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      lastTab.current = e.key === 'Tab' ? performance.now() : -Infinity;
    };
    const onPointer = () => {
      lastTab.current = -Infinity;
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  // カード: 組があれば組ごとに 1 枚、無ければ選択肢ごとに 1 枚
  const cards: readonly { key: string; items: readonly T[] }[] = groups
    ? groups.map((g) => ({ key: g.key, items: g.items }))
    : items.map((id) => ({ key: id, items: [id] }));
  const current = cards.find((c) => c.items.includes(value)) ?? cards[0];
  const cardKeys = cards.map((c) => c.key).join('\n');
  // 組ごとに最後に選んだ選択肢（この画面を開いている間だけ）。選んでいない組のカード・組の名前・前後のボタンはこれを出す（無ければ組の最初）
  // render 中に読むので ref でなく state に持ち、選んだものが替わった render の中で更新する（前の render の値を覚える形。
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders。ref だと React Compiler が最適化を諦める）
  const [last, setLast] = useState<Partial<Record<string, T>>>({});
  if (current && last[current.key] !== value)
    setLast({ ...last, [current.key]: value });
  const shown = (c: { key: string; items: readonly T[] }): T => {
    if (c.items.includes(value)) return value;
    const l = last[c.key];
    return l !== undefined && c.items.includes(l) ? l : c.items[0]!;
  };
  // 選んだカードを中央へ。scrollLeft なので動きは CSS に任せる（daisyUI の carousel は reduced-motion では滑らかにしない）。
  // カードが替わったときだけ動かす（組の中で選択肢を替えてもカードは同じなので動かさない）
  const currentKey = current?.key;
  const visible = useContext(CarouselVisible);
  useEffect(() => {
    if (!visible) return;
    const t = track.current;
    const el = currentKey === undefined ? undefined : els.current[currentKey];
    if (!t || !el) return;
    t.scrollLeft = el.offsetLeft - (t.clientWidth - el.clientWidth) / 2;
  }, [currentKey, cardKeys, visible]);
  const headingId = useId();
  const headingClass = useContext(CarouselHeadingHidden)
    ? 'sr-only'
    : 'font-bold';
  if (items.length < 2) {
    const id = items[0] ?? value;
    return (
      <div className="space-y-2">
        <h3 className={headingClass}>{heading}</h3>
        {renderCard(id, { selected: true, idPrefix: headingId })}
      </div>
    );
  }
  const i = Math.max(0, items.indexOf(value));
  const off = (id: T) => disabled?.(id) ?? false;
  // d の向きに、選べる選択肢まで進む（全部選べなければ今のもの）
  const at = (d: number) => {
    for (let k = 1; k <= items.length; k++) {
      const id = items[(i + d * k + items.length * k) % items.length]!;
      if (!off(id)) return id;
    }
    return value;
  };
  // 前後のボタンはカード（組）ごとに移り、移った先のカードに出ている選択肢を選ぶ（組が無ければ選択肢ごと）
  const ci = current ? cards.indexOf(current) : 0;
  const cardAt = (d: number) => {
    for (let k = 1; k <= cards.length; k++) {
      const id = shown(cards[(ci + d * k + cards.length * k) % cards.length]!);
      if (!off(id)) return id;
    }
    return value;
  };
  // 説明に結ぶ要約はカードに出ている選択肢だけにある
  const shownIds = new Set(cards.map(shown));
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
      value={id}
      className="sr-only"
      aria-label={ariaLabel}
      // 要約だけを説明にする（カード全体は長いので、カードは下に領域として読める）
      aria-describedby={
        describedBy?.(id) && shownIds.has(id) ? `${headingId}-${id}` : undefined
      }
      checked={value === id}
      disabled={off(id)}
      onChange={() => onChange(id)}
    />
  );
  /** 注意の印（「※」。文は title と読み上げ）。 */
  const flagMark = (id: T) => {
    const f = flag?.(id);
    return f ? (
      <span className="text-warning" title={f}>
        <span aria-hidden>※</span>
        <span className="sr-only">（{f}）</span>
      </span>
    ) : null;
  };
  const flagged = flag ? items.filter((id) => flag(id)) : [];
  /** 狭い画面の前後のカードの帯に重ねる三角（d = -1 は左・前、1 は右・次）。 */
  const edgeArrow = (d: -1 | 1) => (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-2 w-5 pt-2 sm:hidden ${
        d < 0 ? 'left-0' : 'right-0'
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        data-edge-arrow={d < 0 ? 'prev' : 'next'}
        className="pointer-events-auto sticky top-[45vh] flex h-10 w-5 cursor-pointer items-center justify-center rounded-field bg-base-100/80 text-[10px] leading-none shadow-sm"
        onClick={() => onChange(cardAt(d))}
      >
        {d < 0 ? '◀' : '▶'}
      </button>
    </div>
  );
  const focusRing =
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary';
  const chipClass = (id: T) =>
    `btn btn-xs gap-1 whitespace-nowrap ${focusRing} ${
      value === id ? 'btn-primary' : 'btn-ghost bg-base-100'
    }`;
  return (
    <div className="space-y-2">
      <h3 id={headingId} className={headingClass}>
        {heading}
      </h3>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-circle shrink-0 btn-ghost btn-sm"
          aria-label={`前の${noun}（${label(cardAt(-1))}）`}
          onClick={() => onChange(cardAt(-1))}
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
                    {flagMark(only)}
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
                  {/* 組の名前を押すと、その組のカード（最後に選んだ選択肢・無ければ最初）を選ぶ。キーボード・読み上げはチップのラジオで選ぶ */}
                  <span
                    aria-hidden
                    className={`inline-flex items-center gap-1 px-1 text-xs font-semibold whitespace-nowrap ${
                      on ? '' : 'cursor-pointer'
                    }`}
                    onClick={
                      on
                        ? undefined
                        : () =>
                            onChange(shown(cards.find((c) => c.key === g.key)!))
                    }
                  >
                    {g.mark}
                    {g.label}
                  </span>
                  <div className="join">
                    {g.items.map((id) => (
                      <label key={id} className={`join-item ${chipClass(id)}`}>
                        {radio(id, label(id))}
                        {g.chip(id)}
                        {flagMark(id)}
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
                className={`tab shrink-0 gap-1 whitespace-nowrap ${focusRing} ${
                  off(id) ? 'tab-disabled cursor-not-allowed opacity-50' : ''
                }`}
              >
                {radio(id)}
                {tab(id)}
                {flagMark(id)}
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-circle shrink-0 btn-ghost btn-sm"
          aria-label={`次の${noun}（${label(cardAt(1))}）`}
          onClick={() => onChange(cardAt(1))}
        >
          ›
        </button>
      </div>
      {flagged.length > 0 && flag && (
        <p className="text-xs opacity-70" aria-hidden>
          <span className="text-warning">※</span> {flag(flagged[0]!)}
        </p>
      )}
      {/* 全部のカード（組があれば組ごとに 1 枚。組の中で選んでいない組は最後に選んだ・無ければ最初の選択肢）を同じ中身で並べ、選んでいるものを本文の列の中央へ。読むのは選んでいる 1 枚で、本文の列の 85%（sm 以上 lg 未満は 88%）を
          使う（sm 未満の狭い画面は 92% で間隔も詰め、前後のカードは細い帯にする）。前後のカードは両脇の端だけ薄く見え、押すと選ぶ。カードの高さは carousel の行で最も高いものに揃う（切り替えてもページが跳ねない）。
          指でのスクロールでは選ばない（選ぶのはタブ・前後のボタン・カードを押す）。overflow を隠し、位置は scrollLeft で動かす */}
      <div className="relative">
        <div
          ref={track}
          className="relative carousel w-full carousel-center gap-1.5 overflow-x-hidden py-2 sm:gap-3"
        >
          {/* 最初と最後のカードも中央に来るように、両端に空きを置く（カードの幅の残りの半分 − 間隔。狭い画面は (100% − 92%) / 2 − gap-1.5） */}
          <div
            aria-hidden
            className="w-[calc(4%-0.375rem)] shrink-0 sm:w-[calc(6%-0.75rem)] lg:w-[calc(7.5%-0.75rem)]"
          />
          {cards.map((c) => {
            const id = shown(c);
            const selected = c === current;
            return (
              // key は組なので、組の中で選択肢を替えてもカード（と構成図）は作り直さず、中身だけを描き直す
              <div
                key={c.key}
                data-card={c.key}
                ref={(el) => {
                  els.current[c.key] = el;
                }}
                className={`carousel-item w-[92%] sm:w-[88%] lg:w-[85%] ${selected ? '' : off(id) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                // 選んでいないカードを押すと選ぶ（キーボードはタブの ←/→ と前後のボタン）。カードの中の ⓘ などのボタンを押したときは選ばない
                onClick={
                  selected || off(id)
                    ? undefined
                    : (e) => {
                        // ⓘ の説明はポータルで描くので、その中の操作も React の木を伝ってここへ届く。DOM でカードの中の操作だけを選ぶ
                        const target = e.target as Element;
                        if (!e.currentTarget.contains(target)) return;
                        if (target.closest('button')) return;
                        onChange(id);
                      }
                }
                // 選んでいないカードの中へ Tab でフォーカスが入ると、ブラウザがそのカードまで横に送るので、
                // そのカードを選ぶ（見えているカードと選択を食い違わせない）。選べないカードなら選んでいるカードを中央へ戻す
                onFocus={
                  selected
                    ? undefined
                    : (e) => {
                        if (!e.currentTarget.contains(e.target as Node)) return;
                        const tabbed =
                          performance.now() - lastTab.current <= 500;
                        lastTab.current = -Infinity;
                        if (!tabbed) return;
                        if (!off(id)) {
                          onChange(id);
                          return;
                        }
                        const t = track.current;
                        const el =
                          currentKey === undefined
                            ? undefined
                            : els.current[currentKey];
                        if (t && el)
                          t.scrollLeft =
                            el.offsetLeft -
                            (t.clientWidth - el.clientWidth) / 2;
                      }
                }
              >
                {renderCard(id, { selected, idPrefix: headingId })}
              </div>
            );
          })}
          <div
            aria-hidden
            className="w-[calc(4%-0.375rem)] shrink-0 sm:w-[calc(6%-0.75rem)] lg:w-[calc(7.5%-0.75rem)]"
          />
        </div>
        {/* 狭い画面では前後のカードが細い帯になり押せると気づきにくいので、帯に小さい横向きの三角を重ねる（押すと前後のボタンと同じく選ぶ）。
          カードは縦に長く、帯の上の方だけに置くと読み進めると見えなくなるので、帯と同じ高さの列の中で sticky にし、
          最初はカードの見出しのあたり（列の上の余白）、下へ読み進めると画面の真ん中あたり（45vh）に留まる。前後のボタンが読み上げ・キーボードを担うので、
          三角は読み上げに出さずフォーカスも受けない。前後は輪で回るが、帯が無い端（最初・最後のカード）では出さない */}
        {ci > 0 && edgeArrow(-1)}
        {ci < cards.length - 1 && edgeArrow(1)}
      </div>
    </div>
  );
}
