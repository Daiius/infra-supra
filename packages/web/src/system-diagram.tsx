// 構成図（D-105）。閲覧者から左→右へ、入口（CDN）→ 処理（関数・コンテナ・VPS）→ データ（DB・ストレージ・KV）と流れる図。
// 箱と線は費用の計算に使う構成から作る（system-diagram-model.ts）。事業者ごとに薄い色の枠で囲み、ロゴと名前を添える。
// 線は流れ（ページの描き方・API・画像）ごとに色の違う細い線を並べ（路線図の形）、凡例を押すとその流れだけを目立たせる。
// SVG は role="img" で要約を名前にし、箱とつながりの一覧を読み上げ用に別に置く（色だけに頼らない）。
// 入れ物が狭い（sm 未満で、横の図が縮めずには収まらない）ときは縦の図にする: 段を上→下・事業者の枠を左→右に並べ、
// 箱は短い名前だけにし、箱を押す（キーボードは Enter・Space）と詳しい説明（事業者・種類・名前・通る流れ）を出す（D-105 の補足）。
// 部品を差し替えられる箱（parts。始める画面・見積の選んでいる構成のカード）は、横の図でも押せて、そのスロットの選択肢を出す（D-116）。
import type { ArchitectureInput } from 'estimator';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { BrandMark, BRANDS, brandColor, type BrandId } from './brand-logos.tsx';
import { Info } from './info.tsx';
import {
  diagramModel,
  diagramSummary,
  activeLane,
  edgeGeometry,
  isNarrow,
  labelOf,
  lanesThrough,
  ARROW,
  LAYOUT,
  VIEWER,
  VIEWER_LABEL,
  type DiagramModel,
  type DiagramNode,
  type LaneId,
} from './system-diagram-model.ts';
import type { ResolvedPage } from './page-wireframes.tsx';

/** 構成図の注記（始める画面・見積モードで同じ文）。 */
export const DIAGRAM_NOTE =
  '構成図は費用の計算に使う構成（部品と、リクエストが通る順）から描く。線の色は流れの種類で、凡例を押すとその流れだけが目立つ。';

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

/** 箱から部品を差し替える（D-116）。slotsOf は箱に当たるスロット（無ければ空）、render はスロットの選択肢（選ぶと close を呼ぶ）。 */
export type DiagramParts = {
  slotsOf: (nodeId: string) => readonly string[];
  render: (slot: string, close: () => void) => ReactNode;
};

/**
 * 差し替えられる箱の印（角の丸いバッジに ⇄。primary の地で、押せる箱だと一目で分かるように。色だけに頼らず記号も付ける）。
 * compact は縦の図の小さい箱。
 */
function SwapMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden
      data-swap-mark
      className={`absolute flex items-center justify-center rounded-full bg-primary leading-none font-bold text-primary-content shadow-sm ${
        compact
          ? 'top-0 right-0 h-3.5 w-3.5 text-[9px]'
          : 'top-0.5 right-0.5 h-[18px] w-[18px] text-[12px]'
      }`}
    >
      ⇄
    </span>
  );
}

/** 差し替えられる箱の枠（primary の色。押せない箱の灰色の枠と見分ける）。 */
const SWAP_STROKE =
  'color-mix(in oklab, var(--color-primary) 70%, transparent)';

const groupTitle = (account: string, brand?: BrandId) =>
  brand ? BRANDS[brand].title : account;

export function SystemDiagram({
  architecture,
  pages,
  caption,
  parts,
  below,
}: {
  architecture: ArchitectureInput;
  /** ページの見取り図（流れの凡例にページの名前を添える。省略可）。 */
  pages?: readonly ResolvedPage[] | undefined;
  /** 図の下の注記。 */
  caption?: string;
  /** 箱から部品を差し替える（選んでいる構成のカードだけ。D-116）。 */
  parts?: DiagramParts | undefined;
  /** 図のすぐ下（凡例・経路に載らない部品より上）に置く中身（部品のチップ。D-116）。 */
  below?: ReactNode;
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
  const wide = useMemo(
    () => diagramModel(architecture, pages ?? []),
    [architecture, pages],
  );
  const narrow = isNarrow(boxWidth, wide.width);
  const tall = useMemo(
    () => (narrow ? diagramModel(architecture, pages ?? [], 'vertical') : null),
    [narrow, architecture, pages],
  );
  const model = tall ?? wide;
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
      className="w-full min-w-0 space-y-2"
      data-diagram="system"
      data-orientation={model.orientation}
    >
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-200/40">
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
                parts={parts}
              />
            ) : parts && parts.slotsOf(n.id).length > 0 ? (
              <SwappableNode
                key={n.id}
                n={n}
                model={model}
                title={title(n.group)}
                parts={parts}
              />
            ) : (
              <g key={n.id} data-node={n.id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={model.node.w}
                  height={model.node.h}
                  rx={6}
                  style={{
                    fill: 'var(--color-base-100)',
                    stroke: n.compute
                      ? 'var(--color-base-content)'
                      : 'color-mix(in oklab, var(--color-base-content) 35%, transparent)',
                    strokeWidth: n.compute ? 1.75 : 1,
                  }}
                />
                <foreignObject
                  x={n.x + 4}
                  y={n.y + 2}
                  width={model.node.w - 8}
                  height={model.node.h - 4}
                >
                  <div
                    title={n.label}
                    className="flex h-full flex-col justify-center leading-tight"
                  >
                    <span className="text-[10px] opacity-60">{n.caption}</span>
                    <span
                      className={`text-[11px] break-words ${n.compute ? 'font-semibold' : ''}`}
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
      {tall && (
        <p className="text-xs opacity-60">
          狭い幅なので縦に並べた。箱を押すと、事業者・種類・通る流れが出る。
          {parts && '⇄ の箱では部品も替えられる。'}
        </p>
      )}
      {!tall && parts && (
        <p className="text-xs opacity-60">
          ⇄ の付いた箱を押すと、その部品を替えられる。
        </p>
      )}
      {/* 部品のチップは図のすぐ下（凡例・経路に載らない部品より上。D-116） */}
      {below}
      {caption && <p className="text-xs opacity-60">{caption}</p>}
      <Legend model={model} active={active} onToggle={setActive} />
      {model.side.length > 0 && (
        <div className="text-xs">
          <div className="font-semibold">
            経路に載らない部品（毎月かかる・裏で動く）
          </div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {model.side.flatMap((s) =>
              s.nodes.map((n) => (
                <li
                  key={n.id}
                  data-side-node={n.id}
                  className="badge h-auto max-w-full gap-1 badge-sm border-dashed badge-outline py-0.5 whitespace-normal"
                >
                  {s.brand && <BrandMark brand={s.brand} size={12} />}
                  <span className="sr-only">{title(s.group)}: </span>
                  {n.label}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      <ConnectionList model={model} title={title} />
    </div>
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
            <div className="flex h-full items-center overflow-hidden text-[9px] font-semibold whitespace-nowrap opacity-80">
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
          <div className="flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap opacity-80">
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
          閲覧者
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
        y={v.y + 44}
        textAnchor="middle"
        className="fill-current text-[11px] font-semibold"
      >
        閲覧者
      </text>
      <text
        x={v.x + v.w / 2}
        y={v.y + 57}
        textAnchor="middle"
        className="fill-current text-[9px] opacity-60"
      >
        ブラウザ
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
              .map((n) => n.label)
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
  const lanes = lanesThrough(model, n.id);
  const laneLabel = (l: LaneId) =>
    model.lanes.find((x) => x.id === l)?.label ?? l;
  return (
    <g data-node={n.id}>
      <foreignObject x={n.x} y={n.y} width={model.node.w} height={model.node.h}>
        <Info
          label={`${title}: ${n.label}（${n.caption}）の${slots.length > 0 ? '説明と差し替え' : '説明'}`}
          interactive={slots.length > 0}
          className={`relative flex h-full w-full cursor-pointer items-center justify-center rounded-md bg-base-100 px-0.5 text-center text-[10px] leading-tight hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
            n.compute ? 'border-[1.75px] font-semibold' : 'border'
          } ${
            // 差し替えられる箱は primary の枠で、ホバーで太くする（D-116）
            slots.length > 0
              ? 'border-primary/70 hover:bg-primary/10 hover:ring-2 hover:ring-primary hover:ring-inset'
              : n.compute
                ? 'border-base-content'
                : 'border-base-content/35'
          }`}
          trigger={
            <>
              <span className="line-clamp-3 [overflow-wrap:anywhere]">
                {n.short}
              </span>
              {slots.length > 0 && <SwapMark compact />}
            </>
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={n.id}>
              <div className="flex items-center gap-1 text-xs opacity-70">
                {brand && <BrandMark brand={brand} size={12} />}
                {title}・{n.caption}
              </div>
              <div className="font-semibold">{n.label}</div>
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
                  {parts!.render(slot, close)}
                </div>
              ))}
            </div>
          )}
        </Info>
      </foreignObject>
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
  return (
    <g data-node={n.id} data-swappable="true">
      <rect
        x={n.x}
        y={n.y}
        width={model.node.w}
        height={model.node.h}
        rx={6}
        style={{
          fill: 'var(--color-base-100)',
          stroke: SWAP_STROKE,
          strokeWidth: n.compute ? 2 : 1.5,
        }}
      />
      <foreignObject
        x={n.x + 2}
        y={n.y + 2}
        width={model.node.w - 4}
        height={model.node.h - 4}
      >
        <Info
          label={`${title}: ${n.label}（${n.caption}）を替える`}
          interactive
          // ホバーで primary の枠を太くし、地を薄く塗る（押せる箱だと分かるように。D-116）
          className="relative flex h-full w-full cursor-pointer flex-col justify-center rounded-md py-0.5 pr-5 pl-0.5 text-left leading-tight hover:bg-primary/10 hover:ring-2 hover:ring-primary hover:ring-inset focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          trigger={
            <>
              <span className="text-[10px] opacity-60">{n.caption}</span>
              <span
                className={`text-[11px] break-words ${n.compute ? 'font-semibold' : ''}`}
              >
                {n.label}
              </span>
              <SwapMark />
            </>
          }
        >
          {(close) => (
            <div className="space-y-1.5" data-node-detail={n.id}>
              <div className="text-xs opacity-70">
                {title}・{n.caption}
              </div>
              <div className="font-semibold">{n.label}</div>
              {parts.slotsOf(n.id).map((slot) => (
                <div key={slot} className="border-t border-base-300 pt-1.5">
                  {parts.render(slot, close)}
                </div>
              ))}
            </div>
          )}
        </Info>
      </foreignObject>
    </g>
  );
}
