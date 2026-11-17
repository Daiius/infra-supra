import {
  activeCommitments,
  commitmentOffers,
  PAYMENT_LABEL,
  type CommitmentPaymentId,
  actionEffort,
  BOT_BLOCK,
  fixedSettingValue,
  settingInactiveReason,
  settingNote,
  EFFORT,
  featureOutlook,
  featureProgressOf,
  hiddenSettings,
  storageOptionText,
  nextSsrCpuMs,
  scenarioOf,
  invalidationNote,
  onDemandInvalidationEstimate,
  settingFlavor,
  SETTINGS,
  type Action,
  type GameState,
  type SettingKey,
  ASTRO_ON_DEMAND,
  NEXT_ON_DEMAND,
} from 'game';
import { Info } from '../info.tsx';
import { FeatureRing, FeatureRingGuide } from '../feature-ring.tsx';
import { Meta, NameWithInfo, OptionText } from '../option-text.tsx';
import { SetupChangeField } from '../setup-change-field.tsx';
import type { MonthDraft } from '../month-draft.ts';
import { ProposalChoice } from '../proposal-choice.tsx';
import { commitmentMeta } from '../commitment-meta.ts';
import { fmtPoints } from '../format.ts';

/** 確約の行動（D-97）。今月の明細に対象の使用がある確約だけ出す。結んだ確約は期間を出す。 */
function CommitmentsSection({
  state,
  value,
  onChange,
  blocked,
}: {
  state: GameState;
  value: Record<string, CommitmentPaymentId>;
  onChange: (v: Record<string, CommitmentPaymentId>) => void;
  blocked: (v: Record<string, CommitmentPaymentId>) => string | null;
}) {
  const active = activeCommitments(state);
  const offers = commitmentOffers(state).filter(
    (o) => !active.some((c) => c.key === o.key),
  );
  if (!active.length && !offers.length) return null;
  return (
    <>
      <div className="divider my-1 text-xs">
        1 年契約（途中でやめられません）
      </div>
      {active.map((c) => (
        <div key={c.key} className="py-1 text-sm">
          1 年契約中: {c.label}（{PAYMENT_LABEL[c.payment]}・{c.endMonth}{' '}
          か月目まで。取り消せません）
        </div>
      ))}
      {offers.map((o) => {
        const on = value[o.key] === o.payment;
        const next = { ...value, [o.key]: o.payment };
        const why = on ? null : blocked(next);
        return (
          <label
            key={`${o.key}:${o.payment}`}
            className="flex cursor-pointer items-start gap-3 py-1"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-1"
              checked={on}
              disabled={!on && why !== null}
              onChange={(e) => {
                const v = { ...value };
                if (e.target.checked) v[o.key] = o.payment;
                else delete v[o.key];
                onChange(v);
              }}
            />
            <OptionText
              name={`${o.label}を結ぶ`}
              meta={[...commitmentMeta(o), '来月から']}
              info={
                <Info title={`${o.label}を結ぶ`}>
                  {o.premise}
                  。契約の額は今月の対象の使用（オンデマンドの額）で決まり、超えた分はオンデマンドのままです。取り消せず、乗り換え・部品の切り替えで使わなくなっても支払いは残ります。
                </Info>
              }
              why={why}
            />
          </label>
        );
      })}
    </>
  );
}

/** 今月の行動。設定はいつでも戻せる。工数のポイントの残りの範囲で、いくつでも選べる。 */
export function Actions({
  state,
  draft: d,
  onDecide,
}: {
  state: GameState;
  /** 今月の行動の下書き（出来事のダイアログの提案のページと共有する。D-202）。 */
  draft: MonthDraft;
  onDecide: (a: Action[]) => void;
}) {
  const {
    settings,
    setSettings,
    optimize,
    setOptimize,
    change,
    setChange,
    blockBots,
    setBlockBots,
    storage,
    setStorage,
    commits,
    setCommits,
    resets,
    reset,
    build,
    blocked,
    valid,
    actions,
    draft,
  } = d;
  const proceed = () => {
    onDecide(actions);
    reset();
  };
  // 来月の機能開発の見込み（選んだ行動・提案への返事を当てた配分。D-122）
  const outlook = featureOutlook(state, actions);
  // 今月の「機能」がメールが届かない分で下がっていれば、来月の見込みの段階は機能開発の比だけで見たものと断る（OCL-7D797D79）
  const lastReport = state.history[state.history.length - 1];
  const stageNote =
    lastReport &&
    lastReport.satisfaction.stages.feature !==
      featureProgressOf(
        scenarioOf(state),
        lastReport.featurePoints,
        lastReport.month,
      ).stage
      ? '（機能開発の分だけで見た段階。メールが届かないと下がります）'
      : '';
  const sc = scenarioOf(state);
  // このシナリオで効かない行動は出さない（D-33・prd/09 E-6）
  const hidden = scenarioOf(state).hidden;
  // シナリオで効かない設定と、SPA の ISR の間隔は出さない（OCL-8DFFDBEC）
  const hiddenKeys = hiddenSettings(state);
  const settingKeys = (Object.keys(SETTINGS) as SettingKey[]).filter(
    (k) => !hiddenKeys.includes(k),
  );
  // オンデマンドにしたときの CloudFront の無効化の見込み（今月の規模・OpenNext。D-66）。
  // 選んでいる行動を当てた draft から毎回引く（部品・提案への返事など、見積が読む行動の値をすべて反映する。OCL-7EDA42D6・OCL-8B602E76）
  const invalidationEst = settingKeys.includes('isr')
    ? onDemandInvalidationEstimate(draft)
    : undefined;
  const invalidation = invalidationEst && invalidationNote(invalidationEst);

  // 来月の見込みの輪（図と、見出しの ⓘ の読み方の説明で同じ値を使う）
  const ring = {
    scenario: sc,
    month: outlook.month,
    total: outlook.total,
    effort: outlook.effort,
    feature: outlook.feature,
    next: true,
    note: stageNote,
  };

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          今月のアクション
          {/* パネルの大事なこと（アクションの効き方・輪のグラフの読み方）をこの ⓘ にまとめる。
              個々のアクションの細かい説明はそれぞれの ⓘ（prd/16・D-222 の補足） */}
          <Info label="今月のアクションの見方" title="今月のアクション">
            <h3 className="font-bold">アクションの効き方</h3>
            <p>
              選んだアクションは来月から効きます。工数の残りは機能開発に回り、満足度の「機能」（累計
              / 期待）と、評判を通して PV
              の伸びに効きます。設定はいつでも戻せます。
            </p>
            <p>
              来月の見込みには、来月に新しく起きるイベントの対応の工数は含めません。
            </p>
            <h3 className="pt-2 font-bold">輪のグラフの見方</h3>
            <FeatureRingGuide {...ring} />
          </Info>
        </h2>
        {/* 広い画面では、入り切りのアクション（チェックボックス）を輪の右に並べ、選ぶと輪が変わるのを横で見られるようにする。
            狭い画面は今まで通り縦に積む（DOM の順も変えない。右の列は md:row-start-1 で輪の横に置く。D-222 の補足） */}
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:gap-x-8">
          {/* 来月の機能開発・累計・「機能」の段階は輪のグラフに任せる（文の行は外した。読み上げは輪の aria-label。D-222 の補足） */}
          <div className="text-sm" data-testid="feature-outlook">
            <FeatureRing {...ring} />
          </div>
          {state.pendingProposals.length > 0 && (
            <div className="col-span-full space-y-2">
              <div className="divider my-1 text-xs">届いた開発依頼</div>
              {state.pendingProposals.map((id) => (
                <ProposalChoice
                  key={id}
                  state={state}
                  id={id}
                  draft={d}
                  where="actions"
                />
              ))}
            </div>
          )}
          <div className="col-span-full grid gap-3 md:grid-cols-3">
            {settingKeys.map((key) => {
              const def = SETTINGS[key];
              const current = state.settings[def.field];
              // 欄を無効にして固定しているなら、選んだ値でなく固定の値を見せる（数えるのもその値。D-58 の補足）
              const fixed = fixedSettingValue(draft, key);
              const chosen = settings[key] ?? fixed ?? current;
              return (
                // 外側を label にしない: label の中で最初の操作できる要素は ⓘ のボタンなので、欄のどこを押しても説明が開く。
                // ⓘ を含む見出しは label にできない（他の操作できる要素を含めない）ので、名前は select の aria-label で付ける
                <div key={key} className="form-control">
                  <span className="label-text mb-1 block">
                    <span className="block font-semibold">
                      {/* 設定の説明・今の部品での注記・選んだ値の説明は ⓘ にまとめる（prd/16） */}
                      <NameWithInfo
                        name={def.label}
                        info={
                          <Info title={def.label}>
                            <p>{def.note}</p>
                            {settingNote(draft, key) && (
                              <p>{settingNote(draft, key)}</p>
                            )}
                            {settingFlavor(key, chosen) && (
                              <p>選んでいる値: {settingFlavor(key, chosen)}</p>
                            )}
                          </Info>
                        }
                      />
                    </span>
                    <Meta
                      items={[
                        // 時間 → オンデマンドだけ実装の工数がかかる（D-49）
                        key === 'isr' ||
                        key === 'buildInterval' ||
                        key === 'pageCache'
                          ? `工数 ${def.effort}（${key === 'buildInterval' ? '更新のたびにビルド' : key === 'pageCache' ? ASTRO_ON_DEMAND : NEXT_ON_DEMAND}へは ${EFFORT.onDemandSwitch}）`
                          : `工数 ${def.effort}`,
                        '来月から',
                      ]}
                    />
                    {settingInactiveReason(draft, key) && (
                      <span className="block text-xs opacity-70">
                        今は効かない: {settingInactiveReason(draft, key)}
                      </span>
                    )}
                  </span>
                  <select
                    aria-label={def.label}
                    className="select select-bordered select-sm w-full"
                    disabled={
                      settingInactiveReason(draft, key) !== undefined &&
                      settings[key] === undefined
                    }
                    value={chosen}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const next = { ...settings };
                      if (v === current) delete next[key];
                      else next[key] = v;
                      setSettings(next);
                    }}
                  >
                    {def.options.map((o) => {
                      const trial = { ...settings, [key]: o.value };
                      if (o.value === current) delete trial[key];
                      const why =
                        o.value === current
                          ? null
                          : blocked(build({ settings: trial }));
                      return (
                        <option
                          key={o.value}
                          value={o.value}
                          disabled={why !== null}
                        >
                          {o.label}
                          {fixed !== undefined
                            ? o.value === fixed
                              ? '（固定）'
                              : ''
                            : o.value === current
                              ? '（今）'
                              : ''}
                          {why ? `（${why}）` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {key === 'isr' && invalidation && (
                    <span className="mt-1 block text-xs text-warning">
                      「{NEXT_ON_DEMAND}」では {invalidation}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="md:col-start-2 md:row-start-1 md:self-center">
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-1"
                checked={optimize}
                disabled={!optimize && !valid(build({ optimize: true }))}
                onChange={(e) => setOptimize(e.target.checked)}
              />
              <OptionText
                name="SSR を最適化する"
                meta={[
                  `CPU ${nextSsrCpuMs(state)} → ${Math.max(EFFORT.minSsrCpuMs, nextSsrCpuMs(state) - EFFORT.optimizeStepMs)} ms`,
                  `工数 ${EFFORT.optimize}`,
                  '来月から',
                ]}
                info={
                  <Info title="SSR を最適化する">
                    CPU 時間と速さに効きます。機能開発が進むと SSR
                    はまた重くなるので、繰り返し判断が要ります。
                  </Info>
                }
                why={optimize ? null : blocked(build({ optimize: true }))}
              />
            </label>
            {!state.botBlocked && !hidden?.blockBots && (
              <label className="flex cursor-pointer items-start gap-3 py-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm mt-1"
                  checked={blockBots}
                  disabled={
                    !blockBots &&
                    (actionEffort(state, { type: 'block-bots' }) === null ||
                      !valid(build({ blockBots: true })))
                  }
                  onChange={(e) => setBlockBots(e.target.checked)}
                />
                <OptionText
                  name="Bot を遮断するルールを入れる"
                  meta={[`工数 ${BOT_BLOCK.effort}`, '来月から効く']}
                  info={
                    <Info title="Bot を遮断するルールを入れる">
                      Bot・クローラーのアクセスが来月から半分になります。一度入れれば続きます。対策の製品（WAF
                      など）の料金は取得していないので、工数だけのアクションです。
                    </Info>
                  }
                  why={blockBots ? null : blocked(build({ blockBots: true }))}
                />
              </label>
            )}
            {(() => {
              const t = storageOptionText(state.stackIndex);
              if (!t || state.storageOption) return null;
              const why = storage ? null : blocked(build({ storage: true }));
              return (
                <label className="flex cursor-pointer items-start gap-3 py-1">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-1"
                    checked={storage}
                    disabled={!storage && why !== null}
                    onChange={(e) => setStorage(e.target.checked)}
                  />
                  <OptionText
                    name={t.name}
                    meta={t.meta}
                    info={<Info title={t.name}>{t.detail}</Info>}
                    why={why}
                  />
                </label>
              );
            })()}
          </div>
        </div>
        <CommitmentsSection
          state={state}
          value={commits}
          onChange={setCommits}
          blocked={(c) => blocked(build({ commits: c }))}
        />
        {/* 構成を変える（D-185）: ①② のタブで今の状態から選び直し、差を行動に写し取る。毎月は変えない選択なので畳んで出し、
            見出しに登録した行動の要約を出す。乗り換えの最中も出し、描き方とコメント欄だけ選び直せる（見出しに進み具合。OCL-0B7CAFEB）。
            key を月ごとに替えて毎月畳んだ状態から */}
        <SetupChangeField
          key={`change-${state.history.length}-${resets}`}
          state={state}
          registered={change}
          onRegister={setChange}
          wrap={(g) => build({ change: g })}
        />
        <div className="card-actions items-center justify-end">
          {actions.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              選択を戻す
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!valid(actions)}
            // 開発依頼は既定で受けないので、選び残しの確認は出さない（D-225 で D-140 の確認をやめた）
            onClick={proceed}
          >
            次の月へ
          </button>
        </div>
      </div>
    </div>
  );
}
