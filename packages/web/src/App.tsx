// ゲームモードの最初の画面（Phase 2〜4 の前倒しの試作）。ロジックは game パッケージ、ここは表示と操作だけ。
import { useState } from 'react';
import {
  applyAction,
  GAME,
  IMPROVEMENTS,
  newGame,
  playMonth,
  STACKS,
  type Action,
  type GameState,
  type MonthReport,
} from 'game';
import type { PlatformPremise } from 'estimator';

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yen = (usdAmount: number) =>
  `${Math.round(usdAmount * GAME.usdJpy).toLocaleString()} 円`;

export function App() {
  const [state, setState] = useState<GameState | null>(null);
  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-sm">
        <span className="px-4 text-lg font-bold">infra-supra（仮称）</span>
        <span className="text-sm opacity-60">
          Web アプリのインフラ運営シミュレーション（試作）
        </span>
        {state && (
          <button
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => setState(null)}
          >
            最初から
          </button>
        )}
      </div>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {state ? (
          <Game state={state} setState={setState} />
        ) : (
          <Briefing onStart={setState} />
        )}
      </main>
    </div>
  );
}

function Briefing({ onStart }: { onStart: (s: GameState) => void }) {
  const [stack, setStack] = useState(1);
  const [seed, setSeed] = useState(42);
  return (
    <>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">
            シナリオ: 記事コミュニティを {GAME.months} か月運営する
          </h2>
          <p>
            Next.js（App Router）で作った記事 +
            コメントのサイト。広告収入で運営する（商用）。今は月{' '}
            {GAME.startPV.toLocaleString()} PV。順調なら毎月 {GAME.growth * 100}
            % ずつ伸びる。どこかで SNS で話題になるかもしれない。
          </p>
          <p>
            所持金 {usd(GAME.startCash)}。自前で運用する構成は、毎月{' '}
            {usd(GAME.selfHostedOpsUsdPerMonth)} の作業がかかる。
          </p>
          <div className="alert alert-info">
            目標: {GAME.months} か月後に所持金 {usd(GAME.goal.cash)}{' '}
            以上、止まった月が {GAME.goal.maxOutageMonths} 回以内
          </div>
          <h3 className="mt-2 font-bold">
            アプリの形（コストに効く判断ポイント）
          </h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              記事ページは ISR（再検証 5 分・2,000 ページ）、マイページなどは
              SSR。SSR 1 回の CPU は約 15 ms
            </li>
            <li>
              1 PV あたり画像 5 枚（150 KB）。画像は 5,000 種類 × サイズ違い 3
            </li>
            <li>1 PV あたり API 1 回。DB は小さい（0.3 GB）</li>
          </ul>
          <p className="text-sm opacity-60">
            料金は 2026-10-31 時点の公式の料金表（エンジンと実データ）。円建ては
            1 USD = {GAME.usdJpy} 円の仮定で換算。
            収益・成長・行動の費用・障害の影響はゲーム上の仮定。
          </p>
        </div>
      </div>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">どの構成で始めますか？</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {STACKS.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-box border p-3 ${stack === s.index ? 'border-primary bg-primary/5' : 'border-base-300'}`}
              >
                <input
                  type="radio"
                  className="radio radio-primary"
                  checked={stack === s.index}
                  onChange={() => setStack(s.index)}
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          <div className="card-actions items-center justify-end">
            <label className="flex items-center gap-2 text-sm">
              乱数のシード
              <input
                type="number"
                className="input input-sm input-bordered w-24"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => onStart(playMonth(newGame(stack, seed)))}
            >
              運営を始める
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Game({
  state,
  setState,
}: {
  state: GameState;
  setState: (s: GameState) => void;
}) {
  const report = state.history[state.history.length - 1]!;
  return (
    <>
      <MonthCard report={report} />
      {state.phase === 'playing' ? (
        <Actions
          state={state}
          onDecide={(a) => setState(playMonth(applyAction(state, a)))}
        />
      ) : (
        <Result state={state} />
      )}
      <History history={state.history} />
    </>
  );
}

const STATUS: Record<MonthReport['status'], { label: string; cls: string }> = {
  ok: { label: '正常', cls: 'badge-success' },
  slow: { label: '遅延', cls: 'badge-warning' },
  incident: { label: '数時間の障害', cls: 'badge-warning' },
  down: { label: '停止', cls: 'badge-error' },
};

function MonthCard({ report: r }: { report: MonthReport }) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">
          {r.month} か月目{' '}
          <span className="font-normal opacity-70">{r.stackName}</span>
          <span className={`badge ${STATUS[r.status].cls}`}>
            {STATUS[r.status].label}
          </span>
        </h2>
        {r.notes.map((n) => (
          <div
            key={n}
            className={`alert ${r.buzz && n.includes('SNS') ? 'alert-info' : 'alert-warning'} py-2`}
          >
            {n}
          </div>
        ))}
        <div className="stats stats-vertical bg-base-200 sm:stats-horizontal">
          <Stat title="PV" value={Math.round(r.pv).toLocaleString()} />
          <Stat title="収益" value={usd(r.revenue)} />
          <Stat
            title="費用"
            value={usd(r.infraCost + r.opsCost)}
            desc={`${yen(r.infraCost + r.opsCost)}${r.opsCost ? `・うち運用の作業 ${usd(r.opsCost)}` : ''}`}
          />
          <Stat title="所持金" value={usd(r.cash)} />
        </div>
        {r.premises.length > 0 && (
          <div>
            <h3 className="mb-1 font-bold">プラットフォームの前提</h3>
            <ul className="space-y-1">
              {r.premises.map((p) => (
                <PremiseRow key={p.id} p={p} />
              ))}
            </ul>
          </div>
        )}
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title text-sm">
            料金の明細
            {r.unpricedLines
              ? `（料金未取得 ${r.unpricedLines} 件。費用は下限）`
              : ''}
          </summary>
          <div className="collapse-content">
            <table className="table table-sm">
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.label}</td>
                    <td className="text-right font-mono">
                      {l.currency === 'JPY'
                        ? `${Math.round(l.amount).toLocaleString()} 円`
                        : usd(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  desc,
}: {
  title: string;
  value: string;
  desc?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-title">{title}</div>
      <div className="stat-value text-2xl">{value}</div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
}

function PremiseRow({ p }: { p: PlatformPremise }) {
  const blocked = p.hit && p.effect !== 'cost';
  const badge =
    p.kind === 'fact'
      ? p.hit
        ? 'badge-error'
        : 'badge-ghost'
      : blocked
        ? 'badge-error'
        : p.hit
          ? 'badge-warning'
          : 'badge-info';
  const label =
    p.kind === 'fact'
      ? p.hit
        ? '違反'
        : '事実'
      : blocked
        ? '当たった'
        : p.hit
          ? '超過（課金）'
          : 'あと少し';
  const ratio = p.ratio === undefined ? null : Math.min(p.ratio, 1);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className={`badge badge-sm ${badge}`}>{label}</span>
      <span>{p.text}</span>
      {ratio !== null && (
        <span className="flex items-center gap-1 text-xs opacity-70">
          <progress
            className={`progress w-20 ${blocked ? 'progress-error' : p.hit ? 'progress-warning' : 'progress-info'}`}
            value={ratio}
            max={1}
          />
          {(p.ratio! * 100).toFixed(0)}%
        </span>
      )}
    </li>
  );
}

function Actions({
  state,
  onDecide,
}: {
  state: GameState;
  onDecide: (a: Action) => void;
}) {
  const [choice, setChoice] = useState<string>('none');
  const decide = () => {
    if (choice.startsWith('improve:'))
      onDecide({ type: 'improve', key: choice.slice(8) as never });
    else if (choice.startsWith('migrate:'))
      onDecide({ type: 'migrate', stackIndex: Number(choice.slice(8)) });
    else onDecide({ type: 'none' });
    setChoice('none');
  };
  const option = (value: string, label: string, sub?: string) => (
    <label key={value} className="flex cursor-pointer items-start gap-3 py-1">
      <input
        type="radio"
        className="radio radio-sm mt-1"
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      <span>
        {label}
        {sub && <span className="block text-xs opacity-60">{sub}</span>}
      </span>
    </label>
  );
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">今月の行動（来月に効く）</h2>
        {option('none', 'このまま続ける')}
        {IMPROVEMENTS.filter((i) => !state.improvements.includes(i.key)).map(
          (i) =>
            option(`improve:${i.key}`, `${i.label}  ${usd(i.cost)}`, i.note),
        )}
        <div className="divider my-1 text-xs">
          構成を乗り換える（{usd(GAME.migrationCost)}・翌月は作業で収益が{' '}
          {GAME.migrationRevenueLoss * 100}% 減る）
        </div>
        {STACKS.filter((s) => s.index !== state.stackIndex).map((s) =>
          option(`migrate:${s.index}`, `${s.name} へ乗り換える`),
        )}
        <div className="card-actions justify-end">
          <button className="btn btn-primary" onClick={decide}>
            次の月へ
          </button>
        </div>
      </div>
    </div>
  );
}

function Result({ state }: { state: GameState }) {
  const won = state.phase === 'won';
  return (
    <div className={`alert ${won ? 'alert-success' : 'alert-error'}`}>
      <span className="text-lg font-bold">
        {won
          ? '🎉 目標達成'
          : state.history.length < GAME.months
            ? '💸 所持金が尽きた'
            : '目標に届かず'}
      </span>
      <span>
        所持金 {usd(state.cash)}・止まった月 {state.outages} 回
      </span>
    </div>
  );
}

function History({ history }: { history: MonthReport[] }) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body overflow-x-auto">
        <h2 className="card-title">これまでの運営</h2>
        <table className="table table-sm">
          <thead>
            <tr>
              <th>月</th>
              <th>構成</th>
              <th className="text-right">PV</th>
              <th className="text-right">収益</th>
              <th className="text-right">費用</th>
              <th className="text-right">所持金</th>
              <th>状態</th>
              <th>行動</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                <td>{r.stackName}</td>
                <td className="text-right">
                  {Math.round(r.pv).toLocaleString()}
                </td>
                <td className="text-right">{usd(r.revenue)}</td>
                <td className="text-right">{usd(r.infraCost + r.opsCost)}</td>
                <td className="text-right">{usd(r.cash)}</td>
                <td>
                  <span className={`badge badge-sm ${STATUS[r.status].cls}`}>
                    {STATUS[r.status].label}
                  </span>
                </td>
                <td className="text-xs">{r.action ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
