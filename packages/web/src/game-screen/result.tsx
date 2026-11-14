import { useCallback, useEffect, useRef, useState } from 'react';
import {
  policyCauseOf,
  comparisonRows,
  effortTotalNote,
  ELEMENT_LABEL,
  ELEMENTS,
  END_LABEL,
  reflectionOf,
  retryHintsOf,
  scenarioOf,
  offeredBaselines,
  type Axes,
  type GameState,
  type Surprise,
} from 'game';
import { compact } from '../charts.tsx';
import { ResultAxesPanel } from '../result-axes.tsx';
import { ResultStatsSection } from '../stats-breakdown.tsx';
import type { StatsQuery } from '../stats-client.ts';
import {
  distributionFireworkLevel,
  TOP_PERCENT,
  topAxesCount,
  type StatsView,
} from '../distribution.ts';
import type { AxisComparison } from '../results-history.ts';
import { PortalContainer } from '../info.tsx';
import { usd } from '../commitment-meta.ts';
import {
  FireworksCanvas,
  FireworksEngine,
  useReducedMotion,
} from '../motion.tsx';
import { fmtPoints } from '../format.ts';

/**
 * 完走のダイアログと花火（D-25・D-131）。4 軸の値と集計の分布の中での位置（段 3・D-161）か手元の履歴との比較を出し、分布があれば上位に入った軸（向きのある 3 軸）が多いほど花火を増やす（D-163）。分布が無ければ花火はいつも 1 段（D-168）。開いている間は暗い背景の上で花火を打ち上げ続ける（ダイアログの背面・背景の前面）。
 * 閉じると背景が消え、新しい花火は出さない。空中に残った粒は少し薄くして、寿命で消えるまで描いてから片付ける。
 * 動きを減らす設定では、ダイアログだけ出して花火は出さない。作法は出来事のダイアログ（D-23）と同じ。
 */
export function VictoryCelebration({
  state,
  comparisons,
  stats,
  auto,
}: {
  state: GameState;
  comparisons: readonly AxisComparison[];
  stats: StatsView;
  /** 完走した直後に開いた（true）か、結果の画面のボタンで開き直した（false）か。 */
  auto: boolean;
}) {
  const reduced = useReducedMotion();
  // 書き換えながら使い、effect の依存にもなるので、参照が変わらない useState で持つ（useMemo は捨てられうる）
  const [engine] = useState(() => new FireworksEngine());
  const [open, setOpen] = useState(true);
  const [afterglow, setAfterglow] = useState(false);
  const ref = useRef<HTMLDialogElement | null>(null);
  // 4 軸の欄の ⓘ（D-207）の説明のダイアログを、このダイアログの中に描く（info.tsx の PortalContainer）
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const dialogRef = useCallback((el: HTMLDialogElement | null) => {
    ref.current = el;
    setDialogEl(el);
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // 完走した直後はフォーカスを外して開く（閉じた後もページの先頭のまま）。開き直したときはボタンへ戻す（D-23 と同じ）
    if (auto && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    d.showModal();
  }, [auto]);
  // 分布があれば上位に入った軸の数で花火の段を決め、無ければいつも 1 段（D-163・D-168。自己ベストの数では変えない）
  const dist = stats.status === 'ready' ? stats.view : null;
  const level = dist ? distributionFireworkLevel(dist) : 1;
  const topAxes = dist ? topAxesCount(dist) : 0;
  const cashGuide = scenarioOf(state).goal.cash;
  return (
    <>
      {open && (
        <dialog
          ref={dialogRef}
          className="modal"
          // 花火が映える暗い背景
          style={{ backgroundColor: 'rgba(6, 8, 22, 0.86)' }}
          aria-labelledby="victory-title"
          data-firework-level={level}
          onClose={() => {
            setOpen(false);
            setAfterglow(!reduced && engine.particles.length > 0);
          }}
        >
          {/* 見出しと閉じるボタンは固定し、4 軸の欄だけを縦にスクロールする（狭い画面で分布が高さを超える。OCL-3AA8C258）。
              高さは dvh で抑える（daisyUI の既定 100vh は iOS Safari のツールバーの分はみ出し、下のボタンが隠れる。D-204。上限は styles.css の .modal-box で全部のダイアログに。D-208） */}
          <div className="modal-box relative z-10 flex max-w-lg flex-col overflow-hidden p-0">
            {/* 成功の色の帯で見出しを強調する（色だけにせず ✓ とラベルを添える） */}
            <div className="shrink-0 bg-success px-6 py-5 text-success-content">
              <h2 id="victory-title" className="text-3xl font-bold">
                ✓ 完走
              </h2>
              <p className="mt-1 text-sm">
                {state.end!.month} か月の運営を走り切りました。4
                つの軸で振り返りましょう
                {dist &&
                  topAxes > 0 &&
                  `（${topAxes} つの軸で上位 ${TOP_PERCENT}% に入りました）`}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
              <PortalContainer.Provider value={dialogEl}>
                <ResultAxesPanel
                  comparisons={comparisons}
                  stats={stats}
                  outages={state.outages}
                  cashGuide={cashGuide}
                  size="lg"
                />
              </PortalContainer.Provider>
            </div>
            <div className="modal-action shrink-0 px-6 pb-6">
              <form method="dialog">
                <button className="btn btn-success" autoFocus>
                  閉じて結果を見る
                </button>
              </form>
            </div>
          </div>
          {/* 花火はダイアログより前面に描く（操作は妨げない） */}
          {!reduced && (
            <FireworksCanvas
              engine={engine}
              spawn
              level={level}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            />
          )}
          <form method="dialog" className="modal-backdrop">
            <button aria-label="閉じる" tabIndex={-1}>
              閉じる
            </button>
          </form>
        </dialog>
      )}
      {afterglow && (
        <FireworksCanvas
          engine={engine}
          spawn={false}
          alpha={0.45}
          className="pointer-events-none fixed inset-0 z-40 h-full w-full"
          onEmpty={() => setAfterglow(false)}
        />
      )}
    </>
  );
}

/** 見込みが外れた理由の文（prd/07 §10.7）。 */
function surpriseReason(x: Surprise): string {
  switch (x.cause.kind) {
    case 'event':
      return `理由: イベント「${x.cause.title}」。これが無ければ今月は ${(x.cause.ratioWithout * 100).toFixed(0)}% で、超えませんでした`;
    case 'action':
      return `理由: 前の月の選択（${x.cause.action}）`;
    case 'growth':
      return '理由: 伸びが直近の推移より速かったため';
  }
}

/** 花火のアイコン（中心から放射する線と点。currentColor で描く）。 */
function FireworkIcon() {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      {rays.map((a) => (
        <line
          key={a}
          x1={12 + Math.cos(a) * 3.5}
          y1={12 + Math.sin(a) * 3.5}
          x2={12 + Math.cos(a) * 8}
          y2={12 + Math.sin(a) * 8}
        />
      ))}
      {rays.map((a) => (
        <circle
          key={`d${a}`}
          cx={12 + Math.cos(a + Math.PI / 8) * 10.5}
          cy={12 + Math.sin(a + Math.PI / 8) * 10.5}
          r="0.9"
          fill="currentColor"
          stroke="none"
        />
      ))}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 結果（prd/07 §9.6・prd/15 §3）: 終わり方・4 軸と手元の履歴との比較（完走のとき）・基準プレイとの比較・振り返り。 */
export function Result({
  state,
  comparisons,
  stats,
  statsQuery,
  onCelebrate,
}: {
  state: GameState;
  comparisons: readonly AxisComparison[];
  stats: StatsView;
  /** 絞り込みのチップと比較の図の元（D-175）。 */
  statsQuery: StatsQuery | null;
  /** 完走のダイアログを開き直す（完走のときだけ使う）。 */
  onCelebrate: () => void;
}) {
  const completed = state.phase === 'completed';
  const end = state.end!;
  // 行の名前（基準プレイは短い名前）は game の comparisonRows で決める（単体テストあり）
  const table = comparisonRows(state);
  /** 短い名前と説明が違う基準プレイだけを注記に出す。 */
  const abbreviated = offeredBaselines(scenarioOf(state)).filter(
    (b) => b.short && b.short !== b.label,
  );
  const reflection = reflectionOf(state);
  // 次のプレイへのヒント（途中終了のとき。完走のときは伸ばせる所として出す。D-40・D-143）
  const hints = retryHintsOf(state);
  // 規約違反で終わったときの原因のプラン（それ以外は null）
  const policy = policyCauseOf(state);
  const rows: { label: string; get: (a: Axes) => string }[] = [
    { label: '累積の利益', get: (a) => usd(a.profit) },
    { label: '満足度の平均', get: (a) => a.satisfaction.toFixed(2) },
    {
      label: '最終的な規模（月 PV）',
      get: (a) => compact(Math.round(a.finalPV)),
    },
    {
      label: '機能開発に回せた手間',
      get: (a) => `${a.featurePoints}（${(a.featureShare * 100).toFixed(0)}%）`,
    },
  ];
  const e = reflection.effort;
  return (
    // 完走は花火、途中終了は控えめにフェードインだけ（D-25。動きを減らす設定では出さない）
    <div className="card motion-fade-in bg-base-100 shadow">
      <div className="card-body gap-4">
        {/* 完走の帯は始める画面の紹介の箱（D-133）と同じ形: success の枠と印だけで、全面は塗りつぶさない（D-170）。途中終了は今の塗りのまま */}
        <div
          className={`alert ${completed ? 'border-2 border-success bg-base-100 text-base-content' : 'alert-error'}`}
          data-result-band={completed ? 'completed' : 'lost'}
        >
          {/* 中身を 1 つのブロックにする（alert の grid で横に割られて途中で折り返さないように） */}
          <div className="min-w-0">
            <div className="text-lg font-bold">
              {completed && (
                <span className="text-success" aria-hidden>
                  ✓{' '}
                </span>
              )}
              {END_LABEL[end.reason]}
            </div>
            <div>
              <span className="whitespace-nowrap">
                {end.month} か月目で終了
              </span>
              ・
              <span className="whitespace-nowrap">
                所持金 {usd(state.cash)}
              </span>
              ・
              <span className="whitespace-nowrap">
                止まった月 {state.outages} 回
              </span>
            </div>
            {policy && (
              // 規約違反で終わったとき: 原因のプラン・部品を強調する（どの選択が原因か分かるように）
              <div className="mt-1" data-policy-cause-result>
                原因のプラン:{' '}
                <span className="badge badge-neutral font-bold">
                  {policy.label ?? policy.text}
                </span>
                <span className="ml-1 text-sm">
                  （{policy.text}
                  {policy.warnedMonth !== null &&
                    `。${policy.warnedMonth} か月目に指摘を受けました`}
                  ）
                </span>
              </div>
            )}
          </div>
          {completed && (
            // 帯の中の花火のアイコンのボタン（SVG。端末のフォントに依存しない）。帯の文字の色で描く
            <button
              className="btn btn-circle btn-sm ml-auto border-current bg-transparent text-current shadow-none hover:bg-black/10"
              onClick={onCelebrate}
              aria-label="もう一度祝う（完走のダイアログを開く）"
              title="もう一度祝う（完走のダイアログを開く）"
            >
              <FireworkIcon />
            </button>
          )}
        </div>
        {completed && (
          // 結果の画面だけ、絞り込みのチップと構成ごとの比較の図を足す（完走のダイアログは今のまま。D-175）
          <ResultStatsSection
            comparisons={comparisons}
            stats={stats}
            outages={state.outages}
            cashGuide={scenarioOf(state).goal.cash}
            query={statsQuery}
          />
        )}
        {hints.length > 0 && (
          // 折りたたまずに出す。原因と対策の方向だけで、正解の構成名は出さない（D-40）
          <section
            className="rounded-box border-2 border-warning bg-warning/10 p-3 sm:p-4"
            aria-labelledby="retry-hints-title"
          >
            <h3 id="retry-hints-title" className="mb-2 font-bold">
              {completed ? '次のプレイで伸ばせる所' : '次のプレイへのヒント'}
            </h3>
            <ol className="space-y-3">
              {hints.map((x, i) => (
                <li key={`${x.kind}:${i}`} className="flex gap-2">
                  <span className="badge badge-warning badge-sm mt-0.5 shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm">{x.what}</p>
                    <p className="mt-1 text-sm">
                      <span className="mr-1 font-semibold whitespace-nowrap">
                        次に試せる方向:
                      </span>
                      {x.next}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title font-bold">
            基準プレイとの比較の表（軸ごとの成績・満足度の要素）
          </summary>
          <div className="collapse-content">
            <p className="mb-1 text-sm opacity-70">
              1
              つの点数にはしません。下の行は同じシードの基準プレイ（目盛り）です
            </p>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">戦略</th>
                    {rows.map((r) => (
                      <th
                        key={r.label}
                        className="whitespace-nowrap text-right"
                      >
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((p) => (
                    <tr key={p.id} className={p.you ? 'font-semibold' : ''}>
                      <td className="whitespace-nowrap" title={p.description}>
                        {p.name}
                      </td>
                      {rows.map((r) => (
                        <td
                          key={r.label}
                          className={`whitespace-nowrap text-right tabular-nums ${p.you ? '' : 'opacity-70'}`}
                        >
                          {r.get(p.axes)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 className="mt-3 mb-1 text-sm font-semibold">
              満足度の要素の平均（良い 1・普通 0.5・悪い 0）
            </h4>
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">戦略</th>
                    {ELEMENTS.map((el) => (
                      <th key={el} className="whitespace-nowrap text-right">
                        {ELEMENT_LABEL[el]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((p) => (
                    <tr key={p.id} className={p.you ? 'font-semibold' : ''}>
                      <td className="whitespace-nowrap" title={p.description}>
                        {p.name}
                      </td>
                      {ELEMENTS.map((el) => (
                        <td
                          key={el}
                          className={`text-right tabular-nums ${p.you ? '' : 'opacity-70'}`}
                        >
                          {p.axes.elements[el].toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {abbreviated.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs opacity-70">
                {abbreviated.map((b) => (
                  <li key={b.id}>
                    {b.short}: {b.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title font-bold">
            振り返り: 達した上限・満足度が悪かった月・手間の内訳
          </summary>
          <div className="collapse-content">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-bold">達した上限・近づいた上限</h3>
                {reflection.premises.length ? (
                  <ul className="space-y-1 text-sm">
                    {reflection.premises.map((p) => (
                      <li key={p.text}>
                        <span
                          className={`badge badge-sm mr-1 ${p.hit ? 'badge-error' : 'badge-info'}`}
                        >
                          {p.month} か月目・{p.hit ? '達した' : '近づいた'}
                        </span>
                        {p.text}
                        {p.action && (
                          <span className="block text-xs opacity-70">
                            その月の選択: {p.action}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">なし</p>
                )}
                {reflection.surprises.length > 0 && (
                  <>
                    <h3 className="mt-3 mb-1 font-bold">
                      見込みより早く超えた上限と、その理由
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {reflection.surprises.map((x) => (
                        <li key={`${x.premiseId}:${x.month}`}>
                          <span className="badge badge-sm badge-outline mr-1">
                            {x.month} か月目
                          </span>
                          {x.text}
                          <span className="block text-xs opacity-70">
                            {surpriseReason(x)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <h3 className="mb-1 font-bold">満足度が「悪い」になった月</h3>
                {reflection.badMonths.length ? (
                  <ul className="space-y-1 text-sm">
                    {reflection.badMonths.map((b, i) => (
                      <li key={i}>
                        {b.month} か月目・{b.label}
                        <span className="ml-1 text-xs opacity-70">
                          {b.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">なし</p>
                )}
                <h3 className="mt-3 mb-1 font-bold">
                  手間の使い道（合計 {fmtPoints(e.total)}
                  {effortTotalNote(e.total, e.accountAllowance)}）
                </h3>
                <ul className="text-sm">
                  {[
                    ['自前運用の維持', e.upkeep],
                    ...(e.accounts ? [['他の事業者の管理', e.accounts]] : []),
                    ['イベントへの対応', e.interrupt],
                    ['乗り換え', e.migration],
                    ['アクション（設定・最適化）', e.actions],
                    ['機能の追加（開発依頼）', e.featureWork],
                    [
                      '機能開発（残り）',
                      e.feature - e.featureWork - e.featureBonus,
                    ],
                  ].map(([label, v]) => (
                    <li key={label as string} className="flex">
                      {label}
                      <span className="ml-auto tabular-nums">
                        {fmtPoints(v as number)}（
                        {e.total
                          ? (((v as number) / e.total) * 100).toFixed(0)
                          : 0}
                        %）
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
