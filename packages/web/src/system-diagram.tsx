// 構成図（D-105）。閲覧者から左→右へ、入口（CDN）→ 処理（関数・コンテナ・VPS）→ データ（DB・ストレージ・KV）と流れる図。
// 箱と線は費用の計算に使う構成から作る（system-diagram-model.ts）。事業者ごとに薄い色の枠で囲み、ロゴと名前を添える。
// 線は流れ（ページの描き方・API・画像）ごとに色の違う細い線を並べ（路線図の形）、凡例を押すとその流れだけを目立たせる。
// SVG は role="img" で要約を名前にし、箱とつながりの一覧を読み上げ用に別に置く（色だけに頼らない）。
import type { ArchitectureInput } from 'estimator';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import { BrandMark, BRANDS, brandColor, type BrandId } from './brand-logos.tsx';
import {
  diagramModel,
  diagramSummary,
  activeLane,
  labelOf,
  BACK_LOOP,
  LAYOUT,
  VIEWER,
  VIEWER_LABEL,
  type DiagramModel,
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
};

const groupTitle = (account: string, brand?: BrandId) =>
  brand ? BRANDS[brand].title : account;

export function SystemDiagram({
  architecture,
  pages,
  caption,
}: {
  architecture: ArchitectureInput;
  /** ページの見取り図（流れの凡例にページの名前を添える。省略可）。 */
  pages?: readonly ResolvedPage[] | undefined;
  /** 図の下の注記。 */
  caption?: string;
}) {
  const model = useMemo(
    () => diagramModel(architecture, pages ?? []),
    [architecture, pages],
  );
  const [chosen, setActive] = useState<LaneId | null>(null);
  // 構成・部品を替えて選んでいた流れが図から消えたら、強調をやめる（凡例に無い流れで全部の線が薄くならないように）
  const active = activeLane(chosen, model);
  const markerId = useId().replace(/:/g, '');
  const title = (account: string) =>
    groupTitle(account, model.groups.find((g) => g.account === account)?.brand);
  return (
    // figure にしない（daisyUI は .card の中の figure を横並びの flex にし、図が細く潰れる）
    <div className="w-full min-w-0 space-y-2" data-diagram="system">
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-200/40">
        <svg
          role="img"
          aria-label={diagramSummary(model, title)}
          // 中身の大きさの viewBox で、カードの幅に合わせて縮める（広げない）。狭い画面では最小の幅を保ち、枠の中で横にスクロールする
          width="100%"
          viewBox={`0 0 ${model.width} ${model.height}`}
          className="block h-auto"
          style={{
            maxWidth: model.width,
            minWidth: Math.min(model.width, MIN_WIDTH),
          }}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
            </marker>
          </defs>
          {model.groups.map((g) =>
            g.box ? (
              <GroupBox key={g.account} g={g} title={title(g.account)} />
            ) : null,
          )}
          <Edges model={model} active={active} markerId={markerId} />
          <Viewer model={model} />
          {model.nodes.map((n) => (
            <g key={n.id} data-node={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={LAYOUT.nodeW}
                height={LAYOUT.nodeH}
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
                width={LAYOUT.nodeW - 8}
                height={LAYOUT.nodeH - 4}
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
          ))}
        </svg>
      </div>
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
                  className="badge h-auto gap-1 badge-sm border-dashed badge-outline py-0.5 whitespace-normal"
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
}: {
  g: DiagramModel['groups'][number];
  title: string;
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
    </g>
  );
}

function Viewer({ model }: { model: DiagramModel }) {
  const v = model.viewer;
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
  const at = (id: string, side: 'out' | 'in') => {
    if (id === VIEWER) {
      const v = model.viewer;
      return { x: v.x + v.w, y: v.y + v.h / 2 };
    }
    const n = model.nodes.find((x) => x.id === id);
    if (!n) return undefined;
    return {
      x: side === 'out' ? n.x + LAYOUT.nodeW : n.x,
      y: n.y + LAYOUT.nodeH / 2,
    };
  };
  return (
    <g fill="none">
      {model.edges.map((e) => {
        const a = at(e.from, 'out');
        const b = at(e.to, 'in');
        if (!a || !b) return null;
        const dx = Math.max(16, (b.x - a.x) / 2);
        // 左へ戻る線（経路の輪）は、箱の下から出て下を回り、戻り先の箱の下へ入る
        const d = (off: number) =>
          e.back
            ? `M${a.x - LAYOUT.nodeW / 2 + off},${a.y + LAYOUT.nodeH / 2} C${a.x - LAYOUT.nodeW / 2 + off},${a.y + LAYOUT.nodeH / 2 + BACK_LOOP} ${b.x + LAYOUT.nodeW / 2 + off},${b.y + LAYOUT.nodeH / 2 + BACK_LOOP} ${b.x + LAYOUT.nodeW / 2 + off},${b.y + LAYOUT.nodeH / 2 + 1}`
            : `M${a.x},${a.y + off} C${a.x + dx},${a.y + off} ${b.x - dx},${b.y + off} ${b.x - 1},${b.y + off}`;
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
                  d={d(off)}
                  style={style}
                  strokeDasharray={LANE_DASH[l]}
                  markerEnd={
                    k === e.lanes.length - 1 || active === l
                      ? `url(#${markerId})`
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
        <li key={l.id}>
          <button
            type="button"
            aria-pressed={active === l.id}
            className={`btn h-auto min-h-0 gap-1.5 btn-ghost px-2 py-1 text-left text-xs font-normal btn-xs ${active === l.id ? 'btn-active' : ''}`}
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
            <span>
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
