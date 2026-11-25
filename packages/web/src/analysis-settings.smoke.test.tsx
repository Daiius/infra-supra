// @vitest-environment jsdom
// 解析の設定（区切り方・候補の数。D-236）を、ゲームの途中の「構成を変える」の欄（D-185）の解析の置き場のタブ（③。D-245）で選び直す。
// 棋譜解析のシナリオはまだ遊べない（SCENARIOS に無い。PR-10 で登録）ので、欄だけを棋譜解析の状態で描いて確かめる。
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  DEFAULT_START_DATE,
  flattenSetupChange,
  newGame,
  playMonth,
  SCENARIOS,
  STACKS,
  type SetupDraft,
} from 'game';
import { describe, expect, it, vi } from 'vitest';
import { SetupChangeField } from './setup-change-field.tsx';
import {
  changeItems,
  ensurePartsList,
  openSetupChange,
  pickAnalysis,
  registerSetupChange,
  showOwnSlotTab,
  showStackTab,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const PRO = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
const kifu = { ...SCENARIOS['kifu-analysis']!, startCash: 1e7 };

const draw = (scenario = kifu) => {
  const state = playMonth(
    newGame(PRO, 1, scenario, DEFAULT_START_DATE, 'nextjs'),
  );
  const onRegister = vi.fn<(d: SetupDraft | null) => void>();
  render(
    <SetupChangeField
      state={state}
      registered={null}
      onRegister={onRegister}
      wrap={flattenSetupChange}
    />,
  );
  openSetupChange();
  return onRegister;
};
// 解析の置き場は ③ のタブ（D-245）。区切り方・候補の数もそのタブで選ぶ
const analysisRow = () => showOwnSlotTab('analysis');
const pressChip = (group: string, value: string) => {
  const g = within(analysisRow()!).getByRole('group', { name: group });
  fireEvent.click(
    within(g.querySelector<HTMLElement>(`[data-option="${value}"]`)!).getByRole(
      'button',
    ),
  );
};

describe('構成を変えるの欄の解析の設定（D-236）', () => {
  it('W-KF5 区切り方と候補の数を解析の置き場の行で選び直すと、内訳に設定の行（工数・来月から）が出て、来月のアクションにできる', () => {
    const onRegister = draw();
    expect(analysisRow()).not.toBeNull();
    pressChip('解析の区切り方', '2');
    pressChip('1 局面に残す候補の数', '1');
    const items = changeItems().filter(
      (x) => x.getAttribute('data-change-kind') === 'setting',
    );
    expect(items.map((x) => x.textContent)).toEqual([
      expect.stringMatching(
        /^解析の区切り方を「1 局ずつ・小分けに保存」に.*工数 2・来月から/,
      ),
      expect.stringMatching(
        /^1 局面に残す候補の数を「1 つ」に.*工数 1・来月から/,
      ),
    ]);
    registerSetupChange();
    expect(onRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { analysisUnit: 2, candidates: 1, analysisScope: 0 },
      }),
    );
  });

  it('W-KF6 解析の置き場を利用者の端末にすると、候補の数は 1 つに固定して選べない理由を出す', () => {
    draw();
    pickAnalysis('client');
    const g = within(analysisRow()!).getByRole('group', {
      name: '1 局面に残す候補の数',
    });
    expect(
      g.querySelector('[data-selected="true"]')?.getAttribute('data-option'),
    ).toBe('1');
    expect(
      g.querySelector('[data-option="3"]')!.getAttribute('data-available'),
    ).toBe('false');
    expect(
      screen.getByText(/今は選べません: 解析の置き場が利用者の端末/),
    ).toBeDefined();
  });

  it('W-KF7 解析の無いシナリオ（記事）の欄には出さない', () => {
    draw({ ...SCENARIOS['article-community']!, startCash: 1e7 });
    showStackTab();
    ensurePartsList();
    expect(
      document.querySelector('section[data-parts] [data-slot="analysis"]'),
    ).toBeNull();
    expect(document.querySelector('[data-analysis-settings]')).toBeNull();
    expect(
      document.querySelector('[data-setup-tab-button="slot:analysis"]'),
    ).toBeNull();
  });
});

describe('詳細解析の範囲のチップ（D-246）', () => {
  it('置き方が併用のときだけ出す', async () => {
    const { AnalysisSettingChips } = await import('./analysis-settings.tsx');
    const value = { analysisUnit: 0, candidates: 3, analysisScope: 0 };
    const { rerender } = render(
      <AnalysisSettingChips
        value={value}
        analysis="same"
        onChange={() => {}}
      />,
    );
    const scopeChips = () =>
      document.querySelectorAll('[data-setting="analysisScope"]').length;
    expect(scopeChips()).toBe(0);
    rerender(
      <AnalysisSettingChips
        value={value}
        analysis="hybrid-fn-lambda"
        onChange={() => {}}
      />,
    );
    expect(scopeChips()).toBeGreaterThan(0);
  });
});
