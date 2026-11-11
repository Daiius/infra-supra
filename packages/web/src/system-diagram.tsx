// 構成図（D-105）。閲覧者から左→右へ、入口（CDN）→ 処理（関数・コンテナ・VPS）→ データ（DB・ストレージ・KV）と流れる図。
// 箱と線は費用の計算に使う構成から作る（system-diagram-model.ts）。事業者ごとに薄い色の枠で囲み、ロゴと名前を添える。
// 線は流れ（ページの描き方・API・画像）ごとに色の違う細い線を並べ（路線図の形）、凡例を押すとその流れだけを目立たせる。
// SVG は role="img" で要約を名前にし、箱とつながりの一覧を読み上げ用に別に置く（色だけに頼らない）。
// 入れ物が狭い（sm 未満で、横の図が縮めずには収まらない）ときは縦の図にする: 段を上→下・事業者の枠を左→右に並べ、
// 箱は短い名前だけにし、箱を押す（キーボードは Enter・Space）と詳しい説明（事業者・種類・名前・通る流れ）を出す（D-105 の補足）。
// 部品を差し替えられる箱（parts。始める画面・見積の選んでいる構成のカード）は、横の図でも押せて、そのスロットの選択肢を出す（D-116）。
// 図の一番下の段には、経路に載らない部品（メールの送信・バックアップなど）と、図に箱を持たないスロット（1 択など）を並べ、
// 部品を選べる図ではそこからも選べる（どのスロットも図の中で選べる。D-116 の補足・2 つの表示）。
import type { FrameworkId } from 'catalog';
import type { ArchitectureInput } from 'estimator';
import { termNotesOf } from 'game';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { BrandMark, BRANDS, brandColor, type BrandId } from './brand-logos.tsx';
import { Popover } from './info.tsx';
import {
  diagramModel,
  diagramSummary,
  activeLane,
  compactText,
  edgeGeometry,
  isNarrow,
  labelOf,
  lanesThrough,
  looseSlots,
  nodeSlots,
  ARROW,
  LAYOUT,
  VIEWER,
  VIEWER_LABEL,
  type DiagramModel,
  type DiagramNode,
  type GhostSlot,
  type LaneId,
} from './system-diagram-model.ts';
import type { ResolvedPage } from './page-wireframes.tsx';

/** 構成図の注記（始める画面・見積モードで同じ文）。 */
export const DIAGRAM_NOTE =
  '構成図は費用の計算に使う構成（部品と、リクエストが通る順）から描いています。線の色は流れの種類で、凡例を押すとその流れだけが目立ちます。';

/** 流れの色（見取り図の作られ方の色にそろえる）。 */
const LANE_COLOR: Readonly<Record<LaneId, string>> = {
  static: 'var(--color-success)',
  isr: 'var(--color-info)',
  ssr: 'var(--color-warning)',
  island:
    'color-mix(in oklab, var(--color-warning) 70%, var(--color-base-content))',
  holes: 'color-mix(in oklab, var(--color-warning) 55%, var(--color-info))',
  api: 'var(--color-secondary)',
  image: 'var(--color-accent)',
  realtime: 'var(--color-primary)',
  revalidate: 'color-mix(in oklab, var(--color-base-content) 55%, transparent)',
};
/** 裏で動く流れは破線（色に頼らない手がかり）。 */
const LANE_DASH: Partial<Record<LaneId, string>> = {
  revalidate: '4 3',
  // サーバーの島（S6）は閲覧ごとに描く SSR と同じ色の系統で、破線で分ける
  island: '7 3',
  // 部品ごとにキャッシュの動的な穴（D-111）は点線
  holes: '2 3',
};

/**
 * 箱から部品を差し替える（D-116）。slotsOf は箱に当たるスロット（無ければ空）、render はスロットの選択肢（選ぶと close を呼ぶ。
 * box は押した箱の id（BoxFocus。選んだ後に focus を戻す先））、unselected はスロットがまだ選ばれていないか
 * （部品のチップの「未選択」と同じ判定。D-45）。
 */
export type DiagramParts = {
  slotsOf: (nodeId: string) => readonly string[];
  render: (slot: string, close: () => void, box: string) => ReactNode;
  unselected?: ((slot: string) => boolean) | undefined;
};

/** 箱に当たるスロットのどれかが未選択か（未選択の箱は警告色の枠と「!」の印で、選ぶよう促す。D-116 の補足）。 */
const hasUnselected = (parts: DiagramParts | undefined, nodeId: string) =>
  parts?.unselected !== undefined &&
  parts.slotsOf(nodeId).some((slot) => parts.unselected!(slot));

/**
 * 箱の右上の印（D-116 とその補足）。差し替えられる箱は primary の地に ⇄、まだ選んでいない部品の箱は warning の地に「!」
 * （色だけに頼らず記号も付ける。読み上げは箱の名前の「未選択」・「を替える」）。箱の名前は既定の部品なので、「!」が無いと選び済みに見える。
 * foreignObject の外に SVG の円と字で描く（WebKit は foreignObject の中の位置指定の要素を viewBox の拡大縮小を受けずに描き、
 * 箱と印がずれる。D-213）。押しても下の箱のボタンに届くよう、印は pointer-events を受けない。
 * right・top は印の右上の角、compact は縦の図の小さい箱。
 */
function BoxMark({
  right,
  top,
  warn,
  compact = false,
}: {
  right: number;
  top: number;
  warn: boolean;
  compact?: boolean;
}) {
  const r = compact ? 6 : 9;
  return (
    <g
      aria-hidden
      data-unselected-mark={warn ? '' : undefined}
      data-swap-mark={warn ? undefined : ''}
      style={{ pointerEvents: 'none' }}
    >
      <circle
        cx={right - r}
        cy={top + r}
        r={r}
        style={{
          fill: warn ? 'var(--color-warning)' : 'var(--color-primary)',
        }}
      />
      <text
        x={right - r}
        y={top + r}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fill: warn
            ? 'var(--color-warning-content)'
            : 'var(--color-primary-content)',
          fontSize: compact ? 8 : 12,
          fontWeight: 700,
        }}
      >
        {warn ? '!' : '⇄'}
      </text>
    </g>
  );
}

/** 差し替えられる箱の枠（primary の色。押せない箱の灰色の枠と見分ける）。 */
const SWAP_STROKE =
  'color-mix(in oklab, var(--color-primary) 70%, transparent)';

/**
 * 幽霊の箱（D-116 の補足）の見た目: 点線の枠・半透明（今の選択は図に箱を持たない。線は引かない）。
 * 差し替えの印（⇄）は薄くしない（押せることは同じに見せる）。
 */
const GHOST_DASH = '4 3';
const GHOST_OPACITY = 0.5;
/**
 * foreignObject の中の字の薄さ（opacity の代わりに色の透明度。WebKit は foreignObject の中の opacity・位置指定などで独自のレイヤーを
 * 作る要素を、viewBox の拡大縮小と foreignObject の位置を受けずに描く。D-213）。幽霊の箱は GHOST_OPACITY を掛けた値。
 */
const CAPTION = 'text-base-content/70';
const GHOST_CAPTION = 'text-base-content/35';
const GHOST_TEXT = 'text-base-content/50';
/** 幽霊の箱の吹き出しの説明。 */
const GHOST_NOTE =
  '今の選択は、課金される部品を図に持ちません（別の部品の中で働くか、使わない）。箱だけを点線で残し、経路の線は引きません。';

/** 幽霊の箱の吹き出しの中身（スロットの名前・今の選択・説明）。 */
function GhostDetail({ n }: { n: DiagramNode }) {
  return (
    <>
      <div className="text-xs opacity-80">{GHOST_NOTE}</div>
      {n.ghost?.note && (
        <div className="text-xs opacity-70">{n.ghost.note}</div>
      )}
    </>
  );
}

/** 箱の吹き出しで選んだ後に focus を移す先（スロットと、押した箱の id。data-box）。 */
export type BoxFocus = { slot: string; box: string };

/** 図の一番下の段の、スロットの箱の id（data-box）。 */
const looseBox = (slot: string) => `loose:${slot}`;

const groupTitle = (account: string, brand?: BrandId) =>
  brand ? BRANDS[brand].title : account;

/**
 * 図の一番下の段に出すスロット（部品を選べる図だけ。D-116 の補足）。picked は選んでいる部品の名前（未選択は undefined）、
 * pressable は選び直せるか（1 択・ファイルの置き場は押せない箱）。経路の箱・経路に載らない部品に当たらないものだけを段に出す（looseSlots）。
 */
export type BandSlot = {
  slot: string;
  label: string;
  picked: string | undefined;
  fixed: boolean;
  pressable: boolean;
};

export function SystemDiagram({
  architecture,
  pages,
  caption,
  parts,
  ghosts,
  bandSlots,
  focusTarget,
  onFocused,
  framework,
}: {
  architecture: ArchitectureInput;
  /** 選んだフレームワーク（流れ・箱の名前をその呼び名にする。D-193）。 */
  framework?: FrameworkId | undefined;
  /** ページの見取り図（流れの凡例にページの名前を添える。省略可）。 */
  pages?: readonly ResolvedPage[] | undefined;
  /** 図の下の注記。 */
  caption?: string;
  /** 箱から部品を差し替える（選んでいる構成のカードだけ。D-116）。 */
  parts?: DiagramParts | undefined;
  /** 今の選択が箱を持たないスロットの幽霊の箱（slotBoxes。D-116 の補足）。 */
  ghosts?: readonly GhostSlot[] | undefined;
  /** 部品のスロットの一覧（部品を選べる図だけ）。図に箱を持たないものを一番下の段に出す。 */
  bandSlots?: readonly BandSlot[] | undefined;
  /**
   * 描いた後に focus を移す先（箱の吹き出しで選んだ直後。押した箱が残っていればそこへ、差し替えで消えたらそのスロットの最初の箱へ、
   * それも無ければ図の頭。OCL-131BD89D）。移したら onFocused を呼ぶ。
   */
  focusTarget?: BoxFocus | null | undefined;
  onFocused?: (() => void) | undefined;
}) {
  // 入れ物の幅を測り、狭ければ縦の図にする（画面の幅でなく入れ物の幅。カルーセルのカード・畳んだ欄の中でも同じ判定）
  const wrap = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = diagramModel(
    architecture,
    pages ?? [],
    'horizontal',
    ghosts,
    framework,
  );
  const narrow = isNarrow(boxWidth, wide.width);
  const tall = narrow
    ? diagramModel(architecture, pages ?? [], 'vertical', ghosts, framework)
    : null;
  const model = tall ?? wide;
  // 幽霊の箱は、そのスロットの差し替えを出す（D-116 の補足）
  const nodeParts: DiagramParts | undefined = parts && {
    render: parts.render,
    unselected: parts.unselected,
    slotsOf: (id) => {
      const n = model.nodes.find((x) => x.id === id);
      return n ? nodeSlots(n, parts.slotsOf) : parts.slotsOf(id);
    },
  };
  // 一番下の段: 経路に載らない部品（幽霊の箱も）と、図に箱を持たないスロット。経路に載らない部品の箱には、経路の箱で選べない
  // スロットだけを出す（バックアップの箱に DB・API の置き場を重ねて出さない）
  const routed = new Set(
    model.nodes.flatMap((n) => (nodeParts ? nodeParts.slotsOf(n.id) : [])),
  );
  const sideSlots = (n: DiagramNode) =>
    nodeParts
      ? nodeSlots(n, nodeParts.slotsOf).filter((x) => !routed.has(x))
      : [];
  const loose = nodeParts
    ? looseSlots(model, nodeParts.slotsOf, bandSlots ?? []).map((slot) =>
        bandSlots!.find((x) => x.slot === slot)!,
      )
    : [];
  // 箱の吹き出しで選んだ後、押した箱（無ければそのスロットの最初の箱、それも無ければ図の頭）へ focus を移す
  useEffect(() => {
    if (!focusTarget) return;
    const el = wrap.current;
    const { slot, box } = focusTarget;
    (
      el?.querySelector<HTMLElement>(
        `[data-box="${box}"][data-slots~="${slot}"] button`,
      ) ??
      el?.querySelector<HTMLElement>(`[data-slots~="${slot}"] button`) ??
      el
    )?.focus();
    onFocused?.();
  }, [focusTarget, onFocused]);
  // 未選択の箱があるときだけ、説明文に印の意味を足す
  // （どのスロットも図の箱か段の箱に当たるので、選べるスロットのどれかが未選択なら ! の箱がある）
  const unselectedAny =
    model.nodes.some((n) => hasUnselected(nodeParts, n.id)) ||
    (bandSlots ?? []).some(
      (x) => x.pressable && nodeParts?.unselected?.(x.slot) === true,
    );
  const [chosen, setActive] = useState<LaneId | null>(null);
  // 構成・部品を替えて選んでいた流れが図から消えたら、強調をやめる（凡例に無い流れで全部の線が薄くならないように）
  const active = activeLane(chosen, model);
  const markerId = useId().replace(/:/g, '');
  const title = (account: string) =>
    groupTitle(account, model.groups.find((g) => g.account === account)?.brand);
  return (
    // figure にしない（daisyUI は .card の中の figure を横並びの flex にし、図が細く潰れる）
    <div
      ref={wrap}
      tabIndex={-1}
      className="w-full min-w-0 space-y-2 focus:outline-none"
      data-diagram="system"
      data-orientation={model.orientation}
    >
      <div className="rounded-box border border-base-300 bg-base-200/40">
        <div className="overflow-x-auto">
          <svg
            // 縦の図は箱が押せるボタンなので img にしない（img の中のボタンは読み上げに出ない）
            // 差し替えられる箱（ボタン）があるときも同じ
            role={tall || parts ? 'group' : 'img'}
            aria-label={diagramSummary(model, title)}
            // 中身の大きさの viewBox で、カードの幅に合わせて縮める（横の図は広げない。狭い画面では最小の幅を保ち、枠の中で横にスクロールする）。
            // 縦の図は最小の幅を持たず（横にスクロールしない）、字が読めるよう 1.5 倍まで広げて真ん中に置く
            width="100%"
            viewBox={`0 0 ${model.width} ${model.height}`}
            className={tall ? 'mx-auto block h-auto' : 'block h-auto'}
            style={
              tall
                ? { maxWidth: model.width * 1.5 }
                : {
                    maxWidth: model.width,
                    minWidth: Math.min(model.width, MIN_WIDTH),
                  }
            }
          >
            <defs>
              {/* 矢印の先端は線の終わりの向き（orient="auto"）。線の終わりは矢印より長いまっすぐな線にしてある（edgeGeometry）。
                大きさは線の太さに依らず図の座標で決める（強調した線でも先端がまっすぐな部分からはみ出さない） */}
              {/* Chromium は context-stroke に対応していないので、流れごとに先端の色を持つ marker を作る */}
              {(Object.keys(LANE_COLOR) as LaneId[]).map((l) => (
                <marker
                  key={l}
                  id={`${markerId}-${l}`}
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerUnits="userSpaceOnUse"
                  markerWidth={ARROW}
                  markerHeight={ARROW}
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 z" fill={LANE_COLOR[l]} />
                </marker>
              ))}
            </defs>
            {model.groups.map((g) =>
              g.box ? (
                <GroupBox
                  key={g.account}
                  g={g}
                  title={title(g.account)}
                  compact={tall !== null}
                />
              ) : null,
            )}
            <Edges model={model} active={active} markerId={markerId} />
            <Viewer model={model} />
            {model.nodes.map((n) =>
              tall ? (
                <CompactNode
                  key={n.id}
                  n={n}
                  model={model}
                  title={title(n.group)}
                  brand={model.groups.find((g) => g.account === n.group)?.brand}
                  parts={nodeParts}
                />
              ) : nodeParts && nodeParts.slotsOf(n.id).length > 0 ? (
                <SwappableNode
                  key={n.id}
                  n={n}
                  model={model}
                  title={title(n.group)}
                  parts={nodeParts}
                />
              ) : (
                <g
                  key={n.id}
                  data-node={n.id}
                  data-ghost={n.ghost ? 'true' : undefined}
                >
                  <rect
                    x={n.x}
                    y={n.y}
                    width={model.node.w}
                    height={model.node.h}
                    rx={6}
                    strokeDasharray={n.ghost ? GHOST_DASH : undefined}
                    style={{
                      fill: 'var(--color-base-100)',
                      stroke: n.compute
                        ? 'var(--color-base-content)'
                        : 'color-mix(in oklab, var(--color-base-content) 35%, transparent)',
                      strokeWidth: n.compute ? 1.75 : 1,
                      ...(n.ghost ? { opacity: GHOST_OPACITY } : {}),
                    }}
                  />
                  <foreignObject
                    x={n.x + 4}
                    y={n.y + 2}
                    width={model.node.w - 8}
                    height={model.node.h - 4}
                  >
                    <div
                      title={
                        n.ghost
                          ? `${n.caption}: ${n.label}（${GHOST_NOTE}）`
                          : n.label
                      }
                      // 幽霊の箱の薄さは opacity でなく字の色の透明度で出す（foreignObject の中に独自のレイヤーを作らない。D-213）
                      className="flex h-full flex-col justify-center leading-tight"
                    >
                      <span
                        className={`text-[10px] ${n.ghost ? GHOST_CAPTION : CAPTION}`}
                      >
                        {n.caption}
                      </span>
                      <span
                        className={`text-[11px] break-words ${n.compute ? 'font-semibold' : ''} ${n.ghost ? GHOST_TEXT : ''}`}
                      >
                        {n.label}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              ),
            )}
          </svg>
        </div>
        {(model.side.length > 0 || loose.length > 0) && (
          // 図の一番下の段（経路に載らない部品と、図に箱を持たないスロット。D-116 の補足）
          <div
            data-diagram-band
            className="border-t border-dashed border-base-300 px-2 py-1.5 text-xs"
          >
            <div className="font-semibold opacity-80">
              経路に載らない部品（毎月かかる・裏で動く）
              {loose.length > 0 && '・図に箱の無い部品'}
            </div>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {model.side.flatMap((s) =>
                s.nodes.map((n) => (
                  <BandNode
                    key={n.id}
                    n={n}
                    brand={s.brand}
                    title={title(s.group)}
                    slots={sideSlots(n)}
                    parts={nodeParts}
                  />
                )),
              )}
              {loose.map((x) => (
                <LooseSlot key={x.slot} x={x} parts={nodeParts} />
              ))}
            </ul>
          </div>
        )}
      </div>
      {tall && (
        <p className="text-xs opacity-70">
          狭い幅なので縦に並べました。箱を押すと、事業者・種類・通る流れが出ます。
          {parts && '⇄ の箱では部品も替えられます。'}
          {unselectedAny && '! の箱はまだ選んでいません。'}
        </p>
      )}
      {!tall && parts && (
        <p className="text-xs opacity-70">
          ⇄ の付いた箱を押すと、その部品を替えられます。
          {unselectedAny &&
            '! の付いた箱はまだ選んでいません（既定の部品の名前で描いています）。'}
        </p>
      )}
      {caption && <p className="text-xs opacity-70">{caption}</p>}
      <Legend model={model} active={active} onToggle={setActive} />
      <ConnectionList model={model} title={title} />
    </div>
  );
}

const BADGE =
  'badge h-auto max-w-full gap-1 badge-sm border-dashed badge-outline py-0.5 whitespace-normal';
/** 段の押せる箱の枠（差し替えられる箱と同じ primary の枠。未選択は警告色の太い枠）。 */
const pressableBadge = (warn: boolean) =>
  `${BADGE} cursor-pointer focus-visible:outline-2 focus-visible:outline-primary ${
    warn
      ? 'justify-start border-2 border-warning hover:bg-warning/10'
      : 'border-primary/70 hover:bg-primary/10'
  }`;

/** 段の押せる箱の印（⇄ か「! 未選択」。色だけに頼らない）。 */
function BandMark({ warn }: { warn: boolean }) {
  return warn ? (
    <span
      aria-hidden
      data-unselected-mark
      className="font-bold whitespace-nowrap"
    >
      ! 未選択
    </span>
  ) : (
    <span aria-hidden data-swap-mark>
      ⇄
    </span>
  );
}

/**
 * 押せる箱の名前の補足（見えている文字の後ろに続ける。WCAG 2.5.3: 名前は見えている文字で始める。D-196）。
 * 例: 「（Cloudflare、未選択）を替える」。ボタンには sr-only で、吹き出しの名前には文字列でそのまま足す。
 */
function swapSuffix(...extras: (string | false | undefined)[]): string {
  return nameSuffix(extras, 'を替える');
}

function nameSuffix(
  extras: readonly (string | false | undefined)[],
  tail: string,
): string {
  const xs = extras.filter((x): x is string => !!x);
  return `${xs.length > 0 ? `（${xs.join('、')}）` : ''}${tail}`;
}

/**
 * 未選択の段の箱の中身: 名前と「! 未選択」を 1 つの文の流れにして左に寄せる（狭い幅で名前が折り返しても、印は名前の後ろに続く。
 * 横並びの flex のままだと、名前が中央に寄り、印が右の別の列に立つ）。
 */
function WarnTrigger({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 text-left">
      {children} <BandMark warn />
    </span>
  );
}

/**
 * 一番下の段の、経路に載らない部品の箱（メールの送信・ドメインの登録・バックアップなど。幽霊の箱は点線・半透明。D-116 の補足）。
 * 部品を選べる図で、経路の箱で選べないスロットに当たる箱（slots）は、押すとそのスロットの差し替えを出す。
 */
function BandNode({
  n,
  brand,
  title,
  slots,
  parts,
}: {
  n: DiagramNode;
  brand: BrandId | undefined;
  title: string;
  slots: readonly string[];
  parts: DiagramParts | undefined;
}) {
  const warn =
    parts?.unselected !== undefined && slots.some((x) => parts.unselected!(x));
  const pressable = parts !== undefined && slots.length > 0;
  const visible = n.ghost ? `${n.caption}: ${n.label}` : n.label;
  // 押せる箱は見えている文字で名前を始め、事業者・スロット・未選択は後ろに足す（名前に既に含むスロットは重ねない。D-196）
  const suffix = swapSuffix(
    !n.ghost && !n.label.includes(n.caption) && n.caption,
    title,
    warn && '未選択',
  );
  const text = pressable ? (
    <>
      {visible}
      <span className="sr-only">{suffix}</span>
    </>
  ) : (
    <>
      <span className="sr-only">{title}: </span>
      {visible}
    </>
  );
  const name = (
    <span
      className="inline-flex items-center gap-1"
      style={n.ghost ? { opacity: GHOST_OPACITY } : undefined}
    >
      {brand && <BrandMark brand={brand} size={12} />}
      {text}
    </span>
  );
  return (
    <li
      data-side-node={n.id}
      data-box={n.id}
      data-ghost={n.ghost ? 'true' : undefined}
      data-slots={slots.length > 0 ? slots.join(' ') : undefined}
      data-unselected={warn ? 'true' : undefined}
    >
      {parts && pressable ? (
        <Popover
          label={`${visible}${suffix}`}
          nameFromContent
          interactive
          className={pressableBadge(warn)}
          trigger={
            warn ? (
              <WarnTrigger>
                {/* 文の流れに置く（ロゴは行の高さに揃え、名前と一緒に折り返す） */}
                <span style={n.ghost ? { opacity: GHOST_OPACITY } : undefined}>
                  {brand && (
                    <span className="mr-1 inline-block align-middle leading-none">
                      <BrandMark brand={brand} size={12} />
                    </span>
                  )}
                  {text}
                </span>
              </WarnTrigger>
            ) : (
              <>
                {name}
                <BandMark warn={false} />
              </>
            )
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={n.id}>
              <div className="text-xs opacity-70">
                {title}・{n.caption}
              </div>
              <div className="font-semibold">{n.label}</div>
              {n.ghost && <GhostDetail n={n} />}
              {slots.map((slot) => (
                <div key={slot} className="border-t border-base-300 pt-1.5">
                  {parts.render(slot, close, n.id)}
                </div>
              ))}
            </div>
          )}
        </Popover>
      ) : (
        <span className={BADGE} title={n.ghost ? GHOST_NOTE : undefined}>
          {name}
        </span>
      )}
    </li>
  );
}

/**
 * 一番下の段の、図に箱を持たないスロットの箱（「スロット名: 選んだ部品」。D-116 の補足）。1 択（ファイルの置き場など）は押せない箱、
 * 選び直せるものは押すとそのスロットの差し替えを出す。
 */
function LooseSlot({
  x,
  parts,
}: {
  x: BandSlot;
  parts: DiagramParts | undefined;
}) {
  const warn = x.pressable && parts?.unselected?.(x.slot) === true;
  const name = (
    <span>
      <span className="font-semibold">{x.label}:</span> {x.picked ?? '未選択'}
      {x.fixed && <span className="opacity-70">（1 択）</span>}
      {parts && x.pressable && <span className="sr-only">{swapSuffix()}</span>}
    </span>
  );
  return (
    <li
      data-loose-slot={x.slot}
      data-box={looseBox(x.slot)}
      data-slots={x.slot}
      data-unselected={warn ? 'true' : undefined}
    >
      {parts && x.pressable ? (
        <Popover
          label={`${x.label}: ${x.picked ?? '未選択'}${swapSuffix()}`}
          nameFromContent
          interactive
          className={pressableBadge(warn)}
          trigger={
            warn ? (
              <WarnTrigger>{name}</WarnTrigger>
            ) : (
              <>
                {name}
                <BandMark warn={false} />
              </>
            )
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={x.slot}>
              {parts.render(x.slot, close, looseBox(x.slot))}
            </div>
          )}
        </Popover>
      ) : (
        <span className={BADGE}>{name}</span>
      )}
    </li>
  );
}

function GroupBox({
  g,
  title,
  compact,
}: {
  g: DiagramModel['groups'][number];
  title: string;
  /** 縦の図: 枠の上の左端にロゴだけ（名前は箱の説明と読み上げに出す）。 */
  compact: boolean;
}) {
  const b = g.box!;
  const color = (g.brand && brandColor(g.brand)) ?? 'var(--color-base-content)';
  return (
    <g data-group={g.account}>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={10}
        style={{
          fill: color,
          fillOpacity: 0.06,
          stroke: color,
          strokeOpacity: 0.45,
          strokeDasharray: '5 3',
        }}
      />
      {compact ? (
        <g>
          <title>{title}</title>
          <foreignObject x={b.x + 3} y={b.y + 2} width={b.w - 6} height={13}>
            {/* 切り詰めは foreignObject の既定の切り抜きに任せる（中に overflow・opacity のレイヤーを作らない。D-213） */}
            <div className="flex h-full items-center text-[9px] font-semibold whitespace-nowrap text-base-content/80">
              {g.brand ? <BrandMark brand={g.brand} size={12} /> : title}
            </div>
          </foreignObject>
        </g>
      ) : (
        <foreignObject
          x={b.x + 6}
          y={b.y + 2}
          width={Math.max(40, b.w - 12)}
          height={LAYOUT.bandHeader - 2}
        >
          <div className="flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap text-base-content/80">
            {g.brand && <BrandMark brand={g.brand} size={12} />}
            {title}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function Viewer({ model }: { model: DiagramModel }) {
  const v = model.viewer;
  if (model.orientation === 'vertical')
    // 縦の図: 上の真ん中の横長の箱（画面の形 + 閲覧者）
    return (
      <g data-node={VIEWER}>
        <rect
          x={v.x}
          y={v.y}
          width={v.w}
          height={v.h}
          rx={8}
          style={{
            fill: 'var(--color-base-100)',
            stroke: 'var(--color-base-content)',
            strokeWidth: 1.25,
          }}
        />
        <rect
          x={v.x + 10}
          y={v.y + v.h / 2 - 6}
          width={16}
          height={12}
          rx={1.5}
          style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.25 }}
        />
        <line
          x1={v.x + 10}
          x2={v.x + 26}
          y1={v.y + v.h / 2 - 2.5}
          y2={v.y + v.h / 2 - 2.5}
          style={{ stroke: 'currentColor', strokeWidth: 1.25 }}
        />
        <text
          x={v.x + 32}
          y={v.y + v.h / 2 + 4}
          className="fill-current text-[11px] font-semibold"
        >
          {VIEWER_LABEL}
        </text>
      </g>
    );
  return (
    <g data-node={VIEWER}>
      <rect
        x={v.x}
        y={v.y}
        width={v.w}
        height={v.h}
        rx={8}
        style={{
          fill: 'var(--color-base-100)',
          stroke: 'var(--color-base-content)',
          strokeWidth: 1.25,
        }}
      />
      {/* 画面の形（ブラウザ） */}
      <rect
        x={v.x + v.w / 2 - 13}
        y={v.y + 10}
        width={26}
        height={18}
        rx={2}
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }}
      />
      <line
        x1={v.x + v.w / 2 - 13}
        x2={v.x + v.w / 2 + 13}
        y1={v.y + 15}
        y2={v.y + 15}
        style={{ stroke: 'currentColor', strokeWidth: 1.5 }}
      />
      <text
        x={v.x + v.w / 2}
        y={v.y + 47}
        textAnchor="middle"
        className="fill-current text-[11px] font-semibold"
      >
        {VIEWER_LABEL}
      </text>
    </g>
  );
}

const STEP = 3;
/** 縮めても文字が読める最小の幅（これより狭い画面では横にスクロールする）。 */
const MIN_WIDTH = 560;

function Edges({
  model,
  active,
  markerId,
}: {
  model: DiagramModel;
  active: LaneId | null;
  markerId: string;
}) {
  return (
    <g fill="none">
      {model.edges.map((e) => {
        if (!edgeGeometry(model, e, 0)) return null;
        return (
          <g key={`${e.from}>${e.to}`} data-edge={`${e.from}>${e.to}`}>
            {e.lanes.map((l, k) => {
              const off = (k - (e.lanes.length - 1) / 2) * STEP;
              const dim = active !== null && active !== l;
              const style: CSSProperties = {
                stroke: LANE_COLOR[l],
                strokeWidth: active === l ? 2.5 : 1.75,
                opacity: dim ? 0.12 : 0.9,
              };
              return (
                <path
                  key={l}
                  data-lane={l}
                  d={edgeGeometry(model, e, off)!.d}
                  style={style}
                  strokeDasharray={LANE_DASH[l]}
                  markerEnd={
                    k === e.lanes.length - 1 || active === l
                      ? `url(#${markerId}-${l})`
                      : undefined
                  }
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function Legend({
  model,
  active,
  onToggle,
}: {
  model: DiagramModel;
  active: LaneId | null;
  onToggle: (l: LaneId | null) => void;
}) {
  return (
    <ul aria-label="構成図の流れの凡例" className="flex flex-wrap gap-1">
      {model.lanes.map((l) => (
        <li key={l.id} className="max-w-full min-w-0">
          <button
            type="button"
            aria-pressed={active === l.id}
            className={`btn h-auto min-h-0 max-w-full shrink gap-1.5 btn-ghost px-2 py-1 text-left text-xs font-normal btn-xs ${active === l.id ? 'btn-active' : ''}`}
            onClick={() => onToggle(active === l.id ? null : l.id)}
          >
            <svg aria-hidden width="18" height="6" className="shrink-0">
              <line
                x1="0"
                x2="18"
                y1="3"
                y2="3"
                style={{ stroke: LANE_COLOR[l.id], strokeWidth: 2.5 }}
                strokeDasharray={LANE_DASH[l.id]}
              />
            </svg>
            <span className="min-w-0 break-words">
              {l.label}
              {l.pages.length > 0 && (
                <span className="opacity-70">（{l.pages.join('・')}）</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 読み上げ用の、事業者ごとの部品とつながりの一覧。 */
function ConnectionList({
  model,
  title,
}: {
  model: DiagramModel;
  title: (account: string) => string;
}) {
  const laneLabel = (l: LaneId) =>
    model.lanes.find((x) => x.id === l)?.label ?? l;
  return (
    <div className="sr-only">
      <ul aria-label="構成図の部品">
        {model.groups.map((g) => (
          <li key={g.account}>
            {title(g.account)}:{' '}
            {[
              ...model.nodes.filter((n) => n.group === g.account),
              ...(model.side.find((s) => s.group === g.account)?.nodes ?? []),
            ]
              .map((n) =>
                n.ghost
                  ? `${n.caption}: ${n.label}（図に部品の箱なし）`
                  : n.label,
              )
              .join('、')}
          </li>
        ))}
      </ul>
      <ul aria-label="構成図のつながり">
        {model.edges.map((e) => (
          <li key={`${e.from}>${e.to}`}>
            {e.from === VIEWER ? VIEWER_LABEL : labelOf(model, e.from)} →{' '}
            {labelOf(model, e.to)}: {e.lanes.map(laneLabel).join('・')}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 縦の図の箱: 短い名前だけの小さい箱で、押すと詳しい説明を出す（info.tsx の吹き出し。ダイアログの中では PortalContainer に描く）。 */
function CompactNode({
  n,
  model,
  title,
  brand,
  parts,
}: {
  n: DiagramNode;
  model: DiagramModel;
  title: string;
  brand: BrandId | undefined;
  parts: DiagramParts | undefined;
}) {
  const slots = parts?.slotsOf(n.id) ?? [];
  const warn = hasUnselected(parts, n.id);
  const lanes = lanesThrough(model, n.id);
  const laneLabel = (l: LaneId) =>
    model.lanes.find((x) => x.id === l)?.label ?? l;
  // 名前は見えている短い名前で始め、正式の名前・スロット・事業者・未選択を後ろに足す（D-196）
  const suffix = nameSuffix(
    [
      n.short !== n.label && n.label,
      !n.label.includes(n.caption) && n.caption,
      title,
      warn && '未選択',
    ],
    slots.length > 0 ? 'の説明と差し替え' : 'の説明',
  );
  // 枠の太さと色（未選択は警告色の太い枠・差し替えられる箱は primary・処理を動かす部品は太い枠。D-116 とその補足）
  const sw = warn ? 2 : n.compute ? 1.75 : 1;
  const stroke = warn
    ? 'var(--color-warning)'
    : slots.length > 0
      ? SWAP_STROKE
      : n.compute
        ? 'var(--color-base-content)'
        : 'color-mix(in oklab, var(--color-base-content) 35%, transparent)';
  const mark = warn || slots.length > 0;
  const text = compactText(n.short, mark);
  return (
    <g
      data-node={n.id}
      data-box={n.id}
      data-slots={slots.length > 0 ? slots.join(' ') : undefined}
      data-unselected={warn ? 'true' : undefined}
      data-ghost={n.ghost ? 'true' : undefined}
    >
      {/* 箱の地と枠は SVG の rect（D-213。WebKit は foreignObject の中の位置指定・opacity の要素を viewBox の拡大縮小を受けずに描く）。
          地は下に、枠はボタン（ホバーの地・輪）の上に重ねて押すのを邪魔しない。枠の太さは CSS の border と同じく箱の内側に収める */}
      <rect
        x={n.x}
        y={n.y}
        width={model.node.w}
        height={model.node.h}
        rx={6}
        style={{
          fill: 'var(--color-base-100)',
          // 幽霊の箱は半透明の地（D-116 の補足）
          ...(n.ghost ? { fillOpacity: GHOST_OPACITY } : {}),
        }}
      />
      <foreignObject x={n.x} y={n.y} width={model.node.w} height={model.node.h}>
        <Popover
          label={`${n.short}${suffix}`}
          hiddenName
          interactive={slots.length > 0}
          // 枠は上の rect が描く。ボタンにも同じ太さの透明の枠を持たせ、ホバーの輪（inset）を枠の内側に置く（前と同じ見た目）。
          // 名前は真ん中のまま、右上の印（!・⇄）は箱の角に重ねる（印の分の余白は取らず、1 行目を短くして避ける。compactText）
          className={`flex h-full w-full cursor-pointer items-center justify-center rounded-md border-transparent px-0.5 text-center leading-tight hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
            text.size === 8
              ? 'text-[8px]'
              : text.size === 9
                ? 'text-[9px]'
                : 'text-[10px]'
          } ${n.compute ? 'font-semibold' : ''} ${
            warn ? 'border-2' : n.compute ? 'border-[1.75px]' : 'border'
          } ${
            // 差し替えられる箱は、ホバーで primary の輪を足して太く見せる（D-116）。未選択の箱は警告色（D-116 の補足）
            warn
              ? 'hover:bg-warning/10 hover:ring-2 hover:ring-warning hover:ring-inset'
              : slots.length > 0
                ? 'hover:bg-primary/10 hover:ring-2 hover:ring-primary hover:ring-inset'
                : ''
          }`}
          trigger={
            // 行はモデルで分けてある（英単語の途中で折らない・長い名前は「…」。D-213 の補足）。ブラウザには折り返させない
            <span
              data-short
              data-truncated={text.truncated ? 'true' : undefined}
              className={`flex flex-col items-center whitespace-nowrap ${n.ghost ? GHOST_TEXT : ''}`}
            >
              {text.lines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </span>
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={n.id}>
              <div className="flex items-center gap-1 text-xs opacity-70">
                {brand && <BrandMark brand={brand} size={12} />}
                {title}・{n.caption}
              </div>
              <div className="font-semibold">{n.label}</div>
              {termNotesOf([n.label]).map((t) => (
                <div key={t} className="text-xs opacity-70">
                  {t}。
                </div>
              ))}
              {n.ghost && <GhostDetail n={n} />}
              {n.compute && (
                <div className="text-xs opacity-70">
                  処理を動かす部品（太い枠）
                </div>
              )}
              {lanes.length > 0 && (
                <ul className="space-y-0.5 text-xs" aria-label="通る流れ">
                  {lanes.map((l) => (
                    <li key={l} className="flex items-center gap-1.5">
                      <svg
                        aria-hidden
                        width="14"
                        height="6"
                        className="shrink-0"
                      >
                        <line
                          x1="0"
                          x2="14"
                          y1="3"
                          y2="3"
                          style={{ stroke: LANE_COLOR[l], strokeWidth: 2.5 }}
                          strokeDasharray={LANE_DASH[l]}
                        />
                      </svg>
                      {laneLabel(l)}
                    </li>
                  ))}
                </ul>
              )}
              {slots.map((slot) => (
                <div key={slot} className="border-t border-base-300 pt-1.5">
                  {parts!.render(slot, close, n.id)}
                </div>
              ))}
            </div>
          )}
        </Popover>
      </foreignObject>
      <rect
        x={n.x + sw / 2}
        y={n.y + sw / 2}
        width={model.node.w - sw}
        height={model.node.h - sw}
        rx={6 - sw / 2}
        // 幽霊の箱は点線の枠（D-116 の補足）
        strokeDasharray={n.ghost ? GHOST_DASH : undefined}
        style={{ fill: 'none', stroke, strokeWidth: sw, pointerEvents: 'none' }}
      />
      {mark && (
        // 縦の図は印を箱の右上の角に重ね（外へ 4 はみ出す）、箱の内側は右端から 8・上端から 8 だけ使う
        <BoxMark
          right={n.x + model.node.w + 4}
          top={n.y - 4}
          warn={warn}
          compact
        />
      )}
    </g>
  );
}

/** 横の図の、部品を差し替えられる箱: 箱そのものがボタンで、押すとそのスロットの選択肢を出す（D-116）。 */
function SwappableNode({
  n,
  model,
  title,
  parts,
}: {
  n: DiagramNode;
  model: DiagramModel;
  title: string;
  parts: DiagramParts;
}) {
  const warn = hasUnselected(parts, n.id);
  return (
    <g
      data-node={n.id}
      data-box={n.id}
      data-slots={parts.slotsOf(n.id).join(' ')}
      data-swappable="true"
      data-unselected={warn ? 'true' : undefined}
      data-ghost={n.ghost ? 'true' : undefined}
    >
      <rect
        x={n.x}
        y={n.y}
        width={model.node.w}
        height={model.node.h}
        rx={6}
        strokeDasharray={n.ghost ? GHOST_DASH : undefined}
        style={{
          fill: 'var(--color-base-100)',
          // 未選択の箱は警告色の太い枠（幽霊の箱でも枠は薄くしない。D-116 の補足）
          stroke: warn ? 'var(--color-warning)' : SWAP_STROKE,
          strokeWidth: warn ? 3 : n.compute ? 2 : 1.5,
          ...(n.ghost
            ? warn
              ? { fillOpacity: GHOST_OPACITY }
              : { opacity: GHOST_OPACITY }
            : {}),
        }}
      />
      <foreignObject
        x={n.x + 2}
        y={n.y + 2}
        width={model.node.w - 4}
        height={model.node.h - 4}
      >
        <Popover
          label={`${n.caption}：${n.label}${swapSuffix(title, warn && '未選択')}`}
          // 名前は見えている「スロット：部品」で始め、事業者・未選択を後ろに足す（D-196）。sr-only（position: absolute）は
          // foreignObject の中に置けないので、名前は hidden の要素から取る（D-213）
          hiddenName
          interactive
          // ホバーで primary の枠を太くし、地を薄く塗る（押せる箱だと分かるように。D-116）。未選択の箱は警告色。
          // 右の余白（pr-5）は右上の印の分
          className={`flex h-full w-full cursor-pointer flex-col justify-center rounded-md py-0.5 pr-5 pl-0.5 text-left leading-tight hover:ring-2 hover:ring-inset focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
            warn
              ? 'hover:bg-warning/10 hover:ring-warning'
              : 'hover:bg-primary/10 hover:ring-primary'
          }`}
          trigger={
            <>
              <span className="flex items-center gap-1">
                <span
                  className={`text-[10px] ${n.ghost ? GHOST_CAPTION : CAPTION}`}
                >
                  {n.caption}
                </span>
                {/* 文字として続ける区切り（見せない。読み上げの名前は hiddenName の文字列） */}
                <span hidden>：</span>
                {warn && (
                  <span
                    aria-hidden
                    className="badge h-3.5 badge-xs px-1 text-[9px] badge-warning"
                  >
                    未選択
                  </span>
                )}
              </span>
              <span
                className={`text-[11px] break-words ${n.compute ? 'font-semibold' : ''} ${n.ghost ? GHOST_TEXT : ''}`}
              >
                {n.label}
              </span>
            </>
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={n.id}>
              <div className="text-xs opacity-70">
                {title}・{n.caption}
              </div>
              <div className="font-semibold">{n.label}</div>
              {n.ghost && <GhostDetail n={n} />}
              {parts.slotsOf(n.id).map((slot) => (
                <div key={slot} className="border-t border-base-300 pt-1.5">
                  {parts.render(slot, close, n.id)}
                </div>
              ))}
            </div>
          )}
        </Popover>
      </foreignObject>
      <BoxMark right={n.x + model.node.w - 4} top={n.y + 4} warn={warn} />
    </g>
  );
}
