// 出来事の種類の印（アイコン。D-140）。始める画面の出来事の説明の行と、運営中の出来事の通知の見出しで共有する。
// 種類は表示の都合なので web に置き、出来事の id・種類（EventDef.kind）・頻度（tier）から決める。
import {
  Bot,
  CalendarClock,
  CircleDot,
  Gauge,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  MessageSquareWarning,
  Receipt,
  TrendingUp,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import type { EventKind, EventTier } from 'game';

export type EventCategory =
  | 'buzz'
  | 'bot'
  | 'team'
  | 'busy'
  | 'expand'
  | 'proposal'
  | 'complaint'
  | 'major'
  | 'limit'
  | 'revision'
  | 'other';

/** 種類ごとの印・名前・色（daisyUI のテーマの色。ダークモードでもトークンのまま）。 */
export const EVENT_CATEGORY: Record<
  EventCategory,
  { Icon: LucideIcon; label: string; cls: string }
> = {
  buzz: { Icon: Megaphone, label: 'SNS で話題', cls: 'text-accent' },
  bot: { Icon: Bot, label: 'Bot・クローラー', cls: 'text-warning' },
  team: { Icon: UserPlus, label: 'チームが増える', cls: 'text-secondary' },
  busy: { Icon: CalendarClock, label: '繁忙期', cls: 'text-warning' },
  expand: { Icon: TrendingUp, label: '利用の広がり', cls: 'text-success' },
  proposal: { Icon: Lightbulb, label: '開発依頼', cls: 'text-primary' },
  complaint: {
    Icon: MessageSquareWarning,
    label: '苦情・評判',
    cls: 'text-secondary',
  },
  major: {
    Icon: TriangleAlert,
    label: '大きなイベント',
    cls: 'text-error-strong',
  },
  limit: { Icon: Gauge, label: '上限・保存量', cls: 'text-info' },
  revision: { Icon: Receipt, label: '料金・制限の改定', cls: 'text-neutral' },
  other: { Icon: CircleDot, label: 'イベント', cls: 'text-base-content/60' },
};

/** 台本の出来事など、id で決める種類（予告は「id:notice」でも来る）。 */
const BY_ID: Record<string, EventCategory> = {
  buzz: 'buzz',
  bot: 'bot',
  team: 'team',
  'c-busy': 'busy',
  'c-expand': 'expand',
};

/** 出来事の種類。改定 → id で決まる台本 → まれな提案（大きな出来事）→ 提案 → 状態（上限）の順に見る。 */
export function eventCategory(e: {
  id: string;
  kind: EventKind;
  tier: EventTier;
  phase?: string;
  unavailable?: string;
}): EventCategory {
  if (e.id.startsWith('revision:')) return 'revision';
  const base = e.id.replace(/:notice$/, '');
  // 即時反映の依頼（D-215 で苦情から依頼の形に）: 依頼として届く・届きうるときは開発依頼。先に対策していて
  // 好評の知らせになったとき（D-118。phase は occurred。受けられない知らせ（D-201。unavailable）は除く）は評判
  if (base === 'p-ondemand')
    return e.phase === 'occurred' && e.unavailable === undefined
      ? 'complaint'
      : 'proposal';
  const byId = BY_ID[base];
  if (byId) return byId;
  if (e.kind === 'proposal') return e.tier === 'rare' ? 'major' : 'proposal';
  if (e.kind === 'state') return 'limit';
  return 'other';
}

/**
 * 出来事の種類の印。飾りなので読み上げない（横に題・文があり、意味はそちらで伝わる）。
 * 種類の名前はホバーのヒント（title）と data-event-icon に出す。
 */
export function EventIcon({
  category,
  className = 'size-5',
}: {
  category: EventCategory;
  className?: string;
}) {
  const { Icon, label, cls } = EVENT_CATEGORY[category];
  return (
    <span title={label} className="inline-flex">
      <Icon
        className={`shrink-0 ${cls} ${className}`}
        aria-hidden
        data-event-icon={category}
      />
    </span>
  );
}
