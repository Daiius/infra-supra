// シナリオの説明の見取り図の区画を、本物のページに近いスケルトンで描く（D-113 の追記）。
// 区画の種類（RegionKind）はシナリオのデータ。静的な塊で描き、動きは付けない
// （daisyUI の skeleton は光る動きがあるので使わない）。飾りなので呼ぶ側で aria-hidden にする。
// 色: 文字の行・見出し・ボタンは中立の灰色（見出しとボタンは濃く）。画像は橙、人（アバター・いいね・未読の印）は赤紫の淡い塗り。
// ページの描き方・作られ方の色（daisyUI の success・info・warning・secondary・accent・primary・error）と意味が重ならないよう、
// テーマの色ではなく Tailwind の色（orange・fuchsia）を使い、区画の枠や地ではなく中の小さい部品にだけ塗る。
// 不透明度つきの塗りなので、明るい地・暗い地のどちらでも読める。
import type { RegionKind } from 'game';
import type { ReactNode } from 'react';

/** 文の行・見出しの棒。w は幅（%）。 */
function Bar({
  w,
  h = 'h-1.5',
  tone = 'bg-base-300',
}: {
  w: number;
  h?: string;
  tone?: string;
}) {
  return (
    <span
      className={`block ${h} rounded-full ${tone}`}
      style={{ width: `${w}%` }}
    />
  );
}

function Dot({
  size = 'h-3 w-3',
  tone = 'bg-base-300',
}: {
  size?: string;
  tone?: string;
}) {
  return (
    <span className={`inline-block shrink-0 rounded-full ${size} ${tone}`} />
  );
}

const ICON = 'shrink-0 text-base-content/35';
/** 画像の塗りと絵柄。 */
const MEDIA = 'bg-orange-400/35';
const MEDIA_ICON = 'shrink-0 text-orange-600/70';
/** 人（アバター・いいね・未読の印）の塗りと絵柄。 */
const PERSON = 'bg-fuchsia-400/45';
const PERSON_ICON = 'shrink-0 text-fuchsia-500/80';
/** 見出しの棒。 */
const HEADING = 'bg-base-content/30';

function ImageIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={`${MEDIA_ICON} ${className}`}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${PERSON_ICON} h-3.5 w-3.5`}
    >
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-3 w-3 shrink-0 text-base-100"
    >
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      className={`${ICON} h-2.5 w-2.5`}
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </svg>
  );
}

/** 入力欄（枠だけの棒）。 */
function Input({ className = 'h-3.5' }: { className?: string }) {
  return (
    <span
      className={`block min-w-0 flex-1 rounded border border-base-300 bg-base-100 ${className}`}
    />
  );
}

/** ボタン（塗った小さい丸角）。 */
function Button({ w = 'w-8', children }: { w?: string; children?: ReactNode }) {
  return (
    <span
      className={`flex h-3.5 ${w} shrink-0 items-center justify-center rounded bg-base-content/30`}
    >
      {children}
    </span>
  );
}

const Stack = ({
  children,
  gap = 'gap-1',
}: {
  children: ReactNode;
  gap?: string;
}) => <span className={`flex flex-col ${gap}`}>{children}</span>;
const Row = ({
  children,
  gap = 'gap-1.5',
}: {
  children: ReactNode;
  gap?: string;
}) => <span className={`flex items-center ${gap}`}>{children}</span>;

const SKELETON: Record<RegionKind, () => ReactNode> = {
  header: () => (
    <Row>
      <Dot size="h-3.5 w-3.5" tone="bg-base-content/40" />
      <Bar w={14} />
      <Bar w={12} />
      <Bar w={10} />
      <span className="ml-auto h-3 w-8 shrink-0 rounded-full bg-base-content/30" />
    </Row>
  ),
  login: () => (
    <Row>
      <span className="ml-auto" />
      <Bar w={35} />
      <Dot size="h-3.5 w-3.5" tone={PERSON} />
    </Row>
  ),
  title: () => (
    <Stack gap="gap-1.5">
      <Bar w={85} h="h-2.5" tone={HEADING} />
      <Bar w={55} h="h-2.5" tone={HEADING} />
      <Row>
        <Dot tone={PERSON} />
        <Bar w={22} />
        <Bar w={14} h="h-1" />
      </Row>
    </Stack>
  ),
  body: () => (
    <Stack>
      {[100, 94, 98, 88, 96, 62].map((w, i) => (
        <Bar key={i} w={w} />
      ))}
    </Stack>
  ),
  image: () => (
    <span className="grid grid-cols-3 gap-1">
      <span
        className={`col-span-2 row-span-2 flex aspect-video items-center justify-center rounded ${MEDIA}`}
      >
        <ImageIcon />
      </span>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={`flex items-center justify-center rounded ${MEDIA}`}
        >
          <ImageIcon className="h-3 w-3" />
        </span>
      ))}
    </span>
  ),
  likes: () => (
    <Row>
      <span className="flex items-center gap-1 rounded-full border border-fuchsia-400/50 px-1.5 py-0.5">
        <HeartIcon />
        <span className="block h-1.5 w-4 rounded-full bg-base-300" />
      </span>
    </Row>
  ),
  comments: () => (
    <Stack gap="gap-1.5">
      {[70, 50].map((w, i) => (
        <span key={i} className="flex gap-1.5">
          <Dot tone={PERSON} />
          <span className="flex flex-1 flex-col gap-1 pt-0.5">
            <Bar w={30} h="h-1" tone={HEADING} />
            <Bar w={w} />
          </span>
        </span>
      ))}
      <Row gap="gap-1">
        <Input />
        <Button w="w-6" />
      </Row>
    </Stack>
  ),
  related: () => (
    <Stack gap="gap-1.5">
      <span className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex flex-col gap-0.5">
            <span className={`block aspect-video rounded ${MEDIA}`} />
            <Bar w={80} h="h-1" />
          </span>
        ))}
      </span>
      <span className="flex gap-2 border-t border-base-300 pt-1">
        <Bar w={14} h="h-1" />
        <Bar w={14} h="h-1" />
        <Bar w={10} h="h-1" />
      </span>
    </Stack>
  ),
  footer: () => (
    <span className="flex gap-2 border-t border-base-300 pt-1">
      <Bar w={14} h="h-1" />
      <Bar w={14} h="h-1" />
      <Bar w={10} h="h-1" />
    </span>
  ),
  profile: () => (
    <span className="flex gap-1.5">
      <Dot size="h-6 w-6" tone={PERSON} />
      <Stack>
        <span className={`block h-2 w-12 rounded-full ${HEADING}`} />
        <span className="block h-1.5 w-16 rounded-full bg-base-300" />
        <span className="block h-1.5 w-10 rounded-full bg-base-300" />
      </Stack>
    </span>
  ),
  notifications: () => (
    <Stack>
      {[85, 70, 78].map((w, i) => (
        <Row key={i} gap="gap-1">
          <Dot
            size="h-1.5 w-1.5"
            tone={i === 0 ? 'bg-fuchsia-500/80' : 'bg-base-300'}
          />
          <Bar w={w} />
        </Row>
      ))}
    </Stack>
  ),
  list: () => (
    <Stack gap="gap-0">
      {[75, 60, 68].map((w, i) => (
        <span
          key={i}
          className="flex flex-col gap-0.5 border-b border-base-200 py-1 last:border-b-0"
        >
          <Bar w={w} h="h-2" tone={HEADING} />
          <Bar w={30} h="h-1" />
        </span>
      ))}
    </Stack>
  ),
  form: () => (
    <Stack>
      {[0, 1].map((i) => (
        <Row key={i} gap="gap-1">
          <span className="block h-1.5 w-8 shrink-0 rounded-full bg-base-300" />
          <Input />
        </Row>
      ))}
      <Row gap="gap-1">
        <span className="ml-auto" />
        <Button w="w-10" />
      </Row>
    </Stack>
  ),
  'post-button': () => (
    <Row>
      <Button w="w-14">
        <PenIcon />
      </Button>
      <Bar w={30} h="h-1" />
    </Row>
  ),
  table: () => (
    <span className="flex flex-col overflow-hidden rounded border border-base-300">
      {[0, 1, 2, 3].map((row) => (
        <span
          key={row}
          className={`grid grid-cols-4 gap-1.5 px-1 py-1 ${row === 0 ? 'bg-base-300' : 'border-t border-base-200'}`}
        >
          {[0, 1, 2, 3].map((c) => (
            <Bar
              key={c}
              w={[90, 70, 60, 40][(c + row) % 4]!}
              h="h-1"
              tone={row === 0 ? HEADING : 'bg-base-300'}
            />
          ))}
        </span>
      ))}
    </span>
  ),
  search: () => (
    <Stack>
      <Row gap="gap-1">
        <span className="flex h-3.5 min-w-0 flex-1 items-center rounded border border-base-300 bg-base-100 px-1">
          <SearchIcon />
        </span>
        <Button w="w-6" />
      </Row>
      <Row gap="gap-1">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="h-2.5 w-7 rounded-full border border-base-300"
          />
        ))}
      </Row>
    </Stack>
  ),
  menu: () => (
    <Stack>
      {[60, 45, 55, 40].map((w, i) => (
        <span
          key={i}
          className={`flex items-center gap-1 rounded px-0.5 py-0.5 ${i === 0 ? 'bg-base-200' : ''}`}
        >
          <span className="block h-2 w-2 shrink-0 rounded-sm bg-base-300" />
          <Bar w={w} />
        </span>
      ))}
    </Stack>
  ),
};

/** 区画 1 つのスケルトン（飾り。aria-hidden）。data-kind に種類を出す。 */
export function RegionSkeleton({ kind }: { kind: RegionKind }) {
  return (
    <span aria-hidden data-kind={kind} className="block">
      {SKELETON[kind]()}
    </span>
  );
}
