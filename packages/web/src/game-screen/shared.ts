import type { MonthReport, Stage } from 'game';
import { signedText } from '../format.ts';

export const pct = (n: number) =>
  signedText(n, (a) => `${(a * 100).toFixed(0)}%`);

export const STATUS: Record<
  MonthReport['status'],
  { label: string; cls: string }
> = {
  ok: { label: '正常', cls: 'badge-success' },
  slow: { label: '遅延', cls: 'badge-warning' },
  incident: { label: '数時間の障害', cls: 'badge-warning' },
  down: { label: '停止', cls: 'badge-error' },
};

/** 手間のポイント（加点の按分で小数になりうる）の表示。丸めは表示のときだけ。 */
export const fmtPoints = (n: number) => String(Number(n.toFixed(1)));

export const STAGE_CLS: Record<Stage, string> = {
  good: 'badge-success',
  fair: 'badge-warning',
  bad: 'badge-error',
};
