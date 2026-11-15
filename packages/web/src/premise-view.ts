// 前提の見せ方の共有（見積モードとゲームの画面）。表示だけで、計算には触れない。
import type { PlatformPremise } from 'estimator';
import type { MonthReport } from 'game';
import { roundInt, usd } from './format.ts';
import {
  ArrowLeftRight,
  Coins,
  Cpu,
  Database,
  Gauge,
  Hammer,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Mail,
  Network,
  Scale,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

/**
 * 込みのクレジットの消費（超えても止まらず、超えた分が従量で請求される）か。
 * 使い切ると止まるクレジット（effect: block）は含めない。
 */
export function isCreditUse(p: PlatformPremise): boolean {
  return (
    p.kind === 'threshold' &&
    p.currency !== undefined &&
    p.effect === 'cost' &&
    p.used !== undefined &&
    p.limit !== undefined
  );
}

/**
 * 当たった前提の色（D-188）。超えたときの効き方で分ける: 止まる・プランの変更が要る・規約は赤（error）、
 * 遅くなる・費用が増える（課金の境目）・込み分の調整・情報は黄（warning）。色だけにせず、文言は `hitLabel` と組で出す。
 * 推移（game の premiseTrends）の効き方は string なので string で受ける。
 */
export function hitTone(
  effect: PlatformPremise['effect'] | string,
): 'error' | 'warning' {
  return effect === 'block' ||
    effect === 'upgrade-required' ||
    effect === 'policy'
    ? 'error'
    : 'warning';
}

const HIT_LABEL: Record<PlatformPremise['effect'], string> = {
  block: '上限に達した',
  'upgrade-required': '上限に達した（プランの変更が要る）',
  policy: '規約に当たった',
  throttle: '上限に達した（遅くなる）',
  adjust: '上限を超えた（調整）',
  cost: '超過（課金）',
  info: '上限に達した',
};

/** 当たった前提の印の文言（D-188。`hitTone` と組）。 */
export function hitLabel(effect: PlatformPremise['effect'] | string): string {
  return HIT_LABEL[effect as PlatformPremise['effect']] ?? '上限に達した';
}

/**
 * 止まる前提が当たっているか（D-190）。赤（`hitTone` が error）のもの = 止まる・プランの変更が要る・規約。
 * 遅くなる・調整・課金・情報は数えない（黄）。見積モードの上限の一覧の「超過」とゲームの画面の印で同じ規則にする。
 */
export function isStopping(p: PlatformPremise): boolean {
  return p.hit && hitTone(p.effect) === 'error';
}

/**
 * 止まる上限（D-190）: 量の境目（threshold）のうち `isStopping` のもの = 止まる・プランの変更が要る。
 * 規約（量によらない事実）は含めない。見積の ① のカード・タブの件数（D-178）・比較の表・費用の曲線の止まる区間（D-180）・
 * 描き方の行の差で数える。
 */
export function isStoppingLimit(p: PlatformPremise): boolean {
  return p.kind === 'threshold' && isStopping(p);
}

/** 「$20 のクレジットのうち $159 分を使用（超えた分 $139 は従量で請求）」 */
export function creditUseText(
  p: PlatformPremise,
  money: (n: number) => string,
): string {
  const used = p.used ?? 0;
  const limit = p.limit ?? 0;
  const head = `${money(limit)} のクレジットのうち ${money(used)} 分を使用`;
  return used > limit
    ? `${head}（超えた分 ${money(used - limit)} は従量で請求）`
    : head;
}

/**
 * 前提の短い名前（一覧の本体に出す。全文は ⓘ の中。D-222 の補足）。前提は名前の欄を持たないので、文の頭の主語
 * （「Images は月 5,000 …」の「Images」・「Email Service の送信は …」の「Email Service の送信」）を、最初の「は」「（」「。」「、」の前で切って取る。
 * 長すぎるとき（主語の無い文）は頭を 18 文字で切って「…」を付ける。
 */
export function premiseName(p: PlatformPremise): string {
  const head = p.text.split(/は|（|。|、/)[0]!.trim();
  if (head.length > 0 && head.length <= 20) return head;
  return `${p.text.slice(0, 18).trim()}…`;
}

/** 対象の言葉から選ぶ印（上から順に最初に当たったもの。製品の公式のアイコンではなく、何の上限かの目印）。 */
const PREMISE_ICONS: [RegExp, LucideIcon][] = [
  [/メール|Email/, Mail],
  [/画像|Images|変換/, ImageIcon],
  [/CPU/, Cpu],
  [/DB|D1|行の|Supabase|Neon|Aurora|DynamoDB/, Database],
  [/KV/, KeyRound],
  [/保存|容量|storage/, HardDrive],
  [/転送|帯域|回線|Mbps/, Network],
  [/ビルド/, Hammer],
  [/ログ/, ScrollText],
  [/リクエスト|requests|呼び出し/, ArrowLeftRight],
];

/** 前提の印（一覧の名前の前に出す。D-222 の補足）。 */
export function premiseIcon(p: PlatformPremise): LucideIcon {
  if (p.effect === 'policy') return Scale;
  if (isCreditUse(p)) return Coins;
  return PREMISE_ICONS.find(([re]) => re.test(p.text))?.[1] ?? Gauge;
}

type ReportLine = MonthReport['lines'][number];

/**
 * 前提の超えた分の費用（D-222 の補足）。無料枠の前提が数えるメーター（estimator の meterIds）と同じ事業者・プラン・メーターの明細の行を足す。
 * 結べないとき（meterIds・planId の無い前提や行・前の保存）は出さない。
 */
export function premiseCostOf(
  p: PlatformPremise,
  lines: readonly ReportLine[],
) {
  if (!p.meterIds?.length || !p.provider || !p.planId) return undefined;
  // 事業者・プラン・メーターが合い、行が数えたノードがすべてこの前提のノードである行だけを足す
  // （同じ事業者の別のサービスの同名のメーター（Workers と Durable Objects の requests など）や、
  // 前提の外のノードの分を混ぜない。結べない行がある・古い保存で planId が無いときは費用を出さない。OCL-3407CD6A）
  const nodes = new Set(p.nodeIds);
  const hits = lines.filter(
    (l) =>
      l.kind === 'usage' &&
      l.provider === p.provider &&
      l.planId === p.planId &&
      l.meterId !== undefined &&
      p.meterIds!.includes(l.meterId),
  );
  if (hits.some((l) => !l.nodeIds?.every((n) => nodes.has(n))))
    return undefined;
  if (hits.length === 0) return undefined;
  const currency = hits[0]!.currency;
  const amount = hits
    .filter((l) => l.currency === currency)
    .reduce((a, l) => a + l.amount, 0);
  return currency === 'JPY'
    ? `${roundInt(amount).toLocaleString()} 円`
    : usd(amount);
}
