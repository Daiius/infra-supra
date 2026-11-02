# 06. フレームワークとビルド出力

> 状態: **設計中（最小の形は実装済み。下の ⚠）**。各フレームワーク・ホストの対応状況（どの機能がどのホストで動くか）は、
> 料金データと同じく公式ドキュメントを出典にして catalog に入れる（[03](./03-pricing-schema.md) §1 と同じ規律）。
> 今は Next.js・Vite の SPA・Astro × Cloudflare・Vercel・さくらの VPS・AWS（Amplify・S3 + CloudFront・OpenNext）・Netlify・Google Cloud（Cloud Run + Firebase Hosting。D-88）を、出典つきで `packages/catalog/src/frameworks` の DeployTarget の表に入れた（Astro × AWS は unsupported。OpenNext・Netlify は D-100 で一時的に隠している）。
> ⚠ **ページ（ルート）ごとの描き方 S1〜S6 と、フレームワーク × 事業者の対応表・フレームワークの既定（プリセット）は [13](./13-route-strategies.md)**（D-106・D-107）。この文書のフレームワークごとの「記事は〜・マイページは〜」は、そのフレームワークの既定の描き方で、始める画面・見積モードでページごとに選び直せる。
> ⚠ **一部実装済み**（Next.js と Vite の SPA の 2 つだけの最小の形。BuildOutput は Workload の routes で代用）→ [10](./10-framework-branch.md) §7・「D-34」（2026-11-01）
> ⚠ **Next.js の静的書き出し（`output: 'export'`）を 4 つ目の選択肢として実装**（§7・D-80・2026-11-02）。Astro と SPA の仕組みの組み合わせで足せた（新しい型・エンジンの拡張なし）。
> ⚠ **Astro を実装**（§6・D-68・2026-11-02）。BuildOutput の型は作らず、SPA と同じく「テンプレートの書き換え（`toAstro`）+ DeployTarget の表 + `composeStack` の分岐」で足せた（§3 の「データ追加だけで足せるか」の検証の答えは §6.6）

## 1. なぜ入力の軸にするか

同じ「ブログ + 管理画面」でも、フレームワークとレンダリング方式によって**インフラ上の形**が変わる。

- 出力が静的ファイルだけなら、ホストは静的配信の比較になる（フレームワークの違いはほぼ消える）。
- SSR・ISR・ミドルウェア・画像最適化を使うと、関数の実行・キャッシュの再生成・画像変換が発生し、
  **ホストごとに課金のされ方が違う**（あるホストでは専用のメーターがあり、別のホストでは自前で用意する）。
- フレームワークによって**載せられるホストが決まる**（アダプターの有無、Node 前提か edge で動くか）。

見積ツールを特定のスタック（作者の好みを含む）に寄せないため、フレームワークは**データとして差し替えられる入力**にする。

## 2. モデル

```
FrameworkProfile（データ）× 使う機能（Workload の入力）
        │ compileBuildOutput
        ▼
BuildOutput（フレームワーク非依存の中間表現）
        │ DeployTarget（ホスト × アダプター。データ）で写像
        ▼
Architecture のノードとリクエストクラス（01 §4）
```

### 2.1 BuildOutput（中間表現）

フレームワーク固有の話をここで止め、エンジンの残りはフレームワークを知らないようにする。

```ts
type BuildOutput = {
  staticAssets: { totalBytes: number; fileCount: number };   // ビルド時に確定するファイル
  routes: RouteGroup[];
  middleware?: { runsOn: 'all' | 'dynamic-only'; cpuMs: Sourced<number> };
  imageOptimization?: { mode: 'build-time' | 'on-demand'; variantsPerImage: Sourced<number> };
};
type RouteGroup = {
  id: string;
  rendering: 'static' | 'spa' | 'ssr' | 'isr' | 'streaming-ssr';
  share: Sourced<number>;                 // PV に占める割合
  revalidateSeconds?: number;              // isr のみ
  runtime?: 'node' | 'edge';               // 動的なルートが要求する実行環境
};
```

- **ISR は件数が PV に比例しない。** 再生成の回数は「ページ数 × 再検証の間隔あたりの回数（× キャッシュの地域数）」で決まり、
  閲覧が少なければ再生成も起きない。上限は `min(閲覧数, 期間 / 間隔)`。これは SSR・静的と比べたときの見どころになる。
- ミドルウェアが `all` で動くと、**静的ファイルの配信にも関数の実行が付く**。課金に効く典型的な落とし穴として扱う。
- 画像の `on-demand` 最適化は、ホストの画像変換メーター（あれば）か、自前の関数・ストレージ（なければ）に写る。

### 2.2 FrameworkProfile（データ・catalog）

```ts
type FrameworkProfile = {
  id: FrameworkId;                         // 'vite-spa' | 'nextjs' | 'vinext' | 'astro' …
  version: string;                         // 対応状況はバージョンで変わる
  renderingModes: RenderingMode[];         // 対応するレンダリング方式
  features: FrameworkFeature[];            // middleware・image-optimization・isr …
  defaults: Partial<WorkloadInput>;        // 典型的なバンドルサイズ・アセット数など（template-default）
  sourceIds: SourceId[];
};
```

- 実装では `renderingModes` を残しているが、ページごとに使える描き方は [13](./13-route-strategies.md) §3 の対応表（`capabilityRow`・`strategySupport`）で決める。`renderingModes` は対応表に置き換えて消す予定（13 §6 の「段 3 でしなかったこと」）。

### 2.3 DeployTarget（データ・catalog）

「フレームワーク × ホスト」の組み合わせごとに、どの機能がどのノード・メーターに写るかを持つ。

```ts
type DeployTarget = {
  framework: FrameworkId;
  host: ProviderId;                        // 'vercel' | 'cloudflare' | 'vps-*' …
  adapter?: string;                        // 使うアダプター・ビルドツール
  supports: Partial<Record<FeatureOrMode, 'native' | 'emulated' | 'unsupported'>>;
  mapping: FeatureMapping[];               // 例: isr → そのホストのキャッシュ + 関数、image-optimization → 画像変換メーター
  sourceIds: SourceId[];
};
```

- `unsupported` の組み合わせは構成の検証で弾く（例: Node 前提のルートを edge 専用のホストへ）。
- `emulated` は動くが実装がホスト本来のものではない（自前のキャッシュで ISR を再現するなど）。性能・運用の仮定を別に持つ。

## 3. 対象フレームワーク

| 段階 | フレームワーク | 主な形 | 見どころ |
|---|---|---|---|
| MVP | Vite（SPA） | 静的ファイル + 別立ての API | 静的配信の比較。API を別のホストに置く構成 |
| MVP | Next.js（App Router） | static / SSR / ISR / ミドルウェア / 画像最適化 | 同じアプリを Vercel（ネイティブ）・VPS（`next start` で自前運用）に載せたときの差。Cloudflare へは vinext で載せる（下の行） |
| MVP | vinext | Next.js の API を Vite の上で実装し、Workers へ載せる | Next.js と同じアプリを別の実装で Cloudflare に載せたときの差（§5） |
| MVP 直後 | Astro | 静的出力が基本。SSR はアダプターで Vercel・Cloudflare・Node へ | 静的出力なら静的ホストの比較に帰着する。SSR アダプターで Vercel に載せたときの課金（実装では、記事コミュニティの記事を閲覧時に描いてキャッシュする形を既定にした。§6・D-103） |
| 拡張 | Remix / React Router、Nuxt、SvelteKit など | — | FrameworkProfile と DeployTarget のデータ追加だけで足せることを目標にする |

- Astro の静的出力は BuildOutput 上で Vite SPA とほぼ同じ形になるので、追加の費用は小さい見込み。
  MVP の 3 つでモデルが固まった後、最初に足して「データ追加だけで足せるか」の検証に使う。
- 各フレームワークのバージョンとアダプターの対応状況は**時点で変わる**ため、FrameworkProfile・DeployTarget も
  PriceBook と同じく取得日と出典を持ち、版で残す。

## 4. 構成の組み方（見積モード）

MVP の比較対象は「フレームワーク × ホスト」の組み合わせになる。例:

| フレームワーク | Cloudflare（Workers + D1 + R2） | Vercel + Supabase | VPS + Docker Compose + MySQL + Nginx |
|---|---|---|---|
| Vite SPA + API | 静的アセット + Workers の API | 静的 + Functions の API | nginx で静的配信 + アプリコンテナの API |
| Next.js | — （vinext の行で扱う。OpenNext は扱わない） | ネイティブ | `next start`（Node）をコンテナで |
| vinext | ネイティブ（ISR は KV、画像は Images） | 対象外（Nitro 経由の対応はあるが MVP では扱わない） | standalone 出力の Node サーバー（MVP では扱うか未定） |

空欄・要調査のマスは DeployTarget のデータで埋まり、`unsupported` なら UI で選べない理由として表示する。

## 5. vinext の調査結果（2026-10-31 取得）

出典: <https://github.com/cloudflare/vinext>（README）、<https://blog.cloudflare.com/vinext/>（2026-02-24 公開・2026-09-28 更新）。

- 位置づけ: Next.js の API を Vite の上で実装し、Cloudflare Workers を主なデプロイ先にする。ブログでは「experimental」、README では「Under active development」。
  対象は Next.js 16.x のみ。バージョン番号は確認できなかった。
- 動くもの（README）: App Router・Pages Router、RSC・Server Actions・route handlers・middleware、静的生成・ISR・`output: "export"`・standalone の Node 出力、`next/image` などの主要モジュール。
- 不完全なもの（README）: `"use cache"` / Cache Components（部分的）、ビルド時の画像パイプライン（リクエスト時の最適化のみ）、`runtime = "edge"` のページは ISR でキャッシュされない。
- ISR: KV のキャッシュハンドラ（ブログ）。**ISR のページの閲覧は毎回 Worker を通り、KV を読む**（Vercel の CDN が返す ISR とは経路が違う。spike の所見 4）。
- 画像: Cloudflare Images のバインディングでリクエスト時に最適化する（README）。Images の料金は別途。
- デプロイ先: Workers が最も深く統合されている。Node や他のプラットフォーム（Vercel など）は Nitro 経由で、対応の度合いは異なる（README）。

⚠ **未確認の仮定**（P1-10 で catalog の構成に入れたもの。原文・実装で確かめる）:
- ISR の再生成は閲覧のリクエストの中で裏で走る（stale-while-revalidate）。Worker のリクエスト数には数えない（`backgroundClasses`）。
- 再生成のたびに KV に書く（内容が変わらなくても）。1000 万 PV では Cloudflare 側で最大の明細になる（spike 所見 16）。

⚠ キャッシュのアダプター名など、README の後半はこの調査では要約でしか読めていない。DeployTarget のデータにする前に原文で確かめる。

## 6. Astro（実装・2026-11-02・D-68。記事をキャッシュする形に替えた・2026-11-03・D-103）

> **D-103（2026-11-03・ユーザーの決定 C-5）で記事の描き方を替えた。** 記事は「ビルドのときに静的」でなく、
> **アダプターが閲覧のときに描いて前段にキャッシュし、記事の投稿・編集でそのページのキャッシュを消す**（設計の下書き RS の S3 `cached-purge`）。
> 記事のためにサイトをビルドし直さない。§6.1 の事実は残し、§6.2〜§6.6 を今の形に書き直した（前の形は D-68 の記録）。

### 6.1 確かめた公式の事実（2026-11-02 取得）

| 事実 | 出典 |
|---|---|
| 既定はビルドのときにページ・エンドポイントを静的にする（「By default, Astro pages, routes, and API endpoints will be pre-rendered at build time」）。リクエストのたびに描くにはアダプターが要り、ページごとに `export const prerender = false`。`output: 'server'` は既定を逆にするだけで機能は増えない | [On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) |
| 公式のアダプターは Cloudflare・Netlify・Node・Vercel | 同上 |
| クライアントの JS は `client:*` を付けた部品（アイランド）だけ（「client-side JavaScript is only loaded for the explicit interactive components that you mark」） | [Islands](https://docs.astro.build/en/concepts/islands/) |
| `@astrojs/cloudflare` は Workers に載せる（Pages は対象外になった）。静的なファイルはアセット、合わないリクエストは Worker。ISR に当たる機能の記載なし。`imageService` は `cloudflare`（Image Resizing）・`cloudflare-binding`（Images の binding）・`compile`（ビルドのときに変換）・`passthrough` | [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) |
| `@astrojs/vercel` の `isr`: リクエストのたびに描くページを最初の閲覧の後にキャッシュする。`expiration`・`bypassToken`（`x-prerender-revalidate` で無効化）・`exclude`。`imageService` で Vercel の画像の最適化 | [@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/) |
| `@astrojs/node` の standalone はページ・API に加えて静的なファイルも配る | [@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/) |
| AWS: 静的なら Amplify・S3（+ CloudFront）、リクエストのたびに描くなら Amplify のコミュニティのアダプター（`astro-aws-amplify`）か SST。公式のアダプターは無い | [Deploy to AWS](https://docs.astro.build/en/guides/deploy/aws/) |
| `<Image />` の変換は、静的なページではビルドのとき、リクエストのたびに描くページでは閲覧のとき。既定で `.webp` を作る | [Images](https://docs.astro.build/en/guides/images/)・[astro:assets](https://docs.astro.build/en/reference/modules/astro-assets/) |
| Workers Builds: Free 月 3,000 分・Paid 月 6,000 分（以降 $0.005 / 分）。並列 Free 1・Paid 6。1 回 20 分まで。Free の超過の扱いは記載なし | [Workers Builds の制限と料金](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)（2026-10-28 更新） |
| Vercel のビルド: Hobby は Basic（2 vCPU）が込み。有料のチームは CPU minute（ビルドの時間を分に切り上げ × vCPU）あたり $0.0035（Basic は $0.007 / 分）。新しい Pro の既定は Elastic（4〜30 vCPU）。1 日のデプロイは Hobby 100・Pro 6,000 | [Managing Builds](https://vercel.com/docs/builds/managing-builds)・[Pricing](https://vercel.com/docs/pricing)・[Limits](https://vercel.com/docs/limits) |
| Amplify のビルドは $0.01 / 分（月 1,000 分の無料は 12 か月の旧来の無料枠） | [Amplify の料金](https://aws.amazon.com/amplify/pricing/)（Astro × AWS は扱わないので数えていない） |

追加（2026-11-03 取得・D-103）:

| 事実 | 出典 |
|---|---|
| Astro の route caching（`astro@7.0.0`）: `Astro.cache.set({ maxAge, swr, tags })` でページをキャッシュし、`cache.invalidate({ tags })`・`{ path }`（完全一致）で消す。provider は Node 向けの `memoryCache()`（組み込み）、`cacheNetlify()`（全エッジで共有する durable cache）・`cacheVercel()`（タグの無効化は soft）・`cacheCloudflare()`（`Cloudflare-CDN-Cache-Control`・`Cache-Tag`。アダプターが Workers Cache を既定の設定で有効にする）。CDN の provider は実験の段階で、手で有効にする（`@astrojs/cloudflare@14.0.0`・`@astrojs/vercel@11.0.0`・`@astrojs/netlify@8.0.0` 以降）。ヒットはサーバーの関数を起動しない | [Route caching](https://docs.astro.build/en/guides/caching/) |
| Workers Cache: Worker の前のキャッシュ。ヒットは Worker を動かさない（CPU は課金されない）。有効にすると、キャッシュから返したものも静的アセットも、すべてのリクエストを Workers の料金で数える。tiered | [Workers Cache](https://developers.cloudflare.com/workers/cache/)（2026-10-30 更新） |
| Workers Cache の purge: Worker の中から `ctx.cache.purge` でタグ・パスの prefix・すべてを消す。Instant Purge の仕組みで、ゾーンの purge と同じ保証で全体に伝わる。制限はアカウント・ゾーンのプランによらず Free の制限（タグ・prefix は 1 分 5 回・貯めて 25 回） | [Purge](https://developers.cloudflare.com/workers/cache/purge/)（2026-10-12 更新）・[Purge cache](https://developers.cloudflare.com/cache/how-to/purge-cache/)（2026-09-29 更新） |
| Workers の料金の注: キャッシュから返したリクエストも Worker を起動したものと同じ単価で数え、CPU はミス・バイパスのときだけ。この注は Free・Paid の両方の表に付く（Free で使えないという記載は無い。Free でも使えると読んだ） | [Workers の料金](https://developers.cloudflare.com/workers/platform/pricing/)（2026-10-02 更新） |
| `@astrojs/vercel` の `isr`: リクエストのたびに描くページを最初の閲覧の後にキャッシュ（`expiration` で期限、`bypassToken` を `x-prerender-revalidate` に付けたリクエストで取り直し、`exclude` は毎回描く）。Vercel の ISR の文書は Astro を対応するフレームワークに挙げ、料金は Next.js と同じ（関数の起動・ISR の読み書き・Fast Origin Transfer）。再検証は全リージョンで 300ms 以内 | [@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/)・[Vercel の ISR](https://vercel.com/docs/incremental-static-regeneration)（2026-08-28 更新） |
| Firebase Hosting の CDN: Cloud Run の応答は `Cache-Control` の `public`・`s-maxage` でキャッシュする。消えるのはデプロイのときだけで、パス・タグを指定して消す方法は文書に無い（D-88 で取得済み） | [Manage cache behavior](https://firebase.google.com/docs/hosting/manage-cache) |
| nginx の `proxy_cache_purge` は NGINX Plus（商用）の機能で、オープンソース版の標準に無い（このモデルでは VPS の前段に nginx のキャッシュを置かず、Astro の `memoryCache()` を使う。nginx の文書は今回取得していない） | — |

### 6.2 入れた形（D-103）

- **FrameworkProfile** `astro`（`renderingModes: static・ssr・isr`）。**DeployTarget**: Cloudflare（`@astrojs/cloudflare` + Workers Cache）・Vercel（`@astrojs/vercel` の `isr`）・さくらの VPS（`@astrojs/node` standalone + `memoryCache()`）・Google Cloud（`@astrojs/node` を Cloud Run + Hosting の CDN）・Netlify（`cacheNetlify()`。隠している）は `native`、**AWS・AWS（OpenNext）は `unsupported`**（公式のアダプターが無い）。
  DeployTarget に `pageCache`（記事のキャッシュの置き場・投稿で消せるか・理由）を足した。
- **テンプレートの書き換え** `toAstro(w, shape)`: 記事（ISR だったルート）は **isr のまま**残す（S2・S3 は ISR の時間・オンデマンドの式がそのまま使えるので、新しい種類は足さない。RS-05）。SSR はそのまま。ページあたりの JS・CSS は `assetsFactor` 倍。Workload に `build` を付けない（記事のためのビルドし直しは無い）。
  ビルドし直し（`toStaticBuild`・`buildMinutes`）は Next.js の静的書き出しだけが使う（§7）。
- **構成**（`composeStack(…, { framework: 'astro' })`）: ISR のキャッシュの部品は選ばせず、置き場は事業者で決まる（`astroPageCacheChoice`。Next.js で選んだ「キャッシュしない」も引き継がない）。記事は `document-isr`（閲覧）と `isr-revalidate`（描き直し）の経路を持つ。

| 事業者 | 記事のキャッシュ（`pageCache`） | 投稿・編集で消す | 経路と数え方 |
|---|---|---|---|
| Cloudflare | Worker の前の Workers Cache（`cacheCloudflare()`） | ✓（`ctx.cache.purge`・全体に伝わる） | `document-isr` → Worker（コードの中のキャッシュ: ヒットは CPU 0）、`isr-revalidate` → Worker → D1（同じリクエストの中。消した後の閲覧は描き終わるのを待つので、その閲覧の 1 リクエストの CPU = キャッシュから返す 2 ms + 描画 15 ms = 17 ms）。**静的アセットも含めて全リクエストを Workers の料金で数える**（`workers-cache-front`）。ビルドのノードは無い |
| Vercel | ISR（`@astrojs/vercel` の `isr`） | ✓（`bypassToken`） | Next.js の ISR と同じ（CDN の期間つきのキャッシュ → ISR の永続ストレージ、描き直しは関数）。ビルドの CPU minute は数えない |
| さくらの VPS | Node のメモリ（`memoryCache()`） | ✓（`cache.invalidate`） | Next.js の VPS と同じ経路（VPS の中）。前段の Cloudflare で「HTML も」なら、Next.js と同じく CDN の期間つきのキャッシュと Free の purge（D-91） |
| Google Cloud | Hosting の CDN（`s-maxage`） | **✗**（デプロイのときしか消えない） | Next.js の GCP と同じ（CDN → Cloud Run）。オンデマンドを選ぶと届かず、即時反映の要件・鮮度で 1 段下げる（Next.js と同じ判定）。始めの既定は 5 分 |
| Netlify（隠している） | durable cache（`cacheNetlify()`） | ✓（タグ） | Next.js の Netlify と同じ。デプロイのクレジットは数えない |

- **画像**: 変わらない（Vercel・VPS の既定は `<Image />` の WebP）。
- **API の置き場**（D-69）: 記事の描き直しも API を呼ぶ（Cloudflare の Astro + VPS の API では、VPS は描き直しの 1 回も API の 1 回として数える。`serverApiClasses` に `isr-revalidate`）。

### 6.3 置いた仮定（template-default・ゲーム上の仮定）

| 値 | 記事コミュニティ | 受託（業務アプリ） |
|---|---|---|
| JS・CSS のファイル数（Next.js の倍率 `assetsFactor`） | 0.3（コメント欄・いいね・ログインの表示だけがアイランド） | 1（表・フォームが画面の大半） |
| 記事のキャッシュを消す更新 | 記事の投稿・編集（Next.js のオンデマンドの再検証と同じ数え方: 書き込みの 1%。30 万 PV で月 300 回。1 回で記事と一覧の 2 ページ。設定「コメントの描き方」で記事のページに含めるとコメントの投稿も） | — （記事のページが無い） |
| 描画の CPU | Next.js と同じテンプレートの値（SSR 15 ms・キャッシュから返す 2 ms）。フレームワークごとの倍率は計測（RS-06）まで入れない | 同じ |
| 初回表示（`firstLoadLight`） | 速さの重さを 1 つ減らす（SPA の `firstLoadHeavy` の逆） | 減らさない |
| 即時反映の要件 | 置き場で決まる（消せる置き場なら満たす。Google Cloud は満たさない） | — |

- 設定「**記事のキャッシュ**」（`pageCache`）は ISR の間隔と同じ値（`revalidateSec`）をこの意味で選ぶ（オンデマンド・1 分・5 分・1 時間・6 時間）。**始めの既定はオンデマンド（投稿・編集で消す）**、消せない Google Cloud では 5 分（`defaultRevalidateSec`）。鮮度の判定は Next.js の ISR と同じ（オンデマンドで消せれば遅れない・期限なら期限の分・前段の CDN でも期限なら約 2 倍）。オンデマンドへの切り替えは ISR と同じ実装の手間。オンデマンドにも、取りこぼしに備えた最大寿命（1 日）を Next.js と同じく数える。
- 消した後の最初の閲覧が描き終わるのを待つか、裏で描くかは構成のノード（`backgroundClasses`）で決まる。Cloudflare は待つ形（同じリクエストの中）で、その閲覧の CPU が Workers Free の 10 ms に数えられる（Workers Free の Astro は記事のページでも当たる）。

### 6.4 基準プレイ（何もしない・シード 1〜20。達成・12 か月のインフラ費の中央値・所持金の中央値）

D-103 の前後（記事コミュニティ。始めの既定: Next.js・静的書き出しは 5 分、Astro は前が「ビルドの間隔 5 分」・後が「記事のキャッシュ: オンデマンド」（Google Cloud は 5 分））。Next.js・SPA・静的書き出しの列は変わらない。

| 記事コミュニティ | Next.js | Astro（前: 静的 + ビルド） | Astro（後: キャッシュ + 投稿で消す） |
|---|---|---|---|
| CF Free | 0 / 20・$4・$139 | 0 / 20・$4・$140 | 0 / 20・$4・$140（1 か月目に Images Free で止まるのは同じ。記事のページも CPU 10 ms に当たるようになった） |
| **CF Paid（目標の根拠）** | **20 / 20・$226・$2,110**（変わらない） | 20 / 20・$241・$2,550 | 20 / 20・$241・$2,550 |
| Vercel Pro | 0 / 20・$1,515・$826 | 0 / 20・$1,739・$1,049 | 0 / 20・**$1,412・$1,382** |
| さくらの VPS 2GB | 8 / 20・$178・$1,698 | 17 / 20・$181・$2,067 | 17 / 20・$181・$2,067 |
| さくらの VPS 4GB | 0 / 20・$339・$1,538 | 16 / 20・$341・$1,907 | 16 / 20・$341・$1,907 |
| Google Cloud | 0 / 20・$772・$1,562 | 20 / 20・$744・$2,053 | 20 / 20・$769・$2,025 |

- **目標の根拠（CF Paid × Next.js）は変わらない。** CF Paid の Astro も変わらない: Workers Cache で静的アセットも Workers のリクエストに数えるようになったが、Paid の込みの 1,000 万リクエストに収まり、描き直しの CPU も込みの CPU 時間に収まる（ビルドの分も前は込みの 6,000 分に収まっていた）。
- **Vercel Pro の Astro は 12 か月で約 $330 安くなった**（$1,739 → $1,412）。前は PV が伸びると 5 分ごとのビルド（記事 2,000〜ページで 1 回 2 分 × 4 vCPU の CPU minute）が毎月かさんでいた。ISR の読み書き・関数の分はそれより小さい。達成は 0 / 20 のまま（Vercel の転送と席が残る）。API を Workers に出した組は 0 → 1 / 20。
- **Google Cloud の Astro は少し高くなった**（$744 → $769）: 記事を Hosting の CDN（5 分の期限）から返し、外れは Cloud Run が描き直す（前は静的なページで Cloud Run に届かなかった）。
- 受託は記事のページが無いので変わらない。
- 同じ日の D-104（静的書き出しの新しい記事はビルドまで開けない）の前後: CF Paid 20 → 17 / 20（$2,111 → $1,747）・VPS 2GB 8 → 0 / 20・AWS 19 → 10 / 20。表は §7.4。
- 前の §6.4（2026-11-02・D-68 の時点の値）は、その後の D-92〜D-98 の費用（ログ・ドメイン・メールなど）が入る前の値なので、上の表の「前」とは合わない。

### 6.5 画面

始める画面の「アプリを何で作りましたか？」に 3 つ目として出る（推奨・既定の印は付けない。説明はシナリオの `text.byFramework.astro`）。カードには、ページごとの描き方と帰結を 1 ページ 1 行で出す（`byFramework.astro.pages`。D-101・D-103）:

- 記事のページ: 「閲覧時に SSR + キャッシュ（最初の閲覧でアダプターが描いて前段にキャッシュし、投稿・編集でそのページのキャッシュを消す。消した後の最初の閲覧は描き終わるのを待つ）」
- 個人向けのページ: 「アダプターで SSR（閲覧のたびにサーバーが描く。Cloudflare では Worker が描くので、1 リクエストの CPU の上限に注意）」

見取り図（D-102）の記事のページの区画（ヘッダー・タイトル・本文・フッター）の札は「**閲覧時に SSR + キャッシュ（投稿で消す）**」（新しい作られ方 `cached`）。ページの札は「鮮度: 投稿・編集でキャッシュを消す」「SNS のカード: HTML に入る」「CPU: 消した後の閲覧が描くのを待つ（Workers は 1 リクエストの上限に注意）」。
Astro を選ぶと構成の一覧から AWS の 2 つが消え、ゲーム中の乗り換え先では「Astro を載せる公式のアダプターが無い」で選べない。設定の欄は「記事のキャッシュ」（ISR の再検証・ビルドの間隔の代わり。D-103）。記事の描き方を替えると設定の意味も替わる（S1 はビルドの間隔・S4 と S5 は出さない。D-107・[13](./13-route-strategies.md) §5b）。
D-107 の後は、カードには既定の描き方を短く出し、ページごとの描き方は次の「③ ページの描き方」の表で選び直す（記事を S1・S4・S5、個人向けを S5 に。Cloudflare で記事をキャッシュしないなら Workers Cache を前に置かない）。

### 6.6 残した点・「データ追加だけで足せるか」の答え

- データだけでは足りなかったのは 2 つ: **ビルドし直しの費用**（estimator の資源・Workload の `build`・ノード `ci-build`）と、**載せられない組の検証**（`unsupported` の DeployTarget を始める画面・乗り換えで弾く）。それ以外（ルートの書き換え・構成の分岐・部品の出し分け・設定の意味）は SPA と同じ仕組みで足りた。06 §2.1 の BuildOutput の型は、まだ作らなくてよい。
- API の置き場（D-69・prd/10 §9.7）: Vercel・VPS の Astro + Cloudflare Workers・D1、Cloudflare の Astro + さくらの VPS の API を許した。
- 後の段: ~~ページごとに描き方を選ぶ形（RS の段 2〜3。Astro の記事を静的・毎回描くにも戻せるようにする）~~ → D-106・D-107（[13](./13-route-strategies.md)）、Server Islands（13 の段 5・S6）、Astro × AWS（コミュニティのアダプター・SST）、フレームワークごとの描画の CPU の倍率（RS-06。計測してから）、Workers Cache が拠点ごとに分かれてヒット率が下がる分（数えていない）、上限の内訳の文の「ISR の閲覧と再生成」を Astro では「キャッシュの描き直し」と書くこと（estimator の文は描き方の名前を知らない）。Next.js の `output: 'export'`（F-03）は §7（D-80）で入れた。Vercel の `isr` で記事を描く形は D-103 で入れた。

## 7. Next.js の静的書き出し（`output: 'export'`。実装・2026-11-02・D-80）

### 7.1 確かめた公式の事実（2026-11-02 取得）

| 事実 | 出典 |
|---|---|
| `next build` でルートごとに HTML を作り、HTML・CSS・JS の静的なファイルを配れる Web サーバーならどこにでも載る。出力は `out/`（例: `/blog/[id]` → `/out/blog/post-1.html`） | [Static Exports](https://nextjs.org/docs/app/guides/static-exports)（2026-08-09 更新） |
| できること: Server Components はビルドのときに動く（静的な HTML と、遷移のための静的なペイロード）。クライアントでのデータの取得は Client Component から（公式の例は SWR）。Route Handler は `GET` だけ、`dynamic = 'force-static'` でビルドのときに静的なファイルになる。`next/image` は `loader: 'custom'`・`loaderFile` で使える（例は Cloudinary） | 同上 |
| 使えないもの: `dynamicParams: true` の動的ルート・`generateStaticParams()` の無い動的ルート・Request に依る Route Handler・Cookies・Rewrites・Redirects・Headers・Proxy（Middleware）・ISR・**既定のローダーでの画像の最適化**・Draft Mode・Server Actions・Intercepting Routes。「If you need to read dynamic values from the incoming request, you cannot use a static export」 | 同上 |
| nginx の例: `try_files $uri $uri.html $uri/ =404` | 同上 |
| `unoptimized: true`（全体は `images.unoptimized`）は原本をそのまま配る。`loaderFile` は「use a custom image optimization service instead of Next.js」 | [Image Component](https://nextjs.org/docs/app/api-reference/components/image)（2026-09-28 更新） |
| Cloudflare の公式の Next.js のローダーは `/cdn-cgi/image/<変換>/<元の画像>` を返す（Images の URL での変換） | [Integrate with frameworks](https://developers.cloudflare.com/images/transform-images/integrate-with-frameworks/)（2026-04-21 更新） |
| Workers の静的アセットの `html_handling` の既定は `auto-trailing-slash` で、`/file` に `/file.html` を返す（リダイレクトなし） | [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)（2026-04-23 更新） |
| Netlify Image CDN は `/.netlify/images?url=…&w=…` で使え、「For all other frameworks, you can use Netlify Image CDN directly」 | [Image CDN](https://docs.netlify.com/build/image-cdn/overview/)（2026-09-25 更新） |
| Vercel の画像の最適化は、Next.js では `/_next/image`（next/image の既定のローダー）、他のフレームワークは `/_vercel/image`（Build Output API の設定）。Next.js の静的書き出しから使う手順は書かれていない（**未確認**なので選べなくした） | [Image Optimization](https://vercel.com/docs/image-optimization)（2026-08-13 更新） |

### 7.2 入れた形（推奨案で自律に決定）

- **独立したフレームワークの選択肢** `nextjs-export`（label「Next.js（静的書き出し）」・`renderingModes: static・spa`）。Next.js の設定・部品にしなかったのは、載せられる事業者・API の置き場・画像の部品・設定の意味がすべて Next.js と違い、Astro・SPA と同じ「始める画面でアプリを選ぶ」形（F-04）がそのまま使えるため。
- **テンプレートの書き換え** `toNextExport(w, spaShape, minutesPerBuild, build)` = `toSpa(toAstro(w, { assetsFactor: 1, … }))`。記事（ISR だったルート）は静的なページにしてビルドし直し（Astro と同じ・D-68 の `build`）、マイページ（SSR だったルート）はブラウザが API で中身を取る（SPA と同じ `spa`。HTML はルートごとの静的なファイル）。JS・CSS は Next.js のまま（倍率 1）。
- **構成**: `composeStack(…, { framework: 'nextjs-export' })` は SPA と同じ形（ISR・SSR の経路なし・静的な配信 + API）に、Astro と同じビルドのノードを足す。名前は「（Next.js の静的書き出し）」。

| 事業者 | 載せ方（DeployTarget） | ビルドし直し | 画像の部品 |
|---|---|---|---|
| Cloudflare | Workers の静的アセット + 同じ Worker の API | Workers Builds | Images（公式のローダー）・R2・縮める・最適化しない |
| Vercel | 静的（CDN）+ Vercel Functions の API | Vercel のビルド（Pro は CPU minute） | **画像の最適化は選べない**（既定は縮める）。縮める・最適化しない・Cloudflare の R2 + Images |
| さくらの VPS | nginx で静的 + 同じホストの Node の API | 同じホスト（数えない・仮定） | **ホストで変換は選べない**（既定は縮める）。縮める・最適化しない |
| AWS | S3 + CloudFront + Lambda（SPA と同じ形） | 手元・CI（数えない・仮定。デプロイの無効化も数えない） | 縮める（既定）・最適化しない・Cloudflare |
| Netlify | 静的 + Netlify Functions の API | 本番のデプロイ 1 回 15 クレジット（Astro と同じ） | Image CDN（URL のローダー）・縮める・最適化しない |
| AWS の OpenNext | **unsupported**（サーバーが無いので OpenNext は使わない） | — | — |

- **API の置き場**: SPA と同じ部品・同じ組（D-65・D-67）。Vercel・AWS・Netlify の静的 + Cloudflare Workers・D1、Cloudflare の静的 + AWS Lambda・DynamoDB／さくらの VPS。ブラウザ（Client Component）が別のサブドメインの API を呼ぶ（CORS・Cookie の前提は F-13 と同じ）。
- **部品**: ISR のキャッシュ・OGP の前処理・API の応答のキャッシュは出さない（記事は静的、マイページは個人化）。さくらの VPS の前段の CDN の「HTML も」は、記事の静的なページを CDN が返す形で選べる（D-91）。
- **満足度**: 初回表示・JS の量は Next.js と同じ扱い（`firstLoadHeavy`・`firstLoadLight` なし。速さの重さには SSR の CPU の値をそのまま使う: マイページはサーバーの描画が無い代わりにブラウザが HTML → JS → API を待つ、という仮定）。記事ごとの SNS のカードは HTML に入る（`noSocialCards` は SPA だけ）。鮮度・即時反映は設定「ビルドの間隔」（オンデマンドは更新のたびにビルド）。
- **新しい記事はビルドまで開けない（D-104・ユーザーの決定 C-7）**: 説明はそのまま、ゲームでは「利用者の新しい投稿がすぐ見える」というコミュニティの要件を満たさない形として扱う。
  - 鮮度の遅れ = 間隔 + 1 回のビルドの時間（記事 2,000 ページで 2 分。オンデマンドでもビルドの時間は待つ）。前はビルドの時間を足していなかった。
  - 遅れがシナリオの `newPostVisibleSec`（記事コミュニティ 60 秒。投稿した人は投稿の直後に自分の記事を開く・**ゲーム上の仮定**）を超えると、鮮度をさらに 1 段下げる（即時反映の要件と同じ下げ方）。新しい記事のページはビルドが終わるまで無い（404）ので、ビルドの時間がある限り 1 分には収まらない。
  - Next.js の ISR・Astro のキャッシュは、新しい記事を最初の閲覧で描くので当たらない。コメントを記事のページに含めたときのコメントの遅れにも、ビルドの時間を足す（オンデマンドでも）。
  - 理由の文: 「ビルドの間隔 5 分 + ビルドの時間 約 2 分・新しく投稿された記事はビルドが終わるまでページが無く、投稿した人がすぐ開けない（コミュニティの要件を満たさない）」。
  - 受託は記事のページが無く、`newPostVisibleSec` も無いので変わらない。
- **仮定**（ゲーム上）: 1 回のビルドの時間は Astro と同じ式（1 分 + 記事 1,000 ページあたり 0.5 分）。マイページの中身の API の CPU は SPA の `dataCpuFactor`（0.5）倍。受託は画像のスロットを出さないので、画像の既定は替えない（添付ファイルを縮めない）。

### 7.3 基準プレイ（何もしない・シード 1〜20・ビルドの間隔 5 分）

> D-104 の前の値（2026-11-02）。D-104 の後は §7.4。

達成・12 か月のインフラ費の中央値・所持金の中央値。Next.js・SPA・Astro の列は今の値（変わらない）。

| 記事コミュニティ | Next.js | Vite の SPA | Astro | Next.js（静的書き出し） |
|---|---|---|---|---|
| CF Free | 0 / 20（3 か月目に停止） | 0 / 20 | 0 / 20 | 0 / 20（同じ） |
| **CF Paid（目標の根拠）** | **20 / 20・$182・$2,152** | 20 / 20・$175・$1,870 | 20 / 20・$189・$2,601 | 20 / 20・$181・$2,153 |
| Vercel Pro | 0 / 20・$1,491・$851 | 0 / 20・$1,274・$774 | 0 / 20・$1,712・$1,076 | 0 / 20・$1,742・$592（画像は縮める） |
| さくらの VPS 2GB | 10 / 20・$157・$1,720 | 0 / 20・$157・$1,566 | 17 / 20・$157・$2,090 | 10 / 20・$157・$1,717 |
| さくらの VPS 4GB | 0 / 20・$317・$1,560 | 0 / 20・$317・$1,405 | 16 / 20・$317・$1,930 | 0 / 20・$317・$1,557 |
| AWS（Amplify / S3 + CloudFront） | 10 / 20・$623・$1,702 | 19 / 20・$179・$1,860 | 載せない | 19 / 20・$378・$1,943 |
| Netlify Pro | 0 / 20・$1,072・$1,263 | 0 / 20・$964・$1,084 | 0 / 20（所持金が尽きる） | 0 / 20（所持金が尽きる。Astro と同じくデプロイのクレジット） |

| 受託 | Next.js | Vite の SPA | Astro | Next.js（静的書き出し） |
|---|---|---|---|---|
| CF Paid | 20 / 20・$68・$2,036 | 20 / 20・$68・$2,100 | 20 / 20・$68・$2,036 | 20 / 20・$68・$2,036 |
| Vercel Pro | 0 / 20・$559・$1,545 | 0 / 20・$542・$1,624 | 0 / 20・$559・$1,545 | 0 / 20・$540・$1,563 |
| さくらの VPS 2GB / 4GB | 0・8 / 20 | 1・12 / 20 | 0・8 / 20 | 0・8 / 20 |
| AWS | 20 / 20・$180・$1,872 | 20 / 20・$50・$2,002 | 載せない | 20 / 20・$50・$2,002 |

API の置き場・画像を替えた静的書き出し（同じ取り方）:

| シナリオ | 構成 | 部品 | 達成 | 12 か月の費用 | 所持金 |
|---|---|---|---|---|---|
| 記事 | Vercel Pro | 画像: Cloudflare の R2 + Images | 0 / 20 | $1,186 | $1,156 |
| 記事 | Vercel Pro | 画像: 最適化しない（原本） | 0 / 20（1 か月目に所持金が尽きる） | — | −$78 |
| 記事 | Vercel Pro | API: Workers + D1・画像: Cloudflare に縮める | 0 / 20 | $760 | $1,577 |
| 記事 | CF Paid | API: AWS Lambda | 20 / 20 | $205 | $2,130 |
| 記事 | CF Free | API: AWS Lambda・画像は縮める | 16 / 20 | $25 | $1,930 |
| 記事 | CF Paid | API: VPS 2GB | 4 / 20 | $329 | $1,634 |
| 記事 | AWS（S3 + CloudFront） | API: Workers + D1 | 19 / 20 | $402 | $1,919 |
| 記事 | VPS 2GB | 前段の CDN（静的と画像） | 16 / 20 | $157 | $1,809 |
| 受託 | Vercel Pro | API: Workers + D1 | **20 / 20** | $300 | $1,817 |
| 受託 | CF Paid | API: AWS Lambda / VPS 2GB | 20 / 20・12 / 20 | $119 / $224 | $1,998 / $1,775 |

- **目標の根拠（CF Paid × Next.js）は変わらない**（既存の golden・基準プレイもすべて同じ）。静的書き出しの CF Paid は Next.js とほぼ同じ（初回表示を同じ扱いにしたので、差は Worker のリクエストと KV の書き込みが減る分だけ）。
- **Vercel Pro は Next.js より悪い**: 既定のローダーが使えず、画像を縮めて配る（サイズ違いが無い）分だけ Fast Data Transfer が増える。Cloudflare の Images に出すと費用は Next.js より下がる。
- **AWS（S3 + CloudFront）は Amplify の Next.js より安く届く**（10 → 19 / 20）。SPA より費用が高いのは、ページごとの HTML と Next.js の JS・CSS を CloudFront から配る分（SPA は入口だけ）。
- 受託はビルドし直しが無く、ほぼ Next.js と同じ（Vercel Pro + Workers・D1 で届くのも同じ）。
### 7.4 D-104 の前後（記事コミュニティ・何もしない・シード 1〜20・ビルドの間隔 5 分）

達成・12 か月のインフラ費の中央値・所持金の中央値。2026-11-03 の値（D-103 の後）。Next.js の列は変わらない。

| 記事コミュニティ | Next.js | 静的書き出し（前） | 静的書き出し（後） |
|---|---|---|---|
| CF Free | 0 / 20・$4・$139 | 0 / 20・$4・$139 | 0 / 20・$4・$138 |
| **CF Paid（目標の根拠）** | **20 / 20・$226・$2,110**（変わらない） | 20 / 20・$224・$2,111 | **17 / 20**・$210・$1,747 |
| Vercel Pro | 0 / 20・$1,515・$826 | 0 / 20・$1,766・$567 | 0 / 20・$1,550・$411 |
| さくらの VPS 2GB | 8 / 20・$178・$1,698 | 8 / 20・$178・$1,696 | **0 / 20**・$177・$1,403 |
| さくらの VPS 4GB | 0 / 20・$339・$1,538 | 0 / 20・$339・$1,536 | 0 / 20・$337・$1,242 |
| AWS（S3 + CloudFront） | 9 / 20・$653・$1,672 | 19 / 20・$408・$1,913 | **10 / 20**・$242・$1,712 |
| Google Cloud | 0 / 20・$772・$1,562 | 0 / 20・$1,744・$465 | 0 / 20・$1,494・$405 |

- 既定の 5 分では遅れが 7 分で「普通」、さらに新しい記事の 1 段で「悪い」（満足度 −0.1）。PV の伸びが下がる分、費用の中央値も下がった。
- 目標・バランスの値は動かしていない（ユーザーの決定どおり、静的書き出しはコミュニティの要件に合わない選択として不利になる）。
- 受託（記事のページが無い）は変わらない。

