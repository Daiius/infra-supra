# 01. ドメインモデル

> 状態: **設計中（Phase 1 着手前）**。型は TypeScript のスケッチで、名前と形は実装時に詰める。

## 1. 計算の流れ

```
 WorkloadInput（簡易 / 詳細）+ FrameworkProfile（06）
        │ resolveWorkload（テンプレートの既定値で穴を埋め、導出値を計算）
        │ compileBuildOutput（フレームワーク → BuildOutput → リクエストクラス。06 §2）
        ▼
 Workload（正規形・各値に出所）           Architecture（ノード + 接続 + 課金アカウント）
        │                                         │   ServiceOffering（catalog のデータ）
        └──────────────┬──────────────────────────┘
                       ▼
            simulateResources  ── ComponentKind ごとの変換（コード）
                       │
                       ▼
            UsageLedger（ノード × メーター × 期間 + 導出根拠）
                       │                       PriceBook（catalog のデータ・版付き）
          ┌────────────┴───────────┐                 │
          ▼                        ▼                 │
  evaluateCapacity           priceUsage ◀────────────┘
 （制限・使用率・ボトルネック）   （無料枠プール → 段階料金 → クレジット → 固定費）
          │                        │
          └───────────┬────────────┘
                      ▼
       Estimate（入力・料金データの版・仮定・Bill・CapacityReport のスナップショット）
```

- 各段は**純粋関数**。前段の出力だけを入力にし、時刻・乱数・I/O に触れない。
- **料金計算（priceUsage）は性能評価の結果を見ない。** ただし無料プランで上限を超えたときの「課金ではなく停止」は
  PriceBook 側の事実なので、priceUsage が `LimitBreach` として出し、性能評価が可用性に反映する（§5.3）。
- ゲームモードは `Workload` を月ごとに作り直してこの流れを毎ターン回す（[08](./08-roadmap.md) Phase 3）。

## 2. 出所（provenance）

企画書 §11.2「実際の料金と仮定を区別する」を型で担保する。数値を持つ入力・データには出所を付ける。

```ts
type Basis =
  | 'official'         // 公式の料金表・仕様。出典 URL と取得日が必須
  | 'user-input'       // 利用者が入力した値
  | 'template-default' // テンプレートの既定値（それ自体は仮定。テンプレートに根拠メモを書く）
  | 'derived'          // 他の値から計算した値（式と入力を保持）
  | 'assumption'       // 測れない値を置いたもの（性能・障害率・ユーザー行動）
  | 'fictional';       // テスト用の架空値。本番の UI では使わない

type Sourced<T> = { value: T; basis: Basis; note?: string; sourceRef?: SourceRef };
type SourceRef = { url: string; retrievedAt: string /* YYYY-MM-DD */; excerpt?: string };
```

- `official` は `sourceRef` を必須にする（スキーマ検証で落とす）。
- `fictional` を含む PriceBook は、本番ビルドの UI では読み込みを拒む（[05](./05-test-strategy.md) §4）。

## 3. Workload

### 3.1 入力は「正準な入力 + 導出値」にする

企画書の入力項目には互いに導出できるものがある（MAU・DAU・PV・ページ数/人、平均 RPS・ピーク RPS など）。
**全部を独立入力にすると矛盾した組み合わせが作れてしまう**ので、正準な入力を決め、残りは導出する。
導出値を直接上書きしたい場合は**明示的な上書き**（`overrides`）として持ち、上書きされたことを結果に残す。

| 区分 | 正準な入力 | 導出 |
|---|---|---|
| 規模 | MAU、DAU/MAU 比、1 日 1 人あたりのセッション数、1 セッションあたりのページ数 | 月間 PV・日次 PV |
| 時間分布 | 24 時間の重み（平日 / 休日の 2 本）、時間内のバースト係数 | 時間帯別リクエスト・平均 RPS・ピーク RPS |
| ページ構成 | ページの種類の割合（静的 / SSR / SPA）、1 ページあたりの API 呼び出し・アセット数・画像数 | クラス別のリクエスト数 |
| 転送 | アセット・HTML・API 応答・画像の平均サイズ、CDN ヒット率、ブラウザキャッシュの再利用率 | 転送量（クライアント↔エッジ、エッジ↔オリジン） |
| 処理 | リクエストクラスごとの CPU ms・I/O 待ち ms・メモリ | CPU 時間・壁時計時間・GB 秒 |
| DB | リクエストクラスごとのクエリ数と読み書き行数、初期容量、月あたりの増加量 | 行の読み書き総数・容量の推移 |
| オブジェクト | 1 MAU あたりの月間アップロード数・平均サイズ・保持期間 | 保存量・書き込み操作・読み取り操作 |
| コンテンツの在庫 | ページ数（ルートごと）、画像の種類数と派生の数、月あたりの更新・追加 | 画像変換・ISR の再生成など、PV ではなく在庫で頭打ちになる件数 |
| 閲覧者の地域 | 地域ごとの割合 | 地域料金のメーター（転送量・CDN）の単価の加重 |

コンテンツの在庫と閲覧者の地域は、スパイク（[`spikes/concept-2026-10-31`](../spikes/concept-2026-10-31/README.md) 所見 5・8）で必要と分かった。

`spikeMultiplier`（一時的なスパイク倍率）は月間合計ではなく**ピークの評価**に使う（課金量への寄与はスパイクの継続時間で別に持つ）。

### 3.2 リクエストクラス

エンジン内部では、トラフィックを**リクエストクラス**に分けて扱う。MVP のクラス:

| クラス | 例 | 主に触るコンポーネント |
|---|---|---|
| `document-static` | 静的 HTML | CDN / 静的ホスティング |
| `document-ssr` | SSR された HTML | CDN（多くは miss）→ 関数 / アプリサーバー → DB |
| `asset` | JS / CSS / フォント | CDN / 静的ホスティング |
| `api` | JSON API | 関数 / アプリサーバー → DB |
| `image-read` | 画像の表示 | CDN → オブジェクトストレージ |
| `image-write` | 画像のアップロード | 関数 / アプリサーバー → オブジェクトストレージ |

各クラスは「月間件数・応答サイズ・キャッシュ可否・CPU ms・I/O 待ち ms・DB の読み書き行数」を持つ。
フレームワーク由来のクラスとして、ISR の再生成（`document-isr-revalidate`）・ミドルウェアの実行（`middleware`）・
画像の変換（`image-transform`）を加える。これらの件数は PV からではなく BuildOutput から導く（[06](./06-frameworks.md) §2.1）。
ページの種類の割合（§3.1）も、BuildOutput のルートグループから決まる。
WebSocket・WebRTC・動画・バッチは Phase 6 でクラスを足して扱う（クラスの追加はエンジンのコード変更）。

### 3.3 期間

- 課金の基本単位は **1 か月 = 730 時間**（月による日数の差は捨てる。仮定として明示する）。
- 時間帯の評価は **代表的な 1 週間（168 時間）** を基本形にする。日次の無料枠（[03](./03-pricing-schema.md) §4）は
  この 1 週間から平日・休日の 1 日分を取り出して評価する。
- ゲームモードは月ごとに Workload を作り直す。月内の成長は扱わない（月初の値で 1 か月を代表させる。要確認）。

## 4. Architecture・ComponentKind・ServiceOffering

### 4.1 振る舞いはコード、具体値はデータ

- **ComponentKind**（コード・estimator）: 「受け取ったトラフィックから、どの汎用リソースをどれだけ消費し、
  どのトラフィックを次へ流すか」と「どの制限で詰まるか」を定める。MVP の種類:
  `cdn` / `static-hosting` / `serverless-function` / `serverless-sql`（D1 型）/ `managed-postgres`（Supabase 型）/
  `object-storage` / `vps`（ホスト）/ `process`（VPS 上で動く nginx・アプリ・MySQL）。
- **ServiceOffering**（データ・catalog）: 実在サービスの 1 プラン。ComponentKind を指定し、そのパラメータ
  （制限・メーターの対応・リージョン）を与える。料金そのものは PriceBook に分ける（[03](./03-pricing-schema.md)）。
- 規則: **既存の ComponentKind で表せるサービスの追加は、データの追加だけで済む。** 新しい種類が要るときだけコードを足す。

### 4.2 グラフ

```ts
type Architecture = {
  id: string;
  name: string;
  accounts: BillingAccount[];      // 無料枠・クレジットの共有単位（Cloudflare アカウント、Vercel チーム、Supabase 組織…）
  nodes: ArchNode[];
  edges: ArchEdge[];
  entry: Partial<Record<RequestClass, NodeId>>; // クラスごとの入口（多くは CDN）
};
type ArchNode = {
  id: NodeId;
  role: Role;                      // 'cdn' | 'static-hosting' | 'compute' | 'database' | 'object-storage' | 'host' …
  offering: OfferingRef;           // { provider, service, plan }
  account: AccountId;
  hostedOn?: NodeId;               // process → vps。ホストの容量を共有し、課金はホスト側に寄る
  config: Record<string, unknown>; // インスタンスサイズ・台数・リージョンなど。ComponentKind ごとに zod で検証
};
type ArchEdge = {
  from: NodeId; to: NodeId;
  classes: RequestClass[];         // この接続を流れるリクエストクラス
  boundary: 'same-host' | 'same-provider' | 'cross-provider' | 'internet'; // 転送課金の判定に使う
};
```

- MVP の見積モードでは、グラフは**組み立て済みのスタック**として与える。スタックは「フレームワーク × ホスト」の DeployTarget から組み立てる（[06](./06-frameworks.md) §4）。グラフエディタ（Phase 5）は同じ型を編集する。
- 構成の検証（必要なコンポーネントの欠落・接続できない組み合わせ・`hostedOn` の不整合）は estimator の純関数にする。

### 4.3 転送量の二重計上を避ける

転送量は**接続（edge）に 1 回だけ**記録し、どちら側のノードの課金に載るかを境界と PriceBook で決める。
同じバイトを送信側の egress と受信側の ingress で 2 回課金するのは、両プロバイダーが実際にそうする場合に限る
（その場合も Usage は 1 件で、LineItem が 2 件になる）。

## 5. Usage・Bill・Capacity

### 5.1 Usage

```ts
type UsageRecord = {
  nodeId: NodeId;
  resource: ResourceKey;  // 汎用リソース: 'requests' | 'cpu-ms' | 'wall-ms' | 'gb-seconds' | 'rows-read' | 'rows-written'
                          // | 'storage-gb-month' | 'object-writes' | 'object-reads' | 'egress-bytes' | 'instance-hours' …
  quantity: Decimal;
  period: 'month' | { day: 'weekday' | 'weekend' } | { hour: number /* 0..167 */ };
  derivation: Derivation; // 式と入力値（説明表示用）
};
```

汎用リソースからプロバイダー固有のメーターへの対応は ServiceOffering が持つ（例: Workers の「CPU 時間」は `cpu-ms`、
Lambda の「実行時間」は `gb-seconds`）。**「Workers は CPU 時間、Lambda は壁時計時間で課金される」**のような差が
ここで自然に出る。これは学習上の見どころなので、説明表示で強調する。

### 5.2 Bill

```ts
type Bill = {
  currency: Currency;           // 表示通貨。換算は ExchangeRate（仮定・日付付き）で行い、原通貨も残す
  lines: LineItem[];
  totals: { fixed: Decimal; usage: Decimal; credits: Decimal; total: Decimal };
  priceBookVersions: Record<ProviderId, string>;
  breaches: LimitBreach[];
};
type LineItem = {
  account: AccountId;
  nodeIds: NodeId[];            // 共有プールの明細は複数ノードにまたがる
  kind: 'base-fee' | 'usage' | 'credit' | 'minimum-charge';
  meter?: MeterId;
  quantity?: Decimal;
  allowanceApplied?: Decimal;   // この明細で消費した無料枠
  billableQuantity?: Decimal;
  tiers?: { from: Decimal; to: Decimal | null; quantity: Decimal; unitPrice: Decimal; amount: Decimal }[];
  amount: Decimal;              // 原通貨
  priceRef: PriceRef;           // どの PriceBook の版・どのプラン・どのメーターか
};
```

### 5.3 上限超過時の挙動

プランの上限を超えたときの挙動は料金データの一部として持つ（[03](./03-pricing-schema.md) §6）:
`bill`（超過料金）/ `block`（リクエストが失敗する）/ `throttle`（遅くなる）/ `upgrade-required`（上位プランが必須）。
`block` と `throttle` は金額にならないので `LimitBreach` として性能評価に渡り、エラー率・可用性に効く。
**無料枠を使い切った無料プランが「タダのまま止まる」ことを、金額と可用性の両面で見せる**のが狙い。

### 5.4 CapacityReport

- 制限への接近度（例: D1 のデータベースあたり容量上限、関数の CPU 時間上限、同時接続数）を `official` の制限値と比べる。
- 使用率（VPS の CPU・メモリ・帯域、Supabase のコンピュートサイズ）はピーク時間帯で評価する。
- レイテンシ・エラー率は `assumption` の性能プロファイルから推定する（Phase 1 では使用率と制限の判定まで。
  p50/p95/p99 は Phase 2 以降。[08](./08-roadmap.md)）。

## 6. 説明可能性

- `Derivation` は「式の名前・人が読める式・入力値（それぞれの出所付き）」を持つ。UI はこれを展開して
  「月 120 万リクエスト − 無料 1,000 万 = 0 → $0」のように表示する。
- Estimate は**入力・解決後の Workload・Architecture・PriceBook の版・為替の仮定・結果**をまとめて保存する。
  料金データが更新されても、保存した見積は当時の版で再計算できる（PriceBook は版ごとに残す）。

## 7. 運用・移行の費用（要確認）

企画書 §1 は「運用・移行・保守のコスト」も考慮するとしている。インフラ請求とは別の明細として、
`laborHours × hourlyRate`（どちらも `assumption`）で表す案。VPS の「安いが手間がかかる」を金額で比べられるようにする。
見積モードに入れるか、ゲームモードだけにするかは未決（[_grilling/decisions.md](./_grilling/decisions.md)）。

## 8. 判断ポイント（コストに効く仮定を選択肢として扱う）

> 2026-10-31 のスパイクを受けたユーザーの方針（[_grilling/decisions.md](./_grilling/decisions.md) D-11）。

結論を左右する仮定（SSR 1 回の CPU 時間、画像のサイズ、ブラウザキャッシュの効き、同時処理の係数など）は、
**不確かさの幅として出さない**。幅にすると見積は「$20〜$107」のように使えなくなり、ゲームでは理不尽な乱数になる。
代わりに、**仮定そのものを選択肢として表に出す**。

```ts
type DecisionPoint = {
  id: string;                              // 'ssr-cpu' | 'image-size' | 'browser-cache' | 'fluid-concurrency' …
  label: string;                           // 「SSR の重さ」
  options: { id: string; label: string; values: Partial<WorkloadInput>; note?: string }[]; // 「軽い（5 ms）」「普通（15 ms）」「重い（50 ms）」
  defaultOption: string;
  surfacedAs: ('scenario' | 'user-choice' | 'estimate-key-point')[];
};
```

| 使われ方 | 意味 | 例 |
|---|---|---|
| `scenario` | シナリオが値を決める（プレイヤーは変えられない前提条件） | 「このアプリは画像が多い」 |
| `user-choice` | 利用者・プレイヤーが選ぶ。ゲームでは行動になり、費用・作業時間を持てる | 画像圧縮・アプリケーション最適化・キャッシュ設定変更（企画書 §5.4） |
| `estimate-key-point` | 見積の結果に「重要な前提」として添える。**どの値を境に結論が入れ替わるか**を示す | 「SSR が 10 ms を超えると Cloudflare Free は使えない」 |

### 8.1 重要なポイント = プラットフォームの前提 × アプリ側の判断

プロダクトの軸（README「目的」・D-12）は、判断ポイントを次の 2 つの交点として扱うことで実現する。

- **プラットフォームの前提**（データ・`official`）: 料金・制限・挙動の中で、アプリの形によって結論を変えるもの。
- **アプリ側の判断**（判断ポイント・`assumption` / 利用者の選択）: その前提に当たるかどうかを決める、アプリの性質や選択。

| プラットフォームの前提（スパイクで見つかったもの） | 当たるかを決めるアプリ側の判断 |
|---|---|
| Cloudflare Free は 1 リクエストあたり CPU 10 ms まで（超えると Error 1102） | SSR の重さ |
| Cloudflare Free・D1 Free は日次の上限で、超えると UTC 0 時まで止まる | 多い日のピーク（スパイク） |
| Cloudflare は egress 無料、Vercel は Fast Data Transfer に課金 | 画像のサイズ・圧縮・ブラウザキャッシュ |
| Vercel の ISR は CDN が返し、vinext の ISR は閲覧ごとに Worker と KV を通る | ISR を使うページの割合 |
| Vercel の画像最適化は変換回数（画像の種類 × サイズ違い）に課金 | 画像の在庫・サイズ違いの数 |
| Vercel Hobby は商用利用が不可 | 商用かどうか（シナリオ） |
| Vercel のメモリはインスタンスの生存時間で課金 | I/O 待ちの長さ・同時処理 |

- 前提はプラットフォームのデータ（PriceBook・Limit・DeployTarget）に `premise` として印を付け、**人が読める 1 文**（上の左列）を持たせる。
- 前提には 2 種類ある（スパイク所見 14）。**量の境目**（「1 日 10 万リクエストまで」）は、当たっているかと境目までの距離を出す。
  **常に効く事実**（「2GB プランは SLA 非対応」「最低利用期間 3 か月」）は月額に効かないので、説明と、ゲーム側の効果（可用性・乗り換えの費用）に使う。
- 見積の「重要な前提」とゲームのイベント・行動の説明は、同じ 1 文を使う。説明の文面を 2 か所で作らない。
- 見積は、選んだ構成で**当たっている前提**と、**あと少しで当たる前提**（境目までの距離）を並べる。

- 境目の値（反転点）は、エンジンが選択肢の値を動かして計算する。範囲を出すのではなく、**境目の位置を 1 つの文で示す**。
- どの仮定を判断ポイントにするかはテンプレートとシナリオのデータで決める。判断ポイントにしない仮定は既定値のまま、根拠つきで固定する。
