/**
 * 集計の API（Hono RPC。D-135・D-149・prd/15 §5）。`AppType` が web の型の出所（web は型だけを devDependencies で読む）。
 * seseraki の packages/server/src/route.ts に倣い、basePath('/api') の鎖 1 本から型を出す。認証は無い。
 *
 * - `POST /api/results`: 終わったプレイを受け取り、再生で照合（verify.ts）して合えば保存する。
 * - `GET /api/results/histogram`: シナリオ・軸（・シード）ごとの完走の分布（histogram.ts）。
 * - `GET /api/results/distribution`: 4 軸 ×（同じシード / 全シード）の 8 本を 1 回で返す（段 3 の画面が使う。D-161）。
 * - `GET /api/version`: 動いているサーバーのコミット（Vercel の画面と版を手動でそろえるときの確かめ。照合には使わない。D-135・D-155）。
 *
 * 🔒 IP・端末の情報を保存しない・ログに出さない（D-134）。アクセスのログは方法・パス（クエリを除く）・状態・時間だけで、
 * ヘッダー（X-Forwarded-For・User-Agent など）は読まない。例外の文言は応答に載せない。
 */
import { zValidator } from '@hono/zod-validator';
import { RESULT_AXES, SCENARIOS, type ResultAxisId } from 'game';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { histogramOf, type Histogram } from './histogram.ts';
export type { Histogram, HistogramBin } from './histogram.ts';
import type { ResultsRepo } from './repo.ts';
import { submissionSchema, verifySubmission } from './verify.ts';

/** 受け取る本文の上限（12 か月の保存は数 KB）。 */
export const MAX_BODY_BYTES = 64 * 1024;

export type BuildVersion = { commit: string; builtAt: string };

export type AppDeps = {
  repo: ResultsRepo;
  /** アクセスのログの出し先（既定は console.log）。 */
  log?: (line: string) => void;
  version?: BuildVersion;
};

/** 環境変数（Dockerfile.prod のビルド引数）からビルドの版を読む。読めない値は unknown。 */
export function buildVersionFromEnv(
  env: Record<string, string | undefined>,
): BuildVersion {
  const commit = env.GIT_COMMIT?.trim().toLowerCase() ?? '';
  const builtAt = env.BUILD_TIME?.trim() ?? '';
  return {
    commit: /^[0-9a-f]{40}$/.test(commit) ? commit : 'unknown',
    builtAt: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(builtAt) ? builtAt : 'unknown',
  };
}

/** アクセスのログ。🔒 方法・パス・状態・時間だけ（IP・ヘッダー・クエリ・本文を出さない）。 */
export function accessLog(log: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const t0 = performance.now();
    await next();
    log(
      `${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms`,
    );
  };
}

const AXIS_IDS = RESULT_AXES.map((a) => a.id) as [
  ResultAxisId,
  ...ResultAxisId[],
];

const numberParam = z
  .string()
  .regex(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i)
  .transform(Number)
  .refine(Number.isFinite);

const histogramQuery = z.object({
  scenario: z.string().refine((s) => s in SCENARIOS),
  axis: z.enum(AXIS_IDS),
  /** 指定すれば同じシードだけの分布。 */
  seed: numberParam.optional(),
  /** 指定すれば、その値の位置（それより大きい数・同じ数）も返す。 */
  value: numberParam.optional(),
});

const distributionQuery = z.object({
  scenario: z.string().refine((s) => s in SCENARIOS),
  /** 同じシードの分布の元（全シードの分布も一緒に返す）。 */
  seed: numberParam,
  // 軸ごとの自分の値（付けた軸だけ position を返す）
  ...(Object.fromEntries(
    AXIS_IDS.map((id) => [id, numberParam.optional()]),
  ) as Record<ResultAxisId, z.ZodOptional<typeof numberParam>>),
});

export function createApp({
  repo,
  log = console.log,
  version = { commit: 'unknown', builtAt: 'unknown' },
}: AppDeps) {
  const app = new Hono().basePath('/api');
  app.onError((err, c) => {
    // 本文の JSON が壊れているときなど（Hono の HTTPException）は、その状態で同じ形のエラーにする
    if (err instanceof HTTPException && err.status < 500)
      return c.json({ error: 'invalid' as const }, 400);
    console.error(err);
    return c.json({ error: 'internal' as const }, 500);
  });
  app.use('*', accessLog(log));
  return app
    .get('/version', (c) => c.json(version))
    .post(
      '/results',
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json({ error: 'too-large' as const }, 413),
      }),
      zValidator('json', submissionSchema, (r, c) => {
        if (!r.success) return c.json({ error: 'invalid' as const }, 400);
      }),
      async (c) => {
        const v = verifySubmission(c.req.valid('json'));
        if (!v.ok)
          return c.json(
            { error: v.code, ...(v.fields ? { fields: v.fields } : {}) },
            422,
          );
        const stored = await repo.insert(v.record);
        return stored === 'inserted'
          ? c.json({ ok: true as const, duplicate: false }, 201)
          : c.json({ ok: true as const, duplicate: true }, 200);
      },
    )
    .get(
      '/results/histogram',
      zValidator('query', histogramQuery, (r, c) => {
        if (!r.success) return c.json({ error: 'invalid' as const }, 400);
      }),
      async (c) => {
        const { scenario, axis, seed, value } = c.req.valid('query');
        const values = await repo.histogramValues({
          scenarioId: scenario,
          axis,
          ...(seed !== undefined ? { seed } : {}),
        });
        return c.json(
          {
            scenarioId: scenario,
            axis,
            seed: seed ?? null,
            ...histogramOf(axis, values, value),
          },
          200,
        );
      },
    )
    .get(
      '/results/distribution',
      zValidator('query', distributionQuery, (r, c) => {
        if (!r.success) return c.json({ error: 'invalid' as const }, 400);
      }),
      async (c) => {
        const q = c.req.valid('query');
        const scenarioId = q.scenario;
        const entries = await Promise.all(
          AXIS_IDS.map(async (axis) => {
            const [same, all] = await Promise.all([
              repo.histogramValues({ scenarioId, axis, seed: q.seed }),
              repo.histogramValues({ scenarioId, axis }),
            ]);
            return [
              axis,
              {
                seed: histogramOf(axis, same, q[axis]),
                all: histogramOf(axis, all, q[axis]),
              },
            ] as const;
          }),
        );
        return c.json(
          {
            scenarioId,
            seed: q.seed,
            axes: Object.fromEntries(entries) as Record<
              ResultAxisId,
              { seed: Histogram; all: Histogram }
            >,
          },
          200,
        );
      },
    );
}

/** `GET /api/results/distribution` の応答（web の型の出所）。 */
export type Distribution = {
  scenarioId: string;
  seed: number;
  axes: Record<ResultAxisId, { seed: Histogram; all: Histogram }>;
};

export type AppType = ReturnType<typeof createApp>;
