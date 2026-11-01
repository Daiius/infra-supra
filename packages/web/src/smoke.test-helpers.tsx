// 画面の描画テスト（D-86）の共通の準備。jsdom に無い・足りないブラウザの API を最小限に補い、操作の手順をまとめる。
// 補うのは描画と操作に要るものだけで、見た目（CSS・レイアウト）は確かめない（prd/05 §7）。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { App } from './App.tsx';

/** 始めた日・乱数のシード（画面の入力で固定する。既定の「今日」に頼らない）。 */
export const START_DATE = '2026-11-02';
export const SEED = 42;

/**
 * jsdom の不足を補う。
 * - matchMedia: 無い。常に「動きを減らす」にして、花火（canvas）と数え上げ（requestAnimationFrame）を止める。
 * - HTMLDialogElement の showModal・close: 無い。open 属性を付け外しするだけ。
 * - ResizeObserver・要素の大きさ: 無い・常に 0。グラフは幅が 0 だと描かないので、幅 640 を返す。
 * - `<form method="dialog">` の送信: 未実装。送信を止めてダイアログを閉じる（ブラウザと同じ）。
 * - scrollTo・canvas の getContext: 未実装の警告を出すので黙らせる。
 */
function installDomShims() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  const dialog = HTMLDialogElement.prototype;
  dialog.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  const WIDTH = 640;
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb(
        [{ target: el, contentRect: { width: WIDTH, height: 200 } } as never],
        this as never,
      );
    }
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: WIDTH,
      bottom: 200,
      width: WIDTH,
      height: 200,
      toJSON: () => ({}),
    }) as DOMRect;
  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (form.getAttribute('method') !== 'dialog') return;
    e.preventDefault();
    form.closest('dialog')?.close();
  });
  window.scrollTo = () => {};
  HTMLCanvasElement.prototype.getContext = () => null;
}

/**
 * 各テストの前後: 保存・URL を消し、React の警告・エラー（key の重複・描画の例外など）を拾って失敗にする。
 * 描画の例外は render・fireEvent がそのまま投げるので、ここでは console.error に出るものを拾う。
 */
export function useSmokeEnv() {
  installDomShims();
  let errors: unknown[][] = [];
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    expect(errors.map((a) => a.map(String).join(' '))).toEqual([]);
  });
}

/** 本番（main.tsx）と同じく StrictMode で描く。 */
export function renderApp(): void {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/** ラベルの先頭で radio を選ぶ（説明・手間の棒の文字が後ろに続くので前方一致）。 */
const pickRadio = (name: string, scope: HTMLElement = document.body) => {
  const r = within(scope).getByRole('radio', {
    name: new RegExp(`^${escape(name)}`),
  });
  fireEvent.click(r);
  expect((r as HTMLInputElement).checked).toBe(true);
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Setup = {
  scenario: string;
  framework: string;
  stack: string;
  /** スロットの見出し → 選ぶ選択肢（無いスロットは選べる最初の選択肢）。 */
  parts?: Record<string, string>;
};

/**
 * 始める画面で選んで「運営を始める」を押す。部品は指定のものを選び、残りの未選択のスロットは選べる最初の選択肢にする
 * （部品の依存で選べないもの・1 択のものは飛ばす）。
 */
export function startGame(s: Setup) {
  pickRadio(s.scenario);
  pickRadio(s.framework);
  pickRadio(s.stack);
  const partsHeading = screen.queryByRole('heading', { name: '部品' });
  for (const [slot, option] of Object.entries(s.parts ?? {}))
    pickRadio(option, slotGroup(slot));
  // 選ぶと別のスロットが出ることがある（API を他の事業者に置いたときの DB など）ので、未選択が無くなるまで回す
  for (let i = 0; partsHeading && i < 20; i++) {
    const open = screen
      .queryAllByRole('group')
      .find((g) =>
        /（未選択）/.test(g.querySelector('legend')?.textContent ?? ''),
      );
    if (!open) break;
    const first = within(open)
      .getAllByRole('radio')
      .find((r) => !(r as HTMLInputElement).disabled);
    expect(first, '選べる選択肢が無いスロット').toBeDefined();
    fireEvent.click(first!);
  }
  fireEvent.change(screen.getByLabelText(/始めた日/), {
    target: { value: START_DATE },
  });
  fireEvent.change(screen.getByLabelText(/乱数のシード/), {
    target: { value: String(SEED) },
  });
  const start = screen.getByRole('button', { name: '運営を始める' });
  expect(
    (start as HTMLButtonElement).disabled,
    screen.queryByRole('status')?.textContent ?? '',
  ).toBe(false);
  fireEvent.click(start);
  // 選んだ構成で始まっている（月のカードの見出しに構成の名前が出る）
  expect(
    screen.getByRole('heading', { level: 2, name: /^1 か月目/ }).textContent,
  ).toContain(s.stack.split(' + ')[0]);
}

const slotGroup = (label: string) =>
  screen.getByRole('group', { name: new RegExp(`^${escape(label)}`) });

/**
 * 「次の月へ」を n 回押す（行動は選ばない）。出来事のダイアログが自動で開いたら、中身が描けていることを見て閉じる。
 */
export function advance(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.queryByRole('dialog');
    if (!dialog) continue;
    within(dialog).getByRole('heading', { name: /か月目の出来事/ });
    fireEvent.click(
      within(dialog).getByRole('button', { name: '閉じて今月の行動へ' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  }
}

/** 今の月のカードの見出し（「N か月目 …」）。 */
export const monthHeading = (n: number) =>
  screen.getByRole('heading', { level: 2, name: new RegExp(`^${n} か月目`) });

/** 遊んでいる間の画面に出るもの: 推移のグラフ・今の月・料金の明細・これまでの運営。 */
export function expectGameScreen(month: number) {
  expect(screen.queryByRole('dialog')).toBeNull();
  monthHeading(month);
  screen.getByRole('heading', { name: 'これまでの推移' });
  expect(screen.getAllByRole('img', { name: /./ }).length).toBeGreaterThan(0);
  const bill = screen.getByText(/^料金の明細/).closest('details')!;
  expect(within(bill).getAllByRole('row').length).toBeGreaterThan(0);
  const history = screen
    .getByRole('heading', { name: 'これまでの運営' })
    .closest('.card-body') as HTMLElement;
  // 見出しの行 + 月の数
  expect(within(history).getAllByRole('row')).toHaveLength(month + 1);
}
