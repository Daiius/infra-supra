// ゲームの再現性（企画書 §10「同じシナリオ・同じシード・同じ行動なら同じ結果」）と、GD-2 の基準プレイの golden（prd/07 §9.7）。
import { describe, expect, it } from 'vitest';
import { composeStack } from 'catalog';
import {
  actionEffort,
  applyAction,
  applyActions,
  averageSatisfaction,
  BASELINES,
  comparisonRows,
  EFFORT,
  effortAvailable,
  GAME,
  newGame,
  playMonth,
  playStrategy,
  policyStep,
  type Action,
  type GameState,
  withoutDomainRegistration,
} from './index.ts';

function play(stackIndex: number, actions: Action[][], seed = 42): GameState {
  return playStrategy({ id: 't', label: 't', stackIndex, actions }, seed);
}
/** n か月進めた状態（各月の終わりに actions[i] を選ぶ）。 */
function playUntil(
  stackIndex: number,
  months: number,
  actions: Action[][] = [],
  seed = 42,
): GameState {
  let s = playMonth(newGame(stackIndex, seed));
  for (let i = 0; i < months - 1 && s.phase === 'playing'; i++)
    s = playMonth(applyActions(s, actions[i] ?? []));
  return s;
}

const CF_FREE = 0;
const CF_PAID = 1;
const HOBBY = 2;
const VERCEL_PRO = 3;
const VPS = 4;

describe('game', () => {
  it('同じシード・同じ行動なら同じ結果', () => {
    const a = play(VPS, [[{ type: 'optimize' }]], 3);
    const b = play(VPS, [[{ type: 'optimize' }]], 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('12 か月で終わる', () => {
    expect(play(CF_PAID, []).history).toHaveLength(12);
  });

  it('GD-4 の基準プレイ（golden。シード 42・SLA の打診が来るシード 3・記事の引き取りが来るシード 31）', () => {
    // GD-2 → GD-3 の差は規模の見直し（30 万 PV・月 12%・話題 × 3）と出来事（prd/07 §10.6・§10.8・PR 本文）。
    // GD-3 → GD-4 の差はチャットの提案（全部受ける ② が受ける）と、まれな出来事の候補に SLA の打診を足したこと（prd/07 §11.7）
    // D-32: 即時反映の提案（全部受ける ② が受け、KV の ISR では満たせず反映スピードが下がる）
    // D-28: 話題と Bot は 50% で予告なし（話題の前兆 PV × 1.2 が無いシード・Bot の前兆が増えたシードで値が変わる。月は変わらない）
    // D-47 追記: 速さが「悪い」月は PV の伸びが 3% 下がる（VPS は話題の月の回線の詰まり・KV を DB に はキーの書き込みで遅い月）
    // D-47: 記事のデザインの刷新の提案（シード 42 は 7 か月目・3 は 10 か月目・31 は無し）を断り、2 か月画質が下がる（所持金だけ下がる）
    // D-44: 話題（2 日）・Bot（7 日）の上乗せが短い期間に集中し、VPS の回線・KV の同じキーへの書き込みが話題の月に詰まる（課金は同じ）
    // D-37: Vercel の CDN の ISR のページのヒット率を固定の 0.8 から再生成の数と同じ式に（ISR の読み取りと FOT が増え、Vercel の構成の所持金が減る。結果は変わらない）
    // D-46: Vercel の画像の原本を Vercel Blob に（保存量・アップロード・転送の課金。Vercel の構成と乗り換え先が Vercel の基準プレイの所持金が数ドル減る。結果は変わらない）
    // D-48: Vercel Pro の込み分（CDN Requests 1,000 万・Fast Data Transfer 1 TB）をやめ、$20 のクレジットがすべての従量に当たる形に。
    //       Vercel Pro・何もしないは Fast Data Transfer の課金で所持金が約 $900 減る。Vercel で始めて乗り換える基準プレイは、乗り換えまでの 3 か月分が減り、シード 3・31 で合格 → 不合格
    // D-49: 即時反映の提案（全部受ける ② が受ける）で再検証がオンデマンドになり再生成が減る・作業の手間 3 → 2（所持金が増える。結果は変わらない）
    // D-56: オンデマンドに最大寿命 1 日の時間の再検証を足し、再生成が増える（提案を受けたあとの全部受ける ② の所持金が少し減る。結果は変わらない）
    // D-58: Next.js の画像の部品（Vercel）は既定で WebP を配る（JPEG より小さく、Fast Data Transfer が減って Vercel の構成の所持金が増える。CF・VPS の値は変わらない）
    // D-62: Cloudflare Images の閲覧のときの変換も WebP で配る。CF Paid・既定の所持金・結果は変わらない（R2 の転送は無料で、変換の数も形式で増えない）。
    //       KV を DB の代わりにする基準プレイは、ページが軽くなり速さが「悪い」月が減って所持金が増える（シード 42・3。31 は変わらない）
    // D-64: 構成に合った対策の基準プレイを 4 本足した（既存の行は変わらない）
    // D-66: OpenNext の再検証の関数（Lambda）と S3 の ISR のキャッシュの保存量を数えた（OpenNext・画像の最適化の所持金が $1.2〜1.6 減る。結果は変わらない）
    // D-70: 記事のページを作り直す更新を記事の投稿・編集だけに（書き込みの 0.5 → 0.01）。オンデマンドの再生成が減り、
    //       提案を受けてオンデマンドになる全部受ける ② の所持金が少し増える（シード 3・31。42 は変わらない）
    // D-95: メールの送信（CF Paid は Email Service・ほかは SES）の費用。シード 42 の VPS・SLA とシード 3 の Vercel Pro → CF Paid が won → goal
    // D-96: ドメインの登録（.com の原価 $11.17 / 年の月割り）と DNS（AWS は Route 53・Google Cloud は Cloud DNS）。所持金が $11〜17 減り、
    //       シード 3 の VPS・前段の CDN が won → goal
    // D-107: ページごとの描き方の基準プレイを 2 本足した（個人向けを枠 + API で始める。既存の行は変わらない）。
    //       CF Free は記事の ISR の再生成（17 ms）が 10 ms を超えるので変わらず止まる。CF Paid は既定とほぼ同じ
    // D-111: Vercel × Next.js の既定を部品ごとにキャッシュに（個人向けのページの CPU・DB の問い合わせが穴の分だけに）。
    //       Vercel で遊ぶ行（vercel-pro・vercel-cf-images・1 か月目だけ Vercel の vercel-to-cf・途中で Vercel へ乗り換える
    //       cf-paid-accept のシード 31）だけが $0.2〜4 増える。目標の根拠の cf-paid は変わらない
    // D-117: メールの通数から Bot の PV を除いた（Bot の月のメールの費用が減り、所持金が $0.3〜7 増える。結果は変わらない）
    // D-120: Vercel Pro の CDN を既定の Flat Rate CDN（段の定額・翌月から上の段）に、CDN・FOT・画像を東京（hnd1）の単価に。
    //       Vercel Pro・何もしないは $237〜335 増える（CDN の転送が段に込み）、Vercel の画像を Cloudflare に出す行は −$4〜+$4。Vercel で始めて乗り換える行は $0.9〜34 増（乗り換えるまでの月）、
    //       途中で Vercel へ乗り換える cf-paid-accept のシード 31 は $1,053 増えて goal → won（乗り換え中も乗り換え先が前の月の段を払う）。CF・VPS・AWS の行は変わらない
    // D-121（D-120 の上で取り直した）: 画像を記事のページの本文 5 枚・サムネイル 4 枚に分け（ブラウザの再利用 0.2・0.5）、記事の閲覧を
    //        Zipf（指数 1）で偏らせた。所持金は Vercel Pro・何もしないが $36〜41・画像だけ Cloudflare が $20〜40・AWS の行が
    //        $8〜11・CF の行は $0.1〜6 増える。シード 31 の cf-paid-accept（乗り換え先の Vercel）は $38 増える。結果は変わらない
    // D-58 の補足（2026-11-04）: Cloudflare の構成の Images（バインディング）を「WebP とみなす」のをやめ、選んだ形式（既定は JPEG）で数える。
    //        KV を DB の代わりにする行だけが、ページが重くなり速さが「悪い」月が増えて所持金が減る（シード 42: $64・3: $56。31 と結果は変わらない）
    // D-125: 再検証の既定を、オンデマンドが選べる構成ではオンデマンドに（Vercel・VPS・AWS。CF は既定の ISR のキャッシュが KV で
    //        選べないので 5 分のまま・変わらない）。Vercel Pro・何もしないは $70〜122・画像だけ Cloudflare は $23〜69・VPS の行は $18〜50 増え、
    //        OpenNext は CloudFront の無効化の分 $79〜111 減る。Vercel から CF へ乗り換える行は、乗り換え先の KV にオンデマンドが届かず
    //        $87〜94 減る。シード 42 の VPS・SLA とシード 3 の VPS・前段の CDN が goal → won
    // D-131: 合否をやめ、12 か月を走り切った行の終わり方は won・goal でなく completed（所持金・月は 1 セントも変わらない）
    // D-211: 転送の大きさを圧縮後に（HTML 60 → 9・API 5 → 1.5 kB など）。転送の費用が減り、所持金が増える: AWS（Amplify）$80〜88・VPS の画像・SLA $82〜100
    //        ・Vercel Pro $4〜24・Vercel へ乗り換える cf-paid-accept（シード 3）$129。CF の行は変わらない
    // D-212: App Router の文書の倍率（記事の HTML 9 → 22.5 kB）。AWS（Amplify）は $20〜22・cf-paid-accept（シード 3）は $30 減る。
    //        シード 3 の VPS・SLA は D-211 の前と同じ $1,664.14 に戻る（VPS は転送の課金が無く、文書が大きくなった分の結果の違い）
    const r = (seed: number) =>
      Object.fromEntries(
        BASELINES.map((b) => {
          const s = playStrategy(b, seed);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect(r(42)).toEqual({
      'cf-paid': ['2087.94', 'completed', 12],
      'cf-paid-accept': ['2169.41', 'completed', 12],
      'vps-images': ['1886.39', 'completed', 12],
      'vercel-pro': ['1373.87', 'completed', 12],
      'vercel-to-cf': ['1551.79', 'completed', 12],
      'cf-free': ['139.10', 'outages', 3],
      'cf-paid-kvdb': ['1851.43', 'completed', 12],
      'cf-paid-chat': ['2117.38', 'completed', 12],
      'vps-sla': ['1831.70', 'completed', 12],
      'vps-cdn': ['1811.35', 'completed', 12],
      'vercel-cf-images': ['1451.72', 'completed', 12],
      'aws-amplify-cdn': ['1994.79', 'completed', 12],
      'aws-opennext-images': ['2145.45', 'completed', 12],
      'cf-free-personal-api': ['139.10', 'outages', 3],
      'cf-paid-personal-api': ['2088.02', 'completed', 12],
    });
    expect(r(3)).toEqual({
      'cf-paid': ['2115.72', 'completed', 12],
      'cf-paid-accept': ['2135.97', 'completed', 12],
      'vps-images': ['1809.26', 'completed', 12],
      'vercel-pro': ['1213.27', 'completed', 12],
      'vercel-to-cf': ['1605.65', 'completed', 12],
      'cf-free': ['139.10', 'outages', 3],
      'cf-paid-kvdb': ['1880.35', 'completed', 12],
      'cf-paid-chat': ['2145.58', 'completed', 12],
      'vps-sla': ['1918.23', 'completed', 12],
      'vps-cdn': ['1771.65', 'completed', 12],
      'vercel-cf-images': ['1371.13', 'completed', 12],
      'aws-amplify-cdn': ['1984.79', 'completed', 12],
      'aws-opennext-images': ['2159.24', 'completed', 12],
      'cf-free-personal-api': ['139.10', 'outages', 3],
      'cf-paid-personal-api': ['2116.16', 'completed', 12],
    });
    expect(r(31)).toEqual({
      'cf-paid': ['2127.98', 'completed', 12],
      'cf-paid-accept': ['2246.75', 'completed', 12],
      'vps-images': ['1692.05', 'completed', 12],
      'vercel-pro': ['1206.93', 'completed', 12],
      'vercel-to-cf': ['1574.70', 'completed', 12],
      'cf-free': ['139.10', 'outages', 3],
      'cf-paid-kvdb': ['1851.40', 'completed', 12],
      'cf-paid-chat': ['2152.40', 'completed', 12],
      'vps-sla': ['1664.14', 'completed', 12],
      'vps-cdn': ['1712.25', 'completed', 12],
      'vercel-cf-images': ['1444.79', 'completed', 12],
      'aws-amplify-cdn': ['1958.48', 'completed', 12],
      'aws-opennext-images': ['2135.69', 'completed', 12],
      'cf-free-personal-api': ['139.10', 'outages', 3],
      'cf-paid-personal-api': ['2128.43', 'completed', 12],
    });
  });

  it('既定の構成・何もしないなら満足度は 0.9（評判も 0.9・成長 12%）', () => {
    const s = playUntil(CF_PAID, 3);
    const m = s.history[2]!.satisfaction;
    expect(m.score).toBeCloseTo(0.9);
    expect(m.reputation).toBeCloseTo(0.9);
    expect(m.growth).toBeCloseTo(0.12);
  });
});

describe('止まった月と規約違反（D-19）', () => {
  it('止まった月の上限（2 回）を超えた月でゲームオーバー', () => {
    const s = play(CF_FREE, []);
    expect(s.phase).toBe('lost');
    expect(s.end).toEqual({ reason: 'outages', month: 3 });
    expect(s.outages).toBe(GAME.goal.maxOutageMonths + 1);
  });

  it('止まった月は可用性が「悪い」で、純成長率が負', () => {
    const r = playUntil(CF_FREE, 1).history[0]!;
    expect(r.status).toBe('down');
    expect(r.satisfaction.stages.availability).toBe('bad');
    expect(r.satisfaction.growth).toBeLessThan(0);
  });

  it('規約違反は最初の月に指摘、翌月も違反したままならアカウント停止', () => {
    const first = playUntil(HOBBY, 1);
    expect(first.phase).toBe('playing');
    expect(first.history[0]!.policyWarning).toBe(true);
    const s = play(HOBBY, []);
    expect(s.end).toEqual({ reason: 'policy', month: 2 });
  });

  it('指摘の月にプラン変更すれば続けられる', () => {
    const s = play(HOBBY, [[{ type: 'plan', stackIndex: VERCEL_PRO }]]);
    expect(s.end?.reason).not.toBe('policy');
    expect(s.history).toHaveLength(12);
  });

  it('指摘の月に乗り換えを始めれば、乗り換えの期間中は停止されない', () => {
    // Hobby は画像の上限にも当たって止まるので、停止の上限で終わる（規約違反では終わらない）
    const s = play(HOBBY, [[{ type: 'migrate', stackIndex: CF_PAID }]]);
    expect(s.end?.reason).toBe('outages');
    expect(s.history[1]!.notes.join()).toContain('猶予中');
  });

  it('規約違反の判定（純粋関数）', () => {
    const base = { warnedMonth: null, violating: true, migrating: false };
    expect(policyStep({ ...base, month: 1 })).toEqual({
      warnedMonth: 1,
      outcome: 'warned',
    });
    expect(policyStep({ ...base, warnedMonth: 1, month: 2 }).outcome).toBe(
      'suspended',
    );
    expect(
      policyStep({ ...base, warnedMonth: 1, migrating: true, month: 2 })
        .outcome,
    ).toBe('grace');
    expect(
      policyStep({ ...base, warnedMonth: 1, violating: false, month: 2 }),
    ).toEqual({ warnedMonth: null, outcome: 'ok' });
  });
});

describe('開発の手間と行動', () => {
  it('VPS は毎月の機能開発が維持の分だけ少ない', () => {
    const cf = playUntil(CF_PAID, 2).history[1]!.effort;
    const vps = playUntil(VPS, 2).history[1]!.effort;
    expect(cf.feature - vps.feature).toBe(EFFORT.selfHostedUpkeep);
    expect(vps.upkeep).toBe(EFFORT.selfHostedUpkeep);
  });

  it('プラン変更は手間 0・翌月から。乗り換えは別の行動', () => {
    const s = playUntil(CF_FREE, 1);
    expect(actionEffort(s, { type: 'plan', stackIndex: CF_PAID })).toBe(0);
    expect(actionEffort(s, { type: 'migrate', stackIndex: CF_PAID })).toBe(
      null,
    );
    expect(actionEffort(s, { type: 'plan', stackIndex: VPS })).toBe(null);
    const next = playMonth(
      applyAction(s, { type: 'plan', stackIndex: CF_PAID }),
    );
    expect(next.history[1]!.stackName).toContain('Paid');
  });

  it('乗り換えは数か月かかり、期間中は新旧両方の費用を払う', () => {
    const acts: Action[][] = [[{ type: 'migrate', stackIndex: CF_PAID }]];
    const s = playUntil(VERCEL_PRO, 4, acts);
    const [m1, m2, m3, m4] = s.history;
    expect(m1!.parallelInfraCost).toBe(0);
    expect(m2!.migration).toBeDefined();
    expect(m2!.parallelInfraCost).toBeGreaterThan(0);
    expect(m2!.effort.migration).toBe(EFFORT.migrationPerMonth);
    expect(m3!.stackName).toContain('Vercel');
    // サーバーレス同士は 2 か月。4 か月目が切り替えの月（可用性は普通）
    expect(m4!.stackName).toContain('Cloudflare');
    expect(m4!.satisfaction.stages.availability).toBe('fair');
  });

  it('乗り換え中の新しい構成ではドメインの登録料を数えない（同じ .com 1 つ。DNS のゾーンは残す。D-96・OCL-A580D510）', () => {
    const aws = composeStack('aws-amplify');
    const kinds = (a: typeof aws) => a.nodes.map((n) => n.config.kind);
    expect(kinds(aws)).toContain('domain-registration');
    const target = withoutDomainRegistration(aws);
    expect(kinds(target)).not.toContain('domain-registration');
    expect(kinds(target)).toContain('dns-zone');
    expect(target.nodes).toHaveLength(aws.nodes.length - 1);
    // 乗り換え中の明細（旧構成 + 並行の新構成）で、登録料は旧構成の $11.17 / 12 の 1 回だけ
    const s = playUntil(VERCEL_PRO, 2, [
      [{ type: 'migrate', stackIndex: CF_PAID }],
    ]);
    const m2 = s.history[1]!;
    const own = m2.lines.filter((l) => l.provider === 'registrar');
    expect(own.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(11.17 / 12, 9);
    expect(m2.parallelInfraCost).toBeGreaterThan(0);
  });

  it('VPS への乗り換えは 3 か月', () => {
    const s = playUntil(CF_PAID, 5, [[{ type: 'migrate', stackIndex: VPS }]]);
    expect(s.history[3]!.stackName).toContain('Cloudflare');
    expect(s.history[4]!.stackName).toContain('VPS');
  });

  it('手間が足りない行動は選べない（状態を変えない）', () => {
    const s = playUntil(VPS, 1); // 維持 3 → 行動に 7
    expect(effortAvailable(s)).toBe(7);
    const once = applyAction(s, { type: 'optimize' });
    expect(effortAvailable(once)).toBe(3);
    expect(applyAction(once, { type: 'optimize' })).toBe(once);
  });

  it('設定は戻せる: 画像を AVIF にしても画質は「良い」のまま、JPEG に戻せる（D-58）', () => {
    const s = playUntil(CF_PAID, 3, [
      [{ type: 'set', key: 'format', value: 84 }],
      [{ type: 'set', key: 'format', value: 150 }],
    ]);
    expect(s.history[1]!.settings.imageKB).toBe(84);
    expect(s.history[1]!.satisfaction.stages.quality).toBe('good');
    expect(s.history[2]!.settings.imageKB).toBe(150);
    expect(s.history[2]!.satisfaction.stages.quality).toBe('good');
  });

  it('同じ設定への変更・同じ構成への乗り換えは何もしない', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(applyAction(s, { type: 'set', key: 'format', value: 150 })).toBe(s);
    expect(applyAction(s, { type: 'migrate', stackIndex: CF_PAID })).toBe(s);
  });

  it('機能開発が進むと SSR が重くなる', () => {
    const s = play(CF_PAID, []);
    expect(s.history[0]!.ssrCpuMs).toBe(GAME.baseSsrCpuMs);
    expect(s.history[11]!.ssrCpuMs).toBeGreaterThan(GAME.baseSsrCpuMs);
  });

  it('満足度は 0〜1 で、合否は平均と停止の回数も見る', () => {
    const s = play(VPS, [], 7);
    for (const r of s.history) {
      expect(r.satisfaction.score).toBeGreaterThanOrEqual(0);
      expect(r.satisfaction.score).toBeLessThanOrEqual(1);
    }
    expect(averageSatisfaction(s.history)).toBeLessThan(0.9);
  });
});

describe('結果の比較の表', () => {
  it('行の名前は「あなた」と基準プレイの短い名前', () => {
    const rows = comparisonRows(play(CF_PAID, []));
    expect(rows.map((r) => r.name)).toEqual([
      'あなた',
      'CF Paid・何もしない',
      'CF Paid・開発依頼を受ける',
      'VPS・画像の開発依頼を受ける',
      'Vercel Pro・何もしない',
      'Vercel Pro → CF Paid',
      'CF Free・何もしない',
      'CF Paid・KV を DB 代わり',
      'CF Paid・チャットを受ける',
      'VPS・SLA に応える',
      'VPS・前段の CDN',
      'Vercel Pro・画像だけ Cloudflare',
      'Amplify・前段の CloudFront + 定額',
      // 'OpenNext・画像の最適化' は隠した構成なので出さない（D-100）
      'CF Free・個人向けを枠 + API',
      'CF Paid・個人向けを枠 + API',
    ]);
    expect(rows[5]!.description).toBe(BASELINES[4]!.label);
  });
});
