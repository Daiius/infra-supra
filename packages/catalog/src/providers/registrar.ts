// ドメインの登録（.com 1 つ。D-96・prd/11 §21）。2026-11-02 に公式の文書から取得。USD・税抜。
// どの構成でも同じ .com を 1 つ持つとみて、登録業者の上乗せの無い原価（.com の登録所 Verisign の卸値 + ICANN の手数料）を使う。
// 原価で売ると公式に書いているのは Cloudflare Registrar（ただし Cloudflare の DNS が前提）。ほかの登録業者は上乗せがあり、
// 構成の既定の DNS（Route 53・Vercel など）で取ると原価より高い（このモデルでは数えない。prd/11 §21）。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

export const registrar: PriceBookInput = {
  schemaVersion: 1,
  provider: 'registrar',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    // Verisign の 2026 年 1〜3 月期の決算の発表（SEC に提出したもの）
    verisign: src(
      'https://www.sec.gov/Archives/edgar/data/1014473/000101447326000019/q12026earningsrelease.htm',
    ),
    icann: src(
      'https://www.icann.org/en/announcements/details/icann-accredited-registrars-approve-registrar-level-fees-for-fiscal-year-2026-21-07-2025-en',
    ),
    cfRegistrar: src('https://developers.cloudflare.com/registrar/faq/'),
  },
  plans: [
    {
      id: 'com',
      service: 'domain',
      name: '.com の登録（原価）',
      sourceIds: ['verisign', 'icann', 'cfRegistrar'],
      baseFee: {
        label: 'ドメインの登録（.com・年額の月割り）',
        // Verisign の卸値 $10.97（2026-11-01 から。それまでは $10.26）+ ICANN の手数料 $0.20
        amount: 11.17,
        per: 'year',
        scope: 'node',
      },
      facts: [
        {
          id: 'at-cost',
          premise:
            '.com の原価は 1 年 $11.17（登録所 Verisign の卸値 $10.97〈2026-11-01 から〉+ ICANN の手数料 $0.20）。Cloudflare Registrar は上乗せなしのこの額で売る（Cloudflare の DNS を使うのが前提）。ほかの登録業者は上乗せがある',
          sourceIds: ['verisign', 'icann', 'cfRegistrar'],
        },
      ],
      meters: [],
      members: {
        pricing: 'not-stated',
        premise:
          'Cloudflare Registrar の文書にメンバー（席）の料金の記載は無い（課金は 1 ドメイン 1 年ごと。土台の事業者のアカウントで持つ）',
        sourceIds: ['cfRegistrar'],
      },
      uptimeSla: {
        status: 'not-stated',
        premise:
          'ドメインの登録はサイトの稼働率の SLA の対象ではない（稼働率の要件ではドメインと DNS を見ない。D-96）',
        sourceIds: ['cfRegistrar'],
      },
      notes: [
        '年額を 12 で割って毎月の費用に入れる（実際の支払いは年に 1 回・前払い）',
      ],
    },
  ],
  notes: [
    'どの構成でも同じ .com を 1 つ持つとみる（構成の比較の差にはならない）。登録業者ごとの上乗せ・初年度の割引は数えない',
  ],
};
