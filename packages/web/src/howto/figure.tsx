// 遊び方のダイアログの図の部品（箱・矢印・流れ・図の面）。D-146。
import { ArrowDown, ArrowRight, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { type ReactNode } from 'react';

/** 図の箱の色（daisyUI のテーマの色。Tailwind が拾えるよう、クラスは文字列のまま書く）。 */
const TONE = {
  neutral: { box: 'border-base-300 bg-base-100', icon: 'text-base-content/70' },
  primary: { box: 'border-primary/40 bg-primary/5', icon: 'text-primary' },
  secondary: {
    box: 'border-secondary/40 bg-secondary/5',
    icon: 'text-secondary',
  },
  accent: { box: 'border-accent/40 bg-accent/5', icon: 'text-accent' },
  info: { box: 'border-info/40 bg-info/5', icon: 'text-info' },
  success: { box: 'border-success/50 bg-success/5', icon: 'text-success' },
  warning: { box: 'border-warning/50 bg-warning/5', icon: 'text-warning' },
  error: { box: 'border-error/40 bg-error/5', icon: 'text-error-strong' },
} as const;
type Tone = keyof typeof TONE;

/** 図の 1 つの箱（印・名前・短い説明）。 */
export function Node({
  Icon,
  label,
  sub,
  tone = 'neutral',
}: {
  Icon: LucideIcon;
  label: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      className={clsx(
        'flex min-w-0 items-start gap-2 rounded-box border px-2 py-1.5',
        TONE[tone].box,
      )}
      data-howto-node
    >
      <Icon
        aria-hidden
        className={clsx('mt-0.5 size-5 shrink-0', TONE[tone].icon)}
      />
      <div className="min-w-0 leading-snug">
        <div className="text-sm font-bold">{label}</div>
        {sub && <div className="text-xs opacity-75">{sub}</div>}
      </div>
    </div>
  );
}

/** 流れの矢印。flow は狭い画面で下向き・sm 以上で右向き（箱の並びと合わせる）。 */
export function Arrow({ dir = 'flow' }: { dir?: 'flow' | 'down' }) {
  const Icon = dir === 'down' ? ArrowDown : ArrowRight;
  return (
    <Icon
      aria-hidden
      className={clsx(
        'size-4 shrink-0 self-center opacity-50',
        dir === 'flow' ? 'rotate-90 sm:rotate-0' : 'mx-auto block',
      )}
    />
  );
}

/** 箱を矢印でつないだ 1 列（狭い画面では縦に並べる）。 */
export function Flow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:[&>[data-howto-node]]:flex-1">
      {children}
    </div>
  );
}

/** 図の面（ページの本文の上）。 */
export function Figure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <figure
      className="space-y-2 rounded-box bg-base-200 p-2 sm:p-3"
      aria-label={label}
      data-howto-figure
    >
      {children}
    </figure>
  );
}

/** 図の中の小見出し。 */
export const FigureTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-bold opacity-70">{children}</div>
);
