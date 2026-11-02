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
    status: 'added',
    premise:
      'Vercel の価格は税抜（USD）で、登録のある国の請求に 2026-04-01 の発行分から VAT・GST などを足す。Vercel Inc. は国税庁の適格請求書発行事業者の公表サイトに 2026-02-01 から登録されている（T9700150136044）ので、日本の住所の請求には消費税が足されるとみる（日本の名を挙げた Vercel の文書は無い）',
    sources: [
      src('https://vercel.com/docs/pricing/taxes'),
      src(
        'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=9700150136044',
      ),
    ],
  },
  {
    provider: 'supabase',
    status: 'unconfirmed',
    premise:
      'Supabase は 2026-05〜06 から登録のある国で VAT・GST などを請求に足すと書かれているが、日本が対象かは書かれていない。国税庁の適格請求書発行事業者の公表情報（2026-10-30 まで）にも Supabase の登録は見当たらない（消費税の扱いは未確認。税抜のまま）',
    sources: [
      src('https://supabase.com/docs/guides/platform/billing-faq'),
      // 国税庁の公表情報（法人・国外を含む分割 5 の 2026-09-30 時点の全件と 2026-10 の差分）に、この事業者の名は無かった
      src('https://www.invoice-kohyo.nta.go.jp/download/zenken'),
    ],
  },
  {
    provider: 'netlify',
    status: 'unconfirmed',
    premise:
      'Netlify の契約（Self-Serve Subscription Agreement 2025-10 §5.4）は料金に税を含まず、利用者が払い Netlify が請求できると書くが、請求の文書に国ごとの記載は無い。国税庁の適格請求書発行事業者の公表情報（2026-10-30 まで）にも Netlify の登録は見当たらない（消費税の扱いは未確認。税抜のまま）',
    sources: [
      src('https://www.netlify.com/legal/self-serve-subscription-agreement/'),
      src(
        'https://docs.netlify.com/manage/accounts-and-billing/billing/overview/',
      ),
      src(
        'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/',
      ),
      // 国税庁の公表情報（法人・国外を含む分割 5 の 2026-09-30 時点の全件と 2026-10 の差分）に、この事業者の名は無かった
      src('https://www.invoice-kohyo.nta.go.jp/download/zenken'),
    ],
  },
  {
    provider: 'neon',
    status: 'unconfirmed',
    premise:
      'Neon の請求の文書は請求先の情報に VAT・税の ID を入れられると書くだけで、日本の消費税を足すかは書かれていない。国税庁の適格請求書発行事業者の公表情報（2026-10-30 まで）にも Neon の登録は見当たらない（消費税の扱いは未確認。税抜のまま）',
    sources: [
      src('https://neon.com/docs/introduction/manage-billing'),
      // 国税庁の公表情報（法人・国外を含む分割 5 の 2026-09-30 時点の全件と 2026-10 の差分）に、この事業者の名は無かった
      src('https://www.invoice-kohyo.nta.go.jp/download/zenken'),
    ],
  },
  {
    provider: 'resend',
    status: 'unconfirmed',
    premise:
      'Resend の料金ページ・送信の上限の文書に、税・日本の消費税の記載が無い（消費税の扱いは未確認。税抜のまま。D-95）',
    sources: [{ url: 'https://resend.com/pricing', retrievedAt: '2026-11-02' }],
  },
  {
    provider: 'registrar',
    status: 'unconfirmed',
    premise:
      'ドメインの登録は登録業者によって消費税の扱いが違う（原価の額は登録所の卸値と ICANN の手数料で、税を含まない）。消費税の扱いは未確認。税抜のまま（D-96）',
    sources: [
      {
        url: 'https://developers.cloudflare.com/registrar/faq/',
        retrievedAt: '2026-11-02',
      },
    ],
  },
  {
    provider: 'gcp',
    status: 'added',
    premise:
      'Google Cloud の価格は税抜（USD）で、Google Cloud の VAT の文書に「Google Cloud usage by customers in Japan is subject to 10% JCT」とある（Firebase の Blaze も Google Cloud の請求先アカウントで払う）',
    sources: [
      src('https://docs.cloud.google.com/billing/docs/resources/vat-overview'),
    ],
  },
];

export const japanTaxOf = (provider: string): JapanTaxTreatment | undefined =>
  JAPAN_TAX.find((t) => t.provider === provider);
