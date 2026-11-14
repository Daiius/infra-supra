import { useEffect, useRef, useState } from 'react';
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
  eventDef,
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
import { FeatureRing } from '../feature-ring.tsx';
import { Meta, NameWithInfo, OptionText } from '../option-text.tsx';
import { SetupChangeField } from '../setup-change-field.tsx';
import type { MonthDraft } from '../month-draft.ts';
import { PROPOSAL_BADGE, ProposalChoice } from '../proposal-choice.tsx';
import { commitmentMeta } from '../commitment-meta.ts';
import { fmtPoints } from '../format.ts';
import { FeatureProgressLine } from './effort.tsx';

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

/** 今月の行動。設定はいつでも戻せる。手間のポイントの残りの範囲で、いくつでも選べる。 */
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
    left,
    undecided,
  } = d;
  /** 未決の提案があるときに「次の月へ」で出す確認（D-140）。 */
  const [confirmDecline, setConfirmDecline] = useState(false);
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

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          今月のアクション（来月に効く）
          <span className="badge badge-lg">
            {/* 分母も選んでいる行動を当てた draft から（プラン変更で既定の分が替わる。D-123・OCL-ADB0B195） */}
            来月の手間の残り {fmtPoints(left)} / {fmtPoints(d.total)}
          </span>
          {/* 欄の使い方の説明は ⓘ に畳む（prd/16） */}
          <Info label="アクションの説明" title="今月のアクション">
            <p>
              選んだアクションは来月から効きます。手間の残りは機能開発に回り、満足度の「機能」（累計
              / 期待）と、評判を通して PV
              の伸びに効きます。設定はいつでも戻せます。
            </p>
            <p>
              来月の見込みには、来月に新しく起きるイベントの対応の手間は含めません。
            </p>
          </Info>
        </h2>
        <div className="space-y-0.5 text-sm" data-testid="feature-outlook">
          {/* 来月の機能開発の量とアクションでの増減は、下の輪のグラフの見出しと中央に出す */}
          <FeatureProgressLine
            scenario={sc}
            total={outlook.total}
            month={outlook.month}
            prefix="来月の"
            note={stageNote}
          />
          <div className="text-xs opacity-70">
            {outlook.total >= outlook.expected
              ? '来月の累計は期待に届きます'
              : `来月の累計は期待にあと ${fmtPoints(outlook.expected - outlook.total)} 届きません`}
          </div>
          <div className="mt-2">
            <FeatureRing
              scenario={sc}
              month={outlook.month}
              total={outlook.total}
              effort={outlook.effort}
              feature={outlook.feature}
              change={outlook.change}
              next
              note={stageNote}
            />
          </div>
        </div>
        {state.pendingProposals.length > 0 && (
          <div className="space-y-2">
            <div className="divider my-1 text-xs">
              届いた開発依頼（選ばなければ断る）
            </div>
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
        <div className="grid gap-3 md:grid-cols-3">
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
                      // 時間 → オンデマンドだけ実装の手間がかかる（D-49）
                      key === 'isr' ||
                      key === 'buildInterval' ||
                      key === 'pageCache'
                        ? `手間 ${def.effort}（${key === 'buildInterval' ? '更新のたびにビルド' : key === 'pageCache' ? ASTRO_ON_DEMAND : NEXT_ON_DEMAND}へは ${EFFORT.onDemandSwitch}）`
                        : `手間 ${def.effort}`,
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
              `手間 ${EFFORT.optimize}`,
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
              meta={[`手間 ${BOT_BLOCK.effort}`, '来月から効く']}
              info={
                <Info title="Bot を遮断するルールを入れる">
                  Bot・クローラーのアクセスが来月から半分になります。一度入れれば続きます。対策の製品（WAF
                  など）の料金は取得していないので、手間だけのアクションです。
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
            onClick={() => {
              if (undecided.length > 0) setConfirmDecline(true);
              else proceed();
            }}
          >
            次の月へ
          </button>
        </div>
      </div>
      {confirmDecline && (
        <DeclineConfirmDialog
          titles={undecided.map(
            (id) => eventDef(scenarioOf(state), id)?.title ?? id,
          )}
          onDecline={() => {
            setConfirmDecline(false);
            proceed();
          }}
          onBack={() => {
            setConfirmDecline(false);
            // 選び残した最初の提案の行へ移る（受ける・断るを選べるように）
            const row = document.querySelector<HTMLElement>(
              `[data-proposal-choice="${CSS.escape(undecided[0]!)}"]`,
            );
            row?.scrollIntoView?.({ block: 'center' });
            row
              ?.querySelector<HTMLInputElement>('input:not(:disabled)')
              ?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * 未決の提案があるまま「次の月へ」を押したときの確認（D-140）。進むと断ったことになる（受けると付く効果は無く、
 * 断ると起きること（画質が下がるなど）が起きる）。「提案を選ぶ」で行動の欄の提案の行へ戻る。
 */
function DeclineConfirmDialog({
  titles,
  onDecline,
  onBack,
}: {
  /** 未決の提案の題。 */
  titles: string[];
  onDecline: () => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // 「断って進む」で閉じたときに onBack を呼ばない
  const declined = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="decline-dialog-title"
      data-decline-confirm
      onClose={() => {
        if (!declined.current) onBack();
      }}
    >
      <div className="modal-box max-w-md">
        <h2 id="decline-dialog-title" className="text-lg font-bold">
          未決の開発依頼が {titles.length} 件あります
        </h2>
        <p className="mt-2 text-sm">
          このまま進むと、次の開発依頼は断ったことになります。
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {titles.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className={`badge badge-sm ${PROPOSAL_BADGE.cls}`}>
                {PROPOSAL_BADGE.label}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-primary btn-sm" autoFocus>
              開発依頼を選ぶ
            </button>
          </form>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              declined.current = true;
              ref.current?.close();
              onDecline();
            }}
          >
            断って進む
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>
  );
}
