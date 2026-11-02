// 見積モードの計算と入力の扱い（D-73）。
import { describe, expect, it } from 'vitest';
import {
  compareStacks,
  costCurves,
  CURVE_PVS,
  curveColorSlot,
  defaultCurveStacks,
  pickedCurveStacks,
  fromQuery,
  japanTax,
  normalizeInput,
  normalizeSeats,
  runEstimate,
  sortRows,
  toQuery,
  withStack,
} from './model.ts';

describe('normalizeInput', () => {
  it('空の入力は記事コミュニティ・始めた月の PV・既定のフレームワークと一覧の最初の構成', () => {
    const i = normalizeInput({});
    expect(i.template).toBe('article');
    expect(i.pv).toBe(300_000);
    expect(i.framework).toBe('nextjs');
    expect(i.stack).toBe('cloudflare-vinext-free');
    expect(i.revalidateSec).toBe(300);
  });

  it('載せられない構成（Astro × AWS）は、載せられる最初の構成にする', () => {
    const i = normalizeInput({ framework: 'astro', stack: 'aws-amplify' });
    expect(i.stack).not.toBe('aws-amplify');
  });

  it('選べない値は既定にし、PV は範囲に収める', () => {
    const i = normalizeInput({
      template: 'business',
      pv: 1e12,
      revalidateSec: 7,
      imageFormat: 'avif',
      parts: { images: 'none' },
    });
    expect(i.pv).toBe(100_000_000);
    expect(i.revalidateSec).toBe(300);
    // 業務アプリは画像の形式・画像の部品を出さない
    expect(i.imageFormat).toBe('jpeg');
    expect(i.parts.images).toBeUndefined();
  });
});

describe('明細の行の名前（D-75）', () => {
  it('料金データの表示名を使う（ID のままにしない）', () => {
    const v = runEstimate(
      normalizeInput({ stack: 'vercel-supabase-pro', pv: 1_000_000 }),
    );
    const labels = v.providers.flatMap((p) => p.lines.map((l) => l.label));
    expect(labels).toContain('基本料（Vercel Pro: 1 席ごと）');
    expect(labels).toContain('CDN の転送（Vercel: Fast Data Transfer）');
    expect(labels.filter((l) => !/（.+）$/.test(l))).toEqual([]);
  });
});

describe('URL のクエリ', () => {
  it('書いて読むと同じ入力に戻る', () => {
    const i = normalizeInput({
      template: 'article',
      pv: 1_000_000,
      framework: 'vite-spa',
      stack: 'vercel-supabase-pro',
      imageFormat: 'webp',
      variants: 2,
      revalidateSec: 3600,
      seats: 3,
      showTax: false,
    });
    expect(normalizeInput(fromQuery(`?${toQuery(i)}`))).toEqual(i);
  });

  it('コメントの描き方（D-82）: 書いて読むと戻り、SPA・業務アプリでは既定（ブラウザで読み込む）', () => {
    const i = normalizeInput({ framework: 'astro', comments: 1 });
    expect(i.comments).toBe(1);
    expect(normalizeInput(fromQuery(`?${toQuery(i)}`))).toEqual(i);
    expect(
      normalizeInput({ framework: 'vite-spa', comments: 1 }).comments,
    ).toBe(0);
    expect(normalizeInput({ template: 'business', comments: 1 }).comments).toBe(
      0,
    );
    // 時間の再検証で記事のページに含めると、記事を開いたときのコメントの取得（API の関数）が無くなり安くなる
    const usd = (comments: number) =>
      runEstimate(
        normalizeInput({
          stack: 'vercel-supabase-pro',
          pv: 3_000_000,
          comments,
        }),
      ).totalUsd;
    expect(usd(1)).toBeLessThan(usd(0));
  });

  it('選んでも変わらない部品（D1 の DB のバックアップ）の値が URL に残っていても無視して既定で見積もる（D-94）', () => {
    const d1 = (q: string) =>
      normalizeInput(fromQuery(`?t=business&s=cloudflare-vinext-paid${q}`));
    for (const v of ['pitr', 'nope']) {
      const i = d1(`&c.dbBackup=${v}`);
      expect(i.parts.dbBackup).toBeUndefined();
      expect(runEstimate(i).totalUsd).toBe(runEstimate(d1('')).totalUsd);
      expect(toQuery(i).has('c.dbBackup')).toBe(false);
    }
    // 選べば変わる DB（Supabase Pro）では残り、見積に効く
    const pro = (v: string) =>
      normalizeInput(
        fromQuery(`?t=business&s=vercel-supabase-pro&c.dbBackup=${v}`),
      );
    expect(pro('pitr').parts.dbBackup).toBe('pitr');
    expect(runEstimate(pro('pitr')).totalUsd).toBeGreaterThan(
      runEstimate(pro('default')).totalUsd,
    );
  });

  it('メール送信（D-95）: 既定は CF Paid が Email Service・ほかは SES で、Resend に替えると Resend の請求が増える', () => {
    const at = (s: string, q = '') =>
      runEstimate(normalizeInput(fromQuery(`?t=business&s=${s}${q}`)));
    const providers = (v: ReturnType<typeof at>) =>
      v.providers.map((p) => p.provider);
    const cf = at('cloudflare-vinext-paid');
    expect(
      cf.providers
        .find((p) => p.provider === 'cloudflare')!
        .lines.some((l) => l.label.startsWith('メールの送信')),
    ).toBe(true);
    expect(providers(at('gcp-cloud-run'))).toContain('aws');
    const pro = at('gcp-cloud-run', '&c.email=resend-pro');
    expect(providers(pro)).toContain('resend');
    expect(providers(pro)).not.toContain('aws');
    expect(pro.totalUsd).toBeGreaterThan(at('gcp-cloud-run').totalUsd);
    // Resend Free は受託の規模で 1 日 100 通を超え、止まる前提に当たる
    expect(
      at('gcp-cloud-run', '&c.email=resend-free').thresholds.find(
        (p) => p.id === 'pool:resend:free:free-daily',
      ),
    ).toMatchObject({ hit: true });
  });

  it('読めない値は捨てる', () => {
    const q = fromQuery('?pv=abc&c.nope=x&c.images=none');
    expect(q.pv).toBeUndefined();
    expect(q.parts).toEqual({ images: 'none' });
  });
});

describe('runEstimate', () => {
  it('合計は事業者の小計の和（円建ては為替の仮定で換算）', () => {
    const v = runEstimate(normalizeInput({ stack: 'sakura-vps-2gb' }));
    const usd = v.providers.reduce(
      (a, p) => a + (p.currency === 'JPY' ? p.subtotal / 150 : p.subtotal),
      0,
    );
    expect(v.totalUsd).toBeCloseTo(usd, 9);
    expect(v.totalJpy).toBeCloseTo(v.totalUsd * 150, 6);
  });

  it('出典は使った事業者だけで、URL と取得日を持つ', () => {
    const v = runEstimate(normalizeInput({ stack: 'vercel-supabase-pro' }));
    // メール送信（D-95）の既定の Amazon SES の分、AWS も入る
    expect(v.sources.map((s) => s.provider).sort()).toEqual(
      ['aws', 'supabase', 'vercel'].sort(),
    );
    for (const s of v.sources) {
      expect(s.links.length).toBeGreaterThan(0);
      for (const l of s.links) expect(l.url).toMatch(/^https:\/\//);
    }
  });

  it('前提の使用率は高い順で、超えたものは hit', () => {
    const v = runEstimate(
      normalizeInput({ stack: 'cloudflare-vinext-free', pv: 10_000_000 }),
    );
    const ratios = v.thresholds.map((p) => p.ratio ?? 0);
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    expect(v.thresholds.some((p) => p.hit)).toBe(true);
  });
});

describe('compareStacks', () => {
  it('フレームワークを載せられる全構成を並べ、選んだ構成の月額は見積と同じ', () => {
    const i = normalizeInput({ stack: 'cloudflare-vinext-paid' });
    const rows = compareStacks(i);
    expect(rows.length).toBeGreaterThanOrEqual(11);
    const cur = rows.find((r) => r.current)!;
    expect(cur.totalUsd).toBeCloseTo(runEstimate(i).totalUsd, 9);
    const astro = compareStacks(normalizeInput({ framework: 'astro' }));
    expect(astro.some((r) => r.stack.startsWith('aws'))).toBe(false);
    // Next.js の静的書き出し（D-80）: AWS は S3 + CloudFront に載り、OpenNext は使わない。Vercel・VPS の画像は投稿のときに縮める
    const ex = compareStacks(normalizeInput({ framework: 'nextjs-export' }));
    expect(ex.some((r) => r.stack === 'aws-amplify')).toBe(true);
    expect(ex.some((r) => r.stack.startsWith('aws-opennext'))).toBe(false);
    const v = normalizeInput({
      framework: 'nextjs-export',
      stack: 'vercel-supabase-pro',
    });
    expect(v.parts.images).toBe('resize');
    expect(runEstimate(v).totalUsd).toBeGreaterThan(0);
  });

  it('並べ替え: 費用の安い順・高い順', () => {
    const rows = compareStacks(normalizeInput({}));
    const asc = sortRows(rows, 'cost').map((r) => r.totalUsd);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(sortRows(rows, 'cost', true).map((r) => r.totalUsd)).toEqual(
      [...asc].reverse(),
    );
  });
});

describe('withStack', () => {
  it('今の構成を選び直しても部品を保ち、別の構成に替えるときだけ既定に戻す（OCL-83383F50）', () => {
    const i = normalizeInput({
      stack: 'cloudflare-vinext-paid',
      parts: { isrCache: 'workers-cache' },
    });
    expect(i.parts.isrCache).toBe('workers-cache');
    const same = normalizeInput({ ...i, ...withStack(i, i.stack) });
    expect(same).toEqual(i);
    const other = normalizeInput({
      ...i,
      ...withStack(i, 'cloudflare-vinext-free'),
    });
    expect(other.stack).toBe('cloudflare-vinext-free');
    expect(other.parts.isrCache).toBe('kv');
  });
});

describe('MAU の換算（OCL-D4F7AE54）', () => {
  it('テンプレートごとに 1 人あたりの月の PV が違う（記事 10・業務アプリ 200）', () => {
    const a = normalizeInput({ template: 'article', pv: 300_000 });
    const b = normalizeInput({ template: 'business', pv: 300_000 });
    expect(a.pv / runEstimate(a).mau).toBeCloseTo(10, 6);
    expect(b.pv / runEstimate(b).mau).toBeCloseTo(200, 6);
  });
});

describe('費用の曲線（D-74）', () => {
  it('今の構成の点は、その PV の見積と同じ（今の部品で数える）', () => {
    const i = normalizeInput({
      stack: 'cloudflare-vinext-paid',
      parts: { isrCache: 'workers-cache' },
    });
    const [c] = costCurves(i, [i.stack]);
    expect(c!.current).toBe(true);
    expect(c!.points.map((p) => p.pv)).toEqual([...CURVE_PVS]);
    for (const p of c!.points)
      expect(p.totalUsd).toBeCloseTo(
        runEstimate({ ...i, pv: p.pv }).totalUsd,
        9,
      );
  });

  it('他の構成は既定の部品で数え、その PV の比較の表と同じ月額', () => {
    const i = normalizeInput({
      stack: 'cloudflare-vinext-free',
      parts: { isrCache: 'workers-cache' },
    });
    const [c] = costCurves(i, ['cloudflare-vinext-paid']);
    for (const p of c!.points) {
      const row = compareStacks({ ...i, pv: p.pv }).find(
        (r) => r.stack === 'cloudflare-vinext-paid',
      )!;
      expect(p.totalUsd).toBeCloseTo(row.totalUsd, 9);
      expect(p.blocking.length).toBe(row.blocking);
    }
  });

  it('止まる前提に当たる点は文を持つ（無料プランは PV を上げると止まる）', () => {
    const i = normalizeInput({ stack: 'netlify-supabase-free' });
    const [c] = costCurves(i, [i.stack]);
    expect(c!.points.at(-1)!.blocking.length).toBeGreaterThan(0);
    expect(c!.points.at(-1)!.blocking.every((t) => t.length > 0)).toBe(true);
  });

  it('載せられない構成は捨てる', () => {
    const i = normalizeInput({ framework: 'astro' });
    expect(costCurves(i, ['aws-amplify'])).toEqual([]);
  });

  it('既定は今の構成 + 今の PV で安い順に 4 構成で、STACKS の順に並ぶ', () => {
    const i = normalizeInput({ stack: 'vercel-supabase-pro' });
    const rows = compareStacks(i);
    const ids = defaultCurveStacks(rows);
    expect(ids).toHaveLength(5);
    expect(ids).toContain('vercel-supabase-pro');
    const priciestPicked = Math.max(
      ...ids
        .filter((id) => id !== i.stack)
        .map((id) => rows.find((r) => r.stack === id)!.totalUsd),
    );
    for (const r of rows)
      if (!ids.includes(r.stack))
        expect(r.totalUsd).toBeGreaterThanOrEqual(priciestPicked);
    const order = rows.map((r) => r.stack);
    expect(ids).toEqual(
      [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    );
  });

  it('6 構成を選んだ後に未選択の構成へ切り替えても、今の構成を入れて 6 構成に抑える（OCL-E5E5FCBD）', () => {
    const before = compareStacks(
      normalizeInput({ stack: 'cloudflare-vinext-free' }),
    );
    const picked = before.slice(0, 6).map((r) => r.stack);
    expect(picked).toContain('cloudflare-vinext-free');
    const outside = before.find((r) => !picked.includes(r.stack))!.stack;
    const rows = compareStacks(normalizeInput({ stack: outside }));
    const ids = pickedCurveStacks(picked, rows);
    expect(ids).toHaveLength(6);
    expect(ids).toContain(outside);
    // 先に選んだものから残す
    expect(ids).toEqual(
      expect.arrayContaining(picked.filter((id) => id !== outside).slice(0, 5)),
    );
    // 載せられない構成は外す
    const astro = compareStacks(normalizeInput({ framework: 'astro' }));
    expect(
      pickedCurveStacks(['aws-amplify'], astro).includes('aws-amplify'),
    ).toBe(false);
  });

  it('色は会社に固定（AWS の 2 つの構成は同じ色で、7 事業者が 6 色の枠に収まる。D-88）', () => {
    const c = costCurves(
      normalizeInput({}),
      compareStacks(normalizeInput({})).map((r) => r.stack),
    );
    const slots = new Set(c.map((s) => curveColorSlot(s.provider)));
    for (const s of slots) expect(s).toBeGreaterThanOrEqual(0);
    expect(Math.max(...slots)).toBeLessThan(6);
    expect(curveColorSlot('cloudflare')).toBe(0);
    expect(curveColorSlot('aws-opennext')).toBe(curveColorSlot('aws'));
    expect(curveColorSlot('gcp')).toBe(5);
    // 同じ事業者の中で形（variant）が重ならない
    const keys = c.map((s) => `${s.provider}:${s.variant}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...c.map((s) => s.variant))).toBeLessThan(3);
  });
});

describe('チームの人数（席。D-76）', () => {
  it('既定は 1 人で、1〜100 に収める', () => {
    expect(normalizeInput({}).seats).toBe(1);
    expect(normalizeInput({}).showTax).toBe(true);
    expect(normalizeInput({ seats: 0 }).seats).toBe(1);
    expect(normalizeInput({ seats: 1e6 }).seats).toBe(100);
    expect(normalizeInput({ seats: 2.6 }).seats).toBe(3);
    // 入力欄の確定で使う（空・範囲外を直した値を欄にも戻す。OCL-5160B6D1）
    expect(normalizeSeats(undefined)).toBe(1);
    expect(normalizeSeats(Number.NaN)).toBe(1);
    expect(normalizeSeats(101)).toBe(100);
  });

  const base = (stack: string, seats: number) =>
    runEstimate(normalizeInput({ stack, pv: 300_000, seats }));
  const fee = (v: ReturnType<typeof runEstimate>) =>
    v.providers
      .flatMap((p) => p.lines)
      .find((l) => l.kind === 'base-fee' && l.label.includes('席'))!;

  it('席課金のプラン（Vercel Pro）は基本料が席の数ぶんになり、月額・比較・曲線に効く', () => {
    const one = base('vercel-supabase-pro', 1);
    const three = base('vercel-supabase-pro', 3);
    const perSeat = fee(one).amount!;
    expect(fee(three).amount).toBeCloseTo(perSeat * 3, 9);
    expect(three.totalUsd - one.totalUsd).toBeCloseTo(perSeat * 2, 9);
    const m = three.members.find((x) => x.pricing === 'per-seat')!;
    expect(m.seatFee).toEqual({
      amount: perSeat * 3,
      currency: 'USD',
      seats: 3,
    });

    const row = (seats: number) =>
      compareStacks(
        normalizeInput({ stack: 'cloudflare-vinext-free', pv: 300_000, seats }),
      ).find((r) => r.stack === 'vercel-supabase-pro')!;
    expect(row(3).totalUsd - row(1).totalUsd).toBeCloseTo(perSeat * 2, 9);

    const curve = (seats: number) =>
      costCurves(
        normalizeInput({ seats }),
        ['vercel-supabase-pro'],
        [100_000],
      )[0]!.points[0]!.totalUsd;
    expect(curve(3) - curve(1)).toBeCloseTo(perSeat * 2, 9);
  });

  it('席の料金が無い・書かれていないプランは月額が変わらず、前提の文が出る', () => {
    for (const stack of [
      'netlify-supabase-pro',
      'sakura-vps-2gb',
      'aws-amplify',
    ]) {
      const one = base(stack, 1);
      const five = base(stack, 5);
      expect(five.totalUsd, stack).toBeCloseTo(one.totalUsd, 9);
      expect(five.members.length, stack).toBeGreaterThan(0);
      expect(
        five.members.every((m) => m.pricing !== 'per-seat'),
        stack,
      ).toBe(true);
    }
    const sakura = base('sakura-vps-2gb', 5);
    expect(sakura.members.some((m) => m.pricing === 'not-stated')).toBe(true);
  });
});

describe('日本から契約するときの消費税（D-76）', () => {
  it('文書で確かめた事業者だけ 10% を足し、税込の価格・未確認は足さない', () => {
    const t = japanTax([
      { provider: 'cloudflare', currency: 'USD', amount: 10 },
      { provider: 'aws', currency: 'USD', amount: 2 },
      { provider: 'aws', currency: 'USD', amount: -1 },
      { provider: 'sakura-vps', currency: 'JPY', amount: 1000 },
      { provider: 'netlify', currency: 'USD', amount: 20 },
    ]);
    expect(t.taxJpy).toBeCloseTo((10 + 1) * 150 * 0.1, 9);
    expect(t.totalJpy).toBeCloseTo((10 + 1 + 20) * 150 + 1000 + t.taxJpy, 9);
    expect(t.unconfirmed).toEqual(['netlify']);
    // 税込の価格の内税は割り戻して出すが、合計には足さない（OCL-66B5BAF1）
    expect(t.includedTaxJpy).toBeCloseTo(1000 * (0.1 / 1.1), 9);
    expect(t.lines.find((l) => l.provider === 'sakura-vps')!.status).toBe(
      'included',
    );
    expect(t.assumption).toContain('個人');
  });

  it('見積と比較の表の税込の目安が一致し、税抜の円より小さくならない', () => {
    const input = normalizeInput({ stack: 'aws-amplify', pv: 1_000_000 });
    const v = runEstimate(input);
    expect(v.tax.totalJpy).toBeGreaterThanOrEqual(v.totalJpy - 1e-6);
    const row = compareStacks(input).find((r) => r.current)!;
    expect(row.taxInclJpy).toBeCloseTo(v.tax.totalJpy, 6);
  });
});
