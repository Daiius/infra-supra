// 画面の描画テスト（D-86）の共通の準備。jsdom に無い・足りないブラウザの API を最小限に補い、操作の手順をまとめる。
// 補うのは描画と操作に要るものだけで、見た目（CSS・レイアウト）は確かめない（prd/05 §7）。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { App } from './App.tsx';
import { storeHowtoSeen } from './local-records.ts';

/** 始めた日・乱数のシード（画面の入力で固定する。既定の「今日」に頼らない）。 */
export const START_DATE = '2026-11-02';
export const SEED = 42;

/**
 * jsdom の不足を補う。
 * - matchMedia: 無い。常に「動きを減らす」にして、花火（canvas）と数え上げ（requestAnimationFrame）を止める。
 * - HTMLDialogElement の showModal・close: 無い。open 属性を付け外しするだけ。Esc は一番上の開いたダイアログを閉じる（ブラウザと同じ）。
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
  if (!dialog.showModal) {
    dialog.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    // Esc: ブラウザと同じく、一番上（後から開いた）のダイアログに cancel を送り、止められなければ閉じる。
    // 中の要素が keydown を preventDefault したら（吹き出しを閉じたとき）閉じない
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const top = [...document.querySelectorAll('dialog[open]')].at(-1) as
        HTMLDialogElement | undefined;
      if (!top) return;
      const cancel = new Event('cancel', { cancelable: true });
      if (top.dispatchEvent(cancel)) top.close();
    });
  }
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
  // 分けて読む画面のモジュールを先に読んでおく（各テストの waitLoaded を短くする。CI では初回の変換が 1 秒を超える）
  beforeAll(async () => {
    await Promise.all([
      import('./game-screen.tsx'),
      import('./estimate/estimate-mode.tsx'),
    ]);
  }, 30_000);
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // 遊び方（D-146）は見た扱いにする（初回に自動で開いて操作を邪魔しないように）。初回の動きは howto-settings の smoke で確かめる
    markHowtoSeen();
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

/** 遊び方を見た記録を書く（D-146）。useSmokeEnv が各テストの前に呼ぶ。初回の動きを確かめるテストは localStorage から消す。 */
export const markHowtoSeen = () => storeHowtoSeen();

/** 遊び方のダイアログが開いていれば × で閉じる（localStorage が使えず、見た記録を読めないテスト用）。 */
export function closeHowtoIfOpen() {
  const d = screen.queryByRole('dialog', { name: '遊び方' });
  if (d)
    fireEvent.click(within(d).getByRole('button', { name: '遊び方を閉じる' }));
}

/** 開いている ⓘ の説明のダイアログ（D-129。info.tsx の Info）。無ければ null。 */
export const infoDialog = (): HTMLElement | null =>
  [
    ...document.querySelectorAll<HTMLElement>('dialog[data-info-dialog][open]'),
  ].at(-1) ?? null;

/** 分けて読む画面（見積・運営中。App.tsx の lazy）の読み込みを待つ。 */
export async function waitLoaded(): Promise<void> {
  // waitFor の既定（1 秒）では CI の遅い実行環境で足りない（testTimeout の 30 秒の内に収める）
  await waitFor(() => expect(screen.queryByText('読み込み中…')).toBeNull(), {
    timeout: 15_000,
  });
}

/** 本番（main.tsx）と同じく StrictMode で描く。 */
export async function renderApp(): Promise<void> {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await waitLoaded();
}

/**
 * 今の表示で query が見つからなければ、① 構成・② フレームワークのタブ（D-116 の補足。隠れた側は hidden）を順に開いて探す
 * （人がタブを開いて探すのと同じ）。始める画面・見積モードの外では query をそのまま返す。
 */
export function inSetupTabs<T>(query: () => T | null): T | null {
  const found = query();
  if (found !== null) return found;
  for (const tab of ['stack', 'framework'] as const) {
    const b = document.querySelector(`[data-setup-tab-button="${tab}"]`);
    if (!b || b.getAttribute('aria-selected') === 'true') continue;
    showSetupTab(tab);
    const r = query();
    if (r !== null) return r;
  }
  return null;
}

/** screen.getByRole('radio', o) と同じ。① ② のタブの隠れた側にあれば開いて引く（inSetupTabs）。 */
export const getRadio = (o: { name: string | RegExp }): HTMLElement =>
  inSetupTabs(() => screen.queryByRole('radio', o)) ??
  screen.getByRole('radio', o);

/** ラベルの先頭で radio を選ぶ（説明・手間の棒の文字が後ろに続くので前方一致）。① ② のタブの隠れた側にあれば開いて選ぶ。 */
export const pickRadio = (name: string, scope: HTMLElement = document.body) => {
  const byName = {
    name: new RegExp(`^${escape(name)}`),
  };
  // 見つからなければ、隠れたタブを開いてから getByRole で落とす（見つからないときの一覧を出すため）
  const r =
    inSetupTabs(() => within(scope).queryByRole('radio', byName)) ??
    within(scope).getByRole('radio', byName);
  fireEvent.click(r);
  expect((r as HTMLInputElement).checked).toBe(true);
};
/**
 * 部品のチップ（① インフラの構成のカードの構成図の下。D-116）を名前の先頭で押す。押すと選択中（aria-pressed）になる。
 * scope はスロットの行（slotGroup）。畳んだ行（選び済み。D-116 の補足）は開いてから押し、選ぶと行はまた畳まれる。
 */
export const pickPart = (name: string, scope: HTMLElement) => {
  openSlot(scope);
  const b = within(scope).getByRole('button', {
    name: new RegExp(`^${escape(name)}`),
    pressed: false,
  });
  fireEvent.click(b);
  const row = slotGroup(scope.getAttribute('data-slot')!, 'slot');
  expect(row.getAttribute('data-collapsed')).toBe('true');
  expect(row.querySelector('[data-selected="true"]')!.textContent).toMatch(
    new RegExp(escape(name)),
  );
};
/**
 * ① の選んでいるカードの部品の表示を切り替える（D-116 の補足。既定は構成図、「機能から選ぶ」はチップの一覧）。
 * 選んだ表示は localStorage に覚えるので、テストの中では切り替えたまま（テストの前に消える）。
 */
export const showPartsView = (view: 'diagram' | 'list') => {
  if (document.querySelector('[data-setup-tab-button]')) showStackTab();
  const tab = document.querySelector<HTMLElement>(
    `[data-parts-view-tab="${view}"]`,
  );
  expect(tab, `部品の表示のタブ ${view}`).not.toBeNull();
  if (tab!.getAttribute('aria-pressed') !== 'true') fireEvent.click(tab!);
  expect(
    document.querySelector(`[data-parts-view="${view}"]`),
    `部品の表示 ${view}`,
  ).not.toBeNull();
};
/**
 * ① インフラの構成・② フレームワークと描き方のタブ（D-116 の補足）を開く。隠れた側の欄は hidden（getByRole で引けない）なので、
 * 欄を操作する前に開く。
 * 選んだタブは localStorage に覚えるので、テストの中では開いたまま（テストの前に消える。既定は ①）。
 */
export const showSetupTab = (tab: 'stack' | 'framework') => {
  const b = document.querySelector<HTMLElement>(
    `[data-setup-tab-button="${tab}"]`,
  );
  expect(b, `選ぶもののタブ ${tab}`).not.toBeNull();
  if (b!.getAttribute('aria-selected') !== 'true') fireEvent.click(b!);
  expect(b!.getAttribute('aria-selected')).toBe('true');
};
/** ① インフラの構成のタブを開く。 */
export const showStackTab = () => showSetupTab('stack');
/** ② フレームワークと描き方のタブを開く。 */
export const showFrameworkTab = () => showSetupTab('framework');
/** 部品のチップの一覧（「機能から選ぶ」）にする（チップの行を押すテスト用）。 */
export const showPartsList = () => showPartsView('list');
/** 部品を選べるカードがあれば、チップの一覧にする（見出しで欄を引くテスト用。無ければ何もしない）。 */
export const ensurePartsList = () => {
  if (
    document.querySelector('[data-parts-view-tab]') &&
    !document.querySelector('section[data-parts]')
  )
    showPartsList();
};
/** 畳んだ部品の行（D-116 の補足）を開く（開いていればそのまま）。行の要素は開いても同じ。 */
export const openSlot = (row: HTMLElement) => {
  const toggle = row.querySelector<HTMLElement>('[data-collapsed-toggle]');
  if (toggle) fireEvent.click(toggle);
  return row;
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Setup = {
  scenario: string;
  framework: string;
  stack: string;
  /** スロットの見出し → 選ぶ選択肢（無いスロットは選べる最初の選択肢）。 */
  parts?: Record<string, string>;
  /** 選び終えて「運営を始める」を押す前に、始める画面を確かめる。 */
  beforeStart?: () => void;
};

/**
 * 始める画面で選んで「運営を始める」を押す。部品は指定のものを選び、残りの未選択のスロットは選べる最初の選択肢にする
 * （部品の依存で選べないもの・1 択のものは飛ばす）。
 */
export async function startGame(s: Setup) {
  // 始める画面の順（D-113）: シナリオ → ① インフラの構成 → ② フレームワーク
  pickRadio(s.scenario);
  showStackTab();
  pickRadio(s.stack);
  showFrameworkTab();
  pickRadio(s.framework);
  showStackTab();
  showPartsList();
  for (const [slot, option] of Object.entries(s.parts ?? {}))
    pickPart(option, slotGroup(slot));
  // 選ぶと別のスロットが出ることがある（API を他の事業者に置いたときの DB など）ので、未選択が無くなるまで回す
  for (let i = 0; i < 20; i++) {
    const open = document.querySelector<HTMLElement>(
      'section[data-parts] [data-slot][data-unselected]',
    );
    if (!open) break;
    const first = within(open)
      .getAllByRole<HTMLButtonElement>('button', { pressed: false })
      .find((b) => !b.disabled);
    expect(first, '選べる選択肢が無いスロット').toBeDefined();
    fireEvent.click(first!);
  }
  fireEvent.change(screen.getByLabelText(/始めた日/), {
    target: { value: START_DATE },
  });
  fireEvent.change(screen.getByLabelText(/乱数のシード/), {
    target: { value: String(SEED) },
  });
  s.beforeStart?.();
  const start = screen.getByRole('button', { name: '運営を始める' });
  expect(
    (start as HTMLButtonElement).disabled,
    screen.queryByRole('status')?.textContent ?? '',
  ).toBe(false);
  fireEvent.click(start);
  await waitLoaded();
  // 選んだ構成で始まっている（月のカードの見出しに構成の名前が出る）
  expect(
    screen.getByRole('heading', { level: 2, name: /^1 か月目/ }).textContent,
  ).toContain(s.stack.split(' + ')[0]);
}

/**
 * 部品のスロットの行（チップの行。D-116）。構成図の表示なら「機能から選ぶ」に切り替えてから引く。label は見出しの先頭（「DB」は「DB のバックアップ」に当てない）、
 * by: 'slot' のときはスロットの id。
 */
export const slotGroup = (label: string, by: 'label' | 'slot' = 'label') => {
  // 始める画面・見積モードの部品の行は ① のタブの中（D-116 の補足）
  if (document.querySelector('[data-setup-tab-button]')) showStackTab();
  if (!document.querySelector('section[data-parts]')) showPartsList();
  const rows = [
    ...document.querySelectorAll<HTMLElement>(
      'section[data-parts] [data-slot]',
    ),
  ];
  const row =
    by === 'slot'
      ? rows.find((r) => r.getAttribute('data-slot') === label)
      : rows.find((r) =>
          new RegExp(`^${escape(label)}(?![^（])`).test(
            r.getAttribute('aria-label') ?? '',
          ),
        );
  expect(row, `部品のスロット ${label}`).toBeDefined();
  return row!;
};

/** 未決の提案の確認のダイアログ（D-140）。開いていなければ null。 */
export const declineConfirm = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('dialog[data-decline-confirm][open]');

/**
 * 「次の月へ」を押す。未決の提案があって確認（D-140）が出たら「断って進む」で進む（選ばなければ断る、の今までの進め方）。
 */
export function nextMonth() {
  fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
  const confirm = declineConfirm();
  if (confirm)
    fireEvent.click(
      within(confirm).getByRole('button', { name: '断って進む' }),
    );
}

/**
 * 「次の月へ」を n 回押す（行動は選ばない）。出来事のダイアログが自動で開いたら、最後のページまで送って中身が描けていることを見て閉じる。
 */
export function advance(n: number) {
  for (let i = 0; i < n; i++) {
    nextMonth();
    const dialog = screen.queryByRole('dialog');
    if (!dialog) continue;
    readEventPages(dialog);
    closeEventsDialog(dialog);
  }
}

/** 出来事のダイアログ（D-126）の今のページの位置（「2 / 4」）。 */
export const eventPosition = (dialog: HTMLElement) =>
  dialog.querySelector('[data-events-position]')!.textContent!.trim();

/**
 * 出来事のダイアログを 1 ページ目から最後まで「次へ」で送り、各ページの中身の文を返す（最後のページで止まる）。
 */
export function readEventPages(dialog: HTMLElement): string[] {
  within(dialog).getByRole('heading', { name: /か月目の出来事/ });
  const pages: string[] = [];
  for (let i = 0; i < 50; i++) {
    pages.push(dialog.querySelector('[data-events-page]')!.textContent!);
    // 1 件だけならナビは無い。最後のページでは「次へ」は押せない（位置を動かさないので消さない）
    const next = within(dialog).queryByRole<HTMLButtonElement>('button', {
      name: /^次へ/,
    });
    if (!next || next.disabled) break;
    fireEvent.click(next);
  }
  return pages;
}

/** 出来事のダイアログを閉じる（最後のページなら「閉じる」、途中なら「あとで見る（閉じる）」）。 */
export function closeEventsDialog(dialog: HTMLElement) {
  fireEvent.click(
    within(dialog).queryByRole('button', { name: '閉じる' }) ??
      within(dialog).getByRole('button', { name: 'あとで見る（閉じる）' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
}

/** ヘッダーの「新しいゲーム」を押し、確認のダイアログで「新しく始める」を押す（始める画面に戻る）。 */
export function restartFromHeader() {
  fireEvent.click(screen.getByRole('button', { name: '新しいゲーム' }));
  const dialog = screen.getByRole('dialog', {
    name: '新しいゲームを始めますか？',
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '新しく始める' }));
  expect(screen.queryByRole('dialog')).toBeNull();
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
