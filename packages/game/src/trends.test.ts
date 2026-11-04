// 推移と見込み（prd/07 §5・GD-1）。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyActions,
  DEFAULT_START_DATE,
  GAME,
  newGame,
  playMonth,
  projectionNote,
  SCENARIOS,
  type GameState,
} from './index.ts';
import { parseSave, replaySave } from './save.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';
import {
  extrapolate,
  isTrafficSpike,
  premiseTrends,
  selectTrends,
  type PremiseSnapshot,
} from './trends.ts';

const snap = (
  id: string,
  ratio: number,
  accumulates = false,
): PremiseSnapshot => ({
  id,
  text: id,
  effect: 'cost',
  ratio,
  hit: ratio > 1,
  accumulates,
});

describe('extrapolate', () => {
  it('流量は月ごとの倍率の平均で伸ばす', () => {
    const v = extrapolate([0.25, 0.5], false, 2);
    expect(v).toEqual([1, 2]);
  });

  it('ためていく量は月ごとの増分の平均で伸ばす', () => {
    const v = extrapolate([0.2, 0.3, 0.4], true, 2);
    expect(v[0]).toBeCloseTo(0.5, 12);
    expect(v[1]).toBeCloseTo(0.6, 12);
  });

  it('記録が 1 か月しかなければ見込まない', () => {
    expect(extrapolate([0.5], false, 3)).toEqual([]);
  });
});

describe('premiseTrends', () => {
  it('残りの期間内に超えるなら、何か月後かを出す', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12)[0]!;
    expect(t.monthsUntil).toBe(2); // 0.5 → 1.0（超えない）→ 2.0
  });

  it('見込みの線は今月から始まり、境目を越える最初の月で止まる', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12)[0]!;
    expect(t.projection.map((p) => p.month)).toEqual([2, 3, 4]);
    expect(t.projection[t.projection.length - 1]!.ratio).toBeGreaterThan(1);
  });

  it('見込みを出さない理由があれば、見込みを出さずに理由を残す（話題になった月など）', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12, {
      skipProjection: '話題の月',
    })[0]!;
    expect(t.monthsUntil).toBeNull();
    expect(t.projection).toEqual([]);
    expect(t.projectionNote).toBe('話題の月');
  });

  it('残りの期間を過ぎてから超えるなら出さない', () => {
    const t = premiseTrends([[snap('a', 0.1)], [snap('a', 0.11)]], 3)[0]!;
    expect(t.monthsUntil).toBeNull();
  });

  it('下がっている・すでに超えているなら見込まない', () => {
    expect(
      premiseTrends([[snap('a', 0.6)], [snap('a', 0.5)]], 12)[0]!.monthsUntil,
    ).toBeNull();
    expect(
      premiseTrends([[snap('a', 1.2)], [snap('a', 1.5)]], 12)[0]!.monthsUntil,
    ).toBeNull();
  });

  it('前の月の見込みより早く超えたら印を付ける（急増など）', () => {
    // 2 か月目までの見込みでは 12 か月以内に超えない（0.1 → 0.11）が、3 か月目に急増して超えた
    const t = premiseTrends(
      [[snap('a', 0.1)], [snap('a', 0.11)], [snap('a', 1.5)]],
      12,
    )[0]!;
    expect(t.hitNow).toBe(true);
    expect(t.earlierThanProjected).toBe(true);
  });

  it('構成を乗り換えて途切れた前提は、途切れた後の記録だけで見込む', () => {
    const t = premiseTrends([[snap('a', 0.4)], [], [snap('a', 0.45)]], 12)[0]!;
    expect(t.ratios).toEqual([0.4, null, 0.45]);
    expect(t.monthsUntil).toBeNull(); // 連続した記録が 1 か月だけ
  });
});

describe('一時的に流量が増えた月を見込みから除く（D-42 と同じ扱い）', () => {
  const series = (...rs: number[]) => rs.map((r) => [snap('a', r)]);

  it('話題の月の跳ねで外挿しない（基準にも比にも使わない）', () => {
    const months = series(0.3, 0.33, 0.9, 0.4);
    // 除かないと、0.33 → 0.9 の比と 0.9 → 0.4 の比が混ざって大きく伸ばす（2 か月後に超える）
    expect(premiseTrends(months, 12)[0]!.monthsUntil).toBe(2);
    const t = premiseTrends(months, 12, {
      spikes: [false, false, true, false],
    })[0]!;
    expect(t.excluded).toEqual([2]);
    expect(t.ratios[2]).toBe(0.9); // 線には描く
    // 0.33 → 0.4 は 2 か月で 1 か月あたり √(0.4 / 0.33)。0.3 → 0.33 の 1.1 倍と平均する
    const factor = (1.1 + Math.sqrt(0.4 / 0.33)) / 2;
    expect(t.projection[1]!.ratio).toBeCloseTo(0.4 * factor, 12);
    expect(t.monthsUntil).toBeNull(); // 月 1.1 倍ほどでは、残りの 8 か月で境目に届かない
  });

  it('ためていく量は、飛んだ月をはさむ増分を 1 か月あたりに直す', () => {
    const t = premiseTrends(
      [[snap('a', 0.2, true)], [snap('a', 0.5, true)], [snap('a', 0.4, true)]],
      12,
      { spikes: [false, true, false] },
    )[0]!;
    expect(t.projection[1]!.ratio).toBeCloseTo(0.5, 12); // 0.2 → 0.4 を 2 か月で（月 0.1）
  });

  it('除いた後に点が 2 つ未満なら見込みを出さない', () => {
    const t = premiseTrends(series(0.3, 0.9, 0.5), 12, {
      spikes: [true, true, false],
    })[0]!;
    expect(t.monthsUntil).toBeNull();
    expect(t.projection).toEqual([]);
    expect(t.excluded).toEqual([0, 1]);
  });

  it('前の月の見込み（見込みより早く超えた）も、除いた記録で数える', () => {
    // 前の月までの記録は 0.5 → 0.9（Bot の月）。除かなければ「来月超える」の見込みが立っていた
    const months = series(0.45, 0.5, 0.9, 1.2);
    expect(premiseTrends(months, 12)[0]!.earlierThanProjected).toBe(false);
    const t = premiseTrends(months, 12, {
      spikes: [false, false, true, false],
    })[0]!;
    expect(t.earlierThanProjected).toBe(true);
  });

  it('一時的に流量が増えた月が無ければ、渡しても渡さなくても同じ', () => {
    const months = series(0.2, 0.25, 0.31, 0.4);
    const a = premiseTrends(months, 12)[0]!;
    const b = premiseTrends(months, 12, { spikes: [false, false, false] })[0]!;
    expect(b).toEqual(a);
  });
});

describe('部品の差し替えで推移を区切る', () => {
  const part = (id: string, ratio: number, parts: string) => ({
    ...snap(id, ratio),
    parts,
  });

  it('効く部品の値が変わった月で区切り、見込みは区切りの後の記録だけで出す', () => {
    // 差し替えで 0.1 → 0.8 に跳んだ。段差ごと外挿すると「1 か月後に超える」と誤って出る
    const months = [
      [part('a', 0.1, 'images:images')],
      [part('a', 0.8, 'images:r2-variants')],
      [part('a', 0.82, 'images:r2-variants')],
    ];
    const t = premiseTrends(months, 12)[0]!;
    expect(t.breaks).toEqual([1]);
    expect(t.segmentStart).toBe(1);
    expect(t.monthsUntil).toBe(9); // 0.8 → 0.82 のペース（月 1.025 倍）なら 9 か月後
    // 区切りを無視すると（同じ記録で部品の値が同じなら）段差で見込んでしまう
    const joined = premiseTrends(
      months.map((m) => m.map(({ parts: _p, ...x }) => x)),
      12,
    )[0]!;
    expect(joined.breaks).toEqual([]);
    expect(joined.monthsUntil).toBe(1);
  });

  it('区切りの直後の月は前の月の見込みと比べない（見込みより早く超えた、と出さない）', () => {
    const t = premiseTrends(
      [
        [part('a', 0.1, 'x:1')],
        [part('a', 0.11, 'x:1')],
        [part('a', 1.5, 'x:2')],
      ],
      12,
    )[0]!;
    expect(t.hitNow).toBe(true);
    expect(t.earlierThanProjected).toBe(false);
  });

  it('区切りの前にだけ 50% を超えていた前提は、推移のグラフに出さない', () => {
    const trends = premiseTrends(
      [
        [part('a', 3.2, 'images:images')],
        [part('a', 0.3, 'images:r2-variants')],
        [part('a', 0.31, 'images:r2-variants')],
      ],
      12,
    );
    expect(selectTrends(trends)).toEqual([]);
  });
});

describe('selectTrends', () => {
  it('止まる前提 → 見込みで超える → 課金の前提 → 近い順に、上位だけ出す', () => {
    const block: PremiseSnapshot = { ...snap('block', 2), effect: 'block' };
    const trends = premiseTrends(
      [
        [
          snap('far', 0.1),
          snap('near', 0.8),
          snap('cost-hit', 1.5),
          block,
          snap('soon', 0.3),
        ],
        [
          snap('far', 0.1),
          snap('near', 0.8),
          snap('cost-hit', 1.6),
          block,
          snap('soon', 0.6),
        ],
      ],
      12,
    );
    expect(selectTrends(trends).map((t) => t.id)).toEqual([
      'block',
      'soon',
      'cost-hit',
      'near',
    ]);
  });
});

describe('ゲームの記録', () => {
  function playN(n: number): GameState {
    let s = playMonth(newGame(3));
    for (let i = 1; i < n; i++) s = playMonth(applyAction(s, { type: 'none' }));
    return s;
  }

  it('毎月、量の境目がある前提をすべて記録する', () => {
    const s = playN(3);
    for (const m of s.history) {
      expect(m.snapshots.length).toBeGreaterThan(0);
      expect(m.snapshots.every((p) => Number.isFinite(p.ratio))).toBe(true);
    }
  });

  it('Vercel Pro は月のクレジットの使用率を記録し、超える前に見込みが出る（受託・シード 2。D-48）', () => {
    let s = playMonth(newGame(3, 2, CONTRACT_OPERATIONS));
    for (let i = 1; i < 5; i++) s = playMonth(applyAction(s, { type: 'none' }));
    const trends = premiseTrends(
      s.history.map((m) => m.snapshots),
      CONTRACT_OPERATIONS.months,
    );
    const credit = trends.find(
      (t) => t.id === 'credit:vercel:pro:usage-credit',
    )!;
    // 止まらず請求が増える前提で、流量として伸び率で見込む
    expect(credit.effect).toBe('cost');
    expect(credit.accumulates).toBe(false);
    expect(credit.ratios.every((r) => r !== null && r > 0)).toBe(true);
    expect(credit.hitNow).toBe(false);
    expect(credit.monthsUntil).not.toBeNull();
  });

  it('記事コミュニティの Vercel Pro（CDN は従量）は 1 か月目からクレジットを超え、超えた分が請求される（D-48）', () => {
    const s = playMonth(
      newGame(3, 42, undefined, undefined, undefined, {
        cdnPlan: 'on-demand',
      }),
    );
    const p = s.history[0]!.snapshots.find(
      (x) => x.id === 'credit:vercel:pro:usage-credit',
    )!;
    expect(p.hit).toBe(true);
    expect(p.effect).toBe('cost');
    expect(s.phase).toBe('playing');
  });

  it('記事コミュニティの Vercel Pro は 1 か月目に Flat Rate CDN の込みの段を超え、翌月から上の段を払う（D-120）', () => {
    const s = playN(2);
    const [m1, m2] = s.history;
    const p = m1!.snapshots.find(
      (x) => x.id === 'capacity:vercel:pro:flat-rate-cdn',
    )!;
    expect(p).toMatchObject({ hit: true, effect: 'cost', accumulates: false });
    // 超えた月の請求は増えない（込みの段の月額 0）。翌月は上の段の月額
    const tierFee = (m: typeof m1) =>
      m!.lines
        .filter((l) => l.label.includes('Flat Rate CDN'))
        .reduce((a, l) => a + l.amount, 0);
    expect(tierFee(m1)).toBe(0);
    expect(tierFee(m2)).toBeGreaterThan(0);
    expect(s.capacityTiers?.vercel?.['flat-rate-cdn']).toBeDefined();
  });

  it('乗り換え中の Vercel Pro（乗り換え先）も、前の月の量で決まった段を払う（最初の月だけ込みの段。D-120）', () => {
    let s = playMonth(newGame(1, 42));
    s = playMonth(applyAction(s, { type: 'migrate', stackIndex: 3 }));
    expect(s.migration).not.toBeNull();
    s = playMonth(s);
    const [, first, second] = s.history;
    const tierFee = (m: typeof first) =>
      m!.lines
        .filter((l) => l.label.includes('Flat Rate CDN'))
        .reduce((a, l) => a + l.amount, 0);
    expect(tierFee(first)).toBe(0);
    expect(tierFee(second)).toBeGreaterThan(0);
  });
});

describe('画像の部品を r2-variants に替えたゲーム（シード 42・記事コミュニティ・Cloudflare Paid・Next.js）', () => {
  const ID = 'pool:cloudflare:images-paid:images-transformations';
  const sc = SCENARIOS['article-community']!;
  const trendsOf = (s: GameState) => {
    const note = projectionNote(s.history[s.history.length - 1]!);
    return premiseTrends(
      s.history.map((m) => m.snapshots),
      sc.months,
      {
        ...(note ? { skipProjection: note } : {}),
        spikes: s.history.map(isTrafficSpike),
      },
    );
  };

  /** 4 か月目の終わりに images を r2-variants に替え、months か月まで進める。 */
  function swapAfter4(months: number): GameState {
    let s = playMonth(newGame(1, 42, sc, DEFAULT_START_DATE, 'nextjs'));
    while (s.history.length < months) {
      if (s.history.length === 4)
        s = applyActions(s, [
          { type: 'component', slot: 'images', option: 'r2-variants' },
        ]);
      s = playMonth(s);
    }
    return s;
  }

  it('前提の文が部品で切り替わる（閲覧のときに変換 → 投稿のときに作るサイズ違い）', () => {
    const s = swapAfter4(5);
    const text = (m: number) =>
      s.history[m - 1]!.snapshots.find((p) => p.id === ID)!.text;
    expect(text(4)).toBe(
      'Images は月 5,000 の一意な変換まで込み（画像の種類 × サイズ違い）',
    );
    expect(text(5)).toBe(
      'Images は月 5,000 の一意な変換まで込み（投稿のときに作るサイズ違い: 投稿数 × サイズ違い × 形式）',
    );
    expect(s.history[3]!.snapshots.find((p) => p.id === ID)!.parts).toBe(
      'images:images',
    );
    expect(s.history[4]!.snapshots.find((p) => p.id === ID)!.parts).toBe(
      'images:r2-variants',
    );
  });

  it('差し替えた月で推移を区切り、差し替えの前の 300% 超えを理由に推移のグラフに残さない', () => {
    const s = swapAfter4(5);
    const t = trendsOf(s).find((x) => x.id === ID)!;
    expect(t.ratios[3]!).toBeGreaterThan(3); // 差し替えの前は境目の 3 倍超
    expect(t.latest).toBeLessThan(0.5);
    expect(t.breaks).toEqual([4]);
    expect(t.segmentStart).toBe(4);
    expect(t.monthsUntil).toBeNull();
    expect(selectTrends(trendsOf(s)).map((x) => x.id)).not.toContain(ID);
  });

  it('6 か月目（話題の月）は、差し替えの段差でも話題の伸びでも見込みを出さない', () => {
    const s = swapAfter4(6);
    const t = trendsOf(s).find((x) => x.id === ID)!;
    expect(t.breaks).toEqual([4]);
    expect(t.monthsUntil).toBeNull();
    expect(t.projection).toEqual([]);
  });

  it('7 か月目は、6 か月目（話題の月）の跳ねで「2 か月後に超える」と見込まない', () => {
    const s = swapAfter4(7);
    expect(isTrafficSpike(s.history[5]!)).toBe(true);
    const t = trendsOf(s).find((x) => x.id === ID)!;
    expect(t.ratios[5]!).toBeGreaterThan(0.9); // 線には描く
    expect(t.excluded).toEqual([5]);
    expect(t.monthsUntil).not.toBe(2);
    expect(t.monthsUntil).toBe(5); // 5 → 7 か月目の 1 か月あたりの伸び
  });

  /** ユーザーの保存（1 か月目に Bot の遮断と最適化、2 か月目の終わりに r2-variants と AVIF に替えた）。 */
  const replayed = () =>
    replaySave(
      parseSave({
        version: 4,
        scenarioId: 'article-community',
        stackIndex: 1,
        framework: 'nextjs',
        seed: 42,
        startDate: '2026-11-04',
        components: {
          isrCache: 'workers-cache',
          images: 'images',
          db: 'd1',
          email: 'default',
        },
        revalidateSec: 0,
        turns: [
          [{ type: 'block-bots' }, { type: 'optimize' }],
          [
            { type: 'component', slot: 'images', option: 'r2-variants' },
            { type: 'set', key: 'format', value: 84 },
          ],
          [],
        ],
      })!,
    );

  it('保存から再生したゲーム（3 か月目に r2-variants と AVIF に替えた）も、替えた月で区切る', () => {
    const t = trendsOf(replayed()).find((x) => x.id === ID)!;
    expect(t.breaks).toEqual([2]);
    expect(t.segmentStart).toBe(2);
    expect(t.monthsUntil).toBeNull();
  });

  it('保存から再生したゲームを 7 か月目まで進めても、話題の月の跳ねで「1 か月後に超える」と見込まない', () => {
    let s = replayed();
    while (s.history.length < 7) s = playMonth(s);
    const t = trendsOf(s).find((x) => x.id === ID)!;
    expect(t.ratios[5]!).toBeGreaterThan(1); // 6 か月目は話題の月
    expect(t.excluded).toContain(5);
    expect(t.monthsUntil).not.toBe(1);
  });

  it('一時的に流量が増えた月より前は、除いても見込みが変わらない', () => {
    let s = playMonth(newGame(1, 42, sc, DEFAULT_START_DATE, 'nextjs'));
    while (s.history.length < 10) {
      const h = s.history;
      const plain = premiseTrends(
        h.map((m) => m.snapshots),
        sc.months,
      );
      const withSpikes = premiseTrends(
        h.map((m) => m.snapshots),
        sc.months,
        { spikes: h.map(isTrafficSpike) },
      );
      for (const [k, t] of withSpikes.entries())
        if (t.excluded.length === 0)
          expect(t).toEqual({ ...plain[k]!, excluded: [] });
      s = playMonth(s);
    }
  });

  it('部品を替えないゲームでは区切らない（推移も見込みも前と同じ）', () => {
    let s = playMonth(newGame(1, 42, sc, DEFAULT_START_DATE, 'nextjs'));
    while (s.history.length < 8) s = playMonth(s);
    for (let n = 1; n <= s.history.length; n++) {
      const trends = premiseTrends(
        s.history.slice(0, n).map((m) => m.snapshots),
        sc.months,
      );
      for (const t of trends) {
        expect(t.breaks).toEqual([]);
        // 最後の区間の前は記録の無い月だけ（50% の判定・見込みは前と同じ記録で行う）
        expect(t.ratios.slice(0, t.segmentStart).every((r) => r === null)).toBe(
          true,
        );
      }
    }
  });
});
