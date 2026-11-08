// ES-15（prd/12 §9・prd/15 §5.1・D-151）: 照合はブラウザとサーバーで同じ結果になることが前提なので、
// 結果に効く計算（estimator・catalog・game の src。テストを除く）に、エンジンの間で結果が一致する保証の無いものを足させない。
// - 時刻（Date・performance.now）と Math.random は一切使わない（乱数はシード付きの random.ts）
// - 超越関数（Math.exp・pow・log など・** 演算子）は、今ある箇所だけを数で固定する。足すときは結果に効かないか確かめて
//   ここを直す（効くなら四則演算と Math.sqrt で書く。prd/02 §3）
// 今ある箇所: estimator の性能・人気の分布の近似（照合は相対 1e-9 の幅で吸収する。verify.ts の sameAxisValue）と、
// game の trends.ts（画面の見込みだけ）。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = fileURLToPath(new URL('../..', import.meta.url));
const ENGINE_PACKAGES = ['estimator', 'catalog', 'game'];

/** 今ある超越関数の箇所（ファイル → 数）。 */
const KNOWN_TRANSCENDENTAL: Record<string, number> = {
  'estimator/src/simulate/simulate.ts': 5,
  'estimator/src/workload/popularity.ts': 4,
  'estimator/src/workload/resolve.ts': 1,
  'game/src/trends.ts': 3,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory())
      return e.name === '__snapshots__' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) &&
      !/\.test\.ts$/.test(e.name) &&
      !/test-helpers\.ts$/.test(e.name)
      ? [p]
      : [];
  });
}

/** コメントを外す（文字列の中の // は URL などなので、前が空白か行頭のものだけを行のコメントとみなす）。 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const TRANSCENDENTAL =
  /\bMath\.(exp|expm1|pow|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b|\*\*/g;
const NONDETERMINISTIC = /\bMath\.random\b|\bDate\b|\bperformance\.now\b/g;

const files = ENGINE_PACKAGES.flatMap((p) =>
  sourceFiles(join(packagesDir, p, 'src')),
).map((f) => ({
  path: relative(packagesDir, f).split('\\').join('/'),
  code: stripComments(readFileSync(f, 'utf8')),
}));

describe('ES-15 決定論（結果に効く計算のコード）', () => {
  it('3 つのパッケージのソースを読めている', () => {
    for (const p of ENGINE_PACKAGES)
      expect(files.some((f) => f.path.startsWith(`${p}/src/`))).toBe(true);
  });

  it('時刻と Math.random を使わない', () => {
    const hits = files.flatMap((f) =>
      (f.code.match(NONDETERMINISTIC) ?? []).map((m) => `${f.path}: ${m}`),
    );
    expect(hits).toEqual([]);
  });

  it('超越関数は今ある箇所（数で固定）のほかに増えない', () => {
    const counts = Object.fromEntries(
      files
        .map((f) => [f.path, (f.code.match(TRANSCENDENTAL) ?? []).length])
        .filter(([, n]) => (n as number) > 0),
    );
    expect(counts).toEqual(KNOWN_TRANSCENDENTAL);
  });
});
