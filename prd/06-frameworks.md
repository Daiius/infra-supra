# 06. フレームワークとビルド出力

> 状態: **設計中**。各フレームワーク・ホストの対応状況（どの機能がどのホストで動くか）は**未調査**で、
> 料金データと同じく公式ドキュメントを出典にして catalog に入れる（[03](./03-pricing-schema.md) §1 と同じ規律）。

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
