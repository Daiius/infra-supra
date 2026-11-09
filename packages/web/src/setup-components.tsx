// 始める画面の部品の選択（D-45）。構成とフレームワークの組み合わせで選べるスロットを game の setupSlots から引き、
// スロットごとにチップで選ぶ（既定は未選択）。チップは ① インフラの構成の選んでいるカードの「機能から選ぶ」の表示に並べる
// （構成図の表示と切り替える。D-116 とその補足）。
// 事実の説明（note）と短い説明（フレーバー）はチップの ⓘ に置く。「不適切」の印は出さない（説明だけで正解が分からないようにする）。
// 構成図の箱を押したときの差し替え（PartOptions）も同じ判定で描く。設定の小さなチップ（SettingChips）は ② のカードの記事のページの行
// （描き方の設定。D-119）と、見積モードの画像の部品の行（画像の形式・サイズ違い）で使う。
// 状態と整合（ゲームの validSetupChoices・見積の normalizeInput）は各画面が持ち、ここは値・変更・注記を受けて描くだけ。
import {
  componentConflict,
  componentFlavor,
  setupMonthOneEstimate,
  setupSlots,
  STACKS,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
  type SetupOption,
  type SetupSlot,
} from 'game';
import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { BrandMark, COMPONENT_BRAND } from './brand-logos.tsx';
import { CarouselHeadingHidden, CarouselVisible } from './choice-carousel.tsx';
import { Info } from './info.tsx';
import { useReducedMotion } from './motion.tsx';
import { NameWithInfo, splitForInfo } from './option-text.tsx';
import { SlotCompareInfo, type SlotCompareData } from './slot-compare.tsx';
import { roundInt } from './format.ts';

/** 部品のスロットの比較（ⓘ の表と月額の横棒。D-124）。画面ごとの見積でスロットの比較を引く（開いたときだけ呼ぶ）。 */
export type PartsCompare = (slot: string) => SlotCompareData;

/** 比べられるスロットか（1 択・ファイルの置き場は比べない）。 */
const comparable = (x: SetupSlot) => !x.fixed && x.slot !== 'files';

export type SetupChoices = Partial<Record<string, string>>;

/**
 * スロットの並び（チップの行の順・図の箱に複数のスロットが当たるときの順。D-116）。構成で選びたくなる DB・画像・API の置き場を先に、
 * 料金のプラン・バックアップ・メールなどを後に。ここに無いスロットは setupSlots の順で最後に足す。
 */
const PART_ORDER: readonly string[] = [
  'db',
  'images',
  'api',
  'isrCache',
  'frontCdn',
  'cdnPlan',
  'apiCache',
  'cdnInvalidation',
  'ogp',
  'minInstances',
  'realtime',
  'dbBackup',
  'email',
  'files',
];
const rankOf = (slot: string) => {
  const i = PART_ORDER.indexOf(slot);
  return i < 0 ? PART_ORDER.length : i;
};

/** 選べるスロット（PART_ORDER の順）。 */
export function usePartSlots(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  value: SetupChoices,
): SetupSlot[] {
  return useMemo(
    () =>
      setupSlots(scenario, stackIndex, framework, value)
        .map((x, i) => ({ x, i }))
        .sort((a, b) => rankOf(a.x.slot) - rankOf(b.x.slot) || a.i - b.i)
        .map((e) => e.x),
    [scenario, stackIndex, framework, value],
  );
}

/** スロットで選んでいる部品。1 択のスロット（固定）は選択済み・変更不可で出す（未選択の判定に含めない。D-45）。 */
const pickedOf = (x: SetupSlot, value: SetupChoices) =>
  x.fixed ? x.options[0]!.id : value[x.slot];

/** スロットがまだ選ばれていないか（チップの行の警告と、構成図の箱の印で同じ判定を使う。D-45・D-116）。 */
export const isUnselected = (x: SetupSlot, value: SetupChoices) =>
  !pickedOf(x, value);

/** チップの見せ方に要る、スロットの選択肢ごとの状態（選択中・選べない理由）。同じ事業者の部品を先に並べる（D-116）。 */
function slotView(
  x: SetupSlot,
  stackIndex: number,
  framework: FrameworkId,
  value: SetupChoices,
) {
  const provider = STACKS[stackIndex]!.provider;
  const picked = pickedOf(x, value);
  const options = x.options
    .map((o, i) => ({ o, i }))
    .sort(
      (a, b) =>
        Number(a.o.platform !== provider) - Number(b.o.platform !== provider) ||
        a.i - b.i,
    )
    .map(({ o }) => ({
      o,
      other: o.platform !== provider,
      selected: picked === o.id,
      // 部品どうしの依存で今は選べない（VPS の API のキャッシュは前段の CDN が要る。D-37）。
      // 部品の事業者でなく構成の事業者で見る（他の事業者の部品も、構成の規則で判定する。D-52）
      why:
        x.fixed || x.slot === 'files'
          ? null
          : componentConflict(provider, x.slot, o.id, value, framework),
    }));
  return { options };
}

/** スロットの選択肢の選べない理由（チップと同じ判定。比較のダイアログに使う。D-124）。 */
export function componentWhy(
  stackIndex: number,
  framework: FrameworkId,
  x: SetupSlot,
  value: SetupChoices,
  option: string,
): string | null {
  return (
    slotView(x, stackIndex, framework, value).options.find(
      (e) => e.o.id === option,
    )?.why ?? null
  );
}

/** 構成と別の事業者の部品のロゴ（D-102。同じ事業者の部品には付けない）。 */
function OtherMark({ o, size = 14 }: { o: SetupOption; size?: number }) {
  return (
    <span className="inline-block shrink-0 align-middle leading-none">
      <BrandMark brand={COMPONENT_BRAND[o.platform]} size={size} />
    </span>
  );
}

/** チップの ⓘ の中身（選べない理由・名前・短い説明・事実の説明）。 */
function OptionDetail({ o, why }: { o: SetupOption; why: string | null }) {
  const flavor = componentFlavor(o);
  return (
    <>
      {why && <p className="font-semibold">{why}</p>}
      <p className="font-semibold">{o.label}</p>
      {flavor && <p className="opacity-80">{flavor}</p>}
      <p>{o.note}</p>
    </>
  );
}

/**
 * チップの ⓘ。比べられるスロット（compare があり、1 択・ファイルの置き場でない）は、スロットの比較のダイアログを開き、
 * 押したチップの選択肢の詳細を開いておく（D-124）。それ以外は選択肢の説明の吹き出し。
 */
function OptionInfo({
  x,
  o,
  why,
  options,
  value,
  compare,
}: {
  x: SetupSlot;
  o: SetupOption;
  why: string | null;
  options: ReturnType<typeof slotView>['options'];
  value: SetupChoices;
  compare: PartsCompare | undefined;
}) {
  if (!compare || !comparable(x))
    return (
      <Info label={`${o.label}${why ? 'が選べない理由' : 'の説明'}`}>
        <OptionDetail o={o} why={why} />
      </Info>
    );
  return (
    <SlotCompareInfo
      label={`${o.label}${why ? 'が選べない理由' : 'の説明'}`}
      slotLabel={x.label}
      current={pickedOf(x, value)}
      why={(id) => options.find((e) => e.o.id === id)?.why ?? null}
      focus={o.id}
      load={() => compare(x.slot)}
    />
  );
}

/**
 * 部品のチップ（① インフラの構成の選んでいるカードの「機能から選ぶ」の表示。構成図の表示とタブで切り替える。D-116 とその補足）。スロットごとに 1 行で、押すとその部品に替わる
 * （図と月額がその場で替わる）。選択中は枠と「選択中」（② の描き方のチップと同じ見せ方）。チップの高さはそろえ、長い名前は
 * 切り詰めて全体をツールチップと ⓘ に出す。選べない部品は灰色で、理由はツールチップと ⓘ。
 * まだ選んでいないスロット（ゲームの始める画面。D-45）は行を警告色の枠で囲み「未選択」を添える。
 * 選び済みのスロット（1 択を含む）の行は「スロット名: 選んだ部品」の小さいチップに畳んで横に並べ、押すとその行だけ開く。
 * 開いた行で選ぶとまた畳む（縦の量を減らす。D-116 の補足）。
 */
export function PartChips({
  stackIndex,
  framework,
  slots,
  value,
  onChange,
  note,
  slotExtra,
  compare,
}: {
  stackIndex: number;
  framework: FrameworkId;
  /** usePartSlots の結果（図の箱の差し替えと同じもの）。 */
  slots: readonly SetupSlot[];
  /** 選んだ部品（選べなくなったものは呼び出し側で外してある）。 */
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  /** 注記（画面ごと。D-115）。 */
  note?: ReactNode;
  /** スロットの行のチップの下に添えるもの（見積モードの画像の形式・サイズ違い。D-119）。 */
  slotExtra?: Partial<Record<string, ReactNode>> | undefined;
  /** 部品の ⓘ で開く比較（D-124）。省略は選択肢ごとの説明の吹き出し。 */
  compare?: PartsCompare | undefined;
}) {
  const root = useRef<HTMLElement>(null);
  // 選んだ部品のスロットは畳み、押して開いたものだけ選択肢を出す（未選択の行はいつも開く。D-116 の補足）
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // 描いた後に focus を移すスロット（チップで選んだ直後。図の箱の吹き出しで選んだ後は図の側で移す。OCL-131BD89D）
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const row = root.current?.querySelector<HTMLElement>(
      `[data-slot="${refocus}"]`,
    );
    // 畳んだボタン（開いたままなら選択中のチップ）。スロットの行が消えた（API の置き場で DB の行が消えるなど）ときは部品の欄の頭
    (
      row?.querySelector<HTMLElement>('[data-collapsed-toggle]') ??
      row?.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
      root.current
    )?.focus();
    setRefocus(null);
  }, [refocus, value]);
  if (slots.length === 0) return null;
  const box =
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-field text-xs';
  const rows = slots.map((x) => {
    const { options } = slotView(x, stackIndex, framework, value);
    const unselected = isUnselected(x, value);
    const chosen = options.find((e) => e.selected);
    return {
      x,
      options,
      unselected,
      chosen,
      collapsed: !unselected && chosen !== undefined && !open.has(x.slot),
    };
  });
  const anyCollapsed = rows.some((r) => r.collapsed);
  return (
    <section
      ref={root}
      tabIndex={-1}
      aria-label="部品"
      data-parts
      className="min-w-0 space-y-1.5 focus:outline-none"
    >
      <p className="text-xs opacity-70">
        {anyCollapsed
          ? '部品（選んだものは畳んであります。押すと選択肢が開きます。「構成図から選ぶ」でも選べます）'
          : '部品（押すと替わります。「構成図から選ぶ」でも選べます）'}
        {note && <span className="block">{note}</span>}
      </p>
      <div className="flex min-w-0 flex-wrap gap-1">
        {rows.map(({ x, options, unselected, chosen, collapsed }) => {
          if (collapsed) {
            const { o, other } = chosen!;
            const openRow = () => setOpen((s) => new Set(s).add(x.slot));
            // 名前は切り詰めず、狭い幅では折り返す。ⓘ は名前の最後の語（1 択は「（1 択）」も）と一緒に置き、ⓘ だけが次の行に落ちない
            // （NameWithInfo と同じ流儀）
            const [head, last] = splitForInfo(o.label);
            const name = (
              <>
                {/* コロンの後の間は余白で取る（名前が 1 語だけだとボタンの末尾の空白は消える） */}
                <span className="mr-1 font-semibold">{x.label}:</span>
                {other && <OtherMark o={o} />}
                {other && ' '}
                {head}
              </>
            );
            const info = (
              <OptionInfo
                x={x}
                o={o}
                why={null}
                options={options}
                value={value}
                compare={compare}
              />
            );
            // 畳んだ行: 「スロット名: 選んだ部品」の小さいチップ。押すとその行だけ開く（1 択は開かない）
            return (
              <div
                key={x.slot}
                role="group"
                aria-label={x.label}
                data-slot={x.slot}
                data-collapsed="true"
                className="max-w-full min-w-0"
              >
                <span
                  data-option={o.id}
                  data-selected="true"
                  title={`${x.label}: ${o.label}`}
                  className={`inline-block max-w-full rounded-field bg-base-100 py-0.5 pr-0.5 pl-2 text-xs leading-6 [overflow-wrap:anywhere] ring-1 ring-base-300 ring-inset ${
                    x.fixed ? '' : 'hover:bg-base-200'
                  }`}
                >
                  {x.fixed ? (
                    <>
                      {name}
                      <span className="whitespace-nowrap">
                        {last}
                        <span className="opacity-70">（1 択）</span> {info}
                      </span>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-expanded={false}
                        data-collapsed-toggle
                        aria-label={`${x.label}: ${o.label}（押すと選択肢が開く）`}
                        className="inline cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onClick={openRow}
                      >
                        {name}
                      </button>
                      <span className="whitespace-nowrap">
                        {/* 最後の語と ▾ も押すと開く（キーボードは前のボタンで開く） */}
                        <span
                          aria-hidden
                          className="cursor-pointer"
                          onClick={openRow}
                        >
                          {last}
                          <span className="ml-0.5 opacity-60">▾</span>
                        </span>{' '}
                        {info}
                      </span>
                    </>
                  )}
                </span>
              </div>
            );
          }
          return (
            <div
              key={x.slot}
              role="group"
              aria-label={`${x.label}${unselected ? '（未選択）' : ''}`}
              data-slot={x.slot}
              data-unselected={unselected ? 'true' : undefined}
              className={`grid w-full min-w-0 gap-x-2 gap-y-1 rounded-box sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start ${
                unselected ? 'p-1 ring-2 ring-warning ring-inset' : ''
              }`}
            >
              <span className="pt-1 text-xs font-semibold">
                {open.has(x.slot) && !unselected ? (
                  // 押して開いた行は、見出しを押すと畳む
                  <button
                    type="button"
                    aria-expanded
                    className="cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={() => setOpen((s) => without(s, x.slot))}
                  >
                    {x.label}
                    <span aria-hidden className="ml-1 font-normal opacity-60">
                      ▴
                    </span>
                  </button>
                ) : (
                  x.label
                )}
                {x.fixed && (
                  <span className="ml-1 font-normal opacity-70">（1 択）</span>
                )}
                {unselected && (
                  <span className="ml-1 badge badge-xs badge-warning">
                    未選択
                  </span>
                )}
              </span>
              <ul className="flex min-w-0 flex-wrap gap-1">
                {options.map(({ o, other, selected, why }) => {
                  const pick = !selected && !x.fixed && why === null;
                  return (
                    <li
                      key={o.id}
                      data-option={o.id}
                      data-selected={selected ? 'true' : 'false'}
                      data-available={why === null ? 'true' : 'false'}
                      title={why ? `${o.label}（${why}）` : o.label}
                      className={`${box} pr-0.5 pl-2 ${
                        selected
                          ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
                          : pick
                            ? 'bg-base-100 ring-1 ring-base-300 ring-inset hover:bg-base-200'
                            : 'bg-base-200 opacity-50 ring-1 ring-base-300 ring-inset'
                      }`}
                    >
                      {x.fixed ? (
                        <span className="inline-flex h-full min-w-0 items-center gap-1">
                          {other && <OtherMark o={o} />}
                          <span className="truncate">{o.label}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-pressed={selected}
                          disabled={why !== null}
                          aria-label={`${o.label}${why ? `（${why}）` : ''}`}
                          className={`inline-flex h-full min-w-0 items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            pick ? 'cursor-pointer' : 'cursor-default'
                          }`}
                          onClick={
                            pick
                              ? () => {
                                  onChange({ ...value, [x.slot]: o.id });
                                  // 選んだら畳み、畳んだボタンへ focus を移す
                                  setOpen((s) => without(s, x.slot));
                                  setRefocus(x.slot);
                                }
                              : undefined
                          }
                        >
                          {other && <OtherMark o={o} />}
                          <span className="truncate">{o.label}</span>
                          {selected && (
                            <span className="badge h-4 shrink-0 badge-xs px-1 badge-primary">
                              選択中
                            </span>
                          )}
                        </button>
                      )}
                      <OptionInfo
                        x={x}
                        o={o}
                        why={why}
                        options={options}
                        value={value}
                        compare={compare}
                      />
                    </li>
                  );
                })}
              </ul>
              {slotExtra?.[x.slot] && (
                <div className="min-w-0 sm:col-start-2">
                  {slotExtra[x.slot]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** s から v を除いた集合（無ければ s のまま。状態を替えずに済むように）。 */
function without(s: ReadonlySet<string>, v: string): ReadonlySet<string> {
  if (!s.has(v)) return s;
  const next = new Set(s);
  next.delete(v);
  return next;
}

/**
 * 構成図の箱を押したときの差し替え（D-116）: そのスロットの選択肢を縦に並べたボタン（名前・短い説明。吹き出しの中なので ⓘ は重ねない）。
 * 選ぶと吹き出しを閉じる（close）。
 */
export function PartOptions({
  slot: x,
  stackIndex,
  framework,
  value,
  onChange,
  close,
  onCompare,
}: {
  slot: SetupSlot;
  stackIndex: number;
  framework: FrameworkId;
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  close: () => void;
  /** 比較のダイアログを開く（D-124。吹き出しは閉じてから開く）。省略は出さない。 */
  onCompare?: (() => void) | undefined;
}) {
  const { options } = slotView(x, stackIndex, framework, value);
  return (
    <div role="group" aria-label={`${x.label}を替える`} data-swap={x.slot}>
      <div className="mb-1 text-xs font-semibold">
        {x.label}を替える
        {isUnselected(x, value) && (
          <span className="ml-1 badge badge-xs badge-warning">未選択</span>
        )}
      </div>
      <ul className="space-y-1">
        {options.map(({ o, other, selected, why }) => {
          const flavor = componentFlavor(o);
          return (
            <li key={o.id} data-option={o.id}>
              <button
                type="button"
                aria-pressed={selected}
                disabled={why !== null}
                aria-label={`${o.label}${why ? `（${why}）` : ''}`}
                className={`flex w-full min-w-0 items-start gap-1.5 rounded-field px-2 py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                  selected
                    ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
                    : why
                      ? 'cursor-default opacity-50'
                      : 'cursor-pointer hover:bg-base-200'
                }`}
                onClick={() => {
                  if (selected || why !== null) return;
                  close();
                  onChange({ ...value, [x.slot]: o.id });
                }}
              >
                {other && <OtherMark o={o} size={12} />}
                <span className="block min-w-0">
                  <span className="block">
                    {o.label}
                    {selected && (
                      <span className="ml-1 badge h-4 badge-xs px-1 badge-primary">
                        選択中
                      </span>
                    )}
                  </span>
                  {flavor && (
                    <span className="block font-normal opacity-70">
                      {flavor}
                    </span>
                  )}
                  {why && <span className="block font-normal">{why}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {onCompare && comparable(x) && (
        <button
          type="button"
          className="btn mt-1 w-full btn-ghost btn-xs font-normal underline decoration-dotted underline-offset-2"
          aria-haspopup="dialog"
          data-slot-compare-trigger
          onClick={onCompare}
        >
          表と月額で比べる
        </button>
      )}
    </div>
  );
}

/** 設定のチップの選択肢（why: 選べない理由。flavor: 短い説明。ツールチップと見出しの ⓘ に出す）。 */
export type SettingChipOption<V extends string | number> = {
  value: V;
  label: string;
  flavor?: string | undefined;
  why?: string | null | undefined;
};

/**
 * 設定 1 つを小さなチップで選ぶ（② のカードの記事のページの行の描き方の設定・見積モードの画像の部品の行。D-119）。
 * 部品・描き方のチップと同じ見せ方（同じ高さ・選択中は塗りと内側の枠と「選択中」・選べないものは灰色で理由は ⓘ）。
 * 設定の説明と選択肢ごとの短い説明は見出しの ⓘ にまとめる（チップごとに ⓘ を並べない）。
 */
export function SettingChips<V extends string | number>({
  label,
  note,
  options,
  value,
  onChange,
  setting,
  children,
}: {
  label: string;
  note?: ReactNode;
  options: readonly SettingChipOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** data-setting（テストと見分けに使う）。 */
  setting: string;
  /** チップの下の注記。 */
  children?: ReactNode;
}) {
  const box =
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-field text-xs';
  const flavors = options.filter((o) => o.flavor);
  const info =
    note || flavors.length > 0 ? (
      <Info label={`${label}の説明`}>
        <>
          {note && <p>{note}</p>}
          {flavors.length > 0 && (
            <dl aria-label={`${label}の選択肢`} className="space-y-1">
              {flavors.map((o) => (
                <div key={o.value}>
                  <dt className="inline font-semibold">{o.label}</dt>:{' '}
                  <dd className="inline">{o.flavor}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      </Info>
    ) : undefined;
  return (
    <div
      role="group"
      aria-label={label}
      data-setting={setting}
      className="min-w-0 space-y-1"
    >
      <span className="block text-xs font-semibold">
        <NameWithInfo name={label} info={info} />
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1">
        {options.map((o) => {
          const selected = o.value === value;
          const why = selected ? null : (o.why ?? null);
          const pick = !selected && why === null;
          return (
            <li
              key={o.value}
              data-option={o.value}
              data-selected={selected ? 'true' : 'false'}
              data-available={why === null ? 'true' : 'false'}
              title={why ? `${o.label}（${why}）` : (o.flavor ?? o.label)}
              className={`${box} ${selected || why ? 'pr-0.5' : 'pr-2'} pl-2 ${
                selected
                  ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
                  : pick
                    ? 'bg-base-100 ring-1 ring-base-300 ring-inset hover:bg-base-200'
                    : 'bg-base-200 opacity-50 ring-1 ring-base-300 ring-inset'
              }`}
            >
              <button
                type="button"
                aria-pressed={selected}
                disabled={why !== null}
                aria-label={`${label}を${o.label}にする${why ? `（${why}）` : ''}`}
                className={`inline-flex h-full min-w-0 items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  pick ? 'cursor-pointer' : 'cursor-default'
                }`}
                onClick={pick ? () => onChange(o.value) : undefined}
              >
                <span className="truncate">{o.label}</span>
                {selected && (
                  <span className="badge h-4 shrink-0 badge-xs px-1 badge-primary">
                    選択中
                  </span>
                )}
              </button>
              {why && <Info label={`${o.label}が選べない理由`}>{why}</Info>}
            </li>
          );
        })}
      </ul>
      {children}
    </div>
  );
}

/** ① 構成・② フレームワークのタブ（D-116 の補足）。 */
export type SetupTab = 'stack' | 'framework';

/** SetupTabs を外から動かす口（D-125）。 */
export type SetupTabsApi = {
  /** タブを開く（描き終えてから戻る）。 */
  show: (tab: SetupTab) => void;
  /**
   * ① を開き、選んでいるカードのそのスロットの選択 UI（機能のチップの行・構成図の箱）までスクロールしてフォーカスする。
   * 見つからなければカードまでスクロールして false（カードはフォーカスできない）。
   */
  focusSlot: (slot: string) => boolean;
};

/** タブの見出し: 欄の名前・その欄の今の選択（隠れていても見えるように）・注意（未選択の部品・付け替えの知らせなど）。 */
export type SetupTabInfo = {
  label: string;
  summary: string;
  /** 注意の文。あればタブに「!」を付け、文は title と読み上げに出す。 */
  warn?: string | null | undefined;
  /** 「!」の色。止まる上限の知らせは明細・上限の一覧と同じ赤（error）にする（D-178）。既定は warning。 */
  warnTone?: 'warning' | 'error';
  /**
   * 他方の欄の操作で起きた変化の知らせ（② の付け替えの知らせ。D-113）。欄の中の aria-live は隠れている間は読まれないので、
   * このタブが隠れている間だけ、パネルの外の常設の aria-live で読む（OCL-B12E7ACB）。
   */
  live?: string | null | undefined;
  panel: ReactNode;
};

const SETUP_TABS: readonly SetupTab[] = ['stack', 'framework'];

function readSetupTab(key: string): SetupTab {
  try {
    return localStorage.getItem(key) === 'framework' ? 'framework' : 'stack';
  } catch {
    // 保存領域が使えない環境では ① から
    return 'stack';
  }
}

function storeSetupTab(key: string, v: SetupTab) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 覚えられなくても切り替えられる（開き直すと ① に戻るだけ）
  }
}

/**
 * ① インフラの構成と ② フレームワークと描き方を、タブで切り替えて片方だけ出す（D-116 の補足。縦の情報量を減らし、どちらから
 * 選んでもよいように）。WAI-ARIA の tabs（←/→・Home/End で移って選ぶ）。選んだタブは画面ごとに storageKey へ覚える。
 * 隠れた側も描いたまま hidden にする（carousel の組ごとに最後に選んだプランなど、欄の中の記憶も保つ）。隠れている間は幅が無いので、
 * carousel は見えたときに選んだカードへ寄せ直す（CarouselVisible）。
 * 見た目は ① の事業者の組のタブに寄せる（地の上の枠。選んでいるタブは 2px の primary の枠・淡い地・太字）。部品の選び方の「構成図から /
 * 機能から」（daisyUI の tabs-box）とは区別する。欄の中の見出しはタブと重なるので画面からは隠す（CarouselHeadingHidden。読み上げには残す）。
 */
export function SetupTabs({
  storageKey,
  stack,
  framework,
  api,
}: {
  storageKey: string;
  stack: SetupTabInfo;
  framework: SetupTabInfo;
  /** 外からタブを開く・① の部品の選択 UI へ移る口（未選択の部品へのジャンプ。D-125）。 */
  api?: Ref<SetupTabsApi> | undefined;
}) {
  const [tab, setTabState] = useState<SetupTab>(() => readSetupTab(storageKey));
  const setTab = (v: SetupTab) => {
    setTabState(v);
    storeSetupTab(storageKey, v);
  };
  const id = useId();
  const tabs = useRef<Partial<Record<SetupTab, HTMLButtonElement | null>>>({});
  const panels = useRef<Partial<Record<SetupTab, HTMLDivElement | null>>>({});
  const reduced = useReducedMotion();
  useImperativeHandle(api, () => ({
    show: (t) => flushSync(() => setTab(t)),
    focusSlot: (slot) => {
      // ① を開いて描き終えてから、選んでいるカードのそのスロットの選択 UI（機能のチップの行か、構成図の箱）を探す
      flushSync(() => setTab('stack'));
      const panel = panels.current.stack;
      const card =
        panel?.querySelector<HTMLElement>(
          'section[data-stack][aria-current="true"]',
        ) ?? panel;
      const target =
        card?.querySelector<HTMLElement>(
          `[data-parts] [data-slot="${slot}"] button:not([disabled])`,
        ) ??
        card?.querySelector<HTMLElement>(
          `[data-slots~="${slot}"] button:not([disabled])`,
        );
      const el = target ?? card;
      if (!el) return false;
      el.scrollIntoView?.({
        block: 'center',
        behavior: reduced ? 'auto' : 'smooth',
      });
      el.focus({ preventScroll: true });
      return target !== null && target !== undefined;
    },
  }));
  const info = { stack, framework };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SETUP_TABS.indexOf(tab);
    const n = SETUP_TABS.length;
    const next =
      e.key === 'ArrowRight'
        ? SETUP_TABS[(i + 1) % n]
        : e.key === 'ArrowLeft'
          ? SETUP_TABS[(i + n - 1) % n]
          : e.key === 'Home'
            ? SETUP_TABS[0]
            : e.key === 'End'
              ? SETUP_TABS[n - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className="min-w-0 space-y-2" data-setup-tab={tab}>
      <div
        role="tablist"
        aria-label="選ぶもの"
        className="flex min-w-0 gap-1.5 rounded-box bg-base-200 p-1.5"
        onKeyDown={onKeyDown}
      >
        {SETUP_TABS.map((t) => {
          const x = info[t];
          const selected = tab === t;
          return (
            <button
              key={t}
              ref={(el) => {
                tabs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t}`}
              tabIndex={selected ? 0 : -1}
              title={`${x.label}: ${x.summary}${x.warn ? `（${x.warn}）` : ''}`}
              data-setup-tab-button={t}
              className={`flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-field text-left motion-safe:transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                // 選んでいるタブは 2px の primary の枠・淡い地・太字、選んでいないタブは 1px の灰色の枠（線の差は余白で埋めて高さを揃える）
                selected
                  ? 'border-2 border-primary bg-primary/10 px-2 py-1 font-bold'
                  : 'border border-base-300 bg-base-100 px-[calc(0.5rem+1px)] py-[calc(0.25rem+1px)] font-normal hover:border-primary/60'
              }`}
              onClick={() => setTab(t)}
            >
              <span className="flex max-w-full items-center gap-1 text-sm">
                <span className={`truncate ${selected ? 'text-primary' : ''}`}>
                  {x.label}
                </span>
                {x.warn && (
                  <span
                    aria-hidden
                    className={`badge shrink-0 badge-xs font-bold ${x.warnTone === 'error' ? 'badge-error' : 'badge-warning'}`}
                    data-setup-tab-warn
                  >
                    !
                  </span>
                )}
              </span>
              <span
                className={`block w-full truncate text-xs font-normal ${
                  selected ? 'opacity-90' : 'opacity-70'
                }`}
              >
                <span className="sr-only">：</span>
                {x.summary}
              </span>
              {x.warn && <span className="sr-only">（{x.warn}）</span>}
            </button>
          );
        })}
      </div>
      {/* 隠れたタブの知らせを読む（見えているタブの知らせは欄の中の aria-live が読むので、二重にしない） */}
      <div aria-live="polite" className="sr-only" data-setup-tab-live>
        {SETUP_TABS.filter((t) => t !== tab && info[t].live).map((t) => (
          <p key={t}>{info[t].live}</p>
        ))}
      </div>
      {SETUP_TABS.map((t) => (
        <div
          key={t}
          role="tabpanel"
          id={`${id}-panel-${t}`}
          aria-labelledby={`${id}-tab-${t}`}
          ref={(el) => {
            panels.current[t] = el;
          }}
          hidden={tab !== t}
          className="min-w-0"
        >
          <CarouselVisible.Provider value={tab === t}>
            <CarouselHeadingHidden.Provider value>
              {info[t].panel}
            </CarouselHeadingHidden.Provider>
          </CarouselVisible.Provider>
        </div>
      ))}
    </div>
  );
}

/** ③ 設定の欄（見出しと、設定を並べる枠）。描き方の設定は ② のカード、画像の設定は ① の画像の行に移した（D-119）。今は見積モードで画像の行の無い構成のときだけ使う。 */
export function SetupSettings({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="mt-2 font-bold">③ 設定</h3>
      {children}
    </div>
  );
}

/** 「約 $X」（見込みは目安なので整数のドル。丸めは表示のときだけ）。 */
const aboutUsd = (n: number) => `約 $${roundInt(n).toLocaleString('en-US')}`;

/**
 * 始める画面の 1 か月目の費用の見込み（D-72）。部品と設定がすべて選ばれたときだけ出す。費用が「開始の所持金 + 1 か月目の
 * 収益の見込み」を超えるときは警告色にし、主な費用の行を添える（正解の構成名は出さない。D-40）。始めることは止めない。
 */
export function SetupCostPreview({
  scenario,
  stackIndex,
  framework,
  components,
  revalidateSec,
  comments,
  routes,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: SetupChoices;
  /** 再検証・ビルドの間隔（選べないフレームワークでは undefined）。 */
  revalidateSec: number | undefined;
  /** 記事のページのコメント欄（選べないシナリオ・描き方では undefined。D-82・D-109）。 */
  comments: number | undefined;
  /** 選んだページごとの描き方（D-107）。 */
  routes?: RouteOverrides | undefined;
}) {
  const chosen = Object.fromEntries(
    Object.entries(components).filter(
      (x): x is [string, string] => x[1] !== undefined,
    ),
  );
  const e = setupMonthOneEstimate(
    scenario,
    stackIndex,
    framework,
    chosen,
    revalidateSec,
    comments,
    routes,
  );
  return (
    <div
      role="status"
      className={`min-w-0 rounded-box border p-3 text-sm ${e.short ? 'border-warning bg-warning/15' : 'border-base-300'}`}
    >
      <p className="break-words">
        1 か月目の費用の見込み <strong>{aboutUsd(e.costUsd)}</strong>
        （開始の所持金 ${Math.round(e.startCash).toLocaleString('en-US')}・1
        か月目の収益の見込み {aboutUsd(e.revenueUsd)}）
      </p>
      {e.blocking.length > 0 && (
        <div className="mt-1">
          <p className="font-bold">
            1
            か月目に達する上限（止まる・遅くなる分、収益の見込みを減らしている）
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {e.blocking.map((b) => (
              <li key={b.id} className="break-words">
                {b.text}
                {b.detail && <span className="block">{b.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.undelivered.length > 0 && (
        <div className="mt-1">
          <p className="font-bold">
            1
            か月目に達するメールの送信の上限（サイトは止まらないが、超えた日のメールが届かず、機能の満足度が下がる）
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {e.undelivered.map((b) => (
              <li key={b.id} className="break-words">
                {b.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.short && (
        <>
          <p className="mt-1 font-bold">
            この組み合わせだと 1 か月目に所持金が尽きる見込み
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {e.topLines.map((l) => (
              <li key={l.label} className="break-all">
                {l.label} {aboutUsd(l.usd)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-1 text-xs opacity-70">
        ゲーム上の目安（1 か月目の基準の規模。出来事・障害は含めない）
      </p>
    </div>
  );
}
