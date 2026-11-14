// 始める画面のシナリオの選択と説明（D-33・prd/09 E-5・E-6）と、構成のカードのフレームワーク欄（D-35）。文言はシナリオのデータ（Scenario.text）から読む。
import clsx from 'clsx';
import { Eye, TrendingDown, TrendingUp } from 'lucide-react';
import {
  accountAllowanceOf,
  accountLabel,
  accountUpkeepOf,
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
import { Info, MoreDetails, PortalContainer } from './info.tsx';
import {
  eventCategory,
  EventIcon,
  type EventCategory,
} from './event-icons.tsx';
import { ScenarioArt } from './scenario-art.tsx';
import {
  PageBadges,
  PageWireframe,
  ScenarioWireframes,
  ScenarioWireframesInfo,
  WireframeLegend,
} from './page-wireframes.tsx';
import {
  RouteChips,
  StrategyExplain,
  RowStatus,
  UnavailableInfo,
  unavailableOf,
} from './route-plan-table.tsx';
import {
  RouteSettingChips,
  SettingExplain,
  settingUnavailableOf,
  type RoutePlanEditor,
} from './route-plan-field.tsx';
import { usd, fmtPoints } from './format.ts';

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

type EffortProps = {
  scenario: Scenario;
  stackIndex: number;
  /** 選んでいる部品（他の事業者のアカウントが増える分を出す。省略は構成の既定）。 */
  components?: Partial<Record<string, string>> | undefined;
  framework?: FrameworkId | undefined;
};

/** 手間の数（単位 pt。D-218）。 */
const pt = (n: number) => `${fmtPoints(n)} pt`;

/** 構成の毎月の手間の数と内訳（マスの塗り分けと ⓘ の凡例に使う。D-218）。 */
function effortOf({
  scenario: sc,
  stackIndex,
  components,
  framework,
}: EffortProps) {
  // 構成の既定の部品での他の事業者の管理の分を基礎に足す（D-123）。既定のままなら機能開発は基礎のまま
  const allowance = accountAllowanceOf(stackIndex, framework);
  const total = sc.effort.perMonth + allowance;
  // 部品で VPS を使う（VPS の API。D-67）ときも自前運用の維持と障害がかかる
  const upkeep = upkeepOf(sc, stackIndex, components, framework);
  const accounts = accountUpkeepOf(stackIndex, components, framework);
  const others = otherAccounts(stackIndex, components, framework);
  const free = total - upkeep - accounts;
  // 色はゲーム中の手間の棒と同じ（維持 warning・他の事業者の管理 warning の薄い色・機能開発 success）
  const segments = [
    { key: 'upkeep', cls: 'bg-warning', label: '維持', value: upkeep },
    {
      key: 'accounts',
      cls: 'bg-warning/50',
      label: '他の事業者の管理',
      value: accounts,
      note: others.map(accountLabel).join('・'),
    },
    { key: 'free', cls: 'bg-success', label: '機能開発', value: free },
  ];
  // 偶発的な障害は自前運用（VPS）だけ。自分で組む構成（OpenNext）は維持の手間だけ（D-63）
  const incidentPct = selfHostedOf(stackIndex, components, framework)
    ? Math.round(sc.incidents.selfHostedChancePerMonth * 100)
    : undefined;
  return { allowance, total, upkeep, accounts, free, segments, incidentPct };
}

/** 毎月の手間のマス（1 マス 1 pt。内訳を左から塗る。0.5 はマスの左半分）。 */
function EffortSquares({
  e,
  size,
}: {
  e: ReturnType<typeof effortOf>;
  size: string;
}) {
  // マスごとに、維持・他の事業者の管理・機能開発の割合（0〜1）を左から塗る
  const cell = (k: number) => {
    let from = 0;
    return e.segments
      .map((x) => {
        const to = from + x.value;
        const w = Math.max(0, Math.min(1, to - k) - Math.max(0, from - k));
        from = to;
        return { cls: x.cls, w };
      })
      .filter((x) => x.w > 0);
  };
  return (
    <span
      role="img"
      aria-label={`毎月の手間 ${pt(e.total)} のうち、${e.segments
        .filter((x) => x.value > 0)
        .map((x) => `${x.label} ${pt(x.value)}`)
        .join('・')}`}
      className="flex flex-wrap gap-0.5"
    >
      {Array.from({ length: Math.max(0, Math.ceil(e.total)) }, (_, k) => (
        <span key={k} className={clsx('flex overflow-hidden rounded-sm', size)}>
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
  );
}

/**
 * 構成の毎月の手間（D-36）。カードには毎月の手間のマスと機能開発に回せる分だけを出す（内訳はカードの ⓘ の EffortDetail。D-218）。
 * 他の事業者の管理（D-52）は 1 アカウント 0.5 なので、マスの左半分だけを塗る（0.5 の表示の形）。
 * 毎月の手間はシナリオの基礎 + 構成の既定の部品での他の事業者の管理の分（D-123）。端数（10.5）は最後のマスの左半分。
 */
export function EffortBar(props: EffortProps) {
  const e = effortOf(props);
  return (
    <span
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5"
      data-effort
    >
      <span className="shrink-0">
        <EffortSquares e={e} size="h-2.5 w-2.5" />
      </span>
      <span className="text-xs" data-effort-free>
        機能開発に毎月 {pt(e.free)}
      </span>
    </span>
  );
}

/** 構成のカードの ⓘ の中の毎月の手間: 大きめのマスと、色の凡例（色・名前・数）。 */
export function EffortDetail(props: EffortProps) {
  const e = effortOf(props);
  return (
    <section className="space-y-2" data-effort-detail>
      <h3 className="font-semibold">毎月の手間 {pt(e.total)}</h3>
      <EffortSquares e={e} size="h-4 w-4" />
      <ul aria-label="毎月の手間の内訳" className="space-y-1 text-sm">
        {e.segments
          .filter((x) => x.value > 0)
          .map((x) => (
            <li key={x.key} className="flex items-start gap-2">
              <span
                aria-hidden
                className={clsx('mt-1 size-3 shrink-0 rounded-sm', x.cls)}
              />
              <span>
                {x.label}{' '}
                <span className="font-semibold tabular-nums">
                  {pt(x.value)}
                </span>
                {x.note && <span className="opacity-70">（{x.note}）</span>}
              </span>
            </li>
          ))}
      </ul>
      {e.allowance > 0 && (
        <p className="text-xs opacity-70">
          毎月 {pt(e.total)} は、基礎 {pt(e.total - e.allowance)}{' '}
          と既定の構成の事業者の管理 {pt(e.allowance)} の合計です。
        </p>
      )}
      {e.incidentPct !== undefined && (
        <p className="text-xs opacity-70">
          自前運用なので、障害が月 {e.incidentPct}% の確率で起きます。
        </p>
      )}
    </section>
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
  detail,
  selected,
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
  /** フレームワークそのものの説明（カードの ⓘ の「詳しい説明を見る」に畳む）。 */
  detail: ReactNode;
  selected: boolean;
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
  // ページが 2 つ以上なら、タブで 1 ページずつ出す（2026-11-14）
  const [pageTab, setPageTab] = useState(0);
  const shownPage = pages[Math.min(pageTab, pages.length - 1)];
  return (
    <section
      aria-label={`${FRAMEWORKS[id].label} の説明`}
      aria-current={selected ? 'true' : undefined}
      data-framework={id}
      className={clsx(
        'card w-full border border-t-4 bg-base-100 motion-safe:transition',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/30'
          : unsupported
            ? 'scale-[0.97] border-base-300 opacity-50 grayscale'
            : 'scale-[0.97] border-base-300 opacity-60 saturate-50 hover:opacity-80',
      )}
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
          <span className="min-w-0">{FRAMEWORKS[id].label}</span>
          {/* カードの ⓘ は右上の 1 つ（D-218）。短い説明・ページごとの描き方と判定と設定・見取り図の凡例・詳しく比べるをまとめる（D-219） */}
          <span className="ml-auto shrink-0">
            <Info label={`${FRAMEWORKS[id].label} の説明`}>
              {/* 先に図の読み方（見取り図の色）と比べる表を出し、文の説明は「詳しい説明を見る」に畳む（D-219。構成のカードの ⓘ と同じ形） */}
              {t?.note && <p>{t.note}。</p>}
              {pages.length > 0 && (
                <section className="space-y-1" data-wireframe-legend>
                  <h3 className="font-semibold">見取り図の色</h3>
                  <WireframeLegend pages={pages} />
                </section>
              )}
              <MoreDetails>
                {(() => {
                  // ページの札・フレームワークの説明の行・設定の説明は、そのページで選んでいる描き方の中に入れる（D-220）
                  const extraOf = (route: string) => {
                    const p = pages.find((x) => x.route === route);
                    if (!p) return null;
                    const row = rowOf(route);
                    const pageLines = p.strategy
                      ? []
                      : frameworkLinesOf(p.label);
                    return (
                      <>
                        {p.badges.length > 0 && (
                          <div data-page-badges={p.route}>
                            <PageBadges badges={p.badges} />
                          </div>
                        )}
                        {pageLines.length > 0 && (
                          <ul
                            aria-label={`${p.label}の説明`}
                            className="list-disc space-y-0.5 pl-5"
                          >
                            {pageLines.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        )}
                        {editor?.setting?.route === p.route && row && (
                          <SettingExplain setting={editor.setting} row={row} />
                        )}
                      </>
                    );
                  };
                  const rows = pages.flatMap((p) => {
                    const r = rowOf(p.route);
                    return r ? [r] : [];
                  });
                  return <StrategyExplain rows={rows} extraOf={extraOf} />;
                })()}
                {rest.length > 0 && (
                  <ul className="list-disc pl-5">
                    {rest.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
                {pages.length > 0 && (
                  <p className="text-xs opacity-70">{text.wireframeNote}</p>
                )}
                {detail}
              </MoreDetails>
            </Info>
          </span>
        </h4>
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
        {pages.length > 1 && (
          <div
            role="tablist"
            aria-label="ページ"
            className="tabs-box tabs w-fit max-w-full tabs-sm"
            data-page-tabs
          >
            {pages.map((p, i) => (
              <button
                key={p.route}
                type="button"
                role="tab"
                aria-selected={p === shownPage}
                data-page-tab={p.route}
                className={clsx('tab', p === shownPage && 'tab-active')}
                onClick={() => setPageTab(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {pages.map((p) => {
          if (p !== shownPage) return null;
          const row = rowOf(p.route);
          const st = statusOf(p.route);
          return (
            <section
              key={p.route}
              aria-label={p.label}
              data-route={p.route}
              className={clsx(
                'flex flex-col gap-2 md:flex-row md:gap-4',
                pages.length === 1 && 'border-t border-base-300 pt-3',
              )}
            >
              <PageWireframe page={p} />
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* タブがあるときは見出しをタブと重ねない（読み上げには残す） */}
                <h5
                  className={clsx(
                    'font-semibold',
                    pages.length > 1 && 'sr-only',
                  )}
                >
                  {p.label}
                </h5>
                {row && (
                  <RouteChips
                    row={row}
                    onSelect={editor?.onSelect}
                    info={false}
                  />
                )}
                {editor && row?.overriddenBy && (
                  <p className="text-[11px] text-warning">{row.overriddenBy}</p>
                )}
                {/* 選べない描き方・設定の理由は、チップごとでなく 1 つの ⓘ にまとめる（D-220）。設定のチップより上に置く */}
                {row && (
                  <UnavailableInfo
                    items={[
                      ...unavailableOf(row),
                      ...(editor?.setting?.route === p.route
                        ? settingUnavailableOf(editor.setting, row)
                        : []),
                    ]}
                  />
                )}
                {/* 描き方の設定（再検証の間隔・オンデマンドなど）は記事のページの行で選ぶ（D-119） */}
                {editor?.setting?.route === p.route && row && (
                  <RouteSettingChips
                    setting={editor.setting}
                    row={row}
                    info={false}
                  />
                )}
                {/* 判定は問題のあるもの（△・✗）だけを出す。満たしているものと判定の文はカードの ⓘ（D-219） */}
                {st && <RowStatus s={st} variant="badges" issuesOnly />}
              </div>
            </section>
          );
        })}
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
};

const GAME_FRAMEWORK_TEXT: FrameworkFieldText = {
  heading: '② アプリを何で作りましたか？（フレームワークとページの描き方）',
  // 乗り換え・作り直しの説明は遊び方に任せる（D-219）
  footnote: null,
  wireframeNote:
    '見取り図はゲーム上の仮定です。描き方のチップを変えると、隣の見取り図の札も変わります。',
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
        disabled={(id) => unsupported?.(id) !== undefined}
        renderCard={(id, { selected }) => {
          // 載せられないフレームワークは、構成で決まる描き方を引かない（その組の行・図は無い。D-113）
          const off = selected ? undefined : unsupported?.(id);
          return (
            <FrameworkCard
              scenario={scenario}
              id={id}
              comments={comments}
              detail={<FrameworkDetail scenario={scenario} id={id} />}
              selected={selected}
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
        <p className="text-sm opacity-70">{text.footnote}</p>
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
  wide = false,
}: {
  /** 開くボタンの文字。 */
  label: string;
  title: string;
  children: ReactNode;
  /** 図を載せるとき（見取り図）の広い幅。 */
  wide?: boolean;
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
            <div
              className={clsx(
                'modal-box',
                wide ? 'w-11/12 max-w-4xl' : 'max-w-xl',
              )}
            >
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

/** 文を「。」ごとに分ける（括弧（）の中の「。」では切らない）。 */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (ch === '（') depth++;
    else if (ch === '）') depth = Math.max(0, depth - 1);
    else if (ch === '。' && depth === 0) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** シナリオの説明・アプリの形（走り切ることと 4 軸の紹介は遊び方に任せる。D-217）。 */
export function ScenarioDescription({ scenario: sc }: { scenario: Scenario }) {
  const t = sc.text;
  const intro = t?.intro;
  const app = t?.app ?? [];
  const growth = (
    growthFromReputation(0.9, false, sc.growth).net * 100
  ).toFixed(0);
  const wireframes = scenarioWireframes(sc);
  const pageLines = t?.pages ?? [];
  // 見取り図のページの説明（ダイアログの中で、見取り図の下に添える）
  const lineOf = (label: string) => pageLines.find((l) => l.startsWith(label));
  // 見取り図に当てはまらない行（「一覧・トップは…」など）は、ダイアログの見取り図の下に並べる
  const otherLines = pageLines.filter(
    (l) => !wireframes.some((p) => l.startsWith(p.label)),
  );
  const introLines = sentencesOf(intro ?? '');
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body px-3 sm:px-6">
        <h2 className="card-title">
          シナリオ: {sc.name}を {sc.months} か月運営する
        </h2>
        {/* シナリオの題材を一般的なアイコンの組み合わせで 1 枚に見せる（D-140） */}
        <ScenarioArt scenarioId={sc.id} name={sc.name} />
        {/*
          紹介（2026-11-14）: どんなアプリかを中立の面に箇条書きで、伸びる・減る要因を色分けした 2 つのパネルに分ける。
          ページの一覧と見取り図は、フレームワークの描き方の選択でも見られるので「ページの見取り図」のダイアログに畳む
        */}
        <div className="space-y-2" data-scenario-intro>
          <div className="rounded-box bg-base-200 p-2 sm:p-3">
            <ul className="list-disc space-y-0.5 pl-5">
              {introLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {t?.scale && <li>{t.scale}</li>}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1 text-sm">
                <Eye aria-hidden className="size-4 opacity-70" />
                今は月{' '}
                <span className="font-bold tabular-nums">
                  {sc.scale.startPV.toLocaleString()}
                </span>{' '}
                PV
              </span>
              {t?.pages && (
                <DetailsDialog
                  label="ページの見取り図"
                  title="ページの見取り図"
                  wide
                >
                  {/* 札の凡例・ページの性質・注記は ⓘ に畳む（D-113 の補足・2026-11-05） */}
                  <div className="flex items-center gap-1">
                    <span className="text-sm opacity-80">凡例と注記</span>
                    <ScenarioWireframesInfo pages={wireframes} />
                  </div>
                  <ScenarioWireframes
                    pages={wireframes}
                    captionOf={(p) => lineOf(p.label)}
                    offscreen={scenarioOffscreen(sc)}
                  />
                  {otherLines.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5">
                      {otherLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </DetailsDialog>
              )}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div
              className="flex items-start gap-2 rounded-box border border-success/50 bg-success/5 p-2 sm:p-3"
              data-growth="up"
            >
              {/* 良い効果は緑の右肩上がり・悪い効果は赤の右肩下がり（色と矢印の向きの両方で見分ける） */}
              <TrendingUp
                aria-label="良い効果"
                className="size-7 shrink-0 text-success"
              />
              <div className="min-w-0 self-center">
                <p className="text-sm">
                  {t?.growth.up ?? '満足度が高いと伸びます'}（満足度 0.9
                  で毎月約 {growth}%）。
                </p>
              </div>
            </div>
            <div
              className="flex items-start gap-2 rounded-box border border-error/40 bg-error/5 p-2 sm:p-3"
              data-growth="down"
            >
              <TrendingDown
                aria-label="悪い効果"
                className="size-7 shrink-0 text-error-strong"
              />
              <div className="min-w-0 self-center">
                <p className="text-sm">
                  {t?.growth.down ?? '満足度が低いと減ります'}。
                </p>
              </div>
            </div>
          </div>
        </div>
        {t?.revenue && <p>{t.revenue}</p>}
        <div>
          運営中にイベントが起きます（時期は乱数のシードで変わります）。
          <DetailsDialog label="イベントの詳しい説明" title="運営中のイベント">
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
                始めた日より後に施行される、実際に予告されている料金・制限の改定があれば、それもイベントとして出ます（改定後の料金を取得していないものは、計算に反映しません）。
              </EventLine>
            </ul>
            <p>時期は乱数のシードで変わります。</p>
          </DetailsDialog>
        </div>
        <p>所持金 {usd(sc.startCash)}。</p>
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
