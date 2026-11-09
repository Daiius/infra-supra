// 始める画面のシナリオの選択と説明（D-33・prd/09 E-5・E-6）と、構成のカードのフレームワーク欄（D-35）。文言はシナリオのデータ（Scenario.text）から読む。
import {
  accountAllowanceOf,
  accountLabel,
  accountUpkeepOf,
  effortTotalNote,
  FRAMEWORKS,
  growthFromReputation,
  pageWireframes,
  SCENARIOS,
  scenarioOffscreen,
  scenarioWireframes,
  selfHostedOf,
  type FrameworkId,
  type RouteOverrides,
  type RoutePlanRow,
  type RouteStrategyId,
  otherAccounts,
  type Scenario,
  upkeepOf,
  RESULT_AXES,
  type ResultAxisId,
} from 'game';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChoiceCarousel } from './choice-carousel.tsx';
import { BrandMark, brandColor, FRAMEWORK_BRAND } from './brand-logos.tsx';
import { Info, PortalContainer } from './info.tsx';
import {
  eventCategory,
  EventIcon,
  type EventCategory,
} from './event-icons.tsx';
import { ScenarioArt } from './scenario-art.tsx';
import { Meta, NameWithInfo } from './option-text.tsx';
import {
  PageBadges,
  PageWireframe,
  ScenarioWireframes,
  ScenarioWireframesInfo,
  WireframeLegend,
} from './page-wireframes.tsx';
import { RouteChips, RowParts, RowStatus } from './route-plan-table.tsx';
import {
  RoutePlanCompare,
  RouteSettingChips,
  type RoutePlanEditor,
} from './route-plan-field.tsx';
import { usd } from './format.ts';

/** 選べるシナリオ（SCENARIOS の登録順）。 */
export const SCENARIO_LIST: Scenario[] = Object.values(SCENARIOS);

/** シナリオを選ぶ。 */
export function ScenarioPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  if (SCENARIO_LIST.length < 2) return null;
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body px-3 sm:px-6">
        <h2 className="card-title">どのシナリオで遊びますか？</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCENARIO_LIST.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-3 rounded-box border p-3 ${value === s.id ? 'border-primary bg-primary/5' : 'border-base-300'}`}
            >
              <input
                type="radio"
                name="scenario"
                className="radio radio-primary"
                checked={value === s.id}
                onChange={() => onChange(s.id)}
              />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

const fmtEffort = (n: number) => String(Number(n.toFixed(1)));

/**
 * 構成の毎月の手間（D-36）。毎月の手間をマスで並べ、内訳で塗り分ける（色はゲーム中の手間の棒と同じ: 維持 warning・
 * 他の事業者の管理 warning の薄い色・機能開発 success）。色だけに頼らず、数を文字でも出す。自前運用の構成には、自前の障害の確率を添える。
 * 他の事業者の管理（D-52）は 1 アカウント 0.5 なので、マスの左半分だけを塗る（0.5 の表示の形）。
 * 毎月の手間はシナリオの基礎 + 構成の既定の部品での他の事業者の管理の分（D-123）。端数（10.5）は最後のマスの左半分。
 */
export function EffortBar({
  scenario: sc,
  stackIndex,
  components,
  framework,
}: {
  scenario: Scenario;
  stackIndex: number;
  /** 選んでいる部品（他の事業者のアカウントが増える分を出す。省略は構成の既定）。 */
  components?: Partial<Record<string, string>>;
  framework?: FrameworkId;
}) {
  // 構成の既定の部品での他の事業者の管理の分を基礎に足す（D-123）。既定のままなら機能開発は基礎のまま
  const allowance = accountAllowanceOf(stackIndex, framework);
  const total = sc.effort.perMonth + allowance;
  // 部品で VPS を使う（VPS の API。D-67）ときも自前運用の維持と障害がかかる
  const upkeep = upkeepOf(sc, stackIndex, components, framework);
  const selfHosted = selfHostedOf(stackIndex, components, framework);
  const accounts = accountUpkeepOf(stackIndex, components, framework);
  const others = otherAccounts(stackIndex, components, framework);
  const free = total - upkeep - accounts;
  const items = [
    ...(allowance > 0
      ? [`毎月 ${fmtEffort(total)}${effortTotalNote(total, allowance)}`]
      : []),
    ...(upkeep > 0 ? [`維持 ${upkeep}`] : []),
    ...(accounts > 0
      ? [
          `他の事業者の管理 ${fmtEffort(accounts)}（${others.map(accountLabel).join('・')}）`,
        ]
      : []),
    `機能開発に ${fmtEffort(free)}`,
    // 偶発的な障害は自前運用（VPS）だけ。自分で組む構成（OpenNext）は維持の手間だけ（D-63）
    ...(selfHosted
      ? [
          `自前の障害 月 ${Math.round(sc.incidents.selfHostedChancePerMonth * 100)}%`,
        ]
      : []),
  ];
  // マスごとに、維持・他の事業者の管理・機能開発の割合（0〜1）を左から塗る
  const cell = (k: number) => {
    const part = (from: number, to: number) =>
      Math.max(0, Math.min(1, to - k) - Math.max(0, from - k));
    return [
      { cls: 'bg-warning', w: part(0, upkeep) },
      { cls: 'bg-warning/50', w: part(upkeep, upkeep + accounts) },
      { cls: 'bg-success', w: part(upkeep + accounts, total) },
    ].filter((x) => x.w > 0);
  };
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span
        role="img"
        aria-label={`毎月の手間 ${fmtEffort(total)}${effortTotalNote(total, allowance)} のうち、維持 ${upkeep}${accounts > 0 ? `・他の事業者の管理 ${fmtEffort(accounts)}` : ''}`}
        className="flex shrink-0 gap-0.5"
      >
        {Array.from({ length: Math.max(0, Math.ceil(total)) }, (_, k) => (
          <span key={k} className="flex h-2.5 w-2.5 overflow-hidden rounded-sm">
            {cell(k).map((x, i) => (
              <span
                key={i}
                className={`h-full ${x.cls}`}
                style={{ width: `${x.w * 100}%` }}
              />
            ))}
          </span>
        ))}
      </span>
      <Meta items={items} className="text-xs opacity-80" />
    </span>
  );
}

/** フレームワークの長い説明（ⓘ に畳む）。SSR / API の CPU の行はテンプレートから足す。 */
function FrameworkDetail({
  scenario: sc,
  id,
}: {
  scenario: Scenario;
  id: FrameworkId;
}) {
  const f = FRAMEWORKS[id];
  const app = sc.text?.byFramework?.[id]?.app ?? [];
  // Next.js の静的書き出し（D-80）も、サーバーが受けるのは中身を返す API だけ（SPA と同じ行）
  const spa =
    id === 'vite-spa' || id === 'nextjs-export'
      ? sc.frameworks?.spa
      : undefined;
  const ssrCpuMs = sc.template(1).routes[0]!.processing.cpuMs;
  return (
    <>
      <p>{f.note}</p>
      <p className="font-semibold">このシナリオでは</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {app.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {spa ? (
          <li>
            中身を返す API 1 回の CPU は約 {ssrCpuMs * spa.shape.dataCpuFactor}{' '}
            ms（HTML を描かない分 SSR の {spa.shape.dataCpuFactor}{' '}
            倍と仮定。機能が増えると重くなります）。この仮定で Cloudflare Free
            の 1 リクエスト CPU 10 ms に当たるかが決まります
          </li>
        ) : (
          <li>
            サーバーで 1 回描く CPU 時間（SSR）は約 {ssrCpuMs}{' '}
            ms（機能が増えると重くなります）
          </li>
        )}
      </ul>
    </>
  );
}

/**
 * フレームワークのカード: 名前・要約・ページごとの見取り図と描き方（D-102）。選んでいるものは枠とブランドの色で目立たせ、
 * 選んでいないものも同じ中身を読める大きさで出す（薄く・彩度を落とし・少し小さく）。
 * ページの欄は見取り図を左・描き方のチップと札を右に置き、選んでいるカードではチップで描き方を選ぶと隣の見取り図がすぐ替わる（D-112）。
 * 描き方の設定（再検証の間隔・オンデマンドなど）は、選んでいるカードの記事のページの行の描き方のチップの下で選ぶ（D-119）。
 * 選んでいないカードは既定の描き方を読むだけで出す（押すとそのフレームワークを選ぶ）。
 */
function FrameworkCard({
  scenario,
  id,
  comments,
  info,
  selected,
  noteId,
  routes,
  chosenRoutes,
  routeNotice,
  resolved,
  editor,
  unsupported,
  text,
}: {
  scenario: Scenario;
  id: FrameworkId;
  comments: number | undefined;
  info: ReactNode;
  selected: boolean;
  /** 要約の要素の id（タブのラジオの aria-describedby に使う）。 */
  noteId: string;
  /** 既定のページごとの描き方（選んでいる構成で。D-106）。 */
  routes?: RoutePlanRow[] | undefined;
  /** 選んだ描き方（選んでいるカードの見取り図に使う。D-107）。 */
  chosenRoutes?: RouteOverrides | undefined;
  /** このフレームワークにすると既定に戻る描き方の注意（選んでいないカードだけ。D-107 の補足）。 */
  routeNotice?: string | null | undefined;
  /** 実際の描き方（routeChoices。表・計算と同じ。見取り図に使う。D-111）。 */
  resolved?: Partial<Record<string, RouteStrategyId>> | undefined;
  /** 描き方を選ぶ（選んでいるカードだけ。D-112）。 */
  editor?: RoutePlanEditor | undefined;
  /** 選んでいる構成に載せられない理由（D-113。あれば灰色にして選べない。描き方のチップは出さない）。 */
  unsupported?: string | undefined;
  text: FrameworkFieldText;
}) {
  const t = scenario.text?.byFramework?.[id];
  // 選んでいるカードは選んだ描き方で描く（D-107）。表・計算と同じ実際の描き方（resolved。事業者で決まる既定・部品の
  // 「キャッシュしない」も効く。D-111・OCL-CD192A98）があればそれで描く
  const pages = pageWireframes(
    scenario,
    id,
    comments,
    selected ? chosenRoutes : undefined,
    resolved,
  );
  const lines = t?.pages ?? [];
  /** ページの行（「記事のページ: …」）を、見取り図のページに振り分ける。 */
  const frameworkLinesOf = (label: string) =>
    lines
      .filter((l) => l.startsWith(`${label}:`))
      .map((l) => l.slice(label.length + 1).trim());
  const rest = lines.filter(
    (l) => !pages.some((p) => l.startsWith(`${p.label}:`)),
  );
  const brand = FRAMEWORK_BRAND[id];
  // ページの行: 選んでいるカードは選んだ描き方の行（要件の判定つき）、選んでいないカードは既定の行
  const rowOf = (route: string) =>
    (editor?.rows ?? routes)?.find((r) => r.route === route);
  const statusOf = (route: string) =>
    editor?.status.find((x) => x.route === route);
  return (
    <section
      aria-label={`${FRAMEWORKS[id].label} の説明`}
      aria-current={selected ? 'true' : undefined}
      data-framework={id}
      className={`card w-full border border-t-4 bg-base-100 motion-safe:transition ${
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/30'
          : unsupported
            ? 'scale-[0.97] border-base-300 opacity-50 grayscale'
            : 'scale-[0.97] border-base-300 opacity-60 saturate-50 hover:opacity-80'
      }`}
      aria-disabled={unsupported ? 'true' : undefined}
      // ブランドの色は選んでいるカードの上の縁だけ（黒一色のロゴは文字の色）
      style={
        selected
          ? { borderTopColor: brandColor(brand.brand) ?? 'currentColor' }
          : undefined
      }
    >
      <div className="card-body justify-start gap-3 p-3 *:grow-0 sm:p-4">
        <h4 className="card-title text-lg">
          <BrandMark brand={brand.brand} size={22} tag={brand.tag} />
          <NameWithInfo name={FRAMEWORKS[id].label} info={info} />
        </h4>
        {t?.note && (
          <p id={noteId} className="text-sm opacity-80">
            {t.note}
          </p>
        )}
        {unsupported && (
          <p className="text-xs text-warning" role="note">
            選んでいる構成では選べない: {unsupported}
          </p>
        )}
        {!selected && !unsupported && routeNotice && (
          <p className="text-xs text-warning" role="note">
            {routeNotice}
          </p>
        )}
        {rest.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {rest.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {pages.map((p) => {
          const row = rowOf(p.route);
          const st = statusOf(p.route);
          // フレームワークの既定と違う描き方なら、フレームワークの説明の行は出さず、描き方の説明（long・why）はチップの ⓘ に
          // 畳む（D-112・D-125）
          const pageLines = p.strategy ? [] : frameworkLinesOf(p.label);
          return (
            <section
              key={p.route}
              aria-label={p.label}
              data-route={p.route}
              className="flex flex-col gap-2 border-t border-base-300 pt-3 lg:flex-row lg:gap-4"
            >
              <PageWireframe page={p} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <h5 className="font-semibold">{p.label}</h5>
                {row && (
                  <RouteChips
                    row={row}
                    onSelect={editor?.onSelect}
                    describe={
                      p.strategy !== undefined && row.strategy === p.strategy
                    }
                  />
                )}
                {editor && row?.overriddenBy && (
                  <p className="text-[11px] text-warning">
                    既定から変わっている: {row.overriddenBy}
                  </p>
                )}
                {/* 描き方の設定（再検証の間隔・オンデマンドなど）は記事のページの行で選ぶ（D-119） */}
                {editor?.setting?.route === p.route && row && (
                  <RouteSettingChips setting={editor.setting} row={row} />
                )}
                {editor && row && (
                  <RowParts
                    row={row}
                    onChange={editor.onPart}
                    namePrefix="card-part"
                  />
                )}
                {st && <RowStatus s={st} variant="badges" />}
                <PageBadges badges={p.badges} />
                {pageLines.length > 0 && (
                  <ul
                    aria-label={`${p.label}の説明`}
                    className="list-disc space-y-0.5 pl-5 text-sm"
                  >
                    {pageLines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
        {editor && editor.rows.length > 0 && text.compareHint !== null && (
          <div className="flex flex-wrap items-center gap-2 border-t border-base-300 pt-3">
            <RoutePlanCompare
              editor={editor}
              frameworkLabel={FRAMEWORKS[id].label}
              {...(text.compareNote ? { note: text.compareNote } : {})}
              {...(text.compareCaption ? { caption: text.compareCaption } : {})}
            />
            <span className="text-xs opacity-70">{text.compareHint}</span>
          </div>
        )}
        {pages.length > 0 && (
          <div className="border-t border-base-300 pt-2">
            <WireframeLegend pages={pages} />
            <p className="mt-1 text-xs opacity-60">{text.wireframeNote}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** フレームワークの欄の画面ごとの文（ゲームの始める画面が既定。見積モードは自分の文を渡す。D-115）。 */
export type FrameworkFieldText = {
  /** 見出し（選べるものが 2 つ以上のとき）。 */
  heading: string;
  /** カードの下の注記（選べるものが 2 つ以上のとき。null は出さない）。 */
  footnote: string | null;
  /** 見取り図の凡例の下の注記。 */
  wireframeNote: string;
  /** 「詳しく比べる」のボタンの横の文（null はボタンごと出さない）。 */
  compareHint: string | null;
  /** 「詳しく比べる」のダイアログの説明と表の説明（省略は RoutePlanCompare の既定。ゲームの始める画面の文）。 */
  compareNote?: string | undefined;
  compareCaption?: string | undefined;
};

const GAME_FRAMEWORK_TEXT: FrameworkFieldText = {
  heading: '② アプリを何で作りましたか？（フレームワークとページの描き方）',
  footnote:
    '乗り換えても同じアプリのままです。途中で別のフレームワークに作り直せますが、大きな手間（数か月・その間は機能開発がほぼ止まる）がかかります。SNS のカード・初回表示への効き方と作り直しの手間はゲーム上の仮定です。',
  wireframeNote:
    '見取り図はゲーム上の仮定です。描き方のチップや記事のページのコメント欄を変えると、隣の見取り図の札も変わります。',
  compareHint:
    'なぜ・要件の判定・ほかの描き方の 1 か月目の費用の差を表で並べます',
};

/**
 * アプリのフレームワーク（構成のカードの中で、インフラの構成と同列に選ぶ。D-35・prd/10 F-04）。
 * どれにも推奨・既定の印を付けない。名前とロゴのタブ（ラジオ）で選び、選んだものを中央の大きいカードに出す（D-102）。
 * 前後のボタン・タブの ←/→・カードを押して切り替える。前後のカードも同じ中身で両脇に見える（daisyUI の carousel）。
 * 選んでいる＝中央のカード（「これにする」のボタンは置かない）。シナリオで選べるものが 1 つだけのときはカードだけを出す。
 */
export function FrameworkField({
  scenario,
  allowed,
  value,
  onChange,
  comments,
  routePlan,
  routes,
  routeNotice,
  resolvedRoutes,
  editor,
  unsupported,
  notice,
  text: textOverride,
}: {
  scenario: Scenario;
  allowed: FrameworkId[];
  value: FrameworkId;
  onChange: (id: FrameworkId) => void;
  /** 記事のページの部品「コメント欄」（始める画面で選べるときだけ。見取り図のコメント欄が変わる。D-82）。 */
  comments?: number | undefined;
  /** フレームワークごとの、既定のページごとの描き方（選んでいる構成で。D-106）。 */
  routePlan?: (id: FrameworkId) => RoutePlanRow[];
  /** 選んだ描き方（D-107）。 */
  routes?: RouteOverrides | undefined;
  /** そのフレームワークにすると既定に戻る描き方の注意（D-107 の補足）。 */
  routeNotice?: (id: FrameworkId) => string | null;
  /** フレームワークごとの実際の描き方（選んでいるカードは選んだ描き方込み。見取り図に使う。D-111・OCL-CD192A98）。 */
  resolvedRoutes?: (
    id: FrameworkId,
    selected: boolean,
  ) => Partial<Record<string, RouteStrategyId>>;
  /** 選んでいるフレームワークのページの描き方を選ぶ（カードのチップと「詳しく比べる」。D-112）。 */
  editor?: RoutePlanEditor | undefined;
  /** 選んでいる構成に載せられない理由（D-113。あるフレームワークは選べない）。 */
  unsupported?: (id: FrameworkId) => string | undefined;
  /** 構成を替えて、載せられるフレームワークに戻したときの知らせ（D-113）。 */
  notice?: string | null | undefined;
  /** 画面ごとの文（省略はゲームの始める画面の文。D-115）。 */
  text?: Partial<FrameworkFieldText> | undefined;
}) {
  const text = { ...GAME_FRAMEWORK_TEXT, ...textOverride };
  const info = (id: FrameworkId) => (
    <Info label={`${FRAMEWORKS[id].label} の説明`}>
      <FrameworkDetail scenario={scenario} id={id} />
    </Info>
  );
  return (
    <div className="space-y-2">
      {/* 構成を替えて戻したときの知らせ（D-113）。読み上げに届くよう、知らせの無いときも枠は置く */}
      <div aria-live="polite">
        {notice && (
          <p className="text-sm text-warning" role="note">
            {notice}
          </p>
        )}
      </div>
      <ChoiceCarousel
        heading={
          allowed.length < 2
            ? '② アプリのフレームワークとページの描き方'
            : text.heading
        }
        name="framework"
        noun="選択肢"
        items={allowed}
        value={value}
        onChange={onChange}
        label={(id) => FRAMEWORKS[id].label}
        tab={(id) => (
          <>
            <BrandMark
              brand={FRAMEWORK_BRAND[id].brand}
              size={14}
              tag={FRAMEWORK_BRAND[id].tag}
            />
            {FRAMEWORKS[id].label}
          </>
        )}
        describedBy={(id) => Boolean(scenario.text?.byFramework?.[id]?.note)}
        disabled={(id) => unsupported?.(id) !== undefined}
        renderCard={(id, { selected, idPrefix }) => {
          // 載せられないフレームワークは、構成で決まる描き方を引かない（その組の行・図は無い。D-113）
          const off = selected ? undefined : unsupported?.(id);
          return (
            <FrameworkCard
              scenario={scenario}
              id={id}
              comments={comments}
              info={info(id)}
              selected={selected}
              noteId={`${idPrefix}-${id}`}
              routes={off ? undefined : routePlan?.(id)}
              chosenRoutes={routes}
              routeNotice={selected || off ? null : routeNotice?.(id)}
              resolved={off ? undefined : resolvedRoutes?.(id, selected)}
              editor={selected ? editor : undefined}
              unsupported={off}
              text={text}
            />
          );
        }}
      />

      {allowed.length >= 2 && text.footnote && (
        <p className="text-sm opacity-60">{text.footnote}</p>
      )}
    </div>
  );
}

/**
 * 興味のある人だけ読めばよい説明を畳むボタンとダイアログ（出来事の詳細・アプリの形）。
 * 中で ⓘ を使っても吹き出しがダイアログの後ろに隠れないよう、PortalContainer にダイアログを渡す（OCL-8E844E7C）。
 */
function DetailsDialog({
  label,
  title,
  children,
}: {
  /** 開くボタンの文字。 */
  label: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
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
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost btn-xs h-auto min-h-6 px-1.5 py-0.5 font-normal text-base-content/80 underline decoration-dotted underline-offset-2"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {label}
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
            <div className="modal-box max-w-xl">
              <div className="flex items-start justify-between gap-2">
                <h2 id={titleId} className="text-lg font-bold">
                  {title}
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
              <div className="mt-2 space-y-2 text-sm">{children}</div>
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

/** 出来事の説明の 1 行（daisyUI の list-row。種類の印 + 文。D-140）。 */
function EventLine({
  category,
  children,
}: {
  category: EventCategory;
  children: ReactNode;
}) {
  return (
    <li className="list-row items-start gap-3 px-3 py-2">
      <EventIcon category={category} className="mt-0.5 size-5" />
      <div className="list-col-grow">{children}</div>
    </li>
  );
}

/** 始める画面の 4 軸の紹介の短い説明（D-133）。 */
const AXIS_INTRO: Record<ResultAxisId, string> = {
  cash: '最後の月の所持金',
  satisfaction: '12 か月の満足度の平均',
  featurePoints: '運用に取られずに機能開発に回せた手間',
  totalCost:
    'プレイした月のインフラの費用の合計（高い・低いで良し悪しは付けません）',
};

/** シナリオの説明・走り切ることと 4 軸の紹介・アプリの形。 */
export function ScenarioDescription({ scenario: sc }: { scenario: Scenario }) {
  const t = sc.text;
  const intro = t?.intro;
  const app = t?.app ?? [];
  const growth = (
    growthFromReputation(0.9, false, sc.growth).net * 100
  ).toFixed(0);
  const wireframes = scenarioWireframes(sc);
  const pageLines = t?.pages ?? [];
  // ページの一覧の行のうち、見取り図のページの行は見取り図の説明にし、残り（「一覧・トップは…」など）は下に並べる
  const lineOf = (label: string) => pageLines.find((l) => l.startsWith(label));
  const otherLines = pageLines.filter(
    (l) => !wireframes.some((p) => l.startsWith(p.label)),
  );
  const pagesTitleId = useId();
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body px-3 sm:px-6">
        <h2 className="card-title">
          シナリオ: {sc.name}を {sc.months} か月運営する
        </h2>
        {/* シナリオの題材を一般的なアイコンの組み合わせで 1 枚に見せる（D-140） */}
        <ScenarioArt scenarioId={sc.id} name={sc.name} />
        <p>
          {intro}
          {t?.scale}今は月 {sc.scale.startPV.toLocaleString()} PV。
          {t?.growth.up ?? '満足度が高ければ伸び'}（満足度 0.9 で毎月約 {growth}
          %）、{t?.growth.down ?? '低ければ減ります'}。
        </p>
        {/* ページの一覧（ページ → 見る人・要件。D-101）と、フレームワークに依らない見取り図（区画の要件。D-113）。
            描き方はフレームワークのカードに出す。説明文に埋もれないよう、別の面（帯）に載せる */}
        {t?.pages && (
          <section
            aria-labelledby={pagesTitleId}
            className="space-y-2 rounded-box bg-base-200 p-2 sm:p-3"
          >
            {/* 札の凡例・ページの性質・注記は見出しの横の ⓘ に畳む（D-113 の補足・2026-11-05） */}
            <div className="flex items-center gap-1">
              <h3 id={pagesTitleId} className="font-bold">
                ページの見取り図
              </h3>
              <ScenarioWireframesInfo pages={wireframes} />
            </div>
            <ScenarioWireframes
              pages={wireframes}
              captionOf={(p) => lineOf(p.label)}
              offscreen={scenarioOffscreen(sc)}
            />
            {otherLines.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-6 text-sm">
                {otherLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        )}
        {t?.revenue && <p>{t.revenue}</p>}
        <div>
          運営中に出来事が起きます（時期は乱数のシードで変わります）。
          <DetailsDialog label="出来事の詳しい説明" title="運営中の出来事">
            {/* 出来事の種類ごとに印（アイコン）を付けた一覧（D-140）。印は運営中の出来事の通知と同じ */}
            <ul className="list rounded-box bg-base-200" data-events-list>
              {(t?.events ?? []).map((line) => {
                const def = sc.events.find((e) => e.id === line.about[0]);
                return (
                  <EventLine
                    key={line.text}
                    category={def ? eventCategory(def) : 'other'}
                  >
                    {line.text}
                  </EventLine>
                );
              })}
              <EventLine category="revision">
                始めた日より後に施行される、実際に予告されている料金・制限の改定があれば、それも出来事として出ます（改定後の料金を取得していないものは、計算に反映しません）。
              </EventLine>
            </ul>
            <p>時期は乱数のシードで変わります。</p>
          </DetailsDialog>
        </div>
        <p>所持金 {usd(sc.startCash)}。</p>
        {/* 完走のダイアログに寄せた紹介（D-133）。success は枠と見出しの印にだけ使い、全面は塗りつぶさない */}
        <section
          className="rounded-box border-2 border-success bg-base-100 p-3 sm:p-4"
          aria-labelledby="run-goal-title"
          data-run-goal
        >
          <h3 id="run-goal-title" className="text-lg font-bold">
            <span className="text-success" aria-hidden>
              ✓{' '}
            </span>
            {sc.months} か月を走り切りましょう
          </h3>
          <p className="mt-1 text-sm">
            合否はありません。走り切ると花火が上がり、4 つの軸で振り返ります（1
            つの点数にはまとめません）。
          </p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {RESULT_AXES.map((a, i) => (
              <li
                key={a.id}
                className="rounded-box border border-success/40 px-2 py-1"
              >
                <span className="font-semibold">
                  {['①', '②', '③', '④'][i]} {a.label}
                </span>
                <span className="block text-xs opacity-70">
                  {AXIS_INTRO[a.id]}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs opacity-80">
            止まった月が{' '}
            <span className="whitespace-nowrap">
              {sc.goal.maxOutageMonths} 回
            </span>
            を超えた時点、所持金が尽きた時点、規約違反の指摘を受けた翌月も違反したままのときは、その場で終わります。
          </p>
        </section>
        {/* アプリの形は見出しの 1 行だけを出し、注記と箇条書きはダイアログに畳む（2026-11-05・ユーザーの要望） */}
        {app.length > 0 && (
          <div>
            <h3 className="inline font-bold">
              アプリの形（コストに効く判断ポイント）
            </h3>
            <DetailsDialog
              label={`${app.length} 項目を見る`}
              title="アプリの形（コストに効く判断ポイント）"
            >
              <p className="text-sm opacity-70">
                フレームワークで変わる点（ページの描き方・SNS のカード・CPU
                の重さ）は、② フレームワークと描き方で選ぶときに出ます。
              </p>
              <ul className="list-disc space-y-1 pl-6">
                {app.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </DetailsDialog>
          </div>
        )}
      </div>
    </div>
  );
}
