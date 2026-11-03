// 次のプレイへのヒント（目標に届かなかったとき。D-40）。
import {
  buzzLasting,
  type Element,
  ELEMENT_LABEL,
  ELEMENTS,
  STAGE_VALUE,
} from './rules.ts';
import { eventDef, scenarioOf, USD_JPY } from './core.ts';
import { commas, fmtFactor, usd, usdOf } from './format.ts';
import { averageSatisfaction } from './month/satisfaction.ts';
import { COMMITMENTS, offerOf } from './offers.ts';
import { reflectionOf } from './review.ts';
import { commentsInPage, commentsOf } from './routes/comments.ts';
import { INVALIDATION_METER } from './setup/estimates.ts';
import { componentLabel, STACKS } from './stacks.ts';
import type { GameState, MonthReport } from './state.ts';

// ---- 次のプレイへのヒント（目標に届かなかったとき。D-40）----

export type RetryHint = {
  /** 原因の種類（画面のキー・テスト用）。 */
  kind:
    | 'limit'
    | 'incident'
    | 'policy'
    | 'cost'
    | 'overage'
    | 'element'
    | 'ogp'
    | 'slow'
    | 'commitment';
  /** 何が起きたか（何か月目に・数値）。 */
  what: string;
  /** 次に試せる方向。正解の構成名は出さない（事業者の制限・プラン名など事実の名前は出してよい。D-40）。 */
  next: string;
};

/** 月の並び（1 つなら「3 か月目」、続くなら「3〜5 か月目」、飛ぶなら「3・7 か月目」）。 */
function monthsText(ms: readonly number[]): string {
  if (ms.length === 1) return `${ms[0]} か月目`;
  const contiguous = ms.every((m, i) => i === 0 || m === ms[i - 1]! + 1);
  return contiguous
    ? `${ms[0]}〜${ms[ms.length - 1]} か月目`
    : ms.length <= 4
      ? `${ms.join('・')} か月目`
      : `${ms[0]} か月目から計 ${ms.length} か月`;
}

const ELEMENT_NEXT: Record<Exclude<Element, 'availability'>, string> = {
  speed:
    'ページの重さ（サーバーの処理・画像の大きさと種類）を設定や部品で軽くするか、処理の上限に余裕のある構成を考える',
  quality:
    '画像の画質が下がっている（記事のデザインの刷新など）。画像の部品と、原本を残しているかを見直す',
  freshness:
    'キャッシュの間隔や部品の性質で更新が遅れて見える。間隔を短くするか、更新がすぐ届く部品を考える',
  feature:
    '機能開発に回せる手間が期待に届かない。維持・出来事への対応・行動の手間を減らして、機能開発に回す',
};

/**
 * SPA で OGP の前処理なしに話題の月を迎えたときの、取り逃がした収益の見積もり（D-43）。
 * 行動の列は状態に残らないのでプレイを引き直せない。代わりに、カードが出ないことの効き方（socialCardFactor）だけを
 * 戻して記録から見積もる: 話題の月の広告の収益は 話題の伸び（× f）/ 小さくなった伸び（× (1 + (f − 1) × c)）倍、
 * それ以後の月は、話題の後に残る伸び（buzzLasting。その月の評判で）の比の倍になる。成長率・費用・上限への当たり方の
 * 変化は織り込まない（大きくなった流量で上限に当たる構成なら、この見積もりより少なくなる）。最初の該当の月だけを見る。
 */
function socialCardLoss(
  state: GameState,
):
  | { month: number; factor: number; reduced: number; extraRevenue: number }
  | undefined {
  const sc = scenarioOf(state);
  const c = sc.frameworks?.spa?.socialCardFactor ?? 1;
  if (c === 1) return undefined;
  const h = state.history;
  const ads = (r: MonthReport) => {
    const raw = (r.humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
    const fixed = sc.revenue.fixedUsdPerMonth ?? 0;
    // 収益から契約の分を除き、止まった月などの減り方は広告と固定の分で同じとみなす
    return raw > 0
      ? ((r.revenue - r.contractRevenue) * raw) / (raw + fixed)
      : 0;
  };
  for (const r of h) {
    // その月に動いていたフレームワークで見る（作り直しで替わる。D-81）
    if ((r.framework ?? state.framework) !== 'vite-spa') continue;
    if (!r.buzz || r.components.ogp === 'prerender') continue;
    const effect = state.schedule
      .filter((x) => x.month === r.month)
      .flatMap((x) => eventDef(sc, x.id)?.effects ?? [])
      .find((e) => e.type === 'traffic' && e.social && e.lasting);
    if (!effect || effect.type !== 'traffic') continue;
    const factor = effect.factor;
    const reduced = 1 + (factor - 1) * c;
    const rep = r.satisfaction.reputation;
    const lastingRatio =
      buzzLasting(rep, sc.buzz) /
      buzzLasting(rep, { ...sc.buzz, extra: sc.buzz.extra * c });
    const extraRevenue =
      ads(r) * (factor / reduced - 1) +
      h
        .filter((x) => x.month > r.month)
        .reduce((a, x) => a + ads(x) * (lastingRatio - 1), 0);
    return { month: r.month, factor, reduced, extraRevenue };
  }
  return undefined;
}

/**
 * 次のプレイへのヒント（目標に届かなかったとき・途中で終わったとき。達成なら空）。
 * 未達の目標と終わり方ごとに、原因を月の記録（止まった月の前提・費用の内訳・満足度の理由・手間の内訳・出来事）から特定し、
 * 影響の大きい順に最大 3 つ返す。終わり方の直接の原因 → 未達の目標の原因 の順に並べる。
 */
export function retryHintsOf(state: GameState): RetryHint[] {
  if (state.phase !== 'lost' || !state.end) return [];
  const sc = scenarioOf(state);
  const h = state.history;
  const n = Math.max(1, h.length);
  const reason = state.end.reason;
  const early = reason !== 'goal';
  const cashShort = reason === 'cash' || (!early && state.cash < sc.goal.cash);
  const satShort = !early && averageSatisfaction(h) < sc.goal.satisfaction;
  const w = sc.satisfaction.weights;
  const out: { hint: RetryHint; score: number }[] = [];
  // 終わり方の直接の原因は 300 台、未達の目標の原因は 200 台、補足は 100 台（それぞれの中は影響の大きさ）
  const tier = (direct: boolean, metric: number) =>
    (direct ? 300 : 200) + Math.min(99, metric);

  // ① 前提（上限）に当たって止まった月
  const limits = new Map<
    string,
    {
      text: string;
      detail?: string;
      months: number[];
      ratio: number;
      accumulates: boolean;
    }
  >();
  for (const r of h) {
    if (r.status !== 'down') continue;
    for (const p of r.premises) {
      if (!p.hit || (p.effect !== 'block' && p.effect !== 'upgrade-required'))
        continue;
      const cur = limits.get(p.id) ?? {
        text: p.text,
        ...(p.detail !== undefined ? { detail: p.detail } : {}),
        months: [],
        ratio: 0,
        accumulates: p.accumulates ?? false,
      };
      cur.months.push(r.month);
      cur.ratio = Math.max(cur.ratio, p.ratio ?? 0);
      limits.set(p.id, cur);
    }
  }
  // 同じ方向の対策になる前提はまとめる（無料プランは同じ月に複数の上限に当たる）
  const groups = new Map<
    string,
    {
      months: Set<number>;
      items: { text: string; ratio: number; detail?: string }[];
      cause?: string;
    }
  >();
  for (const [id, l] of limits) {
    const crossing = h
      .flatMap((r) => r.crossings)
      .find((c) => c.premiseId === id && c.causes.length);
    const cause = crossing
      ? [...crossing.causes].sort((a, b) => a.ratioWithout - b.ratioWithout)[0]
      : undefined;
    // 原因は一時的な流量の出来事か、受けた提案（以後ずっと効く負荷・保存量の追加）のどちらか（crossingsOf）
    const permanent =
      cause !== undefined && eventDef(sc, cause.eventId)?.kind === 'proposal';
    const next = permanent
      ? l.accumulates
        ? '受けた提案で保存量が増え、上限を越えた。ためていく量は減らない。受ける前に容量との余裕を確かめるか、容量の大きいプラン・部品へ移す'
        : '受けた提案で以後の負荷が増え、上限を越えた。受ける前に上限との余裕を確かめるか、上限の大きいプラン・部品・設定で負荷を下げる'
      : cause
        ? cause.eventId === 'bot'
          ? 'Bot の大量アクセスで上限を越えた。Bot を遮断するか、上限に余裕のあるプラン・部品を考える'
          : '一時的に流量が増える出来事で上限を越えた。予告や前兆が来たら、前もって上限に余裕を作る'
        : l.accumulates
          ? 'ためていく量（保存量）は減らない。上限に届く前に、容量の大きいプラン・部品へ移すか、ためる量を減らす'
          : '込みの量・無料枠の上限に当たると止まる。上限の大きいプラン・部品に変えるか、設定・部品で量や処理を減らす';
    const g = groups.get(next) ?? { months: new Set<number>(), items: [] };
    l.months.forEach((m) => g.months.add(m));
    g.items.push({
      text: l.text,
      ratio: l.ratio,
      ...(l.detail !== undefined ? { detail: l.detail } : {}),
    });
    if (cause && !g.cause) g.cause = cause.title;
    groups.set(next, g);
  }
  const times = (r: number) =>
    r > 1 && Number.isFinite(r) ? `${r.toFixed(1)} 倍` : '';
  for (const [next, g] of groups) {
    const months = [...g.months].sort((a, b) => a - b);
    const items = [...g.items].sort((a, b) => b.ratio - a.ratio);
    const top = items[0]!;
    const by = g.cause ? `。「${g.cause}」が無ければ越えなかった` : '';
    const what =
      items.length === 1
        ? `${monthsText(months)}に「${top.text}」に当たって止まった${times(top.ratio) ? `。使用量は上限の ${times(top.ratio)}` : ''}${top.detail ? `。${top.detail}` : ''}${by}`
        : `${monthsText(months)}に止まった。当たった上限: ${items
            .slice(0, 2)
            .map(
              (x) =>
                `「${x.text}」${times(x.ratio) ? `（${times(x.ratio)}）` : ''}${x.detail ? `（${x.detail}）` : ''}`,
            )
            .join(
              '・',
            )}${items.length > 2 ? ` ほか ${items.length - 2} 件` : ''}${by}`;
    out.push({
      hint: { kind: 'limit', what, next },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? months.length * 10 + Math.min(9, top.ratio)
          : (100 * w.availability * months.length) / n,
      ),
    });
  }

  // ② 自前運用の偶発的な障害
  const incidents = h
    .filter((r) => r.status === 'incident')
    .map((r) => r.month);
  if (incidents.length)
    out.push({
      hint: {
        kind: 'incident',
        what: `${monthsText(incidents)}に自前運用のサーバーの障害で止まった（偶発的。1 台構成・SLA なし）`,
        next: '自前運用は偶発的に止まることがある。止まった回数の上限に余裕を残すか、障害の対応を事業者に任せられる構成を考える',
      },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? incidents.length * 10
          : (100 * w.availability * incidents.length * 0.5) / n,
      ),
    });

  // ③ 規約違反（指摘の翌月も違反したまま）
  if (reason === 'policy') {
    // 停止につながった指摘は最後の指摘（一度解消して再び違反すると、指摘からやり直しになる。policyStep）
    const warned = h.findLast((r) => r.policyWarning);
    const p = warned?.premises.find((x) => x.hit && x.effect === 'policy');
    out.push({
      hint: {
        kind: 'policy',
        what: `${warned ? `${warned.month} か月目に運営元から規約違反の指摘${p ? `（${p.text}）` : ''}を受け、` : ''}${state.end.month} か月目も違反したままでアカウントが停止された`,
        next: '指摘が来た月のうちにプランを変えるか、乗り換えを始める（乗り換えの作業中は猶予される）。規約の条件は始める前に構成の説明で確かめられる',
      },
      score: tier(true, 99),
    });
  }

  // ④ 費用（所持金が足りない・尽きた）
  if (cashShort) {
    const byLabel = new Map<string, number>();
    const baseLabels = new Set<string>();
    const invLabels = new Set<string>();
    for (const r of h)
      for (const l of r.lines) {
        const v = l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
        if (v > 0) byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + v);
        if (l.kind === 'base-fee') baseLabels.add(l.label);
        if (l.meterId === INVALIDATION_METER) invLabels.add(l.label);
      }
    const top = [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const infra = h.reduce((a, r) => a + r.infraCost, 0);
    const revenue = h.reduce((a, r) => a + r.revenue, 0);
    const positive = [...byLabel.values()].reduce((a, v) => a + v, 0);
    const baseSum = [...byLabel]
      .filter(([k]) => baseLabels.has(k))
      .reduce((a, [, v]) => a + v, 0);
    const base = baseSum > positive / 2;
    const share = infra / Math.max(1, revenue);
    // オンデマンドの再検証の CloudFront の無効化が最も大きい費用（D-66）
    const inv = h.flatMap((r) =>
      r.lines.filter((l) => l.meterId === INVALIDATION_METER),
    );
    const invalidation =
      top[0] && invLabels.has(top[0][0])
        ? {
            paths: inv.reduce((a, l) => a + (l.quantity ?? 0), 0),
            usd: top[0][1],
          }
        : undefined;
    const shortText =
      reason === 'cash'
        ? `${state.end.month} か月目に所持金が尽きた`
        : `所持金 ${usd(state.cash)} で、目標 ${usd(sc.goal.cash)} に ${usd(sc.goal.cash - state.cash)} 足りない`;
    if (top.length)
      out.push({
        hint: {
          kind: 'cost',
          what: `${shortText}。${h.length} か月の収益 ${usd(revenue)} に対し、インフラの費用は ${usd(infra)}（${Math.round(100 * share)}%）で、大きいのは ${top.map(([k, v]) => `${k} ${usd(v)}`).join('・')}`,
          next: invalidation
            ? `オンデマンドの再検証で CloudFront の無効化が増えた（${h.length} か月で ${commas(invalidation.paths)} パス・${usd(invalidation.usd)}）。更新のたびにページごとに無効化するので、記事の更新が多い規模では高くつく。無効化が込みの定額のプラン・時間の再検証にする、または部品「CDN の無効化のまとめ方」でワイルドカードにまとめる${commentsInPage(commentsOf(sc, state.routeParts), state.framework, sc, state.routes) ? '。コメントを記事のページに含めているなら、ブラウザで読み込む形に戻すとコメントの投稿のたびの無効化が無くなる' : ''}`
            : share < 0.2
              ? `費用は収益に比べて小さく、差は収益（PV の伸び）の側にもある。伸びは満足度（評判）で決まるので、「良い」でない要素や止まった月を減らす。費用を削るなら、${base ? '規模に見合う基本料を見直す' : '設定・部品で量を下げる'}`
              : base
                ? '基本料（固定費）が費用の大半。今の規模に見合う基本料か、込みの量や席がそこまで要るかを見直す'
                : '使った分の費用が大きい。設定・部品で量（転送・変換・実行）を下げるか、込みの量の大きいプランと比べる',
        },
        score: tier(reason === 'cash', 50 + Math.min(49, 100 * share)),
      });
    // 込み分を超えて請求が付いた前提
    const over = new Map<string, { text: string; months: number[] }>();
    for (const r of h)
      for (const p of r.premises) {
        if (!p.hit || p.effect !== 'cost') continue;
        const cur = over.get(p.id) ?? { text: p.text, months: [] };
        cur.months.push(r.month);
        over.set(p.id, cur);
      }
    // 確約できた使用（D-97）: 対象の使用が半分以上の月で続き、確約を結ばなかった（補足。費用の差は小さいことが多い）
    const committed = new Set((state.commitments ?? []).map((c) => c.key));
    for (const d of COMMITMENTS) {
      if (committed.has(d.key)) continue;
      const ms = h.filter((r) => (r.commitmentEligible?.[d.key] ?? 0) > 0);
      if (ms.length < Math.ceil(n / 2)) continue;
      const offers = d.commitment.payments.flatMap(
        (p) => offerOf(d, p.payment, undefined, 12) ?? [],
      );
      const rate =
        d.commitment.kind === 'spend'
          ? Math.max(...d.commitment.payments.map((p) => p.discount ?? 0))
          : Math.max(0, ...offers.map((o) => o.discount));
      const sum = ms.reduce(
        (a, r) => a + usdOf(r.commitmentEligible![d.key]!, d.currency),
        0,
      );
      const saving = sum * rate;
      if (saving < 1) continue;
      out.push({
        hint: {
          kind: 'commitment',
          what: `${d.commitment.label}の対象の使用が ${ms.length} か月あった（オンデマンドで ${usd(sum)}）`,
          next: `1 年の確約で最大 ${Math.round(100 * rate)}% 安くなる（この ${ms.length} か月なら約 ${usd(saving)}）。確約は取り消せず、乗り換え・部品の切り替えで使わなくなっても支払いは残る。全額前払いは所持金から一度に引く`,
        },
        // 差は月に数ドルのことが多いので、ほかの補足（100 台）より下に置く（ほかに出すものが少ないときだけ出る）
        score: Math.min(99, saving),
      });
    }
    for (const o of over.values())
      out.push({
        hint: {
          kind: 'overage',
          what: `${o.months[0]} か月目から「${o.text}」を超え、超えた分が請求された`,
          next: '込みの量・クレジットを超えた分は使った分だけ請求される。設定・部品で量を下げるか、超えたときの単価をプランごとに比べる',
        },
        score: tier(false, 20 + o.months.length),
      });
  }

  // ⑦ 速さが「悪い」で PV の伸びが下がった月（離脱・検索からの流入。ゲーム上の仮定・D-47）
  if (cashShort) {
    const slow = h.filter((r) => (r.satisfaction.slowPenalty ?? 0) > 0);
    if (slow.length) {
      const pen = slow[0]!.satisfaction.slowPenalty!;
      const cut =
        1 - slow.reduce((a, r) => a * (1 - r.satisfaction.slowPenalty!), 1);
      out.push({
        hint: {
          kind: 'slow',
          what: `${monthsText(slow.map((r) => r.month))}、速さが悪く PV の伸びが下がった（1 か月あたり約 ${Math.round(pen * 100)}%・合わせて約 ${Math.round(cut * 100)}%。${(slow[0]!.satisfaction.reasons.speed ?? '').replace(/。速さが悪く PV の伸び.*$/, '')}）`,
          next: '速さを「悪い」から戻す: 画像を原本のまま配っていないか（1 ページの通信量）、SSR の重さ、ピークに詰まる前提を見直す',
        },
        // 合わせて 1 割未満なら補足（100 台）。大きいときは未達の原因として並べる
        score:
          cut >= 0.1
            ? tier(reason === 'cash', Math.min(99, 100 * cut))
            : 100 + Math.min(99, 100 * cut),
      });
    }
  }

  // ⑥ SPA で OGP の前処理なしに話題の月を迎えた（記事ごとの SNS のカードが出ず、伸びが小さい。D-43）
  if (cashShort) {
    const ogp = socialCardLoss(state);
    if (ogp) {
      const shortfall = Math.max(1, sc.goal.cash - state.cash);
      const platform = STACKS[state.stackIndex]!.provider;
      // VPS で前段の CDN が無いと、伸びた話題の月に回線が詰まりうる（話題は短い期間に集中する。D-44）
      const noFrontCdn =
        platform === 'sakura' &&
        (state.components.frontCdn ?? 'none') === 'none';
      out.push({
        hint: {
          kind: 'ogp',
          what: `${ogp.month} か月目の話題で、記事ごとの SNS のカードが出ないため伸びが小さかった（話題の伸び ${fmtFactor(ogp.factor)} → ${fmtFactor(ogp.reduced)}・ゲーム上の仮定）。前処理があれば、収益は約 +${usd(ogp.extraRevenue)} の見込み${noFrontCdn ? '（ただし前段の CDN が無いと、伸びた話題の月に回線が詰まりうるので、増えた分の一部が失われる）' : ''}`,
          next: `SNS のカード（OGP）の前処理の部品（${componentLabel(platform, 'ogp', 'prerender')}）を、話題の前に付ける${noFrontCdn ? '。前段の CDN も一緒に付けると、話題の月の回線の詰まりを避けられる' : ''}。または、記事ごとに HTML を返すフレームワークへ作り直す（大きな手間で数か月かかり、その間は機能開発がほぼ止まるので、話題に間に合うよう早めに）`,
        },
        // 影響額で比べる: 足りない額に対する、取り戻せた収益の割合（半分以上なら最上位）
        score: tier(
          reason === 'cash',
          50 + Math.min(49, (100 * ogp.extraRevenue) / shortfall),
        ),
      });
    }
  }

  // ⑤ 満足度の要素（満足度の目標・伸び＝収益にも効く。可用性は ①② で扱う）
  if (satShort || cashShort) {
    const eff = reflectionOf(state).effort;
    for (const e of ELEMENTS) {
      if (e === 'availability' || !w[e]) continue;
      const months = h.filter((r) => r.satisfaction.stages[e] !== 'good');
      if (!months.length) continue;
      const loss =
        h.reduce(
          (a, r) => a + w[e] * (1 - STAGE_VALUE[r.satisfaction.stages[e]]),
          0,
        ) / n;
      const last = months[months.length - 1]!;
      // 維持には他の事業者の管理（D-52）を含める
      const upkeepSum = eff.upkeep + (eff.accounts ?? 0);
      // 作り直し（D-81）に入れた手間。その間は機能開発がほぼ止まる
      const rewriteSum = h.reduce(
        (a, r) => a + (r.rewrite ? r.effort.migration : 0),
        0,
      );
      const spent = upkeepSum + eff.interrupt + rewriteSum;
      const effortText =
        e === 'feature' && spent > 0
          ? `。維持の手間 計 ${upkeepSum}・出来事への対応 計 ${eff.interrupt}${rewriteSum > 0 ? `・作り直し 計 ${rewriteSum}` : ''}（手間の合計 ${eff.total} の ${Math.round((100 * spent) / Math.max(1, eff.total))}%）`
          : '';
      const growth = satShort ? '' : '満足度は伸び（PV と収益）にも効く。';
      const rewriteNext =
        e === 'feature' && rewriteSum > 0
          ? '。作り直しの間は機能開発がほぼ止まるので、作り直すなら早い月に始めて、止まる月を短くする'
          : '';
      out.push({
        hint: {
          kind: 'element',
          what: `${ELEMENT_LABEL[e]}が「良い」でない月が ${months.length} か月${last.satisfaction.reasons[e] ? `（${last.month} か月目: ${last.satisfaction.reasons[e]}）` : ''}${effortText}`,
          next: growth + ELEMENT_NEXT[e] + rewriteNext,
        },
        score: satShort
          ? tier(false, 100 * loss)
          : 100 + Math.min(99, 100 * loss),
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.hint);
}
