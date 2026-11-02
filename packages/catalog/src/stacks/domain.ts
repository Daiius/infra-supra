// ドメインと DNS（D-96・prd/04 §3.11・prd/11 §21）。構成を組み終えた後に、ドメインの登録のノードと（課金のある DNS なら）DNS のゾーンのノードを足す。
// 部品にはしない（DNS は構成の既定で決まり、差は月 $0.2〜0.5。選ぶほどの差ではない）。
// - ドメインの登録: どの構成でも同じ .com を 1 つ。原価（Verisign の卸値 + ICANN の手数料）の年額を月割り（catalog の registrar）。
//   課金のアカウントは土台の事業者のアカウントに含める（登録業者のアカウントを増やさない。D-52 の維持の手間は数えない）。
// - DNS: 構成の既定。Cloudflare は Cloudflare の DNS（Free でも無料）、Vercel・Netlify は自前の DNS（料金表に項目が無い）、
//   さくらの VPS は VPS に付く無料のネームサーバー（2GB・4GB で 5・10 ゾーン）。この 4 つは費用が無いのでノードを足さない。
//   AWS は Route 53（ゾーン月 $0.50。CloudFront へのエイリアスの問い合わせは無料）、Google Cloud は Cloud DNS
//   （Firebase Hosting に DNS が無い。ゾーン月 約 $0.20 + 問い合わせ 100 万件 $0.40）。
import type { ArchitectureInput } from 'estimator';
import type { Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/**
 * 1 閲覧あたりの DNS の問い合わせ（権威サーバーに届く数。ゲーム上の仮定・出典なし）。名前を引くのは訪問の初めだけで、
 * ブラウザ・OS・リゾルバが TTL（数分〜）の間キャッシュするので、閲覧の数よりずっと少ない。
 */
export const DNS_QUERIES_PER_PAGE_VIEW = 0.1;

/** 土台の事業者のアカウント（ドメインの登録の課金をここにまとめる）。 */
const HOST_ACCOUNT: Record<Platform, string> = {
  cloudflare: 'cloudflare',
  vercel: 'vercel',
  sakura: 'sakura',
  aws: 'aws',
  'aws-opennext': 'aws',
  netlify: 'netlify',
  gcp: 'gcp',
};

type Dns = {
  label: string;
  provider: string;
  planId: string;
  /** 課金されない問い合わせの割合（Route 53 のエイリアス）。 */
  freeQueryShare: number;
  /** 前提に出すプランの事実。 */
  facts: string[];
};

/** 構成の既定の DNS（課金のあるものだけ。無料の DNS は undefined）。 */
export function dnsOf(platform: Platform): Dns | undefined {
  switch (platform) {
    case 'aws':
    case 'aws-opennext':
      return {
        label: 'Route 53（DNS）',
        provider: 'aws',
        planId: 'route53',
        // サイトの名前（apex・www）は CloudFront へのエイリアスで、その問い合わせは無料
        freeQueryShare: 1,
        facts: ['alias-free'],
      };
    case 'gcp':
      return {
        label: 'Cloud DNS（DNS）',
        provider: 'gcp',
        planId: 'cloud-dns',
        freeQueryShare: 0,
        facts: ['no-free-tier', 'hosting-no-dns'],
      };
    default:
      return undefined;
  }
}

/** 構成にドメインの登録と DNS のノードを足す（D-96）。 */
export function withDomain(
  arch: ArchitectureInput,
  platform: Platform,
): ArchitectureInput {
  const account = HOST_ACCOUNT[platform];
  const domain: ArchNodeIn = {
    id: 'domain',
    label: 'ドメインの登録（.com）',
    config: { kind: 'domain-registration' },
    facts: ['at-cost'],
    billing: {
      accountId: account,
      provider: 'registrar',
      planId: 'com',
      meters: {},
    },
  };
  const d = dnsOf(platform);
  const dns: ArchNodeIn[] = d
    ? [
        {
          id: 'dns',
          label: d.label,
          facts: d.facts,
          config: {
            kind: 'dns-zone',
            queriesPerPageView: DNS_QUERIES_PER_PAGE_VIEW,
            freeQueryShare: d.freeQueryShare,
          },
          billing: {
            accountId: account,
            provider: d.provider,
            planId: d.planId,
            meters: { 'dns-queries': 'queries' },
          },
        },
      ]
    : [];
  return { ...arch, nodes: [...arch.nodes, ...dns, domain] };
}
