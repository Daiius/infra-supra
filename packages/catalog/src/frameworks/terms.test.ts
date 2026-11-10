// フレームワークごとの描き方の呼び名（D-193）: 出典つきであること・呼び名が無ければ一般の言葉に落ちること。
import { describe, expect, it } from 'vitest';
import {
  FRAMEWORK_TERMS,
  frameworkTerm,
  strategyTitle,
  termName,
} from './terms.ts';
import { ROUTE_STRATEGIES } from './route-strategies.ts';

describe('FRAMEWORK_TERMS（D-193）', () => {
  it('どの呼び名も公式の文書の出典（https）と取得日を持つ', () => {
    for (const terms of Object.values(FRAMEWORK_TERMS))
      for (const t of Object.values(terms)) {
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.source.url).toMatch(
          /^https:\/\/(nextjs\.org|docs\.astro\.build|vite\.dev)\//,
        );
        expect(t.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
  });

  it('呼び名が無い・フレームワークを選ぶ前は一般の言葉', () => {
    expect(strategyTitle('ssr')).toBe(ROUTE_STRATEGIES.ssr.label);
    expect(strategyTitle('ssr', 'vite-spa')).toBe(ROUTE_STRATEGIES.ssr.label);
    expect(strategyTitle('ssr', 'nextjs')).toBe('Dynamic rendering');
    expect(strategyTitle('ssr', 'astro')).toBe('On-demand rendering');
    expect(frameworkTerm(undefined, 'onDemand')).toBeUndefined();
    expect(termName('nextjs', 'onDemand', '更新で消す')).toBe(
      'On-demand revalidation',
    );
    expect(termName('nextjs-export', 'onDemand', '更新で消す')).toBe(
      '更新で消す',
    );
  });
});
