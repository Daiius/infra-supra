// 見積モードの計算と入力の扱い（D-73）。
import { describe, expect, it } from 'vitest';
import { composeStack } from 'catalog';
import {
  withSeats,
  compareStacks,
  costCurves,
  CURVE_PVS,
  curveColorSlot,
  defaultCurveStacks,
  diagramOf,
  pickedCurveStacks,
  fromQuery,
  japanTax,
  normalizeInput,
  normalizeSeats,
  routeStatusOf,
  runEstimate,
  sortRows,
  stackCardTotals,
  toQuery,
  withFramework,
  withStack,
  withTemplate,
  type EstimateInput,
  withParts,
  withStackRemembered,
  withPartsRemembered,
  keptParts,
  type PartsByGroup,
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

  it('隠した構成（D-100。OpenNext・Netlify）の URL は一覧の最初の構成にし、曲線にも出さない', () => {
    for (const stack of ['aws-opennext', 'netlify-supabase-pro']) {
      const q = fromQuery(`?mode=estimate&s=${stack}&c.images=default`);
      expect(q.stack).toBe(stack);
      const i = normalizeInput(q);
      expect(i.stack).toBe('cloudflare-vinext-free');
      expect(costCurves(i, [stack])).toEqual([]);
    }
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

describe('確約したときの月額（D-97）', () => {
  it('RDS・さくらの VPS は確約の形ごとに安くなった月額を出し、確約の無い構成では出さない', () => {
    const rds = runEstimate(
      normalizeInput({ stack: 'aws-amplify', parts: { db: 'rds' } }),
    );
    expect(rds.commitments.map((c) => c.payment)).toEqual([
      '前払いなし',
      '全額前払い',
    ]);
    for (const c of rds.commitments) {
      expect(c.label).toContain('リザーブドインスタンス');
      expect(c.totalUsd).toBeLessThan(rds.totalUsd);
    }
    const vps = runEstimate(normalizeInput({ stack: 'sakura-vps-2gb' }));
    expect(vps.commitments.map((c) => c.label)).toEqual([
      expect.stringContaining('年額'),
    ]);
    expect(vps.commitments[0]!.totalUsd).toBeLessThan(vps.totalUsd);
    expect(
      runEstimate(normalizeInput({ stack: 'cloudflare-vinext-paid' }))
        .commitments,
    ).toEqual([]);
  });
});

describe('URL の互換（D-115。選択の UI をゲームと共用にしても、前の共有 URL は同じ入力で読む）', () => {
  const read = (url: string) => normalizeInput(fromQuery(url));
  it('Astro × CF Paid・部品・描き方・画像の設定・席', () => {
    const i = read(
      '?mode=estimate&t=article&pv=1000000&fw=astro&s=cloudflare-vinext-paid&r=0&img=webp&v=2&seats=3&c.images=images&rp.article=static-build',
    );
    expect(i).toEqual({
      template: 'article',
      pv: 1_000_000,
      framework: 'astro',
      stack: 'cloudflare-vinext-paid',
      parts: { images: 'images', api: 'same', db: 'd1', email: 'default' },
      revalidateSec: 0,
      comments: 0,
      imageFormat: 'webp',
      variants: 2,
      seats: 3,
      showTax: true,
      routes: { article: 'static-build' },
    });
    expect(toQuery(i).toString()).toBe(
      'mode=estimate&t=article&pv=1000000&fw=astro&s=cloudflare-vinext-paid&r=0&img=webp&v=2&seats=3&c.images=images&c.api=same&c.db=d1&c.email=default&rp.article=static-build',
    );
  });

  it('Next.js × Vercel Pro・記事のコメント欄・税込を出さない（選べない部品の値は捨てる）', () => {
    const i = read(
      '?mode=estimate&t=article&pv=300000&fw=nextjs&s=vercel-supabase-pro&r=300&rp.article.comments=1&tax=0&c.ogp=prerender',
    );
    expect(i).toMatchObject({
      framework: 'nextjs',
      stack: 'vercel-supabase-pro',
      comments: 1,
      showTax: false,
      routes: {},
    });
    expect(toQuery(i).toString()).toBe(
      'mode=estimate&t=article&pv=300000&fw=nextjs&s=vercel-supabase-pro&r=300&rp.article.comments=1&img=jpeg&v=3&seats=1&tax=0&c.isrCache=default&c.images=default&c.api=same&c.db=supabase&c.cdnPlan=flat-rate&c.dbBackup=default&c.email=default',
    );
  });

  it('Vite の SPA × さくらの VPS・業務アプリ × Amplify（前の cm は業務アプリでは既定）', () => {
    expect(
      toQuery(
        read(
          '?mode=estimate&t=article&pv=30000&fw=vite-spa&s=sakura-vps-2gb&r=60&img=jpeg&v=3&seats=1',
        ),
      ).toString(),
    ).toBe(
      // さくらの VPS の DB のスロット（D-114 段 2d）: 前の URL（DB の指定なし）は既定の VPS の MySQL で読む
      'mode=estimate&t=article&pv=30000&fw=vite-spa&s=sakura-vps-2gb&r=60&img=jpeg&v=3&seats=1&c.images=default&c.db=mysql&c.frontCdn=none&c.ogp=none&c.apiCache=none&c.dbBackup=default&c.email=default',
    );
    expect(
      toQuery(
        read(
          '?mode=estimate&t=business&pv=50000&fw=nextjs&s=aws-amplify&r=300&cm=1',
        ),
      ).toString(),
    ).toBe(
      'mode=estimate&t=business&pv=50000&fw=nextjs&s=aws-amplify&r=300&img=jpeg&v=3&seats=1&c.api=same&c.db=dynamodb&c.frontCdn=none&c.cdnPlan=payg&c.dbBackup=default&c.email=default',
    );
  });

  it('載せられない組（Astro × AWS）の URL は今までどおり構成を直す（フレームワークは URL のまま）', () => {
    const i = read('?mode=estimate&t=article&fw=astro&s=aws-amplify');
    expect(i.framework).toBe('astro');
    expect(i.stack).toBe('cloudflare-vinext-free');
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

  it('コメント欄は記事のページの部品（D-109）: URL は rp.article.comments に書き、前の cm も読む。枠 + API の記事では既定', () => {
    const i = normalizeInput({ framework: 'astro', comments: 1 });
    const q = toQuery(i);
    expect(q.get('rp.article.comments')).toBe('1');
    expect(q.has('cm')).toBe(false);
    expect(normalizeInput(fromQuery('?fw=astro&cm=1')).comments).toBe(1);
    expect(
      normalizeInput(fromQuery('?fw=astro&rp.article.comments=1')).comments,
    ).toBe(1);
    // 部品のキーは描き方として読まない
    expect(fromQuery('?rp.article.comments=1').routes).toEqual({});
    expect(
      normalizeInput({
        framework: 'astro',
        comments: 1,
        routes: { article: 'shell-api' },
      }).comments,
    ).toBe(0);
    // 表の記事の行に部品として出る
    const row = diagramOf(i).routes.find((r) => r.route === 'article')!;
    expect(row.parts.map((p) => [p.part, p.value])).toEqual([['comments', 1]]);
  });

  it('記事ごとの枠（S5。D-109）: Next.js・Astro の記事の S5 は SNS のカードが出る。SPA は前処理の部品が要る', () => {
    const ogp = (i: Partial<EstimateInput>) =>
      routeStatusOf(normalizeInput(i)).find((r) => r.route === 'article')!.ogp;
    expect(
      ogp({ framework: 'nextjs', routes: { article: 'shell-api' } })?.ok,
    ).toBe(true);
    expect(ogp({ framework: 'vite-spa' })?.ok).toBe(false);
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

  it('Bunny（D-98）: 画像・前段の CDN を Bunny にすると Bunny の請求と出典が増え、明細は料金データの表示名', () => {
    const at = (s: string, q = '') =>
      runEstimate(normalizeInput(fromQuery(`?t=article&s=${s}${q}`)));
    const gcp = at('gcp-cloud-run', '&c.images=bunny-images');
    const bunny = gcp.providers.find((p) => p.provider === 'bunny')!;
    expect(bunny.lines.map((l) => l.label)).toEqual(
      expect.arrayContaining([
        'CDN の転送（Bunny CDN: Standard network・Asia & Oceania）',
        '基本料（Bunny Optimizer: per website）',
      ]),
    );
    expect(gcp.sources.map((s) => s.provider)).toContain('bunny');
    const vps = at('sakura-vps-2gb', '&c.frontCdn=bunny');
    expect(vps.providers.map((p) => p.provider)).toContain('bunny');
    expect(vps.totalUsd).toBeGreaterThan(
      at('sakura-vps-2gb', '&c.frontCdn=static').totalUsd,
    );
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
    // メール送信（D-95）の既定の Amazon SES の分、AWS も入る。ドメインの登録（D-96）の registrar も入る
    expect(v.sources.map((s) => s.provider).sort()).toEqual(
      ['aws', 'registrar', 'supabase', 'vercel'].sort(),
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
    // 隠した構成（AWS の OpenNext・Netlify の 3 つ。D-100）は並べない
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(
      rows.some(
        (r) => r.stack === 'aws-opennext' || r.stack.startsWith('netlify'),
      ),
    ).toBe(false);
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

describe('構成が先（D-115。始める画面と同じ D-113 の規則）', () => {
  it('今のフレームワークを載せられない構成（Astro × AWS）を選ぶと、載せられる最初のフレームワークに替える', () => {
    const i = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-paid',
    });
    const next = normalizeInput({ ...i, ...withStack(i, 'aws-amplify') });
    expect(next.stack).toBe('aws-amplify');
    expect(next.framework).toBe('nextjs');
    // 載せられる構成ではフレームワークは替えない
    const vps = normalizeInput({ ...i, ...withStack(i, 'sakura-vps-2gb') });
    expect(vps.framework).toBe('astro');
  });

  it('構成のカードの月額は、その構成を選んだ後の見積と同じ（載せられない構成は替わる先のフレームワークで）', () => {
    const i = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-paid',
    });
    const totals = stackCardTotals(i, compareStacks(i));
    for (const id of [
      'cloudflare-vinext-paid',
      'sakura-vps-2gb',
      'aws-amplify',
    ]) {
      const sel = normalizeInput({ ...i, ...withStack(i, id) });
      expect(totals[id]?.totalUsd).toBeCloseTo(runEstimate(sel).totalUsd, 6);
      expect(totals[id]?.framework).toBe(sel.framework);
    }
    // 隠した構成（D-100）は出さない
    expect(totals['aws-opennext']).toBeUndefined();
  });

  it('覚えている構成は、比較の表・カードの月額・費用の曲線をその記憶の部品で数え、戻った後の見積と同じ。触っていない構成は既定のまま（D-116 の補足・記憶は組ごと。D-176）', () => {
    const i = normalizeInput({ stack: 'cloudflare-vinext-paid' });
    const memory = { vercel: { db: 'neon' } };
    const plain = compareStacks(i);
    const rows = compareStacks(i, memory);
    const totals = stackCardTotals(i, rows, memory);
    const back = withStackRemembered(i, 'vercel-supabase-pro', memory).input;
    expect(back.parts.db).toBe('neon');
    const after = runEstimate(back);
    const row = rows.find((r) => r.stack === 'vercel-supabase-pro')!;
    expect(row.totalUsd).toBeCloseTo(after.totalUsd, 6);
    expect(row.name).toContain('Neon');
    expect(row).not.toEqual(
      plain.find((r) => r.stack === 'vercel-supabase-pro'),
    );
    expect(totals['vercel-supabase-pro']?.totalUsd).toBeCloseTo(
      after.totalUsd,
      6,
    );
    const [curve] = costCurves(i, ['vercel-supabase-pro'], [i.pv], memory);
    expect(curve!.points[0]!.totalUsd).toBeCloseTo(after.totalUsd, 6);
    // 同じ組（Vercel Hobby）も同じ記憶の部品で数える（D-176）
    expect(
      rows.find((r) => r.stack === 'vercel-supabase-hobby')!.name,
    ).toContain('Neon');
    // 触っていない組・今の構成は記憶なしと同じ
    for (const r of rows)
      if (!r.stack.startsWith('vercel-'))
        expect(r).toEqual(plain.find((p) => p.stack === r.stack));
  });

  it('同じ事業者のプランは部品の選択を共有し、今のプランで選べないものは記憶に残して戻ったら戻す（D-176）', () => {
    const pick = (
      i: EstimateInput,
      memory: PartsByGroup,
      parts: EstimateInput['parts'],
    ) => {
      const next = normalizeInput({ ...i, ...withParts(i, parts) });
      return { input: next, memory: withPartsRemembered(memory, i, next) };
    };
    // Hobby で DB を選ぶ → Pro に替えると同じ DB
    const hobby = normalizeInput({ stack: 'vercel-supabase-hobby' });
    const a = pick(hobby, {}, { ...hobby.parts, db: 'neon' });
    const pro = withStackRemembered(a.input, 'vercel-supabase-pro', a.memory);
    expect(pro.input.parts.db).toBe('neon');
    // Pro でだけ選べる部品（CDN のプラン）を選ぶ → Hobby では無い → Pro に戻すと戻る
    expect(pro.input.parts.cdnPlan).not.toBe('on-demand');
    const b = pick(pro.input, pro.memory, {
      ...pro.input.parts,
      cdnPlan: 'on-demand',
    });
    const back = withStackRemembered(
      b.input,
      'vercel-supabase-hobby',
      b.memory,
    );
    expect(back.input.parts.cdnPlan).toBeUndefined();
    expect(back.input.parts.db).toBe('neon');
    // Hobby でほかの部品を選び直しても、Pro だけの記憶は消えない（選び直すかどうかで復活が変わらない。OCL-09D12A43 の趣旨）
    const c = pick(back.input, back.memory, {
      ...back.input.parts,
      db: 'supabase',
    });
    const again = withStackRemembered(c.input, 'vercel-supabase-pro', c.memory);
    expect(again.input.parts.cdnPlan).toBe('on-demand');
    expect(again.input.parts.db).toBe('supabase');
    // 比較の表の Pro の行も、戻った後の見積と同じ（同じ組は同じ選択で数える）
    const row = compareStacks(c.input, c.memory).find(
      (r) => r.stack === 'vercel-supabase-pro',
    )!;
    expect(row.totalUsd).toBeCloseTo(runEstimate(again.input).totalUsd, 6);
    // 別の組へ替えて戻ると、それぞれの組の選択が戻る
    const cf = withStackRemembered(
      again.input,
      'cloudflare-vinext-free',
      again.memory,
    );
    const cf2 = pick(cf.input, cf.memory, { ...cf.input.parts, db: 'neon' });
    const v = withStackRemembered(cf2.input, 'vercel-supabase-pro', cf2.memory);
    expect(v.input.parts.db).toBe('supabase');
    expect(v.input.parts.cdnPlan).toBe('on-demand');
    const cfBack = withStackRemembered(
      v.input,
      'cloudflare-vinext-paid',
      v.memory,
    );
    expect(cfBack.input.parts.db).toBe('neon');
  });

  it('フレームワークを替えて組のどのプランでも選べなくなった部品は、記憶からも落ちる（戻しても復活しない。OCL-09D12A43・D-176）', () => {
    const i = normalizeInput({ stack: 'cloudflare-vinext-paid' });
    const next = normalizeInput({
      ...i,
      ...withParts(i, { ...i.parts, isrCache: 'r2' }),
    });
    const memory = withPartsRemembered({}, i, next);
    const vite = normalizeInput({
      ...next,
      ...withFramework(next, 'vite-spa'),
    });
    const kept = keptParts(memory, vite, next);
    expect(kept.cloudflare?.isrCache).toBeUndefined();
    const nextjs = normalizeInput({
      ...vite,
      ...withFramework(vite, 'nextjs'),
    });
    const away = withStackRemembered(
      nextjs,
      'cloudflare-vinext-free',
      keptParts(kept, nextjs, vite),
    );
    expect(away.input.parts.isrCache).not.toBe('r2');
  });
});

describe('フレームワーク・構成を替えたときの再検証の値（始める画面と同じ規則。D-103・D-107）', () => {
  const apply = (i: EstimateInput, p: Partial<EstimateInput>) =>
    normalizeInput({ ...i, ...p });
  // URL から読み直しても同じ（r= は毎回書かれる）
  const viaUrl = (i: EstimateInput) =>
    normalizeInput(fromQuery(`?${toQuery(i)}`));

  it('既定のまま Next.js から Astro に替えると、Astro の既定（消せる置き場はオンデマンド）にする', () => {
    const next = viaUrl(normalizeInput({ stack: 'cloudflare-vinext-paid' }));
    expect(next.revalidateSec).toBe(300);
    const astro = apply(next, withFramework(next, 'astro'));
    expect(astro.framework).toBe('astro');
    expect(astro.revalidateSec).toBe(0);
    // 戻すと Next.js の既定
    expect(apply(astro, withFramework(astro, 'nextjs')).revalidateSec).toBe(
      300,
    );
  });

  it('既定のまま消せない置き場（Google Cloud）へ替えると 5 分、消せる置き場へ戻すとオンデマンド', () => {
    const cf = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-paid',
    });
    expect(cf.revalidateSec).toBe(0);
    const gcp = apply(cf, withStack(cf, 'gcp-cloud-run'));
    expect(gcp.stack).toBe('gcp-cloud-run');
    expect(gcp.revalidateSec).toBe(300);
    expect(
      apply(gcp, withStack(gcp, 'vercel-supabase-pro')).revalidateSec,
    ).toBe(0);
  });

  it('選んだ値（既定と違う）は替えた先で選べるなら残す', () => {
    const chosen = normalizeInput({
      framework: 'nextjs',
      stack: 'cloudflare-vinext-paid',
      revalidateSec: 3600,
    });
    const astro = apply(chosen, withFramework(chosen, 'astro'));
    expect(astro.revalidateSec).toBe(3600);
    const gcp = apply(astro, withStack(astro, 'gcp-cloud-run'));
    expect(gcp.revalidateSec).toBe(3600);
  });

  it('Next.js の再検証の既定は、オンデマンドが選べる部品ならオンデマンド。既定のままなら部品に付いて替わり、選んだ値は残す（D-125）', () => {
    // Cloudflare の既定の ISR のキャッシュ（KV）は消せないので 5 分、R2 ならオンデマンド
    const kv = viaUrl(normalizeInput({ stack: 'cloudflare-vinext-paid' }));
    expect(kv.revalidateSec).toBe(300);
    const r2 = apply(kv, withParts(kv, { isrCache: 'r2' }));
    expect(r2.revalidateSec).toBe(0);
    expect(viaUrl(r2).revalidateSec).toBe(0);
    expect(apply(r2, withParts(r2, { isrCache: 'kv' })).revalidateSec).toBe(
      300,
    );
    // 構成を替えて戻ると、覚えていた R2 に合わせてオンデマンドの既定に戻る（OCL-3CBB2E6A）
    const away = withStackRemembered(r2, 'sakura-vps-2gb', {});
    const back = withStackRemembered(
      away.input,
      'cloudflare-vinext-paid',
      away.memory,
    ).input;
    expect(back.parts.isrCache).toBe('r2');
    expect(back.revalidateSec).toBe(0);
    // 選んだ値（1 時間）は部品を替えても残す
    const chosen = { ...r2, revalidateSec: 3600 };
    expect(
      apply(chosen, withParts(chosen, { isrCache: 'kv' })).revalidateSec,
    ).toBe(3600);
    // VPS・Vercel は既定の部品で消せる
    expect(normalizeInput({ stack: 'sakura-vps-2gb' }).revalidateSec).toBe(0);
    expect(normalizeInput({ stack: 'vercel-supabase-pro' }).revalidateSec).toBe(
      0,
    );
  });

  it('業務アプリ（設定を出さない）から記事に替えると、替えた先の既定', () => {
    const biz = normalizeInput({
      template: 'business',
      framework: 'astro',
      stack: 'cloudflare-vinext-paid',
    });
    expect(biz.revalidateSec).toBe(300);
    const art = apply(biz, withTemplate(biz, 'article'));
    expect(art.template).toBe('article');
    expect(art.revalidateSec).toBe(
      normalizeInput({ framework: art.framework, stack: art.stack })
        .revalidateSec,
    );
  });

  it('替えた先で選べないページの描き方（rp.〜）は捨て、選べるものは残す', () => {
    const astro = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-free',
      routes: { article: 'static-build', personal: 'shell-api' },
    });
    // vinext（Cloudflare の Next.js）の S1 も選べるので両方残る（RS-15 の解除）
    const next = apply(astro, withFramework(astro, 'nextjs'));
    expect(next.routes).toEqual({
      article: 'static-build',
      personal: 'shell-api',
    });
    // Vite の SPA には S1 が無いので捨てる（個人向けの S5 は SPA の既定なので持たない）
    const spa = apply(astro, withFramework(astro, 'vite-spa'));
    expect(spa.routes).toEqual({});
    expect(toQuery(spa).has('rp.article')).toBe(false);
  });

  it('比較の表・費用の曲線の他の構成の月額は、その構成を選んだ後の見積と同じ（既定の違う構成の間で。OCL-417D9CCA）', () => {
    for (const from of ['gcp-cloud-run', 'cloudflare-vinext-paid']) {
      const i = normalizeInput({ framework: 'astro', stack: from });
      for (const row of compareStacks(i)) {
        const picked = apply(i, withStack(i, row.stack));
        const pickedTotal = compareStacks(picked).find((r) => r.current)!;
        expect(row.totalUsd).toBeCloseTo(pickedTotal.totalUsd, 9);
        const [curve] = costCurves(i, [row.stack], [i.pv]);
        expect(curve!.points[0]!.totalUsd).toBeCloseTo(pickedTotal.totalUsd, 9);
      }
    }
    // 既定の違う構成（Google Cloud は 5 分・Cloudflare はオンデマンド）を含む
    const gcp = normalizeInput({ framework: 'astro', stack: 'gcp-cloud-run' });
    expect(
      apply(gcp, withStack(gcp, 'cloudflare-vinext-paid')).revalidateSec,
    ).not.toBe(gcp.revalidateSec);
  });

  it('同じ値を選び直しても何も変えない', () => {
    const i = normalizeInput({ framework: 'astro' });
    expect(withFramework(i, 'astro')).toEqual({});
    expect(withTemplate(i, i.template)).toEqual({});
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

describe('ページごとの描き方（D-107）', () => {
  it('URL の rp.〜 に残り、読み直すと同じ。使えない描き方（個人向けのキャッシュ）は捨てる', () => {
    const input = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-free',
      routes: { article: 'static-build', personal: 'shell-api' },
    });
    expect(input.routes).toEqual({
      article: 'static-build',
      personal: 'shell-api',
    });
    const q = toQuery(input);
    expect(q.get('rp.personal')).toBe('shell-api');
    expect(normalizeInput(fromQuery(`?${q}`))).toEqual(input);
    expect(
      normalizeInput({
        framework: 'nextjs',
        stack: 'cloudflare-vinext-paid',
        routes: { article: 'static-build', personal: 'cached-ttl' },
      }).routes,
    ).toEqual({ article: 'static-build' });
  });

  it('構成の比較も選んだ描き方で引く（CF Free の Astro は記事 S1・個人向け S5 で CPU の制限に当たらない）', () => {
    const base = normalizeInput({
      framework: 'astro',
      stack: 'cloudflare-vinext-free',
    });
    const chosen = normalizeInput({
      ...base,
      routes: { article: 'static-build', personal: 'shell-api' },
    });
    const free = (i: typeof base) =>
      compareStacks(i).find((r) => r.stack === 'cloudflare-vinext-free')!;
    expect(free(chosen).blocking).toBeLessThan(free(base).blocking);
    const st = routeStatusOf(base);
    expect(st.find((r) => r.route === 'personal')!.cpu.ok).toBe(false);
    expect(
      st.find((r) => r.route === 'personal')!.deltas['shell-api'],
    ).toBeDefined();
    expect(
      routeStatusOf(chosen).find((r) => r.route === 'personal')!.cpu.ok,
    ).toBe(true);
  });
});

describe('席の数（D-120）', () => {
  it('2 席以上でも構成の契約の地域・CDN の料金（On-demand）を残して席を重ねる', () => {
    const arch = withSeats(
      composeStack('vercel-supabase-pro', { cdnPlan: 'on-demand' }),
      3,
    );
    expect(arch.accounts).toContainEqual({
      id: 'vercel',
      region: 'iad1',
      viewerRegion: 'hnd1',
      capacityTiers: { 'flat-rate-cdn': 'off' },
      seats: 3,
    });
    expect(arch.accounts).toContainEqual({ id: 'supabase', seats: 3 });
  });
});
