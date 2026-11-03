// playMonth の最初の段: 返事のない提案の扱い・今月の台本（起きる出来事と予告）・流量の出来事・今月の PV。
import type { Platform } from 'catalog';
import type { Scenario, Scheduled } from '../scenario.ts';
import { BOT_BLOCK } from '../actions/check.ts';
import { eventDef } from '../core.ts';
import { applyEffects } from '../events.ts';
import { fmtFactor } from '../format.ts';
import { STACKS } from '../stacks.ts';
import type { GameState } from '../state.ts';
import type { Spike } from '../workload.ts';
import { noSocialCards } from './satisfaction.ts';

/** 今月の流量を変えた出来事（容量の判定の集中・境目を越えた理由の確かめに使う）。 */
export type TrafficEvent = {
  id: string;
  title: string;
  bot: boolean;
  factor: number;
  peak?: number;
  spikeDays?: number;
};

/** 返事のない提案は断ったことにする（罰はない。D-20 V-11）。 */
export function declineUnanswered(input: GameState): GameState {
  return input.pendingProposals.length
    ? {
        ...input,
        responses: {
          ...input.responses,
          ...Object.fromEntries(
            input.pendingProposals.map((id) => [id, 'declined' as const]),
          ),
        },
        pendingProposals: [],
      }
    : input;
}

/** 台本: 今月起きる出来事と予告（事業者を限った出来事は、その事業者の構成のときだけ。D-24 X-5）。 */
export function scriptOf(
  sc: Scenario,
  state: GameState,
  month: number,
): { platform: Platform; due: Scheduled[]; noticed: Scheduled[] } {
  const platform = STACKS[state.stackIndex]!.provider;
  const forPlatform = (x: Scheduled) => {
    const ps = eventDef(sc, x.id)!.platforms;
    return !ps || ps.includes(platform);
  };
  const due = state.schedule.filter((x) => x.month === month && forPlatform(x));
  const noticed = state.schedule.filter(
    (x) => x.noticeMonth === month && forPlatform(x),
  );
  return { platform, due, noticed };
}

/** 台本の効果（流量以外）は起きた月から効く（提案は返事を待つので当てない）。 */
export function applyDueEffects(
  sc: Scenario,
  state: GameState,
  due: readonly Scheduled[],
): GameState {
  let next = state;
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    next = applyEffects(next, def.effects ?? [], def.id);
  }
  return next;
}

export type Traffic = {
  humanFactor: number;
  botExtra: number;
  peakFactor: number;
  /** 話題の後に伸びが残る月（buzzLasting で基準の PV を決める）。 */
  buzz: boolean;
  buzzRule: Scenario['buzz'];
  trafficEvents: TrafficEvent[];
  trafficNotes: string[];
};

/** 予告と続いている流量の出来事から、今月の流量の倍率を集める（台本の効果を当てる前の状態で見る）。 */
export function trafficOf(
  sc: Scenario,
  state: GameState,
  month: number,
  noticed: readonly Scheduled[],
): Traffic {
  let humanFactor = 1;
  let botExtra = 0;
  let peakFactor = 1;
  let lasting = false;
  // 記事ごとの SNS のカードが出ないと、話題の伸びが小さい（SPA で OGP の前処理なし。ゲーム上の仮定・prd/10 F-05）
  const cardFactor = noSocialCards(state)
    ? (sc.frameworks?.spa?.socialCardFactor ?? 1)
    : 1;
  let socialLasting = false;
  const trafficEvents: TrafficEvent[] = [];
  const trafficNotes: string[] = [];
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    const n = def.notice!;
    if (n.pvFactor && n.bot) {
      // Bot の前兆（収益にならない。遮断していれば半分）
      const extra =
        (n.pvFactor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
      botExtra += extra;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: true,
        factor: 1 + extra,
      });
      trafficNotes.push(n.title);
    } else if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: false,
        factor: n.pvFactor,
      });
      trafficNotes.push(n.text);
    }
  }
  // 続いている流量の出来事（Bot は 2 か月など）
  for (const x of state.schedule) {
    if (x.month > month) continue;
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    for (const e of def.effects ?? []) {
      if (e.type !== 'traffic' || month >= x.month + e.months) continue;
      if (e.bot) {
        const extra =
          (e.factor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
        botExtra += extra;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: true,
          factor: 1 + extra,
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        trafficNotes.push(`${def.title}（Bot は収益にならない）`);
      } else {
        const factor = e.social ? 1 + (e.factor - 1) * cardFactor : e.factor;
        humanFactor *= factor;
        if (e.peakFactor) peakFactor *= e.peakFactor;
        if (e.lasting) lasting = true;
        if (e.lasting && e.social) socialLasting = true;
        if (e.social && cardFactor !== 1)
          trafficNotes.push(
            `記事ごとの SNS のカードが出ないので、話題の伸びが小さい（${fmtFactor(e.factor)} → ${fmtFactor(factor)}・ゲーム上の仮定）`,
          );
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: false,
          factor,
          ...(e.peakFactor ? { peak: e.peakFactor } : {}),
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        if (!e.lasting) trafficNotes.push(def.title);
      }
    }
  }
  // 話題の後に残る伸びも、カードが出ないと小さい（同じ仮定）
  const buzzRule =
    socialLasting && cardFactor !== 1
      ? { ...sc.buzz, extra: sc.buzz.extra * cardFactor }
      : sc.buzz;
  return {
    humanFactor,
    botExtra,
    peakFactor,
    buzz: lasting,
    buzzRule,
    trafficEvents,
    trafficNotes,
  };
}

export type Volume = {
  basePV: number;
  humanPV: number;
  botPV: number;
  pv: number;
  spikes: Spike[];
};

/** 今月の PV（人・Bot）と、短い期間に集中する上乗せ分。 */
export function volumeOf(basePV: number, t: Traffic): Volume {
  const humanPV = basePV * t.humanFactor;
  const botPV = humanPV * t.botExtra;
  const pv = humanPV + botPV;
  // 話題・Bot の上乗せ分は短い期間に集中する（容量の判定だけ。D-44）
  const spikes: Spike[] = t.trafficEvents.flatMap((e) =>
    e.spikeDays
      ? [
          {
            id: e.id,
            extraPV: e.bot
              ? humanPV * (e.factor - 1)
              : humanPV * (1 - 1 / e.factor),
            days: e.spikeDays,
          },
        ]
      : [],
  );
  return { basePV, humanPV, botPV, pv, spikes };
}
