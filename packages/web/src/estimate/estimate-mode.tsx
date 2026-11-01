// 見積モードの画面（D-73）。計算は model.ts（純粋関数）、ここは入力と表示だけ。入力は URL のクエリに残す（共有のため）。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlatformPremise } from 'estimator';
import {
  componentConflict,
  FRAMEWORKS,
  frameworksOf,
  setupSlots,
  stackName,
  stackSupports,
  STACKS,
  type FrameworkId,
} from 'game';
import {
  LogCurveChart,
  SeriesSwatch,
  type CurveChartSeries,
  type MarkShape,
} from '../charts.tsx';
import { Info } from '../info.tsx';
import {
  compareStacks,
  costCurves,
  CURVE_MAX,
  CURVE_PVS,
  curveColorSlot,
  defaultCurveStacks,
  pickedCurveStacks,
  fromQuery,
  IMAGE_FORMATS,
  normalizeInput,
  normalizeSeats,
  PV_PRESETS,
  runEstimate,
  scenarioOfTemplate,
  SEATS_MAX,
  settingsOf,
  sortRows,
  TEMPLATES,
  toQuery,
  USD_JPY,
  VARIANTS,
  withStack,
  type EstimateInput,
  type LineView,
  type MemberView,
  type SortKey,
  type TaxView,
  type TemplateId,
} from './model.ts';

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const jpy = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const money = (n: number, currency: string) =>
  currency === 'JPY' ? jpy(n) : usd(n);
const qty = (n: number) =>
  n.toLocaleString('ja-JP', {
    maximumFractionDigits: Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 3,
  });
const pct = (r: number) =>
  Number.isFinite(r) ? `${Math.round(r * 100)}%` : '∞';

/** 前提の効き方（超えたときに何が起きるか）。 */
const EFFECT_LABEL: Record<PlatformPremise['effect'], string> = {
  block: '止まる',
  'upgrade-required': 'プランの変更が要る',
  throttle: '遅くなる・制限される',
  adjust: '調整される',
  cost: '費用が増える',
  policy: '規約',
  info: '情報',
};

export function EstimateMode() {
  const [input, setInputState] = useState<EstimateInput>(() =>
    normalizeInput(fromQuery(window.location.search)),
  );
  const setInput = (next: Partial<EstimateInput>) =>
    setInputState((cur) => normalizeInput({ ...cur, ...next }));
  // 入力を URL に残す（履歴は増やさない）
  useEffect(() => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?${toQuery(input)}`,
    );
  }, [input]);

  const view = useMemo(() => runEstimate(input), [input]);
  const rows = useMemo(() => compareStacks(input), [input]);

  return (
    <div className="space-y-4">
      <p className="text-sm opacity-70">
        アプリの形と規模を選ぶと、構成ごとの月の費用と、当たるプラットフォームの前提を出す。料金は各社の公式の料金表（出典と取得日は下）、利用の形はテンプレートの仮定（実測ではない）。
      </p>
      <Conditions input={input} setInput={setInput} mau={view.mau} />
      <Card title={`月の費用: ${view.name}`}>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-3xl font-bold tabular-nums">
            {usd(view.totalUsd)}
          </span>
          <span className="opacity-70">/ 月</span>
          <span className="text-sm opacity-70">
            約 {jpy(view.totalJpy)}（1 USD = {USD_JPY} 円の仮定）
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={input.showTax}
            onChange={(e) => setInput({ showTax: e.target.checked })}
          />
          日本から契約するときの税込の目安（円）を出す
        </label>
        {input.showTax && <Tax tax={view.tax} />}
        <Members members={view.members} seats={view.seats} />
        {view.totals.JPY !== undefined && (
          <p className="text-xs opacity-70">
            内訳の通貨: {usd(view.totals.USD ?? 0)} + {jpy(view.totals.JPY)}
            （円建ての事業者は円で請求される）
          </p>
        )}
        {view.unpricedLines > 0 && (
          <p className="text-sm text-warning">
            料金未取得の明細が {view.unpricedLines}{' '}
            件ある（合計に含まないので、合計は下限）
          </p>
        )}
        <Premises
          thresholds={view.thresholds}
          facts={view.facts}
          unpriced={view.unpricedLines}
        />
      </Card>
      <Card title="明細（事業者・メーターごと）">
        <p className="text-xs opacity-70">
          使用量のうち「込み分」は無料枠・プランに含まれる量で、残りが課金対象。クレジットは従量の金額に当てる（当てられる額
          / 上限）。
        </p>
        {view.providers.map((p) => (
          <details key={p.provider} open className="min-w-0">
            <summary className="cursor-pointer font-semibold">
              {p.provider}（{p.plans.join('・')}）:{' '}
              {money(p.subtotal, p.currency)}
            </summary>
            <Lines lines={p.lines} />
          </details>
        ))}
      </Card>
      <Comparison
        rows={rows}
        showTax={input.showTax}
        onPick={(stack) => setInput(withStack(input, stack))}
      />
      <CostCurve input={input} rows={rows} />
      <Card title="料金データの出典">
        <ul className="space-y-2 text-sm">
          {view.sources.map((s) => (
            <li key={s.provider}>
              <details>
                <summary className="cursor-pointer">
                  {s.provider}（版 {s.version}・取得日 {s.retrievedAt}・
                  {s.currency}
                  {s.taxIncluded ? '・税込' : '・税別'}）: {s.links.length} 件
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                  {s.links.map((l) => (
                    <li key={l.id} className="break-all">
                      <a
                        className="link"
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {l.url}
                      </a>{' '}
                      <span className="opacity-70">（{l.retrievedAt}）</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        <ShareButton />
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card bg-base-100 shadow">
      <div className="card-body min-w-0 gap-3 p-4 sm:p-6">
        <h2 className="card-title text-base sm:text-lg">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-semibold">
        {label}
        {info && (
          <>
            {' '}
            <Info label={`${label} の説明`}>{info}</Info>
          </>
        )}
      </span>
      {children}
    </label>
  );
}

function Conditions({
  input,
  setInput,
  mau,
}: {
  input: EstimateInput;
  setInput: (p: Partial<EstimateInput>) => void;
  mau: number;
}) {
  const scenario = scenarioOfTemplate(input.template);
  const fws = frameworksOf(scenario).allowed;
  const stackIndex = STACKS.findIndex((s) => s.id === input.stack);
  const platform = STACKS[stackIndex]!.provider;
  const slots = setupSlots(scenario, stackIndex, input.framework, input.parts);
  const settings = settingsOf(input.template, input.framework);
  const [pvText, setPvText] = useState(String(input.pv));
  useEffect(() => setPvText(String(input.pv)), [input.pv]);
  const select = 'select select-bordered select-sm w-full';
  return (
    <Card title="条件">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="テンプレート">
          <select
            className={select}
            value={input.template}
            onChange={(e) =>
              setInput({ template: e.target.value as TemplateId })
            }
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="月の PV"
          info="1 か月のページビュー。MAU はテンプレートの仮定（1 人あたりの月の PV。下に出す）から出す。月の中の伸びは扱わない"
        >
          <input
            className="input input-bordered input-sm w-full"
            type="number"
            inputMode="numeric"
            min={1000}
            step={1000}
            list="estimate-pv-presets"
            value={pvText}
            onChange={(e) => setPvText(e.target.value)}
            onBlur={() => setInput({ pv: Number(pvText) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setInput({ pv: Number(pvText) });
            }}
          />
          <datalist id="estimate-pv-presets">
            {PV_PRESETS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <span className="mt-1 flex flex-wrap gap-1">
            {PV_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className={`btn btn-xs ${v === input.pv ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setInput({ pv: v })}
              >
                {v >= 1e6 ? `${v / 1e6}M` : `${v / 1e3}K`}
              </button>
            ))}
          </span>
          <span className="mt-1 block text-xs opacity-70">
            MAU 約 {Math.round(mau).toLocaleString('ja-JP')}
            {mau > 0 &&
              `（テンプレートの仮定: 1 人あたり月 ${Math.round(input.pv / mau).toLocaleString('ja-JP')} PV）`}
          </span>
        </Field>
        <Field label="フレームワーク">
          <select
            className={select}
            value={input.framework}
            onChange={(e) =>
              setInput({ framework: e.target.value as FrameworkId })
            }
          >
            {fws.map((f) => (
              <option key={f} value={f}>
                {FRAMEWORKS[f].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="構成">
          <select
            className={select}
            value={input.stack}
            onChange={(e) => setInput(withStack(input, e.target.value))}
          >
            {STACKS.filter((s) => stackSupports(s.index, input.framework)).map(
              (s) => (
                <option key={s.id} value={s.id}>
                  {stackName(s.index, input.framework, false)}
                </option>
              ),
            )}
          </select>
        </Field>
        <Seats seats={input.seats} setInput={setInput} />
      </div>
      <h3 className="font-semibold">部品</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((x) => {
          if (x.fixed || x.slot === 'files')
            return (
              <div key={x.slot} className="min-w-0 text-sm">
                <span className="block font-semibold">{x.label}</span>
                <span className="opacity-70">
                  {x.options[0]!.label}（この構成では 1 択）
                </span>
              </div>
            );
          const slot = x.slot;
          const current = input.parts[slot];
          const note = x.options.find((o) => o.id === current)?.note;
          return (
            <Field key={slot} label={x.label} info={note}>
              <select
                className={select}
                value={current ?? ''}
                onChange={(e) =>
                  setInput({
                    parts: { ...input.parts, [slot]: e.target.value },
                  })
                }
              >
                {x.options.map((o) => {
                  const why = componentConflict(
                    platform,
                    slot,
                    o.id,
                    input.parts,
                    input.framework,
                  );
                  return (
                    <option key={o.id} value={o.id} disabled={why !== null}>
                      {o.label}
                      {why ? '（今の組み合わせでは選べない）' : ''}
                    </option>
                  );
                })}
              </select>
            </Field>
          );
        })}
      </div>
      {(settings.revalidate ||
        settings.comments ||
        settings.format ||
        settings.variants) && (
        <>
          <h3 className="font-semibold">設定</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {settings.revalidate && (
              <Field
                label={settings.revalidate.label}
                info={settings.revalidate.note}
              >
                <select
                  className={select}
                  value={input.revalidateSec}
                  onChange={(e) =>
                    setInput({ revalidateSec: Number(e.target.value) })
                  }
                >
                  {settings.revalidate.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {settings.comments && (
              <Field
                label={settings.comments.label}
                info={settings.comments.note}
              >
                <select
                  className={select}
                  value={input.comments}
                  onChange={(e) =>
                    setInput({ comments: Number(e.target.value) })
                  }
                >
                  {settings.comments.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {settings.format && (
              <Field label="画像の形式">
                <select
                  className={select}
                  value={input.imageFormat}
                  onChange={(e) =>
                    setInput({
                      imageFormat: e.target
                        .value as EstimateInput['imageFormat'],
                    })
                  }
                >
                  {IMAGE_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {settings.variants && (
              <Field label="画像のサイズ違い">
                <select
                  className={select}
                  value={input.variants}
                  onChange={(e) =>
                    setInput({ variants: Number(e.target.value) })
                  }
                >
                  {VARIANTS.map((v) => (
                    <option key={v} value={v}>
                      {v} 種
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** チームの人数（席。D-76）。入力中は文字列で持ち、確定（blur・Enter）で直す。 */
function Seats({
  seats,
  setInput,
}: {
  seats: number;
  setInput: (p: Partial<EstimateInput>) => void;
}) {
  const [text, setText] = useState(String(seats));
  useEffect(() => setText(String(seats)), [seats]);
  // 直した値を欄にも戻す（値が変わらないと上の effect が走らないため。OCL-5160B6D1）
  const commit = () => {
    const n = normalizeSeats(text.trim() === '' ? undefined : Number(text));
    setText(String(n));
    setInput({ seats: n });
  };
  return (
    <Field
      label="チームの人数（管理画面を使う人）"
      info="事業者の管理画面にメンバーとして入る人の数（席）。席ごとに料金がかかるプランだけ月額が変わる。席の料金が料金データに無い事業者は、前提の文で「未取得」と出す"
    >
      <input
        className="input input-bordered input-sm w-full"
        type="number"
        inputMode="numeric"
        min={1}
        max={SEATS_MAX}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

const MEMBER_BADGE: Record<MemberView['pricing'], string> = {
  'per-seat': '席ごとに課金',
  included: '席の料金なし',
  'not-stated': '記載なし',
  unknown: '未取得',
};

/** 構成が使うプランの席の料金（料金データの members）。 */
function Members({ members, seats }: { members: MemberView[]; seats: number }) {
  const unknown = members.filter(
    (m) => m.pricing === 'not-stated' || m.pricing === 'unknown',
  );
  return (
    <div className="space-y-1 text-sm">
      <h3 className="font-semibold">
        チーム {seats} 人の席の料金
        {seats > 1 && unknown.length > 0 && (
          <span className="ml-2 text-xs font-normal text-warning">
            席の料金が書かれていない事業者 {unknown.length}{' '}
            件（月額に含めていない）
          </span>
        )}
      </h3>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={`${m.provider}|${m.plan}`} className="min-w-0">
            <span
              className={`badge badge-sm mr-1 ${m.pricing === 'per-seat' ? 'badge-info' : m.pricing === 'included' ? 'badge-ghost' : 'badge-warning'}`}
            >
              {MEMBER_BADGE[m.pricing]}
            </span>
            <span className="break-words">
              {m.provider} {m.plan}: {m.premise}
              {m.seatFee &&
                `（${m.seatFee.seats} 席で ${money(m.seatFee.amount, m.seatFee.currency)}）`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TAX_BADGE: Record<TaxView['lines'][number]['status'], string> = {
  added: '消費税 10% を足す',
  included: '税込の価格',
  unconfirmed: '未確認（税抜のまま）',
};

/** 日本から契約するときの税込の目安（D-76）。 */
function Tax({ tax }: { tax: TaxView }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="font-semibold">税込の目安 約 {jpy(tax.totalJpy)}</span>
        <span className="opacity-70">
          （うち消費税 約 {jpy(tax.taxJpy + tax.includedTaxJpy)}
          {tax.includedTaxJpy > 0 &&
            `: 足した分 ${jpy(tax.taxJpy)}・税込の価格に含まれる分 ${jpy(tax.includedTaxJpy)}`}
          {tax.unconfirmed.length > 0 &&
            `・${tax.unconfirmed.join('・')} は消費税の扱いが未確認のため税抜のまま`}
          ）
        </span>
      </p>
      <details>
        <summary className="cursor-pointer text-xs">
          事業者ごとの消費税の扱い（出典つき）
        </summary>
        <ul className="mt-1 space-y-1 text-xs">
          {tax.lines.map((l) => (
            <li key={l.provider} className="break-words">
              <span
                className={`badge badge-xs mr-1 ${l.status === 'unconfirmed' ? 'badge-warning' : 'badge-ghost'}`}
              >
                {TAX_BADGE[l.status]}
              </span>
              {l.provider}: {l.premise}
              {l.status === 'added' && `（+${jpy(l.taxJpy)}）`}
              {l.status === 'included' &&
                `（うち消費税 ${jpy(l.includedTaxJpy)}）`}{' '}
              {l.sources.map((x) => (
                <a
                  key={x.url}
                  className="link mr-1 break-all opacity-70"
                  href={x.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  出典（{x.retrievedAt}）
                </a>
              ))}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs opacity-70">{tax.assumption}</p>
      </details>
    </div>
  );
}

/** 当たる前提（量の境目の使用率と、超過の印）。 */
function Premises({
  thresholds,
  facts,
  unpriced,
}: {
  thresholds: PlatformPremise[];
  facts: PlatformPremise[];
  unpriced: number;
}) {
  const hits = thresholds.filter((p) => p.hit).length;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">
        前提（無料枠・込み分・上限）
        <span className="ml-2 text-sm font-normal opacity-70">
          超過 {hits} 件・{thresholds.length} 件中
          {unpriced > 0 ? `・料金未取得 ${unpriced} 件` : ''}
        </span>
      </h3>
      <ul className="space-y-2">
        {thresholds.map((p) => {
          const r = p.ratio ?? 0;
          return (
            <li key={p.id} className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                {p.hit ? (
                  <span className="badge badge-error badge-sm">超過</span>
                ) : r >= 0.7 ? (
                  <span className="badge badge-warning badge-sm">近い</span>
                ) : null}
                <span className="tabular-nums font-semibold">{pct(r)}</span>
                <span className="text-xs opacity-70">
                  超えると: {EFFECT_LABEL[p.effect]}
                </span>
              </div>
              <progress
                className={`progress w-full ${p.hit ? 'progress-error' : r >= 0.7 ? 'progress-warning' : 'progress-success'}`}
                value={Math.min(1, Number.isFinite(r) ? r : 1) * 100}
                max={100}
                aria-label={`${p.text} ${pct(r)}`}
              />
              <span className="block break-words">{p.text}</span>
            </li>
          );
        })}
      </ul>
      {facts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">
            量によらず効く事実（{facts.length} 件）
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {facts.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Lines({ lines }: { lines: LineView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-xs">
        <thead>
          <tr>
            <th>項目</th>
            <th className="text-right">使用量</th>
            <th className="text-right">込み分</th>
            <th className="text-right">課金対象</th>
            <th className="text-right">金額</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="min-w-32">
                {l.label}
                {l.status === 'unpriced' && (
                  <span className="badge badge-warning badge-xs ml-1">
                    料金未取得
                  </span>
                )}
                {l.status === 'blocked' && (
                  <span className="badge badge-error badge-xs ml-1">
                    止まる
                  </span>
                )}
                {l.credit && (
                  <span className="block text-xs opacity-70">
                    当てられる従量 {money(l.credit.eligible, l.currency)} / 上限{' '}
                    {money(l.credit.limit, l.currency)}
                  </span>
                )}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {l.kind === 'usage' && l.quantity !== undefined
                  ? `${qty(l.quantity)} ${l.unit ?? ''}`
                  : ''}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {l.allowance !== undefined ? qty(l.allowance) : ''}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {l.billable !== undefined ? qty(l.billable) : ''}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {l.amount === null ? '—' : money(l.amount, l.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Comparison({
  rows,
  showTax,
  onPick,
}: {
  rows: ReturnType<typeof compareStacks>;
  showTax: boolean;
  onPick: (stack: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'cost',
    desc: false,
  });
  const sorted = sortRows(rows, sort.key, sort.desc);
  const header = (key: SortKey, label: string, className = '') => (
    <th className={className}>
      <button
        type="button"
        className="link link-hover font-semibold"
        aria-sort={
          sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'
        }
        onClick={() =>
          setSort((s) => ({
            key,
            desc: s.key === key ? !s.desc : false,
          }))
        }
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  );
  return (
    <Card title="構成を比べる">
      <p className="text-xs opacity-70">
        同じテンプレート・PV・フレームワーク・設定で、載せられる全構成の月額。部品は選んだ構成だけ今の選択、他は既定。行を押すとその構成の見積を出す。
      </p>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              {header('name', '構成')}
              {header('cost', '月額', 'text-right')}
              {showTax && <th className="text-right">税込の目安</th>}
              {header('blocking', '止まる前提', 'text-right')}
              <th>使用率の最も高い前提</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.stack}
                className={`cursor-pointer hover:bg-base-200 ${r.current ? 'bg-base-200 font-semibold' : ''}`}
                onClick={() => onPick(r.stack)}
              >
                <td className="min-w-40">
                  <button
                    type="button"
                    className="text-left"
                    aria-current={r.current ? 'true' : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPick(r.stack);
                    }}
                  >
                    {r.name}
                  </button>
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">
                  {usd(r.totalUsd)}
                  {r.unpricedLines > 0 && (
                    <span className="block text-xs text-warning">
                      未取得 {r.unpricedLines}
                    </span>
                  )}
                </td>
                {showTax && (
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {jpy(r.taxInclJpy)}
                  </td>
                )}
                <td className="text-right tabular-nums">
                  {r.blocking > 0 ? (
                    <span className="badge badge-error badge-sm">
                      {r.blocking}
                    </span>
                  ) : (
                    <span className="opacity-50">0</span>
                  )}
                  {r.hits > r.blocking && (
                    <span className="block text-xs opacity-70">
                      費用増など {r.hits - r.blocking}
                    </span>
                  )}
                </td>
                <td className="min-w-48 text-xs">
                  {r.top && (
                    <>
                      <span
                        className={`font-semibold ${r.top.ratio > 1 ? 'text-error' : ''}`}
                      >
                        {pct(r.top.ratio)}
                      </span>{' '}
                      {r.top.text}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const SHAPES: readonly MarkShape[] = ['circle', 'square', 'diamond'];
const pvLabel = (v: number) => (v >= 1e6 ? `${v / 1e6}M` : `${v / 1e3}K`);
const usdTick = (v: number) => (v >= 1e3 ? `$${v / 1e3}K` : `$${v}`);
const usdShort = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

/** 費用の曲線（D-74）。今の条件のまま PV だけを振った月額。系列の色は事業者、点の形は事業者の中のプランで固定。 */
function CostCurve({
  input,
  rows,
}: {
  input: EstimateInput;
  rows: ReturnType<typeof compareStacks>;
}) {
  // null は既定（今の構成 + 今の PV で安い順の数構成）。一度足し引きしたら、その選び方を保つ
  const [picked, setPicked] = useState<string[] | null>(null);
  const stacks = useMemo(
    () =>
      picked === null
        ? defaultCurveStacks(rows)
        : pickedCurveStacks(picked, rows),
    [picked, rows],
  );
  const curves = useMemo(() => costCurves(input, stacks), [input, stacks]);
  const series: CurveChartSeries[] = curves.map((c) => ({
    id: c.stack,
    label: c.current ? `${c.name}（今の構成）` : c.name,
    color: `var(--series-${curveColorSlot(c.provider) + 1})`,
    shape: SHAPES[c.variant] ?? 'circle',
    points: c.points.map((p) => ({ y: p.totalUsd, flags: p.blocking })),
  }));
  // 選んだ順を保つ（上限を超えるときは先に選んだものから残す。pickedCurveStacks）
  const toggle = (id: string) =>
    setPicked(
      stacks.includes(id)
        ? stacks.filter((s) => s !== id)
        : [...(picked ?? stacks).filter((s) => stacks.includes(s)), id],
    );
  const full = stacks.length >= CURVE_MAX;
  const anyStop = curves.some((c) => c.points.some((p) => p.blocking.length));
  const unpriced = curves.some((c) =>
    c.points.some((p) => p.unpricedLines > 0),
  );
  return (
    <Card title="費用の曲線（月の PV を振る）">
      <p className="text-xs opacity-70">
        今のテンプレート・フレームワーク・設定のまま、月の PV
        だけを変えたときの月額（USD）。横軸・縦軸とも対数。部品は今の構成だけ今の選択、他は既定。
        {anyStop &&
          '× は止まる前提（無料プランの上限など）に当たる点で、× どうしを結ぶ線は薄くする。'}
        {unpriced && '料金未取得の明細がある点は合計が下限。'}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] viz-root">
        {series.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-1">
            <SeriesSwatch color={s.color} shape={s.shape} />
            <span className="break-words">{s.label}</span>
          </li>
        ))}
      </ul>
      <LogCurveChart
        series={series}
        xs={CURVE_PVS}
        formatX={pvLabel}
        formatY={usdTick}
        formatValue={usdShort}
        marker={{ x: input.pv, label: '今の PV' }}
        label="月の PV ごとの月額（構成ごと）"
      />
      <details>
        <summary className="cursor-pointer text-sm">
          比べる構成を足す・外す（{stacks.length} / 最大 {CURVE_MAX}）
        </summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {rows.map((r) => {
            const on = stacks.includes(r.stack);
            return (
              <label
                key={r.stack}
                className="flex min-w-0 cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={on}
                  disabled={r.current || (!on && full)}
                  onChange={() => toggle(r.stack)}
                />
                <span className="min-w-0 break-words">
                  {r.name}
                  {r.current && (
                    <span className="opacity-70">（今の構成）</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {picked !== null && (
          <button
            type="button"
            className="btn btn-ghost btn-xs mt-2"
            onClick={() => setPicked(null)}
          >
            既定に戻す（今の PV で安い順）
          </button>
        )}
      </details>
      <details>
        <summary className="cursor-pointer text-sm">表で見る</summary>
        <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>構成</th>
                {CURVE_PVS.map((v) => (
                  <th key={v} className="text-right">
                    {pvLabel(v)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curves.map((c) => (
                <tr key={c.stack}>
                  <td className="min-w-40">{c.name}</td>
                  {c.points.map((p) => (
                    <td
                      key={p.pv}
                      className="text-right tabular-nums whitespace-nowrap"
                      title={
                        p.blocking.length
                          ? `止まる: ${p.blocking.join(' / ')}`
                          : undefined
                      }
                    >
                      {usdShort(p.totalUsd)}
                      {p.blocking.length > 0 && (
                        <span className="text-error"> ×</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => setCopied(true));
        }}
      >
        この条件の URL をコピー
      </button>
      {copied && <span className="text-sm opacity-70">コピーした</span>}
    </div>
  );
}
