// 前提が初めて境目を越えた月に、出来事ごとに効果を外した見積を引き直して理由を確かめる（prd/07 §10.7）。
import type { ArchitectureInput, PlatformPremise, PriceBook } from 'estimator';
import { estimate, eventDef } from '../core.ts';
import type { Scenario, WorkloadMods } from '../scenario.ts';
import type { Crossing, GameState, MonthReport } from '../state.ts';
import { workloadFor, type WorkloadParts } from '../workload.ts';

/** 境目を初めて越えた前提について、出来事ごとに効果を外した見積を引き直す（表示のためだけ）。 */
export function crossingsOf(
  sc: Scenario,
  c: {
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    parts: WorkloadParts;
    architecture: ArchitectureInput;
    books: PriceBook[];
    humanPV: number;
    basePV: number;
    trafficEvents: {
      id: string;
      title: string;
      bot: boolean;
      factor: number;
      peak?: number;
    }[];
    state: GameState;
  },
): Crossing[] {
  const crossed = c.premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.hit &&
      Number.isFinite(p.ratio ?? NaN) &&
      // 前の月にも同じ前提があり、境目より下だった（1 か月目・乗り換えの直後は数えない）
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? Infinity) <= 1,
  );
  if (!crossed.length) return [];
  // 外してみる候補: 流量の出来事・受けた提案（Workload の変化・在庫の一括の増加）
  const variants: { eventId: string; title: string; parts: WorkloadParts }[] =
    [];
  for (const t of c.trafficEvents) {
    const pv = t.bot
      ? c.parts.pv - c.humanPV * (t.factor - 1)
      : c.parts.pv / t.factor;
    const peakFactor = (c.parts.peakFactor ?? 1) / (t.peak ?? 1);
    // 外した出来事の集中を除き、人の流量の出来事を外すなら残りの上乗せも同じ割合で小さくする
    const spikes = (c.parts.spikes ?? [])
      .filter((s) => s.id !== t.id)
      .map((s) => (t.bot ? s : { ...s, extraPV: s.extraPV / t.factor }));
    // Bot の PV（メールの通数から除く分。D-117）: Bot の出来事を外せばその分を、人の出来事を外せば同じ割合で小さくする
    const botPV =
      c.parts.botPV !== undefined
        ? Math.max(
            0,
            t.bot
              ? c.parts.botPV - c.humanPV * (t.factor - 1)
              : c.parts.botPV / t.factor,
          )
        : undefined;
    variants.push({
      eventId: t.id,
      title: t.title,
      parts: {
        ...c.parts,
        pv,
        peakFactor,
        spikes,
        ...(botPV !== undefined ? { botPV } : {}),
      },
    });
  }
  for (const [id, res] of Object.entries(c.state.responses)) {
    if (res !== 'accepted') continue;
    const def = eventDef(sc, id);
    if (!def?.accept) continue;
    let mods = c.parts.mods;
    let stock = c.parts.stock;
    let pv = c.parts.pv;
    // basePV を外すと、話題・Bot の上乗せ（集中する分）も同じ割合で小さくなる（OCL-37A91830）
    let baseFactor = 1;
    for (const e of def.accept.effects) {
      if (e.type === 'workload') {
        const next = { ...mods };
        for (const k of Object.keys(e.mods) as (keyof WorkloadMods)[])
          delete next[k];
        mods = next;
      } else if (e.type === 'stock' && stock) {
        stock = {
          dbGB: stock.dbGB - (e.add.dbGB ?? 0),
          imagesGB: stock.imagesGB - (e.add.imagesGB ?? 0),
          images: stock.images - (e.add.images ?? 0),
          articlePages: stock.articlePages - (e.add.articlePages ?? 0),
        };
      } else if (e.type === 'basePV') {
        pv /= e.factor;
        baseFactor *= e.factor;
      }
    }
    const spikes = (c.parts.spikes ?? []).map((s) => ({
      ...s,
      extraPV: s.extraPV / baseFactor,
    }));
    variants.push({
      eventId: id,
      title: def.title,
      parts: {
        ...c.parts,
        mods,
        stock,
        pv,
        spikes,
        ...(c.parts.botPV !== undefined
          ? { botPV: c.parts.botPV / baseFactor }
          : {}),
      },
    });
  }
  const ratios = variants.map((v) => {
    const r = estimate({
      workload: workloadFor(sc, v.parts),
      architecture: c.architecture,
      books: c.books,
    });
    return new Map(r.premises.map((p) => [p.id, p.ratio ?? 0]));
  });
  return crossed.map((p) => ({
    premiseId: p.id,
    text: p.text,
    causes: variants.flatMap((v, i) => {
      const without = ratios[i]!.get(p.id) ?? 0;
      return without <= 1
        ? [{ eventId: v.eventId, title: v.title, ratioWithout: without }]
        : [];
    }),
  }));
}
