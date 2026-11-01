// 始める画面のシナリオの選択と説明（D-33・prd/09 E-5・E-6）と、構成のカードのフレームワーク欄（D-35）。文言はシナリオのデータ（Scenario.text）から読む。
import {
  accountLabel,
  accountUpkeepOf,
  addedAccounts,
  EFFORT,
  FRAMEWORKS,
  growthFromReputation,
  SCENARIOS,
  type FrameworkId,
  type Scenario,
  upkeepOf,
} from 'game';
import { Info } from './info.tsx';
import { Meta, NameWithInfo } from './option-text.tsx';

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
  const upkeep = upkeepOf(sc, stackIndex);
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
    ...(upkeep > 0
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
  const spa = id === 'vite-spa' ? sc.frameworks?.spa : undefined;
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
 * アプリのフレームワーク（構成のカードの中で、インフラの構成と同列に選ぶ。D-35・prd/10 F-04）。
 * どちらにも推奨・既定の印を付けない。選んだものだけ短い注記を出し、長い説明は ⓘ に畳む。
 * シナリオで選べるものが 1 つだけのときは選択肢を出さず、そのフレームワークの説明だけを出す。
 */
export function FrameworkField({
  scenario,
  allowed,
  value,
  onChange,
}: {
  scenario: Scenario;
  allowed: FrameworkId[];
  value: FrameworkId;
  onChange: (id: FrameworkId) => void;
}) {
  const note = (id: FrameworkId) => scenario.text?.byFramework?.[id]?.note;
  const info = (id: FrameworkId) => (
    <Info label={`${FRAMEWORKS[id].label} の説明`}>
      <FrameworkDetail scenario={scenario} id={id} />
    </Info>
  );
  if (allowed.length < 2) {
    const id = allowed[0] ?? value;
    return (
      <div className="space-y-1">
        <h3 className="font-bold">アプリのフレームワーク</h3>
        <p>
          <NameWithInfo name={FRAMEWORKS[id].label} info={info(id)} />
        </p>
        {note(id) && <p className="text-sm opacity-70">{note(id)}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="font-bold">アプリを何で作りましたか？</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {allowed.map((id) => (
          <label
            key={id}
            className={`flex cursor-pointer items-start gap-3 rounded-box border p-3 ${value === id ? 'border-primary bg-primary/5' : 'border-base-300'}`}
          >
            <input
              type="radio"
              name="framework"
              className="radio radio-primary mt-0.5 shrink-0"
              checked={value === id}
              onChange={() => onChange(id)}
            />
            <span className="block min-w-0">
              <span className="block">
                <NameWithInfo name={FRAMEWORKS[id].label} info={info(id)} />
              </span>
              {/* 選んでいない方にも同じ注記を出す（見比べられるように。カードの高さは grid で揃う。D-45） */}
              {note(id) && (
                <span className="block text-xs opacity-70">{note(id)}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm opacity-60">
        途中で作り直すことはできない（乗り換えても同じアプリのまま）。SNS
        のカード・初回表示への効き方はゲーム上の仮定。
      </p>
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
