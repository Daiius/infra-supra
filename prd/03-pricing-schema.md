# 03. 料金データのスキーマ

> 状態: **スキーマと料金計算は実装済み**（P1-4・P1-5。`packages/estimator/src/pricing/`）。実在の料金はスパイクで一次取得しただけで、catalog にはまだ入れていない（P1-10）。🔒 **出典を確認していない数値を、実在の料金のように書かない**
> （企画書 §12）。例示には `fictional` のデータだけを使う。

## 1. 置き場所と単位

- `packages/catalog/src/providers/<provider>/` に、プロバイダーごとの PriceBook を**版ごとのファイル**で置く
  （例: `cloudflare/2026-11-01.ts`）。古い版は消さない（保存済みの見積を当時の料金で再計算するため）。
- 架空の料金は `packages/catalog/src/fictional/` に置き、provider の ID を `fictional-` で始める。
- 1 つの PriceBook = 1 プロバイダー × 1 版。中に複数のサービス・プランを持つ。

## 2. 全体の形

```ts
type PriceBook = {
  schemaVersion: 1;
  provider: ProviderId;              // 'cloudflare' | 'vercel' | 'supabase' | … | 'fictional-*'
  version: string;                   // 版 ID（取得日を基本にする: '2026-11-01'）
  status: 'official' | 'fictional';
  currency: 'USD' | 'JPY';
  retrievedAt: string;               // 取得日
  effectiveFrom?: string;            // 適用開始日（公式に明記されている場合）
  sources: Record<SourceId, SourceRef>;
  allowancePools: AllowancePool[];   // §4
  plans: Plan[];
  notes?: string[];                  // 税・為替・契約割引を含まない等の注記
};

type Plan = {
  id: PlanId;                        // 'workers-paid'
  service: ServiceId;                // 'workers'
  name: string;                      // 表示名
  baseFee?: BaseFee;                 // §3
  meters: Meter[];                   // §5
  credits?: Credit[];                // §7
  limits: Limit[];                   // §6
  requires?: PlanRef[];              // 前提のプラン（例: あるアドオンはアカウントの有料プランが前提）
  regions?: RegionPricing[];         // リージョン差があるメーターの上書き
  sourceIds: SourceId[];             // 必須（status: official のとき）
};
```

## 3. 固定費

```ts
type BaseFee = {
  amount: number;
  per: 'month' | 'hour';
  monthlyCap?: number;               // 時間課金に月額上限がある場合（VPS に多い）
  scope: 'account' | 'node';         // アカウントに 1 回（チームプラン）か、ノードごと（インスタンス）か
  perSeat?: boolean;                 // 席課金（Vercel Pro など）。席数は Architecture の BillingAccount に持つ
};
```

メンバー（席）の料金の扱いは Plan の `members` に持つ（D-20 V-6）。`per-seat`（`perSeat` の基本料と組）・`included`（料金が無いと書かれている）・
`not-stated`（書かれていない。無料と断定しない）のどれかと、前提の 1 文・出典。

## 4. 無料枠のプール

無料枠は「メーターに付属する数量」ではなく**プール**として独立させ、メーターがプールを参照する。
同じ無料枠を複数のサービス・ノードが食い合う場合（アカウント全体で共有されるリクエスト枠など）を表すため。

```ts
type AllowancePool = {
  id: PoolId;
  quantity: number;
  unit: Unit;
  period: 'month' | 'day';           // 日次の無料枠は日ごとに評価する（01 §3.3）
  scope: 'account' | 'project' | 'node'; // 共有の単位
};
```

- 同じプールを複数ノードが使うとき、無料枠の**消費は合算してから引く**（ノードごとに引くと枠を二重に使ってしまう）。
- 明細の表示用に、プールの消費をノードへ**按分**する（使用量に比例）。按分は表示だけで、金額の計算には使わない。
- `period: 'day'` のプールは、平日・休日の 1 日分の使用量で評価し、超過分を日数倍する。
  無料プランでは日次の超過が `block` になることが多く、月間合計では収まっていても**特定の日に止まる**ことがある。

## 5. メーター

```ts
type Meter = {
  id: MeterId;                       // 'requests' | 'cpu-ms' | 'rows-read' | 'storage-gb-month' | …（プロバイダーの呼び方）
  resource: ResourceKey;             // 01 §5.1 の汎用リソースとの対応
  unit: Unit;
  allowancePool?: PoolId;
  rounding?: {                       // 最低課金単位
    granularity: number;             // 例: 1（1 ms 単位）、1_000_000（100 万リクエスト単位）
    scope: 'event' | 'period';       // 1 回ごとに切り上げるか、期間の合計を切り上げるか
    mode: 'ceil' | 'none';
  };
  pricing: Tiered | Volume | Flat;
  onExceed?: OverageBehavior;        // 無料枠を超えたときの挙動（§6）。既定は 'bill'
};
type Flat   = { model: 'flat'; unitPrice: number; per: number /* 1_000_000 = 100 万単位あたり */ };
type Tiered = { model: 'tiered'; per: number; tiers: { upTo: number | null; unitPrice: number }[] }; // 段ごとに別単価
type Volume = { model: 'volume'; per: number; tiers: { upTo: number | null; unitPrice: number }[] }; // 到達した段の単価を全量に
```

- `rounding.scope: 'event'` は 1 リクエストごとの切り上げ。エンジンは分布を持たないので、
  **「全リクエストが平均値をとる」と仮定**して `ceil(平均 / 単位) × 単位 × 件数` で計算する（仮定として明示する）。
- `tiered` と `volume` の違いはテストで必ず押さえる（[05](./05-test-strategy.md) §2）。

## 6. 制限と超過時の挙動

```ts
type OverageBehavior = 'bill' | 'block' | 'throttle' | 'upgrade-required';
type Limit = {
  id: string;                        // 'cpu-ms-per-request' | 'db-size-gb' | 'connections' | 'requests-per-day' …
  value: number;
  unit: Unit;
  scope: 'request' | 'node' | 'account' | 'day' | 'month';
  onExceed: OverageBehavior;
  sourceIds: SourceId[];
};
```

`measure`（何と比べるか）: `cpu-ms-per-request`・`storage-gb`・`peak-concurrency`・`writes-per-second-per-key`（同じキーへの書き込みの頻度。KV の 1 秒 1 回。D-24）。

性能に関わる制限（同時接続数・1 リクエストあたりの CPU 上限など）も**公式の数値なら**ここに置く。
公式でない性能値（1 vCPU が捌ける RPS など）は PriceBook に置かず、性能プロファイル（`assumption`）に分ける。

## 7. クレジット

```ts
type Credit = {
  id: string;
  amount: number;                    // 金額で付与されるクレジット（プランに含まれる利用分など）
  appliesTo: MeterRef[] | 'all-usage';
  period: 'month';
  carryOver: false;
};
```

クレジットは**メーター単位の無料枠を引いた後の金額**に当てる。順序: 無料枠 → 段階料金 → クレジット → 固定費の加算 → 最低請求額。
この順序はプロバイダーによって異なる可能性がある。異なる場合は PriceBook 側で指定できるようにする（要確認・実データで判断）。

## 8. 為替

```ts
type ExchangeRate = { base: Currency; quote: Currency; rate: number; asOf: string; basis: 'assumption' };
```

為替は料金データではなく**見積の仮定**として Estimate に保存する。明細は原通貨の金額を残し、合計だけを表示通貨に換算する。

## 9. スパイクで見つかった追加要件（2026-10-31・設計に反映する）

[`spikes/concept-2026-10-31`](../spikes/concept-2026-10-31/README.md) の所見から、次をスキーマに足す。

| 追加 | 内容 | 所見 |
|---|---|---|
| `interpretation` | 公式の文書が食い違う箇所で**採用した解釈**と、退けた解釈（それぞれ根拠の引用つき）。計算は採用した解釈だけで行い、幅は出さない。実請求で確かめたら `verifiedAt` を付ける | 2 |
| `status: 'unpriced'` | メーター・製品の料金が未取得。LineItem は金額なしで残り、合計は「下限」になる | 3 |
| `eligibility` | 数量でない利用資格（商用利用の可否など）。Workload / シナリオの属性と照合する | 7 |
| 将来の施行日 | 同じ版の中に `effectiveFrom` が未来の改定を持てる（`scheduledChanges`）。`kind`（料金 / 制限 / その他）と、改定後の料金を取得したときだけ `revisedMeters`（プラン・メーター・料金）を持つ。無ければ計算に反映しない理由 `notModeledReason` が必須（D-21）。見積の対象月で切り替える | 11 |
| メーターの別名 | 名称変更（Edge Requests → CDN Requests）を `aliases` で持つ | 11 |
| `rounding: 'not-stated'` | 丸めが書かれていない。エンジンは仮定（既定は丸めなし）で計算し、仮定を使ったことを根拠に残す | 12 |
| 利用者の設定による超過時の挙動 | 予算による一時停止（遅れつき）のように、`onExceed` を構成側で選べるメーター | 10 |
| 地域料金 | 関数の地域（構成）と閲覧者の地域分布（Workload）で単価を引く | 8 |
| 税込かどうか | `taxIncluded`。さくらの VPS は税込の円、他は税抜のドル。見積は方針（税抜で揃えるなど）に合わせて換算する | 18 |
| 備考（`notes`） | 前払い・最低利用期間・課金の時間単位など、月額に効かない支払いの条件は**備考として文で残す**だけにする（構造化しない。D-14） | 19 |
| `premise` | Limit・Meter・DeployTarget の対応に付ける「プラットフォームの前提」の印と、人が読める 1 文。見積の「重要な前提」とゲームの説明が同じ文を使う（01 §8.1） | 1・4・6・7 |
| `facts`（D-24） | 量の境目を持たない事実（KV の反映の遅れ・D1 の 1 行 2 MB・Workers のメモリ 128 MB）を Plan に `id`・`premise`・出典で持つ。常に効くわけではないので、構成のノードが `facts: [id]` で挙げたときだけ前提（`fact:…`）として出す（部品の選び方しだいで効く事実） | GD-4 |
| `addons`（D-30） | 一度きりの費用がかかるオプションを Plan に `oneTimeFee`（PriceBook の通貨・税込かに従う）・前提の 1 文・`interpretation`・出典で持つ（例: さくらの VPS のストレージ変更オプション）。何が変わるか（ディスクの大きさ）は構成のデータ（catalog の stacks）が持つ。月額の計算には入れず、ゲームは申し込んだ次の月の費用に一度だけ足す | GD-4 |
| `uptimeSla`（D-24） | 稼働率の SLA を Plan に `offered`（`percent` と組）/ `none`（含まれないと書かれている）/ `not-stated`（書かれていない。無いと断定しない）で持つ。補償は計算に使わない。notes の文（D-14）だった「2GB は SLA 非対応」をここへ移した（07 §10.10 T-8 の解消） | GD-4 |

## 10. 検証規則（スキーマで落とす）

- `status: 'official'` の PriceBook は、すべての Plan が `sourceIds` を持ち、参照先が `sources` にある。
- `fictional-` で始まる provider は `status: 'fictional'`、それ以外は `official`。
- `members.pricing` が `per-seat` なのは `baseFee.perSeat` のときだけ。`members` も出典が必要。
- メーターが参照するプール・プラン・リージョンが存在する。
- 段階料金の `upTo` は単調増加で、最後の段だけ `null`。
- 単価・数量は有限の数で、負にならない（クレジット以外）。

## 11. 計算の細部（P1-5 の実装で決めたこと）

| 論点 | 決めたこと | 理由 |
|---|---|---|
| プールの付与 | メーターがプールを参照していれば使える（`grantedBy` は持たない） | 無料プランと有料プランで枠が違う場合は、別のプールとして定義すれば足りる |
| 共有の単位 | `account` と `node` を計算する。`project` はスキーマにあるが計算は gap | MVP の 3 構成で project 単位の共有が必要な箇所がまだない |
| 日次プール | 平日・休日の 1 日分の使用量で判定し、超過 × 日数（平日 21.7 日・休日 8.7 日）。1 日分が無ければ均等割りを仮定し、仮定を明細に残す | prd/01 §3.3 |
| 期間の丸め | **無料枠を引いた後**の課金対象に当てる | 使用量 0 の月に 1 単位を課金しないため。プロバイダーが「使用量全体を切り上げてから枠を引く」と明記していたら見直す |
| 1 回ごとの丸め | 平均値で切り上げ、`件数 × 切り上げた平均` | 分布を持たないため（仮定として明細に残す） |
| 超過時の挙動 | `bill` 以外は金額 0 の明細（status: blocked）と `LimitBreach`。利用者は `configurableOnExceed` の範囲だけ選べる | prd/01 §5.3 |
| 料金未取得 | 金額 null の明細（status: unpriced）。合計は下限で、件数を `unpricedLines` に出す | D-09 |
| クレジット | 同じアカウント × プランの従量の明細に当て、上限を超えた分は捨てる（繰り越さない）。固定費には当てない | Vercel・Supabase とも従量（Supabase は Compute だけ）に当たるため |
| 段階料金 | アカウント × プラン × メーターの合計（ノードをまたいで合算）に当てる | 段は請求単位で決まるため |
| 利用資格 | `context.commercial` が true のとき、非商用のみのプランを `eligibilityViolations` に出す | D-09 |
| 施行日つきの予告 | `scheduledChanges` に記録するだけで、計算には使わない | gap。見積の対象月で切り替える機能は必要になってから |
| 制限（Limit） | 料金計算では評価しない | 容量の判定（P1-8）で、資源シミュレーションの結果と合わせて評価する |

## 12. 構成が使うサービスの選び方（データの補足）

- **Vercel + Supabase の画像の原本の置き場は Vercel Blob**（D-46・2026-11-01 取得）。それまでは料金を取得しておらず、課金先なし（明細に「対応なし」）で残していた。
  - 選んだ理由: アプリは Next.js を Vercel に載せており、画像の最適化（Image Optimization）と同じ Vercel のアカウント・同じ込み分・同じクレジットの中で数えられる。Hobby の込み分を超えると 30 日使えない、という他の Hobby のメーターと同じ止まり方になる。Supabase Storage も構成として自然だが、DB の egress と込み分を共有するので、画像の配信が DB の egress の上限に効く形になる。そうするとアプリの DB の扱い（D-24 の部品）と絡むため、今回は採らない（部品として選べるようにするなら、そのときに料金を取得する）。
  - 単価: 既定は iad1（$0.023/GB 月・Simple Operations $0.40/100 万・Advanced Operations $5.00/100 万・Blob Data Transfer $0.05/GB）、東京（hnd1）は地域料金（$0.025・$0.37・$4.70・$0.053）。Hobby の込み分は保存量 1 GB・Simple 1 万・Advanced 2,000・転送 10 GB で、超えると使えない（追加の請求はない）。Pro は込み分なしで、月のクレジットに当たる。出典は vercel.com/docs/vercel-blob/usage-and-pricing（2026-09-23 更新）と地域料金のページ（2026-09-14 更新）。
  - 経路の近似: 閲覧は Vercel の CDN を通り、miss だけが Blob に届く（Simple Operations は miss の読み取りだけ・公式どおり）。ただし公式の例では、Blob Data Transfer はヒットも含む全ダウンロードにかかり、CDN 側は Fast Data Transfer にならない。このモデルは画像の閲覧の転送を Fast Data Transfer（Blob Data Transfer の約 3 倍）で数えるので、高めに見積もる側に倒れる。画像を最適化する経路では、変換のときの原本の読み取りを数えていない。
