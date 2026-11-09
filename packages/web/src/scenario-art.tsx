// シナリオの図柄（D-140）。一般的なアイコン（lucide）を 3〜7 個組み合わせた構図で、シナリオの題材を 1 枚で見せる。
// 生成画像・ラスタ画像は使わない。色は daisyUI のテーマの色（primary・secondary・accent・base-content の濃淡）だけで塗り、
// ダークモードでもトークンのまま替わる。図柄は表示の都合なので web に置き、シナリオの id で引く。
import {
  Building2,
  ClipboardList,
  Database,
  FileSpreadsheet,
  ImageIcon,
  type LucideIcon,
  MessageSquare,
  Newspaper,
  Paperclip,
  Server,
  Share2,
  ShieldCheck,
  Users,
} from 'lucide-react';

type Tone = 'primary' | 'secondary' | 'accent' | 'muted';
type Size = 'lg' | 'md' | 'sm';

/** 図柄の 1 つの印。x・y は図の幅・高さに対する %（印の中心）。 */
type ArtNode = {
  Icon: LucideIcon;
  /** 何を表すか（図の読み上げの名前に並べる）。 */
  label: string;
  x: number;
  y: number;
  size: Size;
  tone: Tone;
};

/** シナリオの id → 図柄。先頭が中心の印で、ほかの印は中心と破線でつなぐ。 */
export const SCENARIO_ART: Readonly<Record<string, readonly ArtNode[]>> = {
  'article-community': [
    {
      Icon: Newspaper,
      label: '記事',
      x: 50,
      y: 50,
      size: 'lg',
      tone: 'primary',
    },
    { Icon: Users, label: '読者', x: 21, y: 34, size: 'md', tone: 'secondary' },
    {
      Icon: MessageSquare,
      label: 'コメント',
      x: 77,
      y: 26,
      size: 'md',
      tone: 'accent',
    },
    {
      Icon: ImageIcon,
      label: '画像',
      x: 79,
      y: 74,
      size: 'md',
      tone: 'secondary',
    },
    {
      Icon: Share2,
      label: 'SNS での共有',
      x: 30,
      y: 80,
      size: 'sm',
      tone: 'accent',
    },
    {
      Icon: Server,
      label: 'サーバー',
      x: 93,
      y: 48,
      size: 'sm',
      tone: 'muted',
    },
    { Icon: Database, label: 'DB', x: 7, y: 66, size: 'sm', tone: 'muted' },
  ],
  'contract-operations': [
    {
      Icon: Building2,
      label: '顧客の会社',
      x: 50,
      y: 50,
      size: 'lg',
      tone: 'primary',
    },
    {
      Icon: Users,
      label: '社員と取引先',
      x: 21,
      y: 34,
      size: 'md',
      tone: 'secondary',
    },
    {
      Icon: ClipboardList,
      label: '申請と承認',
      x: 77,
      y: 26,
      size: 'md',
      tone: 'accent',
    },
    {
      Icon: FileSpreadsheet,
      label: '帳票',
      x: 79,
      y: 74,
      size: 'md',
      tone: 'secondary',
    },
    {
      Icon: Paperclip,
      label: '添付ファイル',
      x: 30,
      y: 80,
      size: 'sm',
      tone: 'accent',
    },
    {
      Icon: ShieldCheck,
      label: '稼働率の SLA',
      x: 93,
      y: 48,
      size: 'sm',
      tone: 'muted',
    },
    {
      Icon: Database,
      label: '業務の記録',
      x: 7,
      y: 66,
      size: 'sm',
      tone: 'muted',
    },
  ],
};

const SIZE: Record<Size, string> = {
  lg: 'size-14 p-3 sm:size-16 sm:p-3.5',
  md: 'size-10 p-2 sm:size-12 sm:p-2.5',
  sm: 'size-8 p-1.5 sm:size-9 sm:p-2',
};

// 印の地は不透明にする（半透明だと後ろの破線が印の上に透けて見える）。テーマの色を base-100 に 15% 混ぜた色で塗る
const TONE: Record<Tone, string> = {
  primary:
    'bg-[color-mix(in_oklab,var(--color-primary)_15%,var(--color-base-100))] text-primary ring-primary/30',
  secondary:
    'bg-[color-mix(in_oklab,var(--color-secondary)_15%,var(--color-base-100))] text-secondary ring-secondary/30',
  accent:
    'bg-[color-mix(in_oklab,var(--color-accent)_15%,var(--color-base-100))] text-accent ring-accent/30',
  muted: 'bg-base-100 text-base-content/60 ring-base-content/15',
};

/** シナリオの図柄。図柄の無いシナリオは何も出さない。 */
export function ScenarioArt({
  scenarioId,
  name,
}: {
  scenarioId: string;
  /** シナリオの名前（読み上げの名前に使う）。 */
  name: string;
}) {
  const nodes = SCENARIO_ART[scenarioId];
  if (!nodes || nodes.length === 0) return null;
  const [hub, ...rest] = nodes;
  return (
    <div
      role="img"
      aria-label={`${name}の図柄: ${nodes.map((n) => n.label).join('・')}`}
      data-scenario-art={scenarioId}
      className="relative mx-auto aspect-[12/5] w-full max-w-md overflow-hidden rounded-box bg-base-200"
    >
      {/* 背景の淡い円と、中心から各印への破線（幅に合わせて伸びても線の太さは変えない） */}
      <div
        aria-hidden
        className="absolute -top-1/3 -left-[10%] size-2/3 rounded-full bg-primary/5"
      />
      <div
        aria-hidden
        className="absolute -right-[8%] -bottom-1/2 aspect-square h-full rounded-full bg-secondary/5"
      />
      <svg
        aria-hidden
        className="absolute inset-0 size-full text-base-content/20"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {rest.map((n) => (
          <line
            key={n.label}
            x1={hub!.x}
            y1={hub!.y}
            x2={n.x}
            y2={n.y}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {nodes.map((n) => (
        <span
          key={n.label}
          aria-hidden
          title={n.label}
          data-art-node
          className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-sm ring-1 ${SIZE[n.size]} ${TONE[n.tone]}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <n.Icon className="size-full" strokeWidth={1.75} />
        </span>
      ))}
    </div>
  );
}
