// 出所（prd/01-domain-model.md §2）。実際の料金と仮定を区別する（企画書 §11.2）ための型と検証。
import { z } from 'zod';
import { UNITS, type Unit } from './num/unit.ts';

export const BASES = [
  'official', // 公式の料金表・仕様。出典が必須
  'user-input', // 利用者が入力した値
  'template-default', // テンプレートの既定値（それ自体は仮定）
  'derived', // 他の値から計算した値（導出を保持）
  'assumption', // 測れない値を置いたもの
  'fictional', // テスト用の架空値。本番の UI では使わない
] as const;
export type Basis = (typeof BASES)[number];

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const SourceRefSchema = z.object({
  url: z.url(),
  retrievedAt: IsoDateSchema,
  excerpt: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** 導出の 1 入力。 */
export type DerivationInput = {
  name: string;
  value: number;
  unit?: Unit;
  basis: Basis;
  sourceRef?: SourceRef;
};

/** 人が読める式と入力（prd/01 §6）。UI はこれを展開して「なぜこの値か」を表示する。 */
export type Derivation = {
  id: string;
  label: string;
  expression: string;
  inputs: DerivationInput[];
  result: number;
  unit?: Unit;
};

export type Sourced<T> = {
  value: T;
  basis: Basis;
  note?: string;
  sourceRef?: SourceRef;
  derivation?: Derivation;
};

const DerivationInputSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.enum(UNITS).optional(),
  basis: z.enum(BASES),
  sourceRef: SourceRefSchema.optional(),
});

export const DerivationSchema = z.object({
  id: z.string(),
  label: z.string(),
  expression: z.string(),
  inputs: z.array(DerivationInputSchema),
  result: z.number(),
  unit: z.enum(UNITS).optional(),
});

/**
 * `Sourced<T>` のスキーマ。規則:
 * - `official` は出典（sourceRef）が必須
 * - `derived` は導出（derivation）が必須
 */
export function sourcedSchema<T extends z.ZodType>(value: T) {
  return z
    .object({
      value,
      basis: z.enum(BASES),
      note: z.string().optional(),
      sourceRef: SourceRefSchema.optional(),
      derivation: DerivationSchema.optional(),
    })
    .superRefine((v, ctx) => {
      if (v.basis === 'official' && !v.sourceRef) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceRef'],
          message: 'official の値には出典（sourceRef）が必要',
        });
      }
      if (v.basis === 'derived' && !v.derivation) {
        ctx.addIssue({
          code: 'custom',
          path: ['derivation'],
          message: 'derived の値には導出（derivation）が必要',
        });
      }
    });
}
