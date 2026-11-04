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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandMark, COMPONENT_BRAND } from './brand-logos.tsx';
import { Info } from './info.tsx';
import { NameWithInfo, splitForInfo } from './option-text.tsx';

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
    <span className="block space-y-1">
      {why && <span className="block font-semibold">{why}</span>}
      <span className="block font-semibold">{o.label}</span>
      {flavor && <span className="block opacity-80">{flavor}</span>}
      <span className="block">{o.note}</span>
    </span>
  );
}

/**
 * 部品のチップ（① インフラの構成の選んでいるカードの、構成図の下。D-116）。スロットごとに 1 行で、押すとその部品に替わる
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
          ? '部品（選んだものは畳んである。押すと選択肢が開く。「構成図から選ぶ」でも選べる）'
          : '部品（押すと替わる。「構成図から選ぶ」でも選べる）'}
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
              <Info label={`${o.label}の説明`}>
                <OptionDetail o={o} why={null} />
              </Info>
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
                      <Info
                        label={`${o.label}${why ? 'が選べない理由' : 'の説明'}`}
                      >
                        <OptionDetail o={o} why={why} />
                      </Info>
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
}: {
  slot: SetupSlot;
  stackIndex: number;
  framework: FrameworkId;
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  close: () => void;
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
        <span className="block space-y-1">
          {note && <span className="block">{note}</span>}
          {flavors.length > 0 && (
            <ul className="list-disc pl-4">
              {flavors.map((o) => (
                <li key={o.value}>
                  <span className="font-semibold">{o.label}</span>: {o.flavor}
                </li>
              ))}
            </ul>
          )}
        </span>
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
const aboutUsd = (n: number) => `約 $${Math.round(n).toLocaleString('en-US')}`;

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
            か月目に当たる上限（止まる・遅くなる分、収益の見込みを減らしている）
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
            か月目に当たるメールの送信の上限（サイトは止まらないが、超えた日のメールが届かず、機能の満足度が下がる）
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
