// 始める画面のシナリオの選択と説明（D-33・prd/09 E-5・E-6）。文言はシナリオのデータ（Scenario.text）から読む。
import {
  FRAMEWORKS,
  growthFromReputation,
  SCENARIOS,
  type FrameworkId,
  type Scenario,
} from 'game';

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

/** アプリのフレームワークを選ぶ（シナリオで選べるものが 2 つ以上のときだけ。prd/10 F-04）。 */
export function FrameworkPicker({
  allowed,
  value,
  onChange,
}: {
  allowed: FrameworkId[];
  value: FrameworkId;
  onChange: (id: FrameworkId) => void;
}) {
  if (allowed.length < 2) return null;
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">アプリを何で作りましたか？</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {allowed.map((id) => {
            const f = FRAMEWORKS[id];
            return (
              <label
                key={id}
                className={`flex cursor-pointer items-start gap-3 rounded-box border p-3 ${value === id ? 'border-primary bg-primary/5' : 'border-base-300'}`}
              >
                <input
                  type="radio"
                  name="framework"
                  className="radio radio-primary mt-1"
                  checked={value === id}
                  onChange={() => onChange(id)}
                />
                <span>
                  <span className="font-semibold">{f.label}</span>
                  <span className="block text-sm opacity-70">{f.note}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-sm opacity-60">
          途中で作り直すことはできない（乗り換えても同じアプリのまま）。SNS
          のカード・初回表示への効き方はゲーム上の仮定。
        </p>
      </div>
    </div>
  );
}

/** シナリオの説明・目標・アプリの形。 */
export function ScenarioDescription({
  scenario: sc,
  framework = 'nextjs',
  usdJpy,
}: {
  scenario: Scenario;
  framework?: FrameworkId;
  usdJpy: number;
}) {
  const t = sc.text;
  const byFw = t?.byFramework?.[framework];
  const intro = byFw?.intro ?? t?.intro;
  const app = byFw?.app ?? t?.app ?? [];
  const spa = framework === 'vite-spa' ? sc.frameworks?.spa : undefined;
  const ssrCpuMs = sc.template(1).routes[0]!.processing.cpuMs;
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
          {sc.effort.selfHostedUpkeep} / 月）に使った残りが機能開発に回る。
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
        <ul className="list-disc space-y-1 pl-6">
          {app.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {spa ? (
            <li>
              中身を返す API 1 回の CPU は約{' '}
              {ssrCpuMs * spa.shape.dataCpuFactor} ms（HTML を描かない分 SSR の{' '}
              {spa.shape.dataCpuFactor}{' '}
              倍と仮定。機能が増えると重くなる）。この仮定で Cloudflare Free の
              1 リクエスト CPU 10 ms に当たるかが決まる
            </li>
          ) : (
            <li>SSR 1 回の CPU は約 {ssrCpuMs} ms（機能が増えると重くなる）</li>
          )}
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
