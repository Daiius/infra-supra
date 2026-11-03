// 始める画面のシナリオの選択と説明（D-33・prd/09 E-5・E-6）と、構成のカードのフレームワーク欄（D-35）。文言はシナリオのデータ（Scenario.text）から読む。
import {
  accountLabel,
  accountUpkeepOf,
  addedAccounts,
  EFFORT,
  FRAMEWORKS,
  growthFromReputation,
  pageWireframes,
  SCENARIOS,
  selfHostedOf,
  type FrameworkId,
  type RouteOverrides,
  type RoutePlanRow,
  type Scenario,
  upkeepOf,
} from 'game';
import type { ReactNode } from 'react';
import { ChoiceCarousel } from './choice-carousel.tsx';
import { BrandMark, brandColor, FRAMEWORK_BRAND } from './brand-logos.tsx';
import { Info } from './info.tsx';
import { Meta, NameWithInfo } from './option-text.tsx';
import {
  PageBadges,
  PageWireframe,
  WireframeLegend,
} from './page-wireframes.tsx';
import { RoutePresetChips } from './route-plan-table.tsx';

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
      <div className="card-body">
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

/**
 * 構成の毎月の手間（D-36）。シナリオの毎月の手間をマスで並べ、内訳で塗り分ける（色はゲーム中の手間の棒と同じ: 維持 warning・
 * 他の事業者の管理 warning の薄い色・機能開発 success）。色だけに頼らず、数を文字でも出す。自前運用の構成には、自前の障害の確率を添える。
 * 他の事業者の管理（D-52）は 1 アカウント 0.5 なので、マスの左半分だけを塗る（0.5 の表示の形）。
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
  const total = sc.effort.perMonth;
  // 部品で VPS を使う（VPS の API。D-67）ときも自前運用の維持と障害がかかる
  const upkeep = upkeepOf(sc, stackIndex, components, framework);
  const selfHosted = selfHostedOf(stackIndex, components, framework);
  const accounts = accountUpkeepOf(stackIndex, components, framework);
  const added = addedAccounts(stackIndex, components, framework);
  const free = total - upkeep - accounts;
  const items = [
    ...(upkeep > 0 ? [`維持 ${upkeep}`] : []),
    ...(accounts > 0
      ? [
          `他の事業者の管理 ${accounts}（${added.map(accountLabel).join('・')}）`,
        ]
      : []),
    `機能開発に ${free}`,
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
        aria-label={`毎月の手間 ${total} のうち、維持 ${upkeep}${accounts > 0 ? `・他の事業者の管理 ${accounts}` : ''}`}
        className="flex shrink-0 gap-0.5"
      >
        {Array.from({ length: Math.max(0, total) }, (_, k) => (
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
    <span className="block space-y-1">
      <span className="block">{f.note}</span>
      <span className="block font-semibold">このシナリオでは</span>
      <ul className="list-disc space-y-0.5 pl-5">
        {app.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {spa ? (
          <li>
            中身を返す API 1 回の CPU は約 {ssrCpuMs * spa.shape.dataCpuFactor}{' '}
            ms（HTML を描かない分 SSR の {spa.shape.dataCpuFactor}{' '}
            倍と仮定。機能が増えると重くなる）。この仮定で Cloudflare Free の 1
            リクエスト CPU 10 ms に当たるかが決まる
          </li>
        ) : (
          <li>SSR 1 回の CPU は約 {ssrCpuMs} ms（機能が増えると重くなる）</li>
        )}
      </ul>
    </span>
  );
}

/**
 * フレームワークのカード: 名前・要約・ページごとの見取り図と描き方（D-102）。選んでいるものは枠とブランドの色で目立たせ、
 * 選んでいないものも同じ中身を読める大きさで出す（薄く・彩度を落とし・少し小さく）。
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
}) {
  const t = scenario.text?.byFramework?.[id];
  // 選んでいるカードは選んだ描き方で描く（D-107）。事業者で決まる既定（Vercel × Next.js の部品ごとにキャッシュ。D-111）は
  // 表の行（選んでいる構成で引いた描き方）から足す
  const byPlatform = Object.fromEntries(
    (routes ?? [])
      .filter((r) => r.strategy === 'cache-components')
      .map((r) => [r.route, r.strategy] as const),
  );
  const pages = pageWireframes(scenario, id, comments, {
    ...byPlatform,
    ...(selected ? chosenRoutes : undefined),
  });
  const lines = t?.pages ?? [];
  /** ページの行（「記事のページ: …」）を、見取り図のページに振り分ける。 */
  const linesOf = (label: string) =>
    lines
      .filter((l) => l.startsWith(`${label}:`))
      .map((l) => l.slice(label.length + 1).trim());
  const rest = lines.filter(
    (l) => !pages.some((p) => l.startsWith(`${p.label}:`)),
  );
  const brand = FRAMEWORK_BRAND[id];
  return (
    <section
      aria-label={`${FRAMEWORKS[id].label} の説明`}
      aria-current={selected ? 'true' : undefined}
      className={`card w-full border border-t-4 bg-base-100 motion-safe:transition ${
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/30'
          : 'scale-[0.97] border-base-300 opacity-60 saturate-50 hover:opacity-80'
      }`}
      // ブランドの色は選んでいるカードの上の縁だけ（黒一色のロゴは文字の色）
      style={
        selected
          ? { borderTopColor: brandColor(brand.brand) ?? 'currentColor' }
          : undefined
      }
    >
      <div className="card-body justify-start gap-3 p-4 *:grow-0">
        <h4 className="card-title text-lg">
          <BrandMark brand={brand.brand} size={22} tag={brand.tag} />
          <NameWithInfo name={FRAMEWORKS[id].label} info={info} />
        </h4>
        {t?.note && (
          <p id={noteId} className="text-sm opacity-80">
            {t.note}
          </p>
        )}
        {!selected && routeNotice && (
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
        {pages.map((p) => (
          <section
            key={p.route}
            aria-label={p.label}
            className="flex flex-col gap-2 border-t border-base-300 pt-3 lg:flex-row lg:gap-4"
          >
            <PageWireframe page={p} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <h5 className="font-semibold">{p.label}</h5>
              <PageBadges badges={p.badges} />
              {linesOf(p.label).length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {linesOf(p.label).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
        {routes && routes.length > 0 && (
          <section
            aria-label="既定の描き方"
            className="border-t border-base-300 pt-3"
          >
            <h5 className="mb-1 font-semibold">
              既定の描き方（下の「ページの描き方」で直せる）
            </h5>
            <RoutePresetChips rows={routes} />
          </section>
        )}
        {pages.length > 0 && (
          <div className="border-t border-base-300 pt-2">
            <WireframeLegend pages={pages} />
            <p className="mt-1 text-xs opacity-60">
              見取り図はゲーム上の仮定。記事のページのコメント欄（③
              ページの描き方の記事の行）を変えると、コメント欄の札も変わる。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

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
}) {
  const info = (id: FrameworkId) => (
    <Info label={`${FRAMEWORKS[id].label} の説明`}>
      <FrameworkDetail scenario={scenario} id={id} />
    </Info>
  );
  return (
    <div className="space-y-2">
      <ChoiceCarousel
        heading={
          allowed.length < 2
            ? 'アプリのフレームワーク'
            : 'アプリを何で作りましたか？'
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
        renderCard={(id, { selected, idPrefix }) => (
          <FrameworkCard
            scenario={scenario}
            id={id}
            comments={comments}
            info={info(id)}
            selected={selected}
            noteId={`${idPrefix}-${id}`}
            routes={routePlan?.(id)}
            chosenRoutes={routes}
            routeNotice={selected ? null : routeNotice?.(id)}
          />
        )}
      />
      {allowed.length >= 2 && (
        <p className="text-sm opacity-60">
          乗り換えても同じアプリのまま。途中で別のフレームワークに作り直せるが、大きな手間（数か月・その間は機能開発がほぼ止まる）がかかる。SNS
          のカード・初回表示への効き方と作り直しの手間はゲーム上の仮定。
        </p>
      )}
    </div>
  );
}

/** シナリオの説明・目標・アプリの形。 */
export function ScenarioDescription({
  scenario: sc,
  usdJpy,
}: {
  scenario: Scenario;
  usdJpy: number;
}) {
  const t = sc.text;
  const intro = t?.intro;
  const app = t?.app ?? [];
  const growth = (
    growthFromReputation(0.9, false, sc.growth).net * 100
  ).toFixed(0);
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">
          シナリオ: {sc.name}を {sc.months} か月運営する
        </h2>
        <p>
          {intro}
          {t?.scale}今は月 {sc.scale.startPV.toLocaleString()} PV。
          {t?.growth.up ?? '満足度が高ければ伸び'}（満足度 0.9 で毎月約 {growth}
          %）、{t?.growth.down ?? '低ければ減る'}。
        </p>
        {/* ページの一覧（ページ → 見る人・要件。描き方はフレームワークのカードに出す。D-101） */}
        {t?.pages && (
          <div>
            <div className="font-semibold">ページ</div>
            <ul className="list-disc space-y-0.5 pl-6">
              {t.pages.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {t?.revenue && <p>{t.revenue}</p>}
        <p>
          {t?.events}
          時期は乱数のシードで変わる。始めた日より後に施行される、実際に予告されている料金・制限の改定があれば、それも出来事として出る（改定後の料金を取得していないものは、計算に反映しない）。
        </p>
        <p>
          {t?.satisfaction}開発の手間は毎月 {sc.effort.perMonth}{' '}
          ポイントで、設定の変更・最適化・乗り換え・出来事への対応・自前運用の維持（
          {sc.effort.selfHostedUpkeep} /
          月）・他の事業者の管理（構成の既定より増えたアカウント 1 つにつき{' '}
          {EFFORT.accountUpkeep} / 月）に使った残りが機能開発に回る。
        </p>
        <p>所持金 {usd(sc.startCash)}。</p>
        {/* daisyUI の alert は子を横の grid に並べるので、中身を 1 つのブロックにして縦に積む */}
        <div className="alert alert-info">
          <div className="space-y-1">
            <div className="font-semibold">
              目標（{sc.months} か月後に、すべて満たす）
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>
                所持金{' '}
                <span className="whitespace-nowrap tabular-nums">
                  {usd(sc.goal.cash)} 以上
                </span>
              </li>
              <li>
                満足度の平均{' '}
                <span className="whitespace-nowrap tabular-nums">
                  {sc.goal.satisfaction} 以上
                </span>
              </li>
              <li>
                止まった月が{' '}
                <span className="whitespace-nowrap tabular-nums">
                  {sc.goal.maxOutageMonths} 回以内
                </span>
              </li>
            </ul>
            <p className="text-sm">
              止まった月が{' '}
              <span className="whitespace-nowrap">
                {sc.goal.maxOutageMonths} 回
              </span>
              を超えた時点、所持金が尽きた時点、規約違反の指摘を受けた翌月も違反したままのときは、その場で終わる。
            </p>
          </div>
        </div>
        <h3 className="mt-2 font-bold">
          アプリの形（コストに効く判断ポイント）
        </h3>
        <p className="text-sm opacity-70">
          フレームワークで変わる点（ページの描き方・SNS のカード・CPU
          の重さ）は、下の構成のカードで選ぶときに出る。
        </p>
        <ul className="list-disc space-y-1 pl-6">
          {app.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm opacity-60">
          料金は 2026-10-31 時点の公式の料金表（エンジンと実データ）。円建ては 1
          USD = {usdJpy} 円の仮定で換算。
          収益・成長・満足度・開発の手間・障害の影響はゲーム上の仮定。
        </p>
      </div>
    </div>
  );
}
