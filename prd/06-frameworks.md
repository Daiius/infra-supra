# 06. フレームワークとビルド出力

> 状態: **設計中**。各フレームワーク・ホストの対応状況（どの機能がどのホストで動くか）は**未調査**で、
> 料金データと同じく公式ドキュメントを出典にして catalog に入れる（[03](./03-pricing-schema.md) §1 と同じ規律）。
> ⚠ **一部実装済み**（Next.js と Vite の SPA の 2 つだけの最小の形。BuildOutput は Workload の routes で代用）→ [10](./10-framework-branch.md) §7・「D-34」（2026-11-01）
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
| MVP 直後 | Astro | 静的出力が基本。SSR はアダプターで Vercel・Cloudflare・Node へ | 静的出力なら静的ホストの比較に帰着する。SSR アダプターで Vercel に載せたときの課金 |
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

## 6. Astro（実装・2026-11-02・D-68）

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

### 6.2 入れた形

- **FrameworkProfile** `astro`（`renderingModes: static・ssr`）。**DeployTarget**: Cloudflare（`@astrojs/cloudflare`）・Vercel（`@astrojs/vercel`）・さくらの VPS（`@astrojs/node` standalone + nginx）は `native`、**AWS・AWS（OpenNext）は `unsupported`**（公式のアダプターが無い）。`frameworkSupported` が始める画面の構成の一覧と乗り換え先を絞る（E-3 の最初の使い手）。
- **テンプレートの書き換え** `toAstro(w, shape, build)`: ISR だったルート（記事）を `static` に、SSR はそのまま（アダプター）。ページあたりの JS・CSS は `assetsFactor` 倍。記事があれば Workload に `build` を付ける。
- **ビルドし直し**（estimator の拡張）: Workload の `build`（内容の更新・間隔・1 回の時間）から `ResolvedWorkload.builds`。月の回数は「間隔 T（ビルドの時間より短くはできない）の枠 N のうち、更新が 1 回でもある枠」= `N × (1 − e^(−更新 / N))`（更新は一様に到着すると仮定）。時間は 1 回ごとに分へ切り上げる（Vercel は明記・Cloudflare は記載なしで同じく切り上げ）。
  構成のノード `ci-build`（経路を持たない）が `build-minutes`（新しい資源・単位 `minute`）を数える。Cloudflare は Workers Builds（Free は超えると `upgrade-required` の解釈）、Vercel Pro は CPU minute（Elastic の最小 4 vCPU とみなす解釈）、Hobby は込み（メーターなし・1 日 100 デプロイは事実として出すだけ）、VPS はノードを置かない（同じホストでビルド・CPU は数えない）。
- **構成**（`composeStack(…, { framework: 'astro' })`）: ISR のキャッシュの部品・HTML を前段でキャッシュする部品を出さない（Next.js だけ）。記事は `document-static`（Cloudflare は Workers の静的アセット＝Worker を起動しない・Vercel は CDN・VPS は nginx）。名前は vinext を外して「（Astro）」。
- **画像**: 事業者の画像の部品はそのまま。Vercel・VPS の既定の画像（閲覧のときに変換）は `<Image />` の既定に合わせて WebP で配る（`autoImageFormat`）。投稿された画像は静的なページのビルドで変換しない（ビルドの時間に入れない）。

### 6.3 置いた仮定（template-default・ゲーム上の仮定）

| 値 | 記事コミュニティ | 受託（業務アプリ） |
|---|---|---|
| JS・CSS のファイル数（Next.js の倍率 `assetsFactor`） | 0.3（コメント欄・いいね・ログインの表示だけがアイランド） | 1（表・フォームが画面の大半） |
| ビルドを起こす更新（`rebuildShare`。内容の更新 = PV × API × 書き込み × 0.5 の割合） | 2%（30 万 PV で月 300 回 ≒ 1 日 10 回。コメントはアイランドが API で読むのでビルドしない） | 0（静的なページが無い） |
| 1 回のビルドの時間 | 1 分 + 記事 1,000 ページあたり 0.5 分（2,000 ページで 2 分） | — |
| 初回表示（`firstLoadLight`） | 速さの重さを 1 つ減らす（SPA の `firstLoadHeavy` の逆） | 減らさない |
| 即時反映の要件 | 「オンデマンド」= 記事を更新するたびにビルド（ビルドの数分は待つが、要件を満たすとみなす） | — |

- 設定「ビルドの間隔」（`buildInterval`）は ISR の間隔と同じ値（`revalidateSec`）をこの意味で選ぶ（オンデマンド・1 分・5 分・1 時間・6 時間。既定 5 分）。鮮度の判定は ISR の間隔と同じ（ビルドの時間の遅れは足していない）。オンデマンドへの切り替えは ISR と同じ実装の手間。
- Vercel の `isr` オプションは使わない（記事は Astro の既定どおり静的にビルドする）。使う形（記事をリクエストのたびに描いて ISR でキャッシュ）は後の段（§6.6）。

### 6.4 基準プレイ（何もしない・シード 1〜20・ビルドの間隔 5 分）

12 か月のインフラ費の中央値と所持金の中央値。Next.js・SPA の列は今の値（変わらない）。

| 記事コミュニティ | Next.js | Vite の SPA | Astro |
|---|---|---|---|
| CF Free | 0 / 20（3 か月目に停止） | 0 / 20 | 0 / 20（同じ: マイページの SSR 15 ms が CPU 10 ms に当たる） |
| **CF Paid（目標の根拠）** | **20 / 20・$182・$2,152** | 20 / 20・$175・$1,870 | 20 / 20・$189・$2,601 |
| Vercel Pro | 0 / 20・$1,491・$851 | 0 / 20・$1,274・$774 | 0 / 20・$1,712・$1,076 |
| さくらの VPS 2GB | 10 / 20・$157・$1,720 | 0 / 20・$157・$1,566 | 17 / 20・$157・$2,090 |
| さくらの VPS 4GB | 0 / 20・$317・$1,560 | 0 / 20・$317・$1,405 | 16 / 20・$317・$1,930 |

| 受託 | Next.js | Vite の SPA | Astro |
|---|---|---|---|
| CF Paid | 20 / 20・$68・$2,036 | 20 / 20・$68・$2,100 | 20 / 20・$68・$2,036（Next.js と同じ） |
| Vercel Pro | 0 / 20・$559 | 0 / 20・$542 | 0 / 20・$559 |
| さくらの VPS 4GB | 8 / 20 | 12 / 20 | 8 / 20 |

- **記事コミュニティの Astro の差は、ほぼすべて初回表示の仮定（`firstLoadLight`）**。外すと CF Paid は $2,153（Next.js と同じ）・VPS 2GB は 14 / 20・VPS 4GB は 2 / 20。速さが「悪い」に落ちる月が減って PV の伸びが下がらない分が効く。
- ビルドの費用は小さい: 30 万 PV・5 分ごとで月 約 300 回 × 2 分。Workers Builds は込みの 6,000 分（Free でも 3,000 分）に収まる。Vercel Pro は 約 590 分 × 4 vCPU × $0.0035 ≒ 月 $8（クレジットに当たる）。間隔を 1 時間にすると CF Paid の所持金は $2,412（鮮度が「普通」）、オンデマンドでもほぼ同じ。
- 記事の更新が多いと効く: 1,000 万 PV・更新のたびのビルドで月 約 1.6 万分（Workers Paid は $50）。Vercel Pro では同じ量で約 $225。
- 受託は静的なページが無く、Next.js と同じ値（JS も同じとみなした）。

### 6.5 画面

始める画面の「アプリを何で作りましたか？」に 3 つ目として出る（推奨・既定の印は付けない。説明はシナリオの `text.byFramework.astro`）。Astro を選ぶと構成の一覧から AWS の 2 つが消え、ゲーム中の乗り換え先では「Astro を載せる公式のアダプターが無い」で選べない。設定の欄は「ビルドの間隔」（ISR の再検証の代わり）。

### 6.6 残した点・「データ追加だけで足せるか」の答え

- データだけでは足りなかったのは 2 つ: **ビルドし直しの費用**（estimator の資源・Workload の `build`・ノード `ci-build`）と、**載せられない組の検証**（`unsupported` の DeployTarget を始める画面・乗り換えで弾く）。それ以外（ルートの書き換え・構成の分岐・部品の出し分け・設定の意味）は SPA と同じ仕組みで足りた。06 §2.1 の BuildOutput の型は、まだ作らなくてよい。
- 後の段: Vercel の `isr` で記事をリクエストのたびに描く形（Next.js の ISR と同じ経路になる）、Server Islands、Astro × AWS（コミュニティのアダプター・SST）、VPS のビルドの CPU、Vercel Hobby の 1 日 100 デプロイの判定、ビルドの遅れを鮮度に足すこと、Astro の静的出力の画像をビルドで変換する形（`compile`）、Next.js の `output: 'export'`（F-03）。
