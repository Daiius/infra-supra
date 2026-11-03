// 始める画面の部品の選択（D-45）。構成とフレームワークの組み合わせで選べるスロットを game の setupSlots から引き、
// スロットごとにチップで選ぶ（既定は未選択）。チップは ① インフラの構成の選んでいるカードの、構成図の下に並べる（D-116）。
// 事実の説明（note）と短い説明（フレーバー）はチップの ⓘ に置く。「不適切」の印は出さない（説明だけで正解が分からないようにする）。
// ③ 設定の欄は見積モードと共用（D-115）。
// 状態と整合（ゲームの validSetupChoices・見積の normalizeInput）は各画面が持ち、ここは値・変更・注記を受けて描くだけ。
import {
  componentConflict,
  componentFlavor,
  invalidationNote,
  ON_DEMAND_REVALIDATE,
  SETTINGS,
  setupInvalidationEstimate,
  setupMonthOneEstimate,
  revalidateSettingOf,
  setupRevalidateOptions,
  setupSlots,
  STACKS,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
  type SetupOption,
  type SetupSlot,
} from 'game';
import { useMemo, type ReactNode } from 'react';
import { BrandMark, COMPONENT_BRAND } from './brand-logos.tsx';
import { Info } from './info.tsx';
import { NameWithInfo } from './option-text.tsx';

export type SetupChoices = Partial<Record<string, string>>;

/**
 * スロットの並び（チップの行の順。D-116）。構成で選びたくなる DB・画像・API の置き場を先に、
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

/** チップの見せ方に要る、スロットの選択肢ごとの状態（選択中・選べない理由）。同じ事業者の部品を先に並べる（D-116）。 */
function slotView(
  x: SetupSlot,
  stackIndex: number,
  framework: FrameworkId,
  value: SetupChoices,
) {
  const provider = STACKS[stackIndex]!.provider;
  // 1 択のスロット（固定）は選択済み・変更不可で出す（未選択の判定に含めない。D-45）
  const picked = x.fixed ? x.options[0]!.id : value[x.slot];
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
  return { picked, options };
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
 */
export function PartChips({
  stackIndex,
  framework,
  slots,
  value,
  onChange,
  note,
}: {
  stackIndex: number;
  framework: FrameworkId;
  /** usePartSlots の結果。 */
  slots: readonly SetupSlot[];
  /** 選んだ部品（選べなくなったものは呼び出し側で外してある）。 */
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
  /** 注記（画面ごと。D-115）。 */
  note?: ReactNode;
}) {
  if (slots.length === 0) return null;
  const box =
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-field text-xs';
  return (
    <section aria-label="部品" data-parts className="min-w-0 space-y-1.5">
      <p className="text-xs opacity-70">
        部品（押すと替わる）
        {note && <span className="block">{note}</span>}
      </p>
      <div className="space-y-1">
        {slots.map((x) => {
          const { picked, options } = slotView(x, stackIndex, framework, value);
          const unselected = !picked;
          return (
            <div
              key={x.slot}
              role="group"
              aria-label={`${x.label}${unselected ? '（未選択）' : ''}`}
              data-slot={x.slot}
              data-unselected={unselected ? 'true' : undefined}
              className={`grid min-w-0 gap-x-2 gap-y-1 rounded-box sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start ${
                unselected ? 'p-1 ring-2 ring-warning ring-inset' : ''
              }`}
            >
              <span className="pt-1 text-xs font-semibold">
                {x.label}
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
                              ? () => onChange({ ...value, [x.slot]: o.id })
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
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 始める画面の ISR の再検証（D-49）・Next.js の静的書き出しのビルドの間隔（D-80）・Astro の記事のキャッシュ（D-103）。
 * SPA 以外。始める前なので手間はかからない（ゲーム中に切り替えるときだけ実装の手間がかかる）。既定は 5 分。
 * コメント欄の描き方（D-82）はフレームワークのカードの記事のページの欄で選ぶ（D-109・D-112）。ここでは無効化の見込みに使うだけ。
 */
export function SetupRevalidate({
  scenario,
  stackIndex,
  framework,
  components,
  value,
  onChange,
  comments,
  routes,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  /** 選んだ部品（オンデマンドの CloudFront の無効化の見込みに使う。D-66）。 */
  components: SetupChoices;
  value: number;
  onChange: (v: number) => void;
  /** 記事のページのコメント欄（含めると、オンデマンドの無効化の見込みも増える。D-82・D-109）。 */
  comments: number;
  /** 選んだページごとの描き方（記事の描き方で出す設定が変わる。D-107）。 */
  routes?: RouteOverrides | undefined;
}) {
  const options = setupRevalidateOptions(scenario, framework, routes);
  // OpenNext で ISR を CloudFront にキャッシュするとき、オンデマンドの無効化の見込み（1 か月目の規模。D-66）
  const invalidation = useMemo(() => {
    if (options.length === 0) return undefined;
    const chosen = Object.fromEntries(
      Object.entries(components).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    );
    const e = setupInvalidationEstimate(
      scenario,
      stackIndex,
      framework,
      chosen,
      comments,
    );
    return e && invalidationNote(e);
  }, [scenario, stackIndex, framework, components, options.length, comments]);
  if (options.length === 0) return null;
  // Next.js は ISR の再検証、静的書き出しはビルドの間隔、Astro は記事のキャッシュ（同じ値をフレームワークの意味で選ぶ。D-80・D-103）
  const def = SETTINGS[revalidateSettingOf(framework)];
  return (
    <SetupSettings>
      <SettingRadios
        name="setup-revalidate"
        label={def.label}
        note={def.note}
        options={options}
        value={value}
        onChange={onChange}
        extra={(v) =>
          v === ON_DEMAND_REVALIDATE && invalidation ? (
            <span className="block text-xs text-warning">{invalidation}</span>
          ) : null
        }
      />
    </SetupSettings>
  );
}

/** ③ 設定の欄（見出しと、設定ごとの SettingRadios を並べる枠。見積モードと共用。D-115）。 */
export function SetupSettings({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="mt-2 font-bold">③ 設定</h3>
      {children}
    </div>
  );
}

/** 設定 1 つをラジオで選ぶ枠（見出しの ⓘ に説明。選択肢に短い説明 flavor と、値ごとの注記 extra を添えられる）。 */
export function SettingRadios<V extends string | number>({
  name,
  label,
  note,
  options,
  value,
  onChange,
  extra,
}: {
  /** ラジオの name。 */
  name: string;
  label: string;
  note?: string | undefined;
  options: readonly { value: V; label: string; flavor?: string | undefined }[];
  value: V;
  onChange: (v: V) => void;
  extra?: (v: V) => ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-box border border-base-300 p-3">
      <legend className="px-1 font-semibold">
        {note ? (
          <NameWithInfo
            name={label}
            info={<Info label={`${label} の説明`}>{note}</Info>}
          />
        ) : (
          label
        )}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2"
          >
            <input
              type="radio"
              name={name}
              value={String(o.value)}
              className="radio radio-primary radio-sm mt-0.5 shrink-0"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="block min-w-0">
              <span className="block text-sm">{o.label}</span>
              {o.flavor && (
                <span className="block text-xs opacity-70">{o.flavor}</span>
              )}
              {extra?.(o.value)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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
  const e = useMemo(() => {
    const chosen = Object.fromEntries(
      Object.entries(components).filter(
        (x): x is [string, string] => x[1] !== undefined,
      ),
    );
    return setupMonthOneEstimate(
      scenario,
      stackIndex,
      framework,
      chosen,
      revalidateSec,
      comments,
      routes,
    );
  }, [
    scenario,
    stackIndex,
    framework,
    components,
    revalidateSec,
    comments,
    routes,
  ]);
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
