# 14. 部品を事業者をまたいで組む（役割と接続の口）

> 状態: **設計（決定 D-114）・段 1 を実装（2026-11-03。§3.11）・段 2 を実装（2026-11-03。§3.12）**。論点 CP-01〜CP-17 は 2026-11-03 に決めた（§8）。CP-06（転送の数え方）・CP-11（アカウントの手間）・CP-15（段 2 の組）は下書きの推奨から変えた。
> 後で検討する候補として残したのは、リージョンの要素（CP-08）と接続の数の上限（CP-09）。
> 出発点（2026-11-03・ユーザー）: 「vercel と aws のストレージという組み合わせもありそうですね...この辺りの組み合わせ方をもっと柔軟に選べるようにできたりしますか？ 根本的に少し変えるところがあるかもしれませんが...」
> 料金・制限の数値は、§2 で公式の文書から取ったもの（URL と取得日つき）か、catalog に既にあるもの（出典は catalog の料金データ）だけを書く。
> 確かめられなかったものは**未確認**、値の根拠の無いものは**ゲーム上の仮定**、文書からの読みは**推測**と書く。

## 0. 要約

- 今は、土台（Platform）と別の事業者の部品を、`CROSS_PAIRS` で**組（土台 × スロット × 部品の事業者）ごとに手で許し**、差し方を `applyCross`・`applyCrossDb`・`applyCrossApi` に**土台ごとに手で書いている**（prd/11 §2.5）。
  組が増えるほど、根拠と差し方の重複が増え、選べない現実の組（Vercel × S3・Vercel × RDS / DynamoDB・Cloudflare × Neon など）が残る。
- 案は 3 つ（§3）。**採るのは案 C（D-114）**: 土台の中身（`composeVercel` など、確かめた事実が詰まった組み立て）は今のまま残し、
  **差し替える側の部品だけ**を「役割（オブジェクトストレージ・DB…）」と「接続の口（公開の URL・認証つきの HTTPS・TCP・binding だけ）」で表し、
  **接続の規則**（どの口からどの口へつなげるか・要る中継・転送をどちらで数えるか・根拠）で組の可否と経路を決める。
  案 B（土台の中まで全部を役割と口で組み直す）は効果が大きいが、golden と基準プレイの作り直しが全部に及ぶので、段 5 で改めて判断する（CP-01）。
- 転送は、事業者ごとの料金データの**送り出し（egress）と受け取り（ingress）の項目をそれぞれ数えて足す**。料金表に項目が無い側は課金なし（前提の文で「未確認」。CP-06）。
- 段 2 で足すのは **Vercel × DynamoDB / Aurora（DB）だけ**（CP-15）。
- 調べて分かった、費用に効く点（§2.4）: 転送は**送り出す側**で課金されることが多い（AWS・Google Cloud・Supabase）。R2・Workers・Hyperdrive は転送に課金しない。
  Vercel の関数から外への通信は通常は課金の項目に無いが、**IP の許可が要る相手には Static IPs（Pro で $100 / 月 / プロジェクト + Private Data Transfer）**が要る。
  AWS の VPC の中の DB へは、Vercel からは Secure Compute（Enterprise）か PrivateLink が要り、個人の規模では**公開の口（公開の RDS・Marketplace の Aurora・DynamoDB の HTTPS）で組む**のが現実の形になる。
  D1・KV は Worker の binding からしか本番のアプリでは使わない（REST は管理用）。

## 1. 目的と、今の形の限界

### 1.1 目的

- 見積モード: 「土台は Vercel、画像は S3 + CloudFront、DB は Aurora」のような**事業者をまたいだ構成を、表に無くても組んで比べられる**。つなげない組は**理由つきで**弾く。
- ゲームモード: 勝ち筋を増やすことより、**「つなぐのに何が要るか（中継・IP の許可・アカウント）」が費用と手間に出る**ことを学べるようにする（prd/07 の「前提が生むポイント」）。
- 実装: 組を 1 つ足す手間を、**組の数ではなく、規則と部品の数**に比例させる。

### 1.2 今の形（2026-11-03 時点のコード）

- `packages/catalog/src/stacks/index.ts`: `Platform`（7 つ。うち OpenNext・Netlify は `HIDDEN_PLATFORMS` で隠している。D-100）・`SlotId`（13）・`ComponentOption`（`hosts`・`link`）・`componentsOf(platform, slot)`。
- `packages/catalog/src/stacks/cross.ts`:
  - `CROSS_PAIRS`: 許した組。明示の行が 13、Resend・Bunny を土台ごとに展開した行を合わせて 20 余り。各行に根拠の要約（`basis`）と出典（`sources`）。
  - `CROSS_COMPONENTS`: 他の事業者の部品（`cf-images`・`cf-resize`・`bunny-images`・Worker の API・Neon など）。`link.via` は `'http'` だけ（「binding・tcp・proxy-binding は段 2 以降」）。
  - 差し方: 画像は `hostImageShape`（土台ごとに外すノードの id と投稿の経路）、DB は `applyCrossDb`（Vercel・Netlify の `db` を Neon に）、API は `HOST_API_NODES`・`HOST_DB_NODES`・`placement`。
    外への転送は土台ごとの専用のノード（`awsOut`・`gcpOut`・`netlifyOut`）。
- 既存の Cloudflare + Hyperdrive（Supabase）・さくらの VPS + 前段の CDN（Cloudflare）は、土台の部品として先に入ったもので、表の外にある。

### 1.3 限界

| # | 限界 | 例 |
|---|---|---|
| L1 | 組ごとに根拠を書くので、**同じ根拠が行の数だけ重複**する | R2 の公開バケット・転送が無料の出典が、Vercel・AWS・OpenNext・Netlify・Google Cloud の 5 行に並ぶ |
| L2 | 差し方が**土台のノードの id に頼る**（`hostImageShape` の `remove: ['image', 'blob']` など）。土台の組み立てを直すと、cross.ts も直す | 土台を 1 つ足すと、画像・API・DB の 3 か所に分岐が要る |
| L3 | 足す手間が組の数に比例する。過去の例: Neon（D-77）は 15 ファイル・約 700 行、Bunny（D-98）は 22 ファイル・約 1,000 行（料金のデータ・テスト・文書を含む）。差し方とその検査だけでも cross.ts に 140〜200 行 | §3.1 |
| L4 | 接続の形が `http` だけなので、**TCP の DB・binding だけの部品・プロキシ**の違い（要る中継・接続の数の上限・IP の許可）を表せない | Vercel × RDS は「公開するか・IP を許可するか」で費用と手間が変わる |
| L5 | 差す順番が手で決まっている（DB → 画像 → API。API を他に置くと DB は外れる） | 新しいスロットを足すたびに順番を考え直す |

### 1.4 選べない、現実にある組（例）

| 土台 | 役割 | 部品 | 現実の可否（§2 で確かめた範囲） | 今 |
|---|---|---|---|---|
| Vercel | 画像 | S3 + CloudFront | 可。Vercel の関数から S3 へは OIDC で一時的な認証（全プラン）。S3 → CloudFront の転送は無料 | 無い |
| Vercel | DB | Aurora PostgreSQL・Aurora DSQL・DynamoDB | 可。Vercel の Marketplace にあり、請求は AWS | 無い |
| Vercel | DB | RDS（PostgreSQL） | 可。公開の口（パブリックアクセス + セキュリティグループ）で。IP を絞るなら Static IPs が要る | 無い |
| Cloudflare | DB | Neon・RDS（Hyperdrive 経由） | 可。Hyperdrive は Postgres・MySQL なら何でも（prd/11 §2.1）。私設の網の DB は Cloudflare Tunnel が要る | Supabase だけ |
| AWS（Amplify・SPA） | DB | Neon・Supabase | 可（公開の Postgres に Lambda から TCP）。推測: Lambda を VPC に入れなければ NAT は要らない | 無い |
| Google Cloud | DB | Neon・Supabase | 可（Cloud Run から公開の Postgres へ） | 無い（画像の R2 は既にある。D-88） |
| さくらの VPS | 画像 | R2・Bunny | 可（VPS から S3 互換の API で書き、公開の URL で配る） | 無い |
| Vercel | DB | D1（直接） | **つなげない**（D1 の REST は管理用。Worker の API を挟む。AX-10） | API の置き場として Worker + D1 はある |

## 2. 現実によくある組み合わせの調査（2026-11-03 取得）

### 2.1 接続の口（部品がどう呼ばれるか）

| 口 | 意味 | 例 | 公式の根拠 |
|---|---|---|---|
| `public-url` | 認証なしの公開の URL（GET で配る） | R2 の公開バケット（カスタムドメイン）・CloudFront・Bunny CDN | prd/11 §2.1・D-98 |
| `https-api` | 認証つきの HTTPS の API（SDK・REST） | S3・R2 の S3 互換の API・DynamoDB・Worker の API | R2 は「The API is available via the `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` endpoint」（[R2 の S3 API](https://developers.cloudflare.com/r2/api/s3/api/)）。Vercel の関数から S3・RDS へ OIDC の例（[Vercel の OIDC × AWS](https://vercel.com/docs/oidc/aws)） |
| `tcp-sql` | DB のワイヤプロトコル（Postgres・MySQL）を TCP で | RDS・Aurora・Supabase・Neon・Cloud SQL | Workers の `connect()`: データベースのプロトコルは「require an underlying TCP socket API」（[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)） |
| `binding` | 同じ事業者の実行環境の中からだけ呼べる | D1・KV・Durable Objects・Hyperdrive | D1 の REST API は「primarily interacts with the control plane」（[D1 の問い合わせ方](https://developers.cloudflare.com/d1/best-practices/query-d1/)）。Hyperdrive は Worker の binding が要る（prd/11 §2.1） |
| `private-net` | VPC などの私設の網の中だけ | 公開しない RDS・Cloud SQL の私設 IP | 下の §2.2 |

### 2.2 確かめた事実（出典つき）

**Vercel の関数から外へ**

- 既定では外へつなぐのに追加の設定は要らない。Vercel の手引き: 送り元の IP の規則・私設の経路・クラウドの中の計算のどれも要らないなら「you likely don't need one」。IP の許可は認証の代わりにならない（「A request from an allowlisted address is still an unauthenticated request」）
  （[ネットワークの選び方](https://vercel.com/kb/guide/how-to-choose-the-right-vercel-networking-option)・2026-11-03 取得）。
- **Static IPs**（Pro・Enterprise）: 用途に「Connect to databases such as Amazon RDS, Google Cloud SQL, Azure SQL, and MongoDB Atlas」。料金は「$100/month per project for Pro plus Private Data Transfer」。有効にすると関数の外への通信が NAT を通り、Private Data Transfer で数えられる
  （[Static IPs](https://vercel.com/docs/networking/static-ips)・2026-06-30 更新・2026-11-03 取得）。
  Private Data Transfer は「1 GB for $0.15 - $0.31」（地域で幅。東京の値は地域のページ。**hnd1 の値は未取得**。[地域の料金](https://vercel.com/docs/pricing/regional-pricing)・2026-11-03 取得）。
- **AWS PrivateLink**（Pro・Enterprise の Advanced Networking）: 最初の 1 つの接続は込み・追加 $30 / 月・転送 $0.04/GB（[ネットワークの選び方](https://vercel.com/kb/guide/how-to-choose-the-right-vercel-networking-option)）。**Advanced Networking そのものの料金は未確認**。
- **Secure Compute**（Enterprise のみ）: 専用の VPC と VPC ピアリング。料金は個別。Private Data Transfer は「$0.15/GB only for traffic that leaves the private network via the public internet」、VPC ピアリングの通信は転送の課金なし
  （[Secure Compute](https://vercel.com/docs/networking/secure-compute)・2026-09-23 更新・2026-11-03 取得）。→ 個人・小さなチームの見積の対象外（CP-07）。
- 通常の関数から外への通信の転送: 料金の項目に無い（prd/11 §2.5 と同じく**未確認として数えない**）。地域の料金の表にも、Static IPs を使わない通信の項目は無い（同上）。
- OIDC: 「Secure backend access with OIDC federation is available on all plans」。S3 の一覧・RDS の IAM 認証の例がある（[Vercel の OIDC × AWS](https://vercel.com/docs/oidc/aws)・2026-08-28 更新）。
- Marketplace の AWS: Aurora PostgreSQL・Aurora DSQL・DynamoDB・S3 など。「All billing is handled directly through AWS」（[Vercel Marketplace の AWS](https://vercel.com/marketplace/aws)・2026-11-03 取得。prd/11 §2.1 と同じ）。

**AWS の側**

- S3: CloudFront へ送る転送と、インターネットから受ける転送は課金しない（「Data transferred out to Amazon CloudFront」「Data transferred in from the internet」が例外）。インターネットへの転送は全サービス合計で月 100 GB まで無料（[S3 の料金](https://aws.amazon.com/s3/pricing/)・2026-11-03 取得）。東京 → インターネットの単価は catalog の `data-transfer-out`（$0.114/GB。prd/11 §2.5）。
- DynamoDB: 受信は無料（「DynamoDB does not charge for inbound data transfer」）。外への転送は 100 GB の無料の後に課金（ページに単価の記載が無い。**推測: EC2 のデータ転送の料金と同じ**）（[DynamoDB の料金](https://aws.amazon.com/dynamodb/pricing/on-demand/)・2026-11-03 取得）。
- RDS を外から使うには「Public access」を有効にし、DB のサブネットが全部インターネットゲートウェイを持ち、セキュリティグループが受け入れを許す必要がある（「That public access is not permitted if the security group assigned to the DB instance doesn't include inbound rules that permit it」）
  （[VPC の中の DB](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)・2026-11-03 取得）。公開のアドレスは EC2 の公開 IPv4 の扱い（「Hourly charge for In-use Public IPv4 Address $0.005」。地域の明記なし。[VPC の料金](https://aws.amazon.com/vpc/pricing/)）。
- Lambda: 既定では「Lambda-managed VPC that has internet access」で動く。VPC に入れると外へ出るのに NAT ゲートウェイが要る（「Connecting a function to a public subnet doesn't give it internet access」）
  （[VPC の Lambda のインターネット](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)・2026-11-03 取得）。
  NAT ゲートウェイの料金はページに Ohio の例（$0.045 / 時・$0.045/GB）だけで、**東京の値は未取得**。→ 「AWS の中の私設の DB」と「外の部品（R2・Neon）」を同じ Lambda から使うと NAT が要る（推測。CP-05）。
- RDS Proxy: 「priced per vCPU per hour」（Aurora Serverless は ACU あたり）。**単価・東京の値は未取得**（[RDS Proxy の料金](https://aws.amazon.com/rds/proxy/pricing/)・2026-11-03 取得）。

**Cloudflare の側**

- Workers は転送に課金しない（「There are no additional charges for data transfer (egress) or throughput (bandwidth)」。[Workers の料金](https://developers.cloudflare.com/workers/platform/pricing/)・2026-11-03 取得）。
- Workers の同時の接続: 「Each Worker invocation can have up to six connections simultaneously waiting for response headers」。サブリクエストは Free 50 / Paid 10,000（1 リクエストあたり）（[Workers の制限](https://developers.cloudflare.com/workers/platform/limits/)・2026-11-03 取得）。
- TCP の `connect()`: Cloudflare の IP・私設の IP へはつなげない。Postgres には「You should use Hyperdrive」（[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)・2026-11-03 取得）。
- Hyperdrive: Free は 1 日 10 万クエリ・Paid は無制限、転送の課金は無い（[Hyperdrive の料金](https://developers.cloudflare.com/hyperdrive/platform/pricing/)・2026-11-03 取得）。私設の網の DB は Cloudflare Tunnel（`cloudflared`）と Access のサービス認証が要り、DB は TLS が必須（[私設の DB へ](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)・2026-11-03 取得）。
- R2: 転送は無料（catalog・prd/11 §2.1）。S3 互換の API で外から読み書きできる（上）。

**DB の事業者**

- Supabase: 直接の接続は既定で IPv6 だけ（「Direct connections are on IPv6, or on IPv4 if the project has the IPv4 add-on」）。サーバーレスには共有のプール（Supavisor）の transaction モード（6543）を勧める
  （[Postgres への接続](https://supabase.com/docs/guides/database/connecting-to-postgres)・2026-11-03 取得）。
  転送: Pro は uncached 250 GB 込み・超過 $0.09/GB、Free は 5 GB。共有のプール経由は DB の転送でなく「Shared Pooler Egress」で数える（[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)・2026-11-03 取得）。
- Neon: プール（PgBouncer）で「up to 10,000 concurrent connections」。`max_connections` は 0.25 CU で 104・1 CU で 419。サーバーレスはプールの接続文字列（`-pooler`）を勧める（[接続のプール](https://neon.com/docs/connect/connection-pooling)・2026-11-03 取得）。東京のリージョンは無い（prd/11 §2.1）。
- Cloud SQL（Cloud Run から）: 公開 IP は Cloud SQL の connector / Auth Proxy、私設 IP は Direct VPC egress か Serverless VPC Access connector が要る。「Cloud Run container instances are limited to 100 connections to a Cloud SQL database」
  （[Cloud Run から Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/connect-run)・2026-11-03 取得）。
- Google Cloud のインターネットへの転送: catalog の `internet-egress`（Premium Tier・東京 → アジア $0.12/GiB〜。D-88）。

### 2.3 つなげない / 中継が要る組

| 組 | 判定 | 要るもの | 費用・手間に効く点 |
|---|---|---|---|
| 他の事業者 → D1・KV・Durable Objects | **直接は不可**（本番のアプリとしては） | 同じアカウントの Worker の API（今の API の置き場） | Workers Paid $5（catalog）。Worker の CPU |
| Workers → Postgres（外） | 可。**Hyperdrive を勧める** | Hyperdrive（Free 10 万 / 日） | 転送の課金なし。接続のプール込み |
| Workers → 私設の網の DB（VPC の RDS） | 可 | Hyperdrive + Cloudflare Tunnel（`cloudflared` を網の中で動かす） | `cloudflared` を動かす計算機（EC2 など）の費用・**未見積** |
| Vercel → 公開の RDS（IP を許可しない） | 可 | なし（パスワード / IAM 認証） | セキュリティグループを広く開ける前提を文に出す |
| Vercel → 公開の RDS（IP を絞る） | 可 | Static IPs（Pro $100 / 月 / プロジェクト） | 関数の外への通信の全部が Private Data Transfer になる |
| Vercel → VPC の中の RDS（公開しない） | Pro は PrivateLink、Enterprise は Secure Compute | Advanced Networking（料金未確認）・Secure Compute（個別） | 見積の対象外にする案（CP-07） |
| Vercel → DynamoDB・S3・Aurora DSQL | 可（HTTPS の API・OIDC） | なし | 送り出す側の AWS の転送 |
| Lambda（VPC の中） → 外（R2・Neon） | 可 | NAT ゲートウェイ | 時間課金 + GB 課金（東京は未取得） |
| Cloud Run → Cloud SQL（私設 IP） | 可 | Direct VPC egress / Serverless VPC Access | 1 インスタンスあたり 100 接続 |
| サーバーレスの関数 → Supabase | 可。transaction モードのプールを勧める | なし（IPv4 から直接は IPv4 アドオン） | プール経由の転送は別の数え方 |
| サーバーレスの関数 → Neon | 可。`-pooler` を勧める | なし | 東京が無い（往復が延びる。遅延は計算しない） |

### 2.4 費用に効く点（まとめ）

1. **転送は送り出す側で課金**される事業者が多い（AWS・Google Cloud・Supabase・Neon）。受ける側は無料か、受信の項目が無い（S3・DynamoDB・Google Cloud・R2）。ただし規則は「どちらか一方で数える」ではなく、両側の料金データの項目をそれぞれ数えて足す（CP-06・D-114）。
2. **課金しない送り手**: R2・Workers・Hyperdrive・S3 → CloudFront。**記載が無い送り手**: Vercel の関数（通常）・Amplify の SSR → 未確認として数えない（今と同じ）。
3. **中継の部品が費用の本体になりうる**: Static IPs $100 / 月・NAT ゲートウェイ（時間課金）・RDS Proxy（vCPU 時間）・Workers Paid $5。小さな構成では DB の単価より大きい。
4. **公開の口で組むと中継が要らない**（Vercel × DynamoDB・公開の RDS・Neon・Supabase のプール）。私設の網で組むと中継か Enterprise の機能が要る。
5. **binding だけの部品**（D1・KV・DO・Hyperdrive）は、使う側が同じ事業者の実行環境（Worker）に限られる → 「Worker の API を挟む」が中継になる。
6. **接続の数の上限**: Workers は同時 6、Cloud Run は 1 インスタンス 100（Cloud SQL）、Neon のプール 10,000・0.25 CU の `max_connections` 104。サーバーレス × 接続を張る DB は**プールが前提**。
7. **リージョン**: Neon に東京が無い・Vercel の関数の既定は iad1（prd/10 §3.3）。往復の遅延は今も計算していない（prd/11 §2.3）。
8. **アカウントが増える手間**: 今は増えたアカウント 1 つにつき毎月 0.5・一度きり 1（D-52）。D-114 で、事業者が増えるほど重くする（k 個目は毎月 0.5 × k。CP-11）。

### 2.5 未確認（見積に入れない・前提の文で出すだけ）

- Vercel の Private Data Transfer の東京（hnd1）の単価・Advanced Networking の料金。
- NAT ゲートウェイ・RDS Proxy の東京の単価。
- DynamoDB からインターネットへの転送の単価（料金ページに記載が無い）。段 2 で、AWS 共通の Data Transfer Out の適用と読んで数えることにした（§3.12。ユーザーの決定）。Vercel の関数と同じリージョンの DB の通信が「同じリージョン内の AWS サービス間は $0」に当たるかは未確認。
- Amplify の SSR から外への通信の課金（prd/11 §2.5 から変わらず）。
- Cloudflare Tunnel を動かす計算機の費用（構成による）。

## 3. 設計案

### 3.1 案 A: 今の形のまま組を足していく

- 1 組を足す手間: `CROSS_PAIRS` に 1 行（根拠と出典）、`CROSS_COMPONENTS` に部品（または `hosts` に土台を足す）、差し方（`hostImageShape` 等に土台の分岐）、外への転送のノード（土台ごと）、テスト（cross.test.ts・game の総当たり・基準プレイ）、文書（prd/11）。
  過去の例は L3（新しい事業者を含めて 700〜1,000 行）。**既にある部品を別の土台に広げるだけなら、差し方と検査で 100〜200 行・半日程度**（推測。D-52 の AWS への拡張・D-88 の Google Cloud × R2 の規模から）。
- 影響: catalog だけ（game・web は `componentsOf` で自動で出る）。estimator・保存は変わらない。
- 良い点: 今の検査（基準プレイ・golden）を壊さない。1 組ずつ根拠を確かめるので、出典の規則を守りやすい。
- 悪い点: L1〜L5 がそのまま。§1.4 の 8 組を足すと分岐がさらに増える。**「つなげない理由」を出す場所が無い**（表に無い組は出ないだけ）。

### 3.2 案 B: 全部を役割と接続の口で組み直す

- 土台も含めて、構成を「部品（役割 + 事業者 + 口）」の集まりにし、経路（`routes`）を**役割の列のテンプレート**から生成する。土台は「既定の部品の組」になる。
- データの形（スケッチ）:

```ts
type Role =
  | 'edge-cdn' | 'static-host' | 'compute' | 'image-transform'
  | 'object-store' | 'sql-db' | 'kv' | 'db-proxy' | 'email' | 'dns';
type Port = 'public-url' | 'https-api' | 'tcp-sql' | 'binding' | 'private-net';

type PartDef = {
  id: string;                    // 今の部品の id をそのまま使う（保存の互換。CP-13）
  provider: ComponentProvider;
  role: Role;
  /** 受ける口（この部品を呼ぶ側が使う口）。 */
  accepts: Port[];
  /** binding の口を呼べる事業者（同じアカウントの実行環境）。 */
  bindingFrom?: ComponentProvider;
  /** 経路に置くノード（今の ArchNodeIn を作る関数）。 */
  nodes: (ctx: PartContext) => ArchNodeIn[];
  premiseRefs: string[];
};

type ConnectionRule = {
  id: string;                    // 例: 'vercel-fn->tcp-sql:public'
  from: { provider?: ComponentProvider; role: Role };
  to: { port: Port; provider?: ComponentProvider };
  verdict: 'ok' | 'needs-relay' | 'blocked';
  relay?: PartRef[];             // 例: Hyperdrive・Worker の API・Static IPs
  // 転送の課金は規則に書かない。両側の部品の事業者の料金データの egress・ingress の項目をそれぞれ数えて足す（CP-06・D-114）
  reason?: string;               // blocked・needs-relay のときに画面に出す
  sources: { url: string; retrievedAt: string }[];
};
```

- 経路の一般化: `RouteTemplate = Record<RequestClass, Role[]>`（例: `image-read: ['edge-cdn', 'object-store']`）をフレームワーク × 描き方（prd/13）ごとに持ち、役割に当てた部品のノードを並べる。
  隣り合う 2 つの部品の事業者が違えば規則を引き、送り手の事業者の料金データに外への転送の項目があれば送り出しのノード（今の `awsOut`・`gcpOut`・`netlifyOut` を一般化した `egressNode(provider)`）を、受け手の事業者に受け取りの項目があれば受け取りのノード（`ingressNode(provider)`）を間に入れる（両方あれば両方。CP-06）。
- 影響: catalog は全面の作り直し（`composeCloudflare` 等を部品の集まりに分解）。estimator は変えない（ノードと経路の形は同じ）。game・web は部品の選び方が変わる。golden・基準プレイは全部取り直し。
- 良い点: L1〜L5 がすべて解ける。任意の組を規則で判定し、弾く理由を出せる。
- 悪い点: 土台の組み立てに詰まった事実（Amplify の画像の最適化の課金・OpenNext の関数の分け方・vinext の Workers Cache・Netlify の durable cache など）を役割に分解し直す必要があり、**同じ金額が出ることを確かめるだけで大仕事**。釣り合い（prd/07 §10）を取り直す範囲が全シナリオに及ぶ。

### 3.3 案 C（採用・D-114）: 土台は今のまま、差し替える部品だけを役割と口で

- 土台（`composeStack` が組む構成）は今のまま。土台の構成のノードに**役割の印**（`role`）を付ける（`image`・`blob` は `object-store`、`db` は `sql-db`、`fn` は `compute`…）。
- 他の事業者の部品は `PartDef`（案 B と同じ形）で書き、**役割で差し替える**: 「土台の `object-store` の役割のノードを外し、部品のノードを入れ、土台の `compute` の役割のノードから部品の口へ規則を引く」。
  今の `hostImageShape` の `remove`・`write` は、ノードの id ではなく役割の印から導く（L2 の解消）。
- 組の可否は `CROSS_PAIRS` でなく**規則**で決める: `allowed(host, part) = 土台の compute（または呼ぶ側）から part.accepts への規則が 'ok' か 'needs-relay'`。
  `CROSS_PAIRS` は規則に移し替え、**移す前後で選べる組と金額が変わらない**ことをテストで確かめてから消す（段 1）。
- 中継（`relay`）は部品として自動で足し、明細と構成図に出す（Hyperdrive・Worker の API・Static IPs）。選べる中継（Worker の API を「API の置き場」で選ぶなど）は今のスロットの依存（`componentConflict`）に寄せる。
- 転送: 境界ごとに、送り手の事業者の送り出し（egress）と受け手の事業者の受け取り（ingress）の項目を、それぞれの料金データから数えて足す（両方に課金があれば両方）。料金表に項目が無い側は課金なしとし、前提の文で「未確認」を出す（今の Vercel の関数・Amplify の SSR と同じ）。今は受け取りに課金する事業者はほぼ無いが、規則は両側を見る形にする（CP-06）。
- 影響:
  - **catalog**: `stacks/cross.ts` を `stacks/parts/`（部品）と `stacks/connections.ts`（規則・出典）に分ける。土台の組み立て（index.ts・aws.ts など）はノードに `role` を足すだけ。
  - **estimator**: 変えない（任意で `links` を出す。§6・CP-17）。
  - **game**: `componentConflict` に規則の `blocked`・`needs-relay` を足す。アカウントの手間（`accounts.ts`）は k 個目を 0.5 × k に重くする（CP-11）。中継の部品の一度きりの手間は足さない（中継で増える事業者のアカウントで数える）。
  - **web**: 部品の選び方（スロットごとに「同じ事業者 / 他の事業者」・事業者で絞る・弾く理由）。構成図は §6。
- 良い点: 土台の検査（golden・基準プレイ）を壊さずに、§1.4 の組を規則と部品の追加で足せる。弾く理由を出せる。後で案 B へ進むときも、部品と規則はそのまま使える。
- 悪い点: 土台の側は今の作りが残る（土台を足す手間は変わらない）。役割の印を付け忘れると差し替えが効かない（テストで「役割の印の無いノードが経路にあれば失敗」とする）。

### 3.4 比べた表

| 観点 | 案 A | 案 B | 案 C（採用） |
|---|---|---|---|
| 組を足す手間 | 組の数に比例 | 部品・規則の数に比例 | 部品・規則の数に比例（土台の追加は今と同じ） |
| 弾く理由を出せるか | 出せない（出ないだけ） | 出せる | 出せる |
| 根拠の重複（L1） | 残る | 解ける | 解ける（規則ごと） |
| 既存の金額・golden | 不変 | 全部取り直し | 移し替えの段で不変を確かめる |
| estimator の変更 | なし | なし（経路を生成するだけ） | なし（任意で `links`） |
| 保存（SAVE_VERSION） | 不変 | id を変えるなら上げる | 不変（id を変えない。CP-13） |
| 釣り合いの取り直し | 組ごと | 全体 | 足す組ごと（基準プレイは変わらない組で不変を確かめる） |
| 総当たりのテスト | 今のまま増える | 爆発する | 爆発する → §4.6 で抑える |

### 3.5 接続の規則の初めの表（案 C・案 B 共通。値は §2 の出典から）

| 呼ぶ側（役割・事業者） | 受ける口 | 判定 | 中継 | 転送の課金（両側の料金データの項目を足す。CP-06） |
|---|---|---|---|---|
| どれでも | `public-url`（画像の配信） | ok | — | 配る側（R2 は無料・CloudFront・Bunny） |
| `compute`・Vercel | `https-api`（S3・DynamoDB・R2） | ok（OIDC か鍵） | — | 応答は AWS の外への転送（送り手）・書き込みは無料 |
| `compute`・Vercel | `tcp-sql`（公開の Postgres） | ok | （IP を絞るなら Static IPs） | DB の事業者の egress（Supabase・Neon）・AWS の外への転送（RDS） |
| `compute`・Vercel | `private-net` | blocked（Pro）・needs-relay（PrivateLink は料金未確認） | — | — |
| `compute`・Cloudflare（Worker） | `tcp-sql` | needs-relay | Hyperdrive | DB の事業者の egress（Hyperdrive は無料） |
| `compute`・Cloudflare（Worker） | `binding`（D1・KV） | ok（同じアカウント） | — | なし |
| `compute`・Cloudflare 以外 | `binding`（D1・KV） | needs-relay | Worker の API（Workers Paid） | Worker → 呼び手は無料 |
| `compute`・AWS Lambda（VPC の外） | `tcp-sql`・`https-api`（外） | ok | — | AWS の外への転送（書き込み）・相手の egress（応答） |
| `compute`・AWS Lambda（VPC の中） | 外のどれでも | needs-relay | NAT ゲートウェイ（東京の単価未取得 → 段 3） | 同上 + NAT の GB |
| `compute`・Cloud Run | `tcp-sql`（Cloud SQL の私設 IP） | needs-relay | Direct VPC egress / connector | — |
| `compute`・VPS | `https-api`・`tcp-sql` | ok | — | VPS は転送の課金なし（catalog）・相手の egress |

### 3.6 釣り合い（ゲーム）

- 目標の値（記事コミュニティ $1,730・受託 $1,700）は**動かさない**（D-64 の決め方。prd/11 §3.4 のユーザーの方針「勝ち筋はおおらかでよい」）。
- 見立て（基準プレイ前・推測）:
  - 画像は既に R2（転送無料）・Bunny があり、費用の床はもう低い。Vercel × S3 + CloudFront（CloudFront の常時無料 1 TB は catalog）は**新しい床を作らず、選択肢を増やすだけ**の見込み。
  - Vercel × DynamoDB・Neon は Supabase Pro の $25 / 月を下げるが、prd/11 §3.4 のとおり**単独では届かない**見込み。
  - Cloudflare × Neon（Hyperdrive）は D1 より高く、勝ち筋を増やさない見込み（学びの選択肢）。
  - 気になるのは「**役割ごとに最安を寄せ集めた構成**」。D-114 で、他の事業者のアカウントの k 個目を毎月 0.5 × k にする（1 個で 0.5・2 個で計 1.5・3 個で計 3.0。ゲーム上の仮定・実装後に基準プレイで調整）。中継の部品の費用（Static IPs $100 / 月など）も抑えになる（CP-11）。
- 新しい組を足す段ごとに、既存の構成の基準プレイが**変わらない**ことと、新しい組の達成数を記録する（prd/11 の各節と同じ形）。

### 3.7 画面

- 始める画面・見積モードの部品の選び方: スロット（役割）ごとに「同じ事業者」「他の事業者」の小見出し（prd/11 §3.1 の案 2）。他の事業者の部品は事業者の名前を前に付ける（今と同じ）。
  選択肢が増えるので、**事業者で絞る**（「AWS の部品だけ」）か、スロットを開いたときだけ他の事業者を出す（CP-12）。
- 規則で `blocked` の部品は**出して無効にし、理由を出す**（D-45 の `componentConflict` と同じ見せ方。CP-04）。`needs-relay` は「Hyperdrive が自動で足される」のように中継を添える。
- 構成図: §6。

### 3.8 保存の互換

- 保存は部品の id（`Choices`）を持つ。案 C は**今の部品の id を変えない**ので、`SAVE_VERSION` は 4 のまま。新しい部品は id が増えるだけ（今の `components` の扱いと同じく版は上げない）。
- 中継を自動で足す部品は保存に書かない（選択から導く）。
- 部品の id を `provider:part` の形に揃えたくなったら、読み込みの別名の表を置いて版を 5 に上げる（CP-13。推奨はしない）。

### 3.9 テスト（組み合わせの爆発を抑える）

- 今の総当たり（`combo-sweep.test.ts`）は約 2,000 組・約 100 秒。部品が土台をまたいで選べると、スロットごとの選択肢が増え、直積が桁で増える。
- 抑え方（CP-14・D-114）:
  1. **規則の単体テスト**: 架空の事業者（`fictional-` で始まる id。AGENTS.md）で、口の組ごとに判定・中継・転送のノードを確かめる。実在の料金を使わない。
  2. **移し替えのテスト**（段 1）: 規則から導いた「選べる組」が今の `CROSS_PAIRS` と一致し、全構成の金額が変わらない（golden）。
  3. **規則ごとに 1 つ以上の実在の組の golden**（規則が実在の料金で動くことの確かめ）。
  4. 総当たりは**全部の直積から pairwise（各スロットの各選択肢の組が 1 回は出る）へ切り替える**（コメントにある方針）。土台ごとの既定の部品だけの総当たりは残す。
  5. 性質ベース: 「`blocked` の組は選べない」「中継のノードが経路にある」「境界の数 ≦ 経路の長さ」「アカウントの数 = `accountsOf` の数」。

### 3.10 段階的な移行（案 C）

| 段 | 中身 | 金額・保存 |
|---|---|---|
| 段 0 | この文書の論点を決める（CP-01〜） | — |
| 段 1（済み・§3.11） | 土台のノードに `role` の印。`ConnectionRule`・`PartDef` の型と、今の組を規則に移し替え（`CROSS_PAIRS` を規則から導く）。差し方を役割から導く（`hostImageShape` 等を置き換え） | **不変**（golden・基準プレイ・保存） |
| 段 2（済み・§3.12） | 公開の口の組を足す: **Vercel × DynamoDB / Aurora（DB。Marketplace）だけ**（CP-15）。後の段の候補: Vercel × S3 + CloudFront（画像）・Cloudflare × Neon（Hyperdrive の接続先違い）・Google Cloud × R2 の広げ方の見直し・AWS / Google Cloud × Neon・Supabase | 新しい組だけ。基準プレイで既存は不変 |
| 段 3 | 中継を部品として自動で足す（Static IPs・NAT・RDS Proxy・Tunnel）。単価を取ってから。`blocked` の理由を画面に出す | 新しい組だけ |
| 段 4 | 画面: 事業者で絞る・構成図の `links`（§6） | — |
| 段 5 | （任意）案 B へ: 土台も部品の集まりにする。段 1〜4 の規則と部品はそのまま使う | 全部の取り直し |

### 3.11 段 1 の実装（2026-11-03）

- **役割の印**: estimator の `ArchNodeSchema` に任意の `role`（`ROLES` の 10。計算は読まない）を足し、土台の構成の経路にあるノードに付けた。
  `sql-db` は**アプリの DB の役割**として使う（DynamoDB・Firestore・KV を DB に使う形（`kv-db`）も含む。ISR のキャッシュの KV・OpenNext のタグの DynamoDB は `kv`）。
  API Gateway は Lambda の前の HTTP の口として `compute`。OpenNext の SQS（再生成の列）は 10 の役割に当てはまらないので印を付けず、テストで例外として明示した。
  転送を数えるだけのノード（`aws-out` など）は部品ではないので印を持たない（`isTransferNode`）。
- **型と規則**（`packages/catalog/src/stacks/connections.ts`）: `Port`（5）・`ConnectionRule`（呼ぶ側の事業者・役割 → 受ける側の事業者・役割・口、フレームワーク、判定、根拠、出典）・`PartDef`（部品の役割・受ける口・土台の側でつながる役割 `attachesTo`・振る舞い `as`）。
  `CONNECTION_RULES` は今の組をつながり方ごとにまとめた 15 の規則（閲覧者 → R2・Bunny の公開の URL、土台の処理 → R2・Bunny への書き込み、Bunny の Pull Zone → Amplify・VPS、ブラウザ → Workers・AWS・VPS の API、Next.js・Astro のサーバー → Workers の API、Worker → VPS の API、土台の処理 → Neon・SES・Resend）。
  出典は移し替える前の `CROSS_PAIRS` の URL と取得日をそのまま引き継いだ（増減なし。同じ URL を別の日に確かめたものは両方の日を残す）。
- **部品**（`stacks/parts.ts`・メールは `stacks/email.ts` の `EMAIL_PARTS`）: 差せる土台（`hosts`）とフレームワークは `partOptions` が規則から導く。部品の id・名前・説明は変えていない（CP-13）。
  Bunny の前段の CDN は同じ id で 2 つの部品（Amplify の配信をオリジンにする `attachesTo: edge-cdn`・VPS をオリジンにする `attachesTo: compute`）。
- **転送（CP-06）**: `OUTBOUND`（送り出し）と `INBOUND`（受け取り）の項目を課金先の事業者（とプラン）で引き、項目のある側だけノードを作る（`transferNodes`）。
  送り出しで数えるのは Lambda（東京 → インターネット）・Netlify の関数（転送量）・Cloud Run（Premium Tier）で、Vercel の関数・Amplify の SSR は項目が無い（未確認・数えない）。受け取りは今の受け手（R2・Workers・S3・Bunny・Neon・VPS）のどれにも項目が無い。
- **差し方**（`stacks/cross.ts`）: 画像は役割から外すノード（画像の経路の置き場・変換と、画像を配るだけの CDN）と投稿の経路を導く（`imageShape`）。
  API の置き場は、土台の API を動かす処理（api の経路の `compute`）・DB（`sql-db`・`db-proxy`）を役割で見つけ、使わなくなった処理・DB・転送のノードを外す。Blob のように土台の関数からだけ書ける置き場は、口（`binding` だけ）で見分ける。
- **一致の確かめ**: 移し替える前と後で、全構成（隠した構成を含む）× フレームワーク × 部品（画像・API・DB・前段の CDN の直積と、全スロットの無作為の組を合わせて約 43 万）× 差し替えの途中の組の構成（`role` を除く）と Workload、
  ゲームの始める画面のスロット・選択肢・依存・1 か月目の見込み・総当たりの最後の状態（約 3.7 万）を突き合わせた。違ったのは隠した Netlify の 1 点だけ（下）。`cross.test.ts` は選べる組と部品ごとの土台・フレームワークを移し替える前の一覧と突き合わせる。
- **変わった 1 点**: Netlify（隠した構成）の SPA・静的書き出しで、画像を Cloudflare・Bunny に置き、API を Workers に置いた組。今までは使わなくなった `netlify-out`（R2 への書き込みの転送）が経路の外に残っていた（AWS の `aws-out` は外していた）。
  使わなくなった転送のノードを一律に外すようにしたので、このノードが無くなった。経路の外で使用量 0 なので、明細と金額は変わらない（5,810 の組で明細の行・金額の一致を確かめた）。
- **段 1 で入れていないもの**: 構成図の `links`（CP-17）は段 4。灰色で理由を出す（CP-04）・同じ事業者 / 他の事業者（CP-12）・手間の段階化（CP-11）・Vercel × DynamoDB / Aurora（CP-15）は後の段。

### 3.12 段 2 の実装（2026-11-03）: Vercel × DynamoDB / Aurora

- **部品**（`stacks/parts.ts`）: AWS の DB の部品を 3 つ（`dynamodb`・`aurora`・`aurora-pause`）。役割は `sql-db`、土台の側は `compute`、受ける口は DynamoDB が `https-api`（OIDC の一時的な認証で SDK）、Aurora が `tcp-sql`（OIDC → IAM 認証のトークン → クラスターのエンドポイント）。
  id は AWS の構成の DB の部品と同じ（保存の互換。CP-13）、料金とノードは `stacks/aws.ts` の `dbNode` をそのまま使う。Aurora DSQL・公開の RDS は入れていない（CP-15 の範囲外。後の段の候補）。
- **規則**（`stacks/connections.ts`）: `vercel-compute-dynamodb`（Vercel の処理 → AWS の `sql-db`・`https-api`）と `vercel-compute-aurora`（→ `tcp-sql`）。どちらも `ok`（中継なし。CP-07 の公開の口）。
  Marketplace の Aurora は「公開のエンドポイント + IAM 認証」とみなした。Marketplace の文書に公開の設定の記載は無く、Pro では VPC の中へつなぐ手段（Secure Compute は Enterprise）が無いことからの**推測**。公開の IPv4 のアドレスの時間課金（VPC の料金の $0.005 / 時。地域の明記なし）は**未確認として数えない**。
  出典（2026-11-03 取得）: [Vercel Marketplace の AWS](https://vercel.com/marketplace/aws)・[Marketplace の Aurora の手引き](https://vercel.com/kb/guide/connect-next-js-to-amazon-aurora-postgresql-using-vercel-marketplace)（2026-09-09 更新）・[OIDC × AWS](https://vercel.com/docs/oidc/aws)・[Marketplace のストレージ](https://vercel.com/docs/marketplace-storage)・[Secure Compute](https://vercel.com/docs/networking/secure-compute)・[VPC の中の DB](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)・[DynamoDB の料金](https://aws.amazon.com/dynamodb/pricing/on-demand/)・[Aurora の料金](https://aws.amazon.com/rds/aurora/pricing/)。
- **差し方**（`stacks/cross.ts` の `applyCrossDb`）: Neon 専用だったのを、部品の事業者ごとにノードを作る形にした（Neon は `neonNode`、AWS は `dbNode`）。ノードの id は土台の DB と同じ `db`（経路を変えない）。差し替えの途中（`db-next`）・DB のバックアップ（`withBackups` は課金先のプランで引くので、DynamoDB の PITR・Aurora の保持 7 日がそのまま効く）も同じ形。
  構成の名前は `crossDbName`（「Vercel Pro + AWS DynamoDB」「Vercel Hobby + AWS Aurora Serverless v2」）。API を他の事業者に置くと、DB と一緒に下の応答の転送のノードも外れる（`replaceDb`）。
- **転送（CP-06）**: DB の応答は DB が送り手。`transferNodes` に「問い合わせの数 × DB の応答の大きさ」で数える形（`'per-query'`）を足し、送り出しの項目（`OUTBOUND`）に AWS の DB のプラン（`dynamodb-on-demand`・`aurora-serverless-v2-io`）を足した。ノード `aws-db-out` を経路の DB の手前に置く。
  estimator の CDN の設定に任意の `egressPerQuery` を足した（`managed-db` の転送と同じ式。既定は今のまま）。受け取りは、Vercel の関数（料金の文書に項目が無い・未確認）・AWS（DynamoDB は受信に課金しない・Aurora は記載なし）とも課金なし。
  - 単価: **インターネットへの転送（AWSDataTransfer の Data Transfer Out。東京 → インターネット $0.114/GB から）として数え、AWS 全体の月 100 GB の無料のプール（`internet-free-transfer`）を共有する**（ユーザーの決定・2026-11-03）。DynamoDB・Aurora の料金ページに外への転送の単価の表は無く、AWS 共通の単価の適用と読んだ（catalog の `data-transfer-out` の facts `dynamodb-out`・`aurora-out`）。
  - 前提の文: 「Vercel の公式文書は関数の地域を AWS の地域名で示すが、関数が AWS のどのアカウントで動き、同じリージョンの DB との通信が AWS の『同じリージョン内の AWS サービス間は $0』に当たるかは公式に記載が無い（未確認）。同じリージョン（hnd1 と ap-northeast-1）に置けば安くなる可能性がある。Vercel の関数の既定の地域は iad1」（[Vercel の地域](https://vercel.com/docs/regions)・2026-11-03 取得）。
  - 切り替えの 1 か所: `connections.ts` の `AWS_DB_OUT_TO_INTERNET`。同じリージョンの扱いが公式に確かめられたら `false` にすると、送り出しの項目が課金なしになり、ノードを作らない。
- **アカウント**: Vercel の構成は既定のメールの送信（SES）で AWS のアカウントを既に数えているので、増えない（D-52 の数え方）。CP-11（k 個目のアカウントの手間を 0.5 × k）は、§3.10 の段 2 の範囲（新しい組だけ・既存は不変）に入らない（既存の組の手間が変わる）ので入れていない。新しい組はアカウントが増えないので、入れても効かない。
- **画面**: 始める画面・見積モード・ゲーム中の乗り換え（DB のスロット）に、Vercel の構成でだけ「AWS: DynamoDB（オンデマンド・Vercel の Marketplace）」「AWS: Aurora Serverless v2（…）」が出る（部品の一覧から導くので web は変えていない）。灰色で理由（CP-04）・同じ事業者 / 他の事業者（CP-12）は段 3・4。
- **不変の確かめ**: 段 1 と同じ突き合わせ（全構成 × フレームワーク × 部品の直積と無作為の組 × 差し替えの途中、ゲームの始める画面・1 か月目の見込み・総当たりの最後の状態）を main（段 1 のマージ後）と比べた。共通の約 39 万の組と約 3.7 万のプレイがすべて一致し、違いは Vercel の DB の選択肢に 3 つ増えたことだけ。
  `route-strategies-equivalence.test.ts` の記録は、足した部品を除いて取り直さずに通る。
- **費用の例**（月 30 万 PV・1 か月目の見積・税抜）:

  | シナリオ | Supabase（既定） | Neon | DynamoDB | Aurora（0.5 ACU） | Aurora（0 ACU まで） | DB の応答の転送 |
  |---|---|---|---|---|---|---|
  | 記事コミュニティ × Vercel Pro | $62.0 | $56.4 | $37.1 | $110.1 | $110.1 | 2.4 GB（無料の中） |
  | 受託 × Vercel Pro | $47.4 | $36.5 | $23.2 | $95.7 | $74.3 | 6.6 GB（無料の中） |

- **基準プレイ**（何もしない・シード 1〜20。12 か月の費用の平均 / 月。目標の額は動かさない・D-64）:

  | シナリオ × Vercel Pro | Supabase | Neon | DynamoDB | Aurora（0.5 ACU） | Aurora（0 ACU まで） |
  |---|---|---|---|---|---|
  | 受託 × Next.js | 0/20 $49.7 | 0/20 $39.5 | **20/20 $26.0** | 0/20 $98.3 | 0/20 $77.0 |
  | 受託 × SPA | 0/20 $48.9 | 14/20 $38.4 | **20/20 $25.4** | 0/20 $97.5 | 0/20 $76.3 |
  | 受託 × Astro | 0/20 $49.9 | 0/20 $39.8 | **20/20 $26.3** | 0/20 $98.5 | 0/20 $77.3 |
  | 受託 × 静的書き出し | 0/20 $48.5 | 0/20 $38.1 | **20/20 $24.8** | 0/20 $97.1 | 0/20 $75.8 |
  | 記事 × Next.js | 0/20 $125.4 | 0/20 $119.9 | 0/20 $100.8 | 0/20 $110.6 | 0/20 $110.6 |
  | 記事 × Astro | 0/20 $118.1 | 0/20 $112.6 | 6/20 $93.5 | 0/20 $151.6 | 0/20 $151.6 |
  | 記事 × Astro + 画像 `cf-resize` | 0/20 $65.1 | 0/20 $59.6 | **20/20 $40.5** | — | 0/20 $113.2 |

  Vercel Hobby はどの DB・フレームワークでも 0/20。受託 × DynamoDB でメールを Resend にすると 0/20（$21.7）。
  受託は既存の AWS（Amplify 20/20 $18.8・OpenNext 20/20 $5.5）・Netlify Personal + Neon（20/20 $30.8）が既に全シードで届くので、Vercel × DynamoDB の 20/20 はそれと同じ並び。
  記事 × Astro + `cf-resize` + DynamoDB の 20/20 は Netlify Pro × Astro + Neon + `cf-resize`（20/20 $44.6）と同じ程度。**釣り合いはそのまま入れる（2026-11-03・ユーザーが受け入れ）**: 全シードで届く組は料金どおりの結果として受け入れ、目標の額・手間は動かさない（受託の床は既存の Amplify $18.8 のままで、それより安い床は作らない）。

## 4. 出典の扱い

- 今: 組ごとに `basis` と `sources`（L1 の重複）。
- 案 C・B: **規則ごと**に `sources`（つなげるか・中継・転送の課金の根拠）、**部品ごと**に `premiseRefs`（料金・制限は provider の facts）。組の根拠は「規則の根拠 + 両側の部品の facts」から自動で作り、前提の文に出す。
- AGENTS.md の「出典を確認していない数値を実在の料金のように書かない」を守る形:
  - 料金表に送り出し・受け取りの項目が見つからない側は**課金なし**とし（金額に入れない）、前提の文に「未確認」を出す。
  - 単価が未取得の中継（NAT・RDS Proxy・Advanced Networking）は、その規則を `needs-relay` のまま**選べなくする**か「見積の対象外」と出す（CP-05）。値を仮に置かない。
  - 架空の規則・部品は `fictional-` の事業者で、テストにだけ使う（`catalog/fictional`）。

## 5. 他の文書との関係

- prd/01: `ArchEdge.boundary`（`same-provider`・`cross-provider`・`internet`）は辺を持たない形で保留していた（prd/11 §2.3）。規則が境界を決めるので、ここで初めて辺の情報が生まれる（§6）。
- prd/03: 料金のスキーマは変えない。中継の部品は普通のプラン・メーターとして足す。
- prd/04: リソースの変換は変えない（経路の上のノードの種類で決まる）。接続の数の上限は後で検討する候補（CP-09）。扱うと決めたら `limit` を足す。
- prd/07: アカウントの手間（D-52）・目標の決め方（D-64）をそのまま使う。
- prd/10: API の置き場（D-65・D-67・D-69）は「Worker の API を中継として足す」規則の特別な形として読める。今のスロット `api` は残す（CP-05）。
- prd/11: §2.2 の `via: 'binding' | 'tcp' | 'http' | 'proxy-binding'` と `requires` の案を、この文書の口と規則で置き換える。§2.3 の「送り出す側の egress で数える（受け取る側は数えない）」は、両側の項目をそれぞれ数えて足す形に改める（CP-06・D-114）。
- prd/13: 経路のテンプレート（案 B）は、ページの描き方ごとの経路と掛け合わさる。案 C は土台の経路を使うので影響しない。

## 6. 構成図との整合（ハブ型）

- 並行の作業（`packages/web/src/system-diagram-model.ts`）で、構成図を「**処理を動かす部品から各ストレージへ線を引く**（ハブ型）」に直している。
- 接続の規則はまさに「呼ぶ側（`compute`）→ 受ける口（ストレージ・DB・KV）」の線なので、**規則で決まった接続を構成図の線の元にできる**。
  案: catalog が構成に `links: { from: nodeId; to: nodeId; port: Port; boundary: 'same-provider' | 'cross-provider'; relay?: nodeId[] }[]` を添え、構成図は経路から線を推し量らずに `links` を描く（CP-17）。
  estimator はこれを読まない（費用は今の `routes` で数える）。
- 中継（Hyperdrive・Worker の API・Static IPs）はハブと受け手の間の箱として描く。`public-url` で閲覧者が直接取る画像（R2・CloudFront）は、今と同じく閲覧者からの線で描く。

## 7. 未確認・扱わないもの

- §2.5 の単価の未取得。
- 往復の遅延（今も計算していない。prd/10 F-12）。
- 可用性（片方の事業者の障害）。prd/11 §2.4 と同じく段 2 以降の出来事の候補。
- Enterprise の機能（Secure Compute）。個人・小さなチームの見積の対象外にする案（CP-07）。

## 8. 決めた論点（CP-01〜CP-17。2026-11-03・D-114）

> 実装の内部の形（CP-02・03・10・13・14・16・17）は、supervisor が推奨案で決めた。そのほかはユーザーが決めた。
> 下書きの推奨から変えたのは CP-06・CP-11・CP-15。

| # | 問い | 決定 |
|---|---|---|
| CP-01 | どの案で進めるか（A: 組を足し続ける / B: 全部を役割と口で / C: 差し替える部品だけ役割と口で） | **C**。土台は今のまま、差し替える部品だけを役割 + 接続の口と接続の規則で組む。B は段 5 で改めて判断 |
| CP-02 | 役割の一覧と粒度 | 推奨どおり（supervisor）: `edge-cdn`・`static-host`・`compute`・`image-transform`・`object-store`・`sql-db`・`kv`・`db-proxy`・`email`・`dns` の 10。今のスロット（`images`・`db`・`api`…）は役割の上の「選ぶ単位」として残す |
| CP-03 | 接続の口の種類 | 推奨どおり（supervisor）: `public-url`・`https-api`・`tcp-sql`・`binding`・`private-net` の 5。プロキシ（Hyperdrive・Supavisor・RDS Proxy）は口ではなく `db-proxy` の役割の部品にする |
| CP-04 | 規則で弾かれる組を画面に出すか | **灰色で出し、理由を添える**（D-45 と同じ見せ方）。見積モードの比較からは外し、外した理由を添える |
| CP-05 | 中継の部品をどう足すか | 規則が要る中継は**自動で足して明細・構成図に出す**。選べる中継（Worker の API）は今の `api` のスロットに従う。単価が未取得の中継（NAT・RDS Proxy・Advanced Networking）が要る組は、取得まで選べない |
| CP-06 | 事業者の間の転送をどう数えるか | **推奨から変更**。「どちらか一方の側で数える」規則にせず、**各事業者の料金データの送り出し（egress）と受け取り（ingress）の項目をそれぞれ数えて足す**（A → B の転送で A の egress と B の ingress の両方に課金があれば両方）。料金表に項目が見つからない側は課金なし（前提の文で「未確認」。Vercel の関数・Amplify の SSR など）。今は受け取りに課金する事業者はほぼ無いが、規則は両側を見る形にする |
| CP-07 | Vercel から AWS の DB へつなぐ形をどこまで扱うか | 公開の口（公開の RDS + 認証・DynamoDB・Marketplace の Aurora）を扱う。IP を絞る形は段 3 で Static IPs（Pro $100 / 月）を中継として。VPC の中（Secure Compute・PrivateLink）は扱わない |
| CP-08 | リージョン・往復の遅延 | 遅延は計算しない。地域の注意（Neon に東京が無い・Vercel の関数の既定は iad1）は前提の文だけ。**リージョンの要素は後で検討する候補**（未決の候補に残す） |
| CP-09 | 接続の数の上限を数えるか | 段 2 は前提の文だけ（プールを前提にする）。ユーザーの感覚: 普通の負荷なら接続の数が問題になることは少なく、プール（pooler）などで管理される。**後で検討する候補**（未決の候補に残す。Workers 同時 6・Cloud Run 100・Neon `max_connections` は §2.2 の事実として持つ） |
| CP-10 | 出典の持ち方 | 推奨どおり（supervisor）: **規則ごとに sources・部品ごとに premiseRefs**。組の根拠は合成。`CROSS_PAIRS` は段 1 で規則に移し、選べる組が一致するテストの後で消す |
| CP-11 | 釣り合い（手間） | **推奨から変更**。事業者が増えるほど手間を重くする: 他の事業者のアカウントの k 個目は毎月 0.5 × k（1 個で 0.5・2 個で計 1.5・3 個で計 3.0。今は 1 つにつき一律 0.5）。ゲーム上の仮定で、実装後に基準プレイで調整する。中継の部品の一度きり +1 は入れない（中継で増える事業者のアカウントで数える）。目標の額は動かさない（D-64） |
| CP-12 | 選択肢が増えた画面の選び方 | スロットごとに「同じ事業者 / 他の事業者」の小見出し。他の事業者は畳んでおき、開いたら事業者で絞れる |
| CP-13 | 保存の互換 | 推奨どおり（supervisor）: 部品の id を変えない。`SAVE_VERSION` は 4 のまま。中継は保存に書かない |
| CP-14 | 総当たりのテスト | 推奨どおり（supervisor）: 規則の単体（架空の事業者）+ 規則ごとの実在の golden + 総当たりは pairwise へ（土台の既定の総当たりは残す） |
| CP-15 | 段 2 で足す組 | **推奨から変更**。段 2 は **Vercel × DynamoDB / Aurora（DB）だけ**。Vercel × S3 + CloudFront・Cloudflare × Neon（Hyperdrive）・Google Cloud × R2 は後の段の候補 |
| CP-16 | Workers から外の Postgres へ、Hyperdrive を通さず TCP（`connect()`）で直接つなぐ形を出すか | 推奨どおり（supervisor）: 出さない（公式が Hyperdrive を勧める）。学びの「不適切な選択」にするかは後で |
| CP-17 | 構成図の線を規則から作るか | 推奨どおり（supervisor）: catalog が `links` を添え、構成図（ハブ型）はそれを描く。estimator は読まない |

### 8.1 後で検討する候補（未決）

- リージョンの要素（CP-08）: 関数と DB の地域の違い・地域料金を費用や速さに効かせるか。
- 接続の数の上限（CP-09）: `limit` として数えるか。

## 9. 出典（2026-11-03 取得。catalog・prd/11 に既にあるものは各所を参照）

- Vercel: [Static IPs](https://vercel.com/docs/networking/static-ips)・[Secure Compute](https://vercel.com/docs/networking/secure-compute)・[地域の料金](https://vercel.com/docs/pricing/regional-pricing)・[ネットワークの選び方](https://vercel.com/kb/guide/how-to-choose-the-right-vercel-networking-option)・[OIDC × AWS](https://vercel.com/docs/oidc/aws)・[Marketplace の AWS](https://vercel.com/marketplace/aws)
- AWS: [S3 の料金](https://aws.amazon.com/s3/pricing/)・[DynamoDB の料金](https://aws.amazon.com/dynamodb/pricing/on-demand/)・[VPC の料金](https://aws.amazon.com/vpc/pricing/)・[RDS Proxy の料金](https://aws.amazon.com/rds/proxy/pricing/)・[VPC の中の RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)・[VPC の Lambda のインターネット](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)
- Cloudflare: [Workers の料金](https://developers.cloudflare.com/workers/platform/pricing/)・[Workers の制限](https://developers.cloudflare.com/workers/platform/limits/)・[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)・[Hyperdrive の料金](https://developers.cloudflare.com/hyperdrive/platform/pricing/)・[Hyperdrive の私設の DB](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)・[D1 の問い合わせ方](https://developers.cloudflare.com/d1/best-practices/query-d1/)・[R2 の S3 API](https://developers.cloudflare.com/r2/api/s3/api/)
- Supabase: [Postgres への接続](https://supabase.com/docs/guides/database/connecting-to-postgres)・[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- Neon: [接続のプール](https://neon.com/docs/connect/connection-pooling)
- Google Cloud: [Cloud Run から Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/connect-run)
