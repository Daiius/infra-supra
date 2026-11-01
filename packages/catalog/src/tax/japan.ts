// 日本から契約するときの消費税の扱い（D-76）。各事業者の課税・請求の文書を一次情報にし、出典と取得日を付ける。
// 計算は「個人（適格請求書発行事業者の登録番号・税の ID を入れない）が日本の住所で契約する」想定の 1 つだけ。
// 料金データの taxIncluded と整合させる（included は taxIncluded の事業者だけ、added は税抜の事業者だけ。catalog のテスト）。

type TaxSource = { url: string; retrievedAt: string };
const R = '2026-11-02';
const src = (url: string): TaxSource => ({ url, retrievedAt: R });

/** 消費税の標準税率（消費税 7.8% と地方消費税 2.2% の合計）。 */
export const JP_CONSUMPTION_TAX_RATE = 0.1;
export const JP_CONSUMPTION_TAX_RATE_SOURCE = src(
  'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6303.htm',
);

export type JapanTaxTreatment = {
  provider: string;
  /**
   * added: 料金表は税抜で、日本の利用者の請求に消費税が足される（文書で確かめた）。
   * included: 料金表の価格が税込（料金データの taxIncluded）。
   * unconfirmed: 日本の利用者に消費税が足されるかを文書で確かめられない（見積は税抜のまま出す）。
   */
  status: 'added' | 'included' | 'unconfirmed';
  /** 画面に出す 1 文（確かめた事実か、確かめられなかったこと）。 */
  premise: string;
  sources: TaxSource[];
};

/** 個人と事業者で変わりうる点（計算には入れない。前提の文として出すだけ）。 */
export const JAPAN_TAX_ASSUMPTION =
  '税込の目安は、個人が日本の住所で契約し、適格請求書発行事業者の登録番号や税の ID を入れない想定。国外の事業者からのクラウドの利用は、事業者向けか消費者向けかで消費税の納め方が変わり（事業者向けはリバースチャージの対象になりうる）、登録番号を入れると請求の扱いが変わる事業者もある。事業者として契約するなら各社の請求の設定と税理士に確かめること';
export const JAPAN_TAX_ASSUMPTION_SOURCE = src(
  'https://www.nta.go.jp/publication/pamph/shohi/cross/01.htm',
);

export const JAPAN_TAX: readonly JapanTaxTreatment[] = [
  {
    provider: 'cloudflare',
    status: 'added',
    premise:
      'Cloudflare は 2023-10-01 から日本で消費税の登録があり、従量課金（Pay-as-you-go）の利用者から 2024-04-01 に消費税の徴収を始めた（請求先の住所で判定）',
    sources: [src('https://developers.cloudflare.com/billing/sales-tax/')],
  },
  {
    provider: 'aws',
    status: 'added',
    premise:
      'AWS の価格表は税抜。日本の居住者の利用には国内外のリージョンとも消費税 10% がかかり、日本のアカウントには AWS Japan が適格請求書を発行する',
    sources: [
      src('https://aws.amazon.com/jp/c-tax-faqs/'),
      src('https://aws.amazon.com/jp/tax-help/japan/'),
      src('https://aws.amazon.com/jp/local/invoice-faq'),
    ],
  },
  {
    provider: 'sakura-vps',
    status: 'included',
    premise: 'さくらの VPS の表示価格はすべて税込（消費税を足さない）',
    sources: [src('https://vps.sakura.ad.jp/specification/')],
  },
  {
    provider: 'vercel',
    status: 'unconfirmed',
    premise:
      'Vercel の価格は税抜（USD）で、2026-04-01 の請求から登録のある国では VAT・GST などを足すと書かれているが、日本が対象かは書かれていない（消費税の扱いは未確認。税抜のまま）',
    sources: [src('https://vercel.com/docs/pricing/taxes')],
  },
  {
    provider: 'supabase',
    status: 'unconfirmed',
    premise:
      'Supabase は 2026-05〜06 から登録のある国で VAT・GST などを請求に足すと書かれているが、日本が対象かは書かれていない（消費税の扱いは未確認。税抜のまま）',
    sources: [src('https://supabase.com/docs/guides/platform/billing-faq')],
  },
  {
    provider: 'netlify',
    status: 'unconfirmed',
    premise:
      'Netlify の請求の文書（概要・FAQ）に税の記載がない（消費税の扱いは未確認。税抜のまま）',
    sources: [
      src(
        'https://docs.netlify.com/manage/accounts-and-billing/billing/overview/',
      ),
      src(
        'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/',
      ),
    ],
  },
  {
    provider: 'neon',
    status: 'unconfirmed',
    premise:
      'Neon の請求の文書は請求先の情報に VAT・税の ID を入れられると書くだけで、日本の消費税を足すかは書かれていない（消費税の扱いは未確認。税抜のまま）',
    sources: [src('https://neon.com/docs/introduction/manage-billing')],
  },
];

export const japanTaxOf = (provider: string): JapanTaxTreatment | undefined =>
  JAPAN_TAX.find((t) => t.provider === provider);
