// 今月の行動の下書き（選んでいる設定・構成の変更・提案への返事など）。行動の欄と出来事のダイアログ（提案のページ）で
// 同じ下書きを共有し、どちらで提案に返事をしても同じ値になるようにする（D-202）。選べるか・手間の判定は game の checkActions。
import { useState } from 'react';
import {
  applyActions,
  checkActions,
  effortAvailable,
  effortTotalOf,
  setupChangeOf,
  type Action,
  type CommitmentPaymentId,
  type GameState,
  type SettingKey,
  type SetupChangeGroups,
  type SetupDraft,
} from 'game';

export type MonthDraftOptions = {
  settings?: Partial<Record<SettingKey, number>>;
  optimize?: boolean;
  /** 構成を変える（写し取った行動の組。D-185）。 */
  change?: SetupChangeGroups | null;
  answers?: Record<string, boolean>;
  blockBots?: boolean;
  storage?: boolean;
  commits?: Record<string, CommitmentPaymentId>;
};

export function useMonthDraft(state: GameState) {
  const [settings, setSettings] = useState<Partial<Record<SettingKey, number>>>(
    {},
  );
  const [optimize, setOptimize] = useState(false);
  /** 構成を変える（構成・部品・フレームワーク・ページの描き方・コメント欄をまとめて選び直したもの。D-185）。 */
  const [change, setChange] = useState<SetupDraft | null>(null);
  /** 提案への返事（選ばなければ断る）。 */
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [blockBots, setBlockBots] = useState(false);
  /** さくらの VPS のストレージ変更オプション（D-30）。 */
  const [storage, setStorage] = useState(false);
  /** 結ぶ確約（確約ごとの支払いの形。D-97）。 */
  const [commits, setCommits] = useState<Record<string, CommitmentPaymentId>>(
    {},
  );
  /** 「選択を戻す」の回数（構成を変えるの欄の選び直しの途中も今の状態に戻すため、欄を描き直す。OCL-E8982F9F）。 */
  const [resets, setResets] = useState(0);
  const reset = () => {
    setResets((n) => n + 1);
    setCommits({});
    setSettings({});
    setOptimize(false);
    setChange(null);
    setAnswers({});
    setBlockBots(false);
    setStorage(false);
  };
  // 登録した「構成を変える」を写し取った行動（D-185）
  const changeGroups = change ? setupChangeOf(state, change).groups : null;

  const build = (o: MonthDraftOptions = {}): Action[] => {
    const st = o.settings ?? settings;
    const opt = o.optimize ?? optimize;
    const ch = o.change === undefined ? changeGroups : o.change;
    const ans = o.answers ?? answers;
    const out: Action[] = [];
    // 提案を受ける手間（割り込み）を先に取る
    for (const eventId of state.pendingProposals)
      out.push({ type: 'respond', eventId, accept: ans[eventId] ?? false });
    if (o.blockBots ?? blockBots) out.push({ type: 'block-bots' });
    if (o.storage ?? storage) out.push({ type: 'storage-option' });
    // 確約は今月の明細の使用で結ぶので、構成を変える行動より先に当てる（D-97）
    for (const [key, payment] of Object.entries(o.commits ?? commits))
      out.push({ type: 'commit', key, payment });
    // 構成を変える（D-185）: 部品（VPS の API の応答のキャッシュは前段の CDN の後・外すときは先。D-37）→ 構成 → 描き方（D-107。
    // 描き方で出す設定が変わるので設定の前）→ ページの部品（コメント欄。D-109。枠 + API にすると含められないので描き方の後）
    if (ch) {
      out.push(...ch.components);
      if (ch.stack) out.push(ch.stack);
      out.push(...ch.routes, ...ch.routeParts);
    }
    for (const [key, value] of Object.entries(st))
      out.push({ type: 'set', key: key as SettingKey, value: value! });
    if (opt) out.push({ type: 'optimize' });
    // 作り直しは残りの手間をすべて取れるので、ほかの行動の後に当てる（D-81）
    if (ch?.rewrite) out.push(ch.rewrite);
    return out;
  };
  /**
   * 選べない理由（すべて選べれば null）。理由はエンジンが区別して返す文をそのまま出す
   * （手間が足りない・今と同じ・最中・要件・提案を受けると付く など）。
   */
  const blocked = (actions: Action[]): string | null => {
    const r = checkActions(state, actions);
    return r.ok ? null : r.message;
  };
  const valid = (actions: Action[]) => blocked(actions) === null;
  const actions = build();
  const draft = applyActions(state, actions);
  return {
    settings,
    setSettings,
    optimize,
    setOptimize,
    change,
    setChange,
    answers,
    /** 提案への返事を選ぶ（行動の欄・出来事のダイアログのどちらからでも同じ値。D-202）。 */
    answer: (id: string, accept: boolean) =>
      setAnswers((a) => ({ ...a, [id]: accept })),
    blockBots,
    setBlockBots,
    storage,
    setStorage,
    commits,
    setCommits,
    resets,
    reset,
    build,
    blocked,
    valid,
    /** 今選んでいる行動。 */
    actions,
    /** 今選んでいる行動を当てた状態。 */
    draft,
    /** 来月の手間の残りと全体（選んでいる行動を当てた draft から。D-123）。 */
    left: effortAvailable(draft),
    total: effortTotalOf(draft),
    /** 受けるも断るも選んでいない提案（このまま進むと断ったことになる。D-140）。 */
    undecided: state.pendingProposals.filter((id) => answers[id] === undefined),
  };
}

export type MonthDraft = ReturnType<typeof useMonthDraft>;
