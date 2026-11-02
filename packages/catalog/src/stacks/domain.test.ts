// ドメインと DNS（D-96・prd/11 §21）。どの構成にも同じ .com の登録（原価の年額の月割り）、課金のある DNS（Route 53・Cloud DNS）だけノードを足す。
import { describe, expect, it } from 'vitest';
import { estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { articleCommunity } from '../templates/index.ts';
import { accountsOf } from './cross.ts';
import { DNS_QUERIES_PER_PAGE_VIEW } from './domain.ts';
import { composeStack, STACK_DEFS } from './index.ts';

const books = loadPriceBooks();

describe('ドメインと DNS（D-96）', () => {
  it('どの構成も .com を 1 つ持ち、土台の事業者のアカウントで払う（アカウントは増えない）', () => {
    for (const d of STACK_DEFS) {
      const a = composeStack(d.id);
      const domain = a.nodes.filter((n) => n.id === 'domain');
      expect(domain, d.id).toHaveLength(1);
      expect(domain[0]!.billing).toMatchObject({
        provider: 'registrar',
        planId: 'com',
      });
      // 登録のアカウントは、登録と DNS を除いた構成のアカウントのどれか（増やさない）
      const rest = {
        ...a,
        nodes: a.nodes.filter((n) => n.id !== 'domain' && n.id !== 'dns'),
      };
      expect(accountsOf(a), d.id).toEqual(accountsOf(rest));
    }
  });

  it('DNS のノードは課金のある Route 53（AWS）・Cloud DNS（Google Cloud）だけ', () => {
    for (const d of STACK_DEFS) {
      const dns = composeStack(d.id).nodes.find((n) => n.id === 'dns');
      const want =
        d.platform === 'aws' || d.platform === 'aws-opennext'
          ? 'aws/route53'
          : d.platform === 'gcp'
            ? 'gcp/cloud-dns'
            : undefined;
      expect(
        dns && `${dns.billing!.provider}/${dns.billing!.planId}`,
        d.id,
      ).toBe(want);
    }
  });

  it('料金: 登録は $11.17 / 年の月割り、Route 53 はゾーン $0.50 で問い合わせはエイリアスで無料、Cloud DNS はゾーン 約 $0.20 + 100 万件 $0.40', () => {
    const pv = 3_000_000;
    const lines = (stack: string, node: string) =>
      estimate({
        workload: articleCommunity(pv),
        architecture: composeStack(stack),
        books,
      }).bill.lines.filter((l) => l.nodeIds.includes(node));
    const sum = (ls: ReturnType<typeof lines>) =>
      ls.reduce((a, l) => a + (l.amount ?? 0), 0);
    expect(sum(lines('cloudflare-vinext-paid', 'domain'))).toBeCloseTo(
      11.17 / 12,
      12,
    );
    expect(lines('cloudflare-vinext-paid', 'dns')).toEqual([]);
    expect(sum(lines('aws-amplify', 'dns'))).toBeCloseTo(0.5, 12);
    expect(sum(lines('gcp-cloud-run', 'dns'))).toBeCloseTo(
      0.000273973 * 730 + (pv * DNS_QUERIES_PER_PAGE_VIEW * 0.4) / 1_000_000,
      9,
    );
  });
});
