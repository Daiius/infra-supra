# 11. AWS の追加と、事業者をまたぐ構成（草案）

> 状態: **論点は決定済み（2026-11-01・D-50）・段 1（AWS・D-51）と段 2 の最初の組（Vercel・AWS + 画像だけ Cloudflare・D-52・§2.5・§3.6）を実装した**。ユーザーの依頼「AWS の追加や部品の構成も追加したい。事業者をまたいだリソースの選定
> （DB だけ Cloudflare だが Vercel + Next.js など）も入れてみたい」に対し、今までの積み重ね（prd/06・07 §11・10 §3、D-20・D-24・D-31・D-37・D-44〜D-48）の上に載せるならどうするかの案。
> 料金・制限の数値は §1.5・§2.1 に**公式で確かめたものだけ**を出典 URL と取得日（2026-11-01）つきで書く。確かめていないことは「未確認」「推測」と書く。
> 手間・倍率・遅延の値は**ゲーム上の仮定**で、実在の値ではない。

## 0. 要約

- **AWS は 4 つ目の事業者（`platform: 'aws'`）として足せる。** ただし Next.js の載せ方が 1 つに決まらない（Amplify Hosting・OpenNext・コンテナ）。
  段 1 は **Amplify Hosting の Next.js（従量）+ DynamoDB または RDS** の 1 構成に絞り、OpenNext は DeployTarget の `emulated` として後の段に回す案（§1.1・AX-02）。
- AWS の見どころは **「CloudFront の常時無料 1 TB・1,000 万リクエスト」と「DB は時間課金（RDS・Aurora）か完全従量（DynamoDB）か」**。
  Vercel と同じ従量の世界だが、無料枠と DB の固定費の形が違う。新規のアカウントは 2025 年以降のクレジット制の無料プランになっていて、**12 か月の無料枠はもう新規には無い**（§1.4）。
- **事業者をまたぐ構成**は、今の `ComponentOption` に `provider`・`accountId` を持たせる決めごと（prd/07 §11.6）を実際に使い、
  「土台の事業者」+「スロットごとに同じ事業者 / 他の事業者の部品」で表す（§2.2）。組み合わせは**表で許した組だけ**（prd/10 F-11 と同じ考え）。
- 現実の可否（§2.1）: **「Vercel + D1」は D1 を直接は使えない**（D1 の REST API は管理用の面で、Cloudflare API 全体の上限 5 分 1,200 回に当たる）。
  現実に組むなら「Vercel → Cloudflare Workers の API → D1」で、prd/10 の「API を別の事業者に置く」と同じ形になる。
  逆向きの「Workers → 外部の Postgres」は Hyperdrive（Worker の binding から使う）で、これは既にある（D-24 X-6）。
- **ユーザーの方針（2026-11-01）: 勝ち筋はおおらかでよい。** 今は Vercel Pro + Supabase Pro を選ぶと固定費とクレジットを超えた従量で目標に届かない（何もしない方針は 0 / 50）。
  従量で小さく始められる道筋（AWS の従量の構成・Vercel + 従量の DB・Vercel + 画像だけ Cloudflare）を増やし、
  **基準プレイで「新しい道筋のどれかが記事コミュニティで合格するか」を確かめる**（§3.4・§3.5）。
  ただし、今ある数字（D-48）を見ると Vercel Pro の負けの主因は **Fast Data Transfer（画像の配信）** で、DB の固定費（Supabase Pro の $25）ではない。
  DB だけを従量に替えても届かない見込みが高く、**画像を他の事業者に出す方が効く**、という見立て（§3.4。要基準プレイ）。

## 1. AWS を事業者として足す

### 1.1 Next.js の載せ方（現実に選ばれている形）

| 載せ方 | 中身 | 課金の形 | 制約（公式で確かめた範囲） | DeployTarget（prd/06 §2.3） |
|---|---|---|---|---|
| **Amplify Hosting**（マネージド） | ビルド・CDN・SSR の計算を Amplify がまとめて持つ | ビルド分・配信の転送量・SSR の計算（リクエスト + GB 時間）・保存量（§1.5） | Next.js **12〜15** を対象。ISR・ミドルウェア・画像の最適化は対応。**オンデマンド ISR・ストリーミング・Edge のミドルウェア・静的アセットと最適化した画像へのミドルウェアは非対応**（[Amplify の文書](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)） | `native`（ただし `onDemandIsr: false`。D-32 の即時反映の提案を満たさない） |
| **OpenNext**（Lambda + CloudFront + S3 など） | Next.js のビルド出力を Lambda 向けのパッケージに直す。サーバーの関数・画像の最適化の関数・再検証のキュー・タグのキャッシュ・ウォーマーに分かれる | 部品ごとの AWS の従量（Lambda・CloudFront・S3・DynamoDB・SQS） | 「OpenNext does not create the underlying infrastructure」（[architecture](https://opennext.js.org/aws/inner_workings/architecture)）。構築は SST などの別の道具。保守は SST のコミュニティ（[opennext.js.org/aws](https://opennext.js.org/aws)）。ISR のキャッシュの置き場・タグの表の DB は文書のこのページでは名指しされていない（**未確認**。S3・DynamoDB と広く言われるが推測） | `emulated`（自前で ISR を再現。prd/06 §2.3 の emulated の定義どおり） |
| **ECS Fargate + ALB**（コンテナ） | `next start` をコンテナで常駐 | Fargate の vCPU 時間・メモリ時間 + ALB の時間 + LCU（§1.5） | 常駐なので VPS に近い。ISR は各タスクのディスク（複数のタスクでは共有されない。Next.js の一般的な性質で、ここでは推測） | `native`（Node のサーバー。VPS の `next start` と同じ扱い） |
| App Runner | — | — | **2026-04-30 で新規の受付を終了**（[App Runner の可用性の変更](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)）。AWS は ECS Express Mode を勧めている | 入れない |

- **段 1 の推奨は Amplify Hosting**（AX-02）。理由: ① 1 つのサービスの料金表で完結し、Vercel と同じ「マネージドの Next.js」として比べやすい。
  ② OpenNext は部品が多く（5 種類以上のサービス）、ISR の置き場が文書から確定しない。③ Fargate は固定費の常駐で、VPS と同じ側の比較になる（後の段で「AWS で常駐」の選択肢として足す）。
- ⚠ Amplify の対象は Next.js 15 まで。vinext の調査（prd/06 §5）は Next.js 16 を前提にしている。catalog の Next.js の FrameworkProfile は版を持っていないので、
  **「Next.js 16 の機能を使わない」前提の文**を Amplify の DeployTarget に付ける（AX-03）。
- Amplify の SSR の計算が内部で何で動くか（Lambda かどうか）は確かめていない。料金表の単位（リクエスト数・GB 時間）だけで写す。

### 1.2 SPA の載せ方

| 形 | 静的 | API | 備考 |
|---|---|---|---|
| S3 + CloudFront + Lambda（API Gateway の HTTP API 経由） | S3 を CloudFront の origin に（AWS の origin からの取得は無料・§1.5） | Lambda（HTTP API の前段） | 典型の形。ディープリンクは CloudFront のエラー応答の設定か CloudFront Functions で `index.html` に寄せる（手順は**未確認**） |
| Amplify Hosting の静的 + Lambda | Amplify の配信 | 同上 | Amplify の配信の単価（§1.5）は CloudFront より高い。CloudFront の常時無料 1 TB は Amplify には効かない（推測。Amplify の料金表は別の行） |

- SPA の API を Lambda の関数 URL で直接受ける形もあるが、関数 URL の料金・制限は**未確認**。段 1 は HTTP API（$1.29 / 100 万）で写す。

### 1.3 部品の候補（スロットごと）

| スロット | 候補 | 当たる前提・課金の形（§1.5 の単価） | 写すノード（estimator） |
|---|---|---|---|
| ISR のキャッシュ | Amplify の既定 / キャッシュしない | Amplify の ISR の置き場の料金は料金表に行が無い（**未確認**）。段 1 は「CDN のヒット率の式（D-37 の λT/(1+λT)）+ 再生成は SSR の計算」で写す | `cdn` の `ttlClasses` + `function` |
| 〃（OpenNext・後の段） | S3（incremental cache）+ DynamoDB（タグ） | S3 の PUT/GET・DynamoDB の読み書き | `object-storage`・`kv`（新しい `mode` が要るかは要検討） |
| 画像 | Amplify の画像の最適化 / CloudFront + Lambda で変換 / 投稿のときに縮める / 最適化しない | Amplify の最適化の単価は料金表に別の行が無い（SSR の計算に含まれるかは**未確認**）。最適化しないは CloudFront（または Amplify）の転送量に乗る | `image-optimizer`・`function` |
| DB | **DynamoDB オンデマンド** / **RDS PostgreSQL（db.t4g.micro）** / Aurora Serverless v2 | DynamoDB: 読み書きの単位で完全従量・保存 25 GB まで無料。RDS: 時間課金の固定費（約 $18/月 + ストレージ）。Aurora SV2: 0.5 ACU 以上は時間課金・0 ACU にすると接続が無い間は止まる（ただし再開に約 15 秒） | DynamoDB は新しい種類か `kv` の `db` 相当（AX-05）・RDS / Aurora は `managed-db` |
| リアルタイム | API Gateway の WebSocket | 接続分（$0.315 / 100 万分）+ メッセージ（$1.26 / 100 万）。AppSync は**未確認** | `durable-object` とは課金の形が違う（接続時間で課金）。新しい種類 |
| ファイル | S3（標準） | 保存 $0.025/GB 月・PUT $0.0047 / 1,000・GET $0.0037 / 1 万。配信は CloudFront 経由が前提 | `object-storage` |

- **Aurora Serverless v2 の 0 ACU は記事コミュニティでは止まらない**: 自動の一時停止は「ユーザーの接続が指定の時間ない」ときだけで、最短 300 秒（[auto-pause の文書](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)）。
  常に閲覧があるサイトでは常時動く。RDS Proxy を付けると一時停止しない（同じ文書）。受託の業務アプリ（夜間に使われない）なら効きうる。**事実だが誤解を誘う部品の典型**（§3.2）。
- DynamoDB は「行で課金される SQL（D1）」とも「時間で買う DB（Supabase）」とも違う第 3 の形（要求の単位で課金）。記事コミュニティのアプリを DynamoDB で書く手間（RDB を前提にしない設計）は、
  prd/07 §10.11 の「RDB を前提にする複雑なデータ管理」の出来事の反対側として効かせられる（ゲーム上の仮定）。

### 1.4 無料枠の扱い

AWS の無料枠は 3 つの層がある。どれも公式の文書で確かめたが、**文書どうしで食い違う点**がある。

| 層 | 内容（公式） | 出典 | 扱いの案 |
|---|---|---|---|
| 常時無料 | 「30+ AWS services are always free within monthly usage limits on both the Free and Paid plans」。Lambda 100 万リクエスト・40 万 GB 秒 / 月、CloudFront（従量の料金）1 TB・1,000 万リクエスト・CloudFront Functions 200 万 / 月、DynamoDB の保存 25 GB 月、インターネットへの転送 100 GB / 月（全サービス・全リージョンの合計） | [aws.amazon.com/free](https://aws.amazon.com/free/)・各料金ページ（§1.5） | 今の**無料枠のプール**（prd/03 §4）でそのまま表せる。転送 100 GB はアカウント全体のプール（`scope: 'account'`） |
| 新規のクレジット | 新規のアカウントに $100、主要なサービスを試すと最大 $100 を追加（計 $200）。Free plan は「6 months after you open it or when your credits run out」で閉じる。Paid plan に移ってもクレジットは使える | [aws.amazon.com/free](https://aws.amazon.com/free/)・[FAQ](https://aws.amazon.com/free/free-tier-faqs/) | **今のスキーマで表せない**（prd/03 §7 のクレジットは `period: 'month'`・繰り越さない）。「1 回きり・期限つき」のクレジットが要る（§4.2・AX-06） |
| 旧来の 12 か月の無料枠 | 2025-07-15 より前に作ったアカウントは、RDS の一部のインスタンスを「up to 12 months after your sign-up date」無料（RDS の無料のページ） | [aws.amazon.com/rds/free](https://aws.amazon.com/rds/free/) | **入れない**。ゲームは新しいアカウントで始める前提にし、前提の文で明示する |

- **決定（AX-06・D-50）: ゲームでは常時無料だけを入れる**（既存のアカウントを想定。新規の 1 回きりのクレジットは入れず、スキーマの追加は要らない）。下の新規のクレジットの記述は事実の記録として残す。
- ⚠ **食い違い**: FAQ はクレジットの期限を「6 months from the date you create your AWS account」とも「12 months after you create your account」とも書いている。
  FAQ には「the new sign-up experience in October 2026」という記述もあり、2026-10 に申し込みの形が変わった可能性がある（日付の 2025-07-15 は RDS の無料のページにだけある）。
  D-10 と同じく**最もらしい方に固定して記録**する: 案は「Free plan は 6 か月で閉じる。Paid plan に移った後のクレジットの期限は 12 か月」。ゲームは 12 か月なので、どちらでも「最初の数か月だけ効く」ことは変わらない。
- **無料の Free plan のまま運営はできない**（6 か月で閉じ、Paid に移す必要がある）。ゲームは既存のアカウント（Paid plan・常時無料だけ）で始める（AX-06）。
- CloudFront には別に**定額のプラン**（Free $0・Pro $15・Business $200 / 月、超過の課金なし）がある（[CloudFront の料金](https://aws.amazon.com/cloudfront/pricing/)）。
  Free は 100 万リクエスト・100 GB、Pro は 1,000 万リクエスト・50 TB。「flat-rate plans can't be combined with other offers」。
  **込み分を超えたときの挙動は確かめられていない**（未確認）。Cloudflare の Free / Pro に近い「プラン」の選択として面白いが、挙動が分かるまで段 1 では入れない（AX-07）。

### 1.5 確かめた料金（東京リージョン `ap-northeast-1`・USD・2026-11-01 取得）

一次情報は **AWS の Price List API**（公式の機械可読の料金表。`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<サービス>/current/ap-northeast-1/index.json`）と各料金ページ。
Price List API の版の日付（publicationDate）も残す。料金ページは東京の値を表で出さない（JavaScript の表）ため、数値は Price List API を正とした。

| サービス | 項目 | 単価 | 出典（版） |
|---|---|---|---|
| Lambda | リクエスト | $0.20 / 100 万（x86・Arm とも） | AWSLambda（2026-10-30） |
| Lambda | 計算（x86） | $0.0000166667 / GB 秒（60 億 GB 秒まで。以降 $0.000015・150 億超 $0.0000133334） | 同上 |
| Lambda | 計算（Arm） | $0.0000133334 / GB 秒（75 億 GB 秒まで。以降 $0.0000120001・187.5 億超 $0.0000106667） | 同上 |
| Lambda | 無料枠 | 100 万リクエスト・40 万 GB 秒 / 月 | [Lambda の料金](https://aws.amazon.com/lambda/pricing/) |
| CloudFront | 転送（日本の拠点からインターネット） | $0.114/GB（最初の 10 TB）・$0.089（次の 40 TB）… | AmazonCloudFront（2026-10-19） |
| CloudFront | HTTPS リクエスト（日本） | $0.012 / 1 万（HTTP は $0.009 / 1 万） | 同上 |
| CloudFront | CloudFront Functions | 最初の 200 万回は $0・以降 $0.10 / 100 万 | 同上 |
| CloudFront | Lambda@Edge（東京） | $0.0000006 / リクエスト・$0.00005001 / GB 秒 | 同上 |
| CloudFront | 常時無料（従量の料金） | 1 TB・1,000 万 HTTP/HTTPS リクエスト・CloudFront Functions 200 万 / 月。AWS の origin からの取得は無料 | [CloudFront の従量の料金](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| データ転送 | 東京 → インターネット | $0.114/GB（全体の無料枠を超えた最初の 10 TB）・$0.089（次の 40 TB）…。東京 → CloudFront は $0 | AWSDataTransfer（2026-09-16） |
| データ転送 | 無料枠 | 100 GB / 月（全サービス・全リージョンの合計） | [EC2 の料金](https://aws.amazon.com/ec2/pricing/on-demand/) |
| S3 標準 | 保存 | $0.025/GB 月（最初の 50 TB） | AmazonS3（2026-10-15） |
| S3 標準 | PUT・COPY・POST・LIST | $0.0047 / 1,000 | 同上 |
| S3 標準 | GET など | $0.0037 / 1 万 | 同上 |
| RDS | db.t4g.micro・PostgreSQL・Single-AZ | $0.025 / 時間（730 時間で $18.25 / 月） | AmazonRDS（2026-10-29） |
| RDS | gp3 ストレージ | $0.138/GB 月 | 同上 |
| Aurora | Serverless v2（PostgreSQL・標準） | $0.15 / ACU 時間（I/O 最適化は $0.20） | 同上 |
| Aurora | ストレージ・I/O | $0.12/GB 月・$0.24 / 100 万 I/O | 同上 |
| DynamoDB | オンデマンドの読み取り・書き込み | $0.1425 / 100 万 RRU・$0.715 / 100 万 WRU | AmazonDynamoDB（2026-09-11） |
| DynamoDB | 保存 | 最初の 25 GB 月は $0・以降 $0.285/GB 月 | 同上 |
| API Gateway | HTTP API | $1.29 / 100 万（最初の 3 億） | AmazonApiGateway（2026-10-13） |
| API Gateway | REST API | $4.25 / 100 万（最初の 3.33 億） | 同上 |
| API Gateway | WebSocket | メッセージ $1.26 / 100 万（最初の 10 億）・接続 $0.315 / 100 万分 | 同上 |
| Amplify Hosting | SSR の計算 | $0.30 / 100 万リクエスト・$0.20 / GB 時間 | AWSAmplify（2026-09-11） |
| Amplify Hosting | 配信の転送・保存・ビルド | $0.15/GB・$0.023/GB・$0.01 / 分（標準のビルド） | 同上 |
| Fargate | vCPU・メモリ | $0.05056 / vCPU 時間・$0.00553 / GB 時間 | AmazonECS（2026-10-19） |
| ALB | 時間・LCU | $0.0243 / 時間・$0.008 / LCU 時間 | AWSELB（2026-09-11） |
| VPC | 使用中のパブリック IPv4 | $0.005 / 時間（730 時間で $3.65 / 月） | AmazonVPC（2026-10-16） |

計算の例（上の単価からの算出。ゲームの値ではない）:

- RDS の最小の固定費: db.t4g.micro $18.25 + gp3 20 GB $2.76 ≒ **$21 / 月**。他の事業者（Vercel）から接続するためにパブリックにすると、IPv4 の $3.65 が足される（パブリックにするかは構成の選択で、推測）。
- Aurora SV2 を 0.5 ACU で常時動かす: 0.5 × $0.15 × 730 = **$54.75 / 月**（+ ストレージ・I/O）。
- Fargate 0.25 vCPU・0.5 GB を 1 タスク常駐: 約 $11.25 / 月 + ALB 約 $17.74 / 月（+ LCU）。

### 1.6 確かめられなかったもの（未確認）

| 項目 | 状態 |
|---|---|
| Lambda の Arm の料金の表（料金ページ） | ページの表が読めなかった。Price List API の値は取れた（§1.5） |
| Amplify Hosting の無料枠（ビルド分・転送量など） | 料金ページを読んでいない。Price List API には無料枠が載らない |
| Amplify の ISR・画像の最適化の課金の内訳 | 料金表に専用の行が無い。SSR の計算に含まれるか未確認 |
| CloudFront の定額のプランで込み分を超えたときの挙動 | 「no overage charges」だけ確認。止まるのか・速度が落ちるのか未確認 |
| Lambda の関数 URL の料金・制限、RDS Proxy、AppSync、SQS、ECS Express Mode の料金 | 未取得 |
| OpenNext の ISR のキャッシュの置き場・タグの表のサービス名 | 文書のページでは名指しされていない |
| AWS の新規のクレジットの期限（6 か月か 12 か月か） | FAQ の中で食い違い（§1.4） |

## 2. 事業者をまたぐ構成

### 2.1 例と現実の可否（公式の文書で確かめた範囲）

| 組 | 現実の可否 | 根拠（公式・2026-11-01 取得） | 表し方の案 |
|---|---|---|---|
| **Vercel + Next.js で、DB だけ Cloudflare D1** | **直接は向かない**。D1 の REST API は「primarily interacts with the control plane, and allows you to create/manage your D1 database」。Cloudflare API 全体の上限は「1,200 requests per five minute period per user」（平均で毎秒 4 回）。アプリのクエリの経路には D1 のクエリの REST の端点（`/query`）もあるが、本番のアプリ向けかの記述は無い | [D1 の問い合わせ方](https://developers.cloudflare.com/d1/best-practices/query-d1/)・[API の上限](https://developers.cloudflare.com/fundamentals/api/reference/limits/)・[D1 の Worker の API](https://developers.cloudflare.com/d1/worker-api/) | **「Vercel → Cloudflare Workers の API → D1（binding）」として表す**。これは prd/10 §3.1 の「静的は Vercel・API は Cloudflare Workers」と同じ形で、Next.js でも API を別に置く（F-14）を先に入れる必要がある。REST で直接つなぐ選択は「不適切」相当の部品として残すか（AX-10） |
| Cloudflare Workers + 外部の Postgres（Supabase・Neon・AWS） | **可**。Hyperdrive は「supports any Postgres or MySQL database」、ホストの例に AWS・Supabase・Neon を挙げる。Worker の binding から使う（「You must create a binding in your Wrangler configuration file for your Worker」） | [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)・[private database](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/) | 既にある（D-24 X-6。接続先は Supabase の 1 組）。接続先に RDS を足すのは表に 1 行足すだけ |
| Vercel + Supabase の代わりに **Neon** | **可**（Vercel の Marketplace にもある）。ただし Neon の AWS のリージョンに**東京が無い**（近いのはシンガポール） | [Neon のリージョン](https://neon.com/docs/introduction/regions)・[Neon の料金](https://neon.com/pricing) | Vercel の関数を東京（hnd1）に置くと DB との往復がシンガポールまで延びる。遅延を計算しない間（§2.3）は**前提の文**で出す |
| Vercel + **AWS RDS / Aurora / DynamoDB** | **可**。Vercel の Marketplace に Aurora PostgreSQL・Aurora DSQL・DynamoDB・S3 があり、「All billing is handled directly through AWS」 | [Vercel Marketplace の AWS](https://vercel.com/marketplace/aws) | 課金先は AWS のアカウント（`accountId: 'aws'`）。Vercel の関数 → AWS の DB の応答は AWS からインターネットへの転送（$0.114/GB・全体で 100 GB 無料） |
| Vercel + **画像だけ Cloudflare（R2 + Images）** | **可（D-52 で確かめた）**。R2 の転送は「There are no charges for egress bandwidth for any storage class」（[R2 の料金](https://developers.cloudflare.com/r2/pricing/)）。公開バケットの本番の配信はカスタムドメインで、「The domain being used must have been added as a zone in the same account as the R2 bucket」（r2.dev は「rate-limited and should only be used for development purposes」。[公開バケット](https://developers.cloudflare.com/r2/buckets/public-buckets/)）。URL の変換は「`https://<ZONE>/cdn-cgi/image/<OPTIONS>/<SOURCE-IMAGE>`」で「Transformations can be requested on every Cloudflare zone that has transformations enabled」（[URL で変換](https://developers.cloudflare.com/images/transform-images/transform-via-url/)）、元の画像は「Cloudflare will always allow source images from the same zone where your transformations are served」（[元の画像](https://developers.cloudflare.com/images/transform-images/sources/)）。Free のプランでも「optimize images stored outside of Images」（[Images の料金](https://developers.cloudflare.com/images/pricing/)）。Next.js の `loaderFile` に Cloudflare の例がある（[next.config.js の images](https://nextjs.org/docs/app/api-reference/config/next-config-js/images)）。→ **画像のドメイン（R2 のカスタムドメイン）を Cloudflare のゾーンに置けば、Vercel のサイトから URL の変換を使える** | R2 の料金（保存 $0.015/GB 月・Class A $4.50 / 100 万・Class B $0.36 / 100 万・無料 10 GB・100 万・1,000 万） | 画像のスロットに Cloudflare の部品（今の `images`・`r2-variants`）を差す。経路 `image-read` が Vercel の CDN を通らなくなり、**Fast Data Transfer が減る**（§3.4 でいちばん効く見込み） |
| VPS の前段に Cloudflare | 既にある（D-31・`frontCdn`） | — | 1 例目。データの形はこれに揃える |
| Vercel の関数の置き場 | 新規のプロジェクトは `iad1`（米国東部）が既定。「ideally close to your data source」。Hobby は 1 リージョン | [Vercel の関数のリージョン](https://vercel.com/docs/functions/configuring-functions/region) | 既に prd/10 §3.3 にある事実。DB を別の事業者の東京に置くなら、関数も hnd1 に置く前提の文を出す |

- D1 の料金（Workers Paid: 読み取り 250 億行 / 月込み + $0.001 / 100 万行・書き込み 5,000 万行込み + $1.00 / 100 万行・保存 5 GB 込み + $0.75/GB 月）は catalog にある（[D1 の料金](https://developers.cloudflare.com/d1/platform/pricing/)）。
  「Vercel + D1」は D1 の単価が安いことより、**Workers Paid（$5）を足して API の層を 1 つ持つ**ことが本体になる。

### 2.2 データの形

今の `composeStack(platform, plan, choices)` は、事業者ごとに部品の選択肢が固定（`componentsOf(platform, slot)`）。これを次のように広げる。

```ts
// catalog（データ）。部品は自分の事業者を持つ（prd/07 §11.6 の決めごと 1 を実際に使う）
type ComponentOption = {
  id: string; slot: SlotId;
  platform: Platform;                 // 部品の事業者（今と同じ。'aws' を足す）
  hosts?: Platform[];                 // この部品を差せる土台の事業者。省略は「同じ事業者だけ」（今の部品はすべてこれ）
  link?: CrossLink;                   // 土台と別の事業者のときの接続の形（下）
  /** … 既存の label・note・premiseRefs・onDemandIsr・frameworks … */
};
type CrossLink = {
  via: 'binding' | 'tcp' | 'http' | 'proxy-binding';   // Workers の binding / DB への TCP / HTTP の API / Hyperdrive
  requires?: { slot: SlotId; option: string }[];       // 例: Vercel + D1 は api: 'cloudflare-workers' が要る
  facts: string[];                                     // 現実の可否の根拠（§2.1）を前提の文として出す
};
```

- **組み合わせの可否の表**（`CROSS_PAIRS`）を catalog に持ち、許した組だけを `hosts` に書く。表に無い組は始める画面に出さない（prd/10 F-11 の「決まった組だけ」）。
  `componentConflict`（D-45 の依存の規則）に「`requires` を満たさない」を足せば、始める画面とゲーム中で同じ規則が効く。
- ノードの `billing.accountId` は部品の事業者のアカウント（今の Hyperdrive の Supabase・前段の CDN の Cloudflare と同じ）。アカウントの数は `nodes` の `billing.accountId` の種類で数えられる。
- **段 2 で許す組の案**（少数）:

| 土台 | スロット | 他の事業者の部品 | 要るもの |
|---|---|---|---|
| Vercel | images | Cloudflare（R2 + Images / 投稿のときにサイズ違いを R2） | なし（画像の URL を外に出すだけ） |
| Vercel | db | AWS RDS（PostgreSQL）/ DynamoDB | なし（TCP / HTTPS） |
| Vercel | db | Cloudflare D1 | `api: 'cloudflare-workers'`（prd/10 の API の置き場） |
| Cloudflare | db | Hyperdrive 経由で AWS RDS | なし（今の Supabase の行の接続先違い） |
| AWS | images | Cloudflare（R2 + Images） | なし |
| さくら | frontCdn | Cloudflare | 既存（D-31） |

### 2.3 経路と課金

| 論点 | 案 | 根拠 |
|---|---|---|
| 事業者の間の転送 | **送り出す側の egress のメーターで数える**（受け取る側は数えない）。AWS → インターネット $0.114/GB・Supabase の egress・Neon の公開の egress（500 GB 込み + $0.10/GB）・R2 は無料・Vercel の関数から外への通信の課金は**未確認** | 各社の料金（§1.5・§2.1） |
| 経路の表し方 | 今の `routes`（クラスごとのノードの列）のまま。隣り合うノードの `billing.provider` が違えば、その継ぎ目を**境界**として印を付ける（`crossings(arch)` の純関数）。prd/01 §4.2 の `ArchEdge.boundary` を、辺を持たずに経路の列から導く形 | `schema.ts` は辺を持たない（prd/07 §11.6 の 3） |
| 往復の遅延 | 段 2 は**計算しない**（prd/10 F-12・GD-4 の Hyperdrive と同じ）。前提の文で「事業者をまたぐ往復は計算していない」と出す。段 3 で境界ごとの往復（ms・仮定）× 1 リクエストあたりのクエリ数を壁時計時間に足し、速さの満足度に効かせる | rtt の公式の値は無い（仮定になる） |
| 関数とDBのリージョン | Vercel の関数の既定は iad1 で、DB が東京なら太平洋を往復する。前提の文に「関数を hnd1 に置く（地域料金）」を出し、hnd1 の地域料金で計算する | §2.1 |
| D1 の REST API | 直接つなぐ部品を残すなら、Cloudflare API の上限（5 分 1,200 回）を `limit` として持ち、超えたら `block`（429）の前提にする | §2.1 |

### 2.4 アカウントが増える手間

- 今のルール: 自前運用（VPS）を含むと `selfHostedUpkeep` を足す。サーバーレス同士は足さない（prd/10 §3.4）。
- 案: **課金のアカウントが 2 つ目以降になるごとに、毎月の維持の手間を 0.5（仮定）足す**（請求の確認・権限・障害の窓口が増える分）。手間のバー（D-36）の「維持」の色に入る。
  一度きりの手間（接続の設定・CORS・秘密の受け渡し）は、他の事業者の部品を差すときの手間（2）に 1 を足す（prd/10 F-13 の一度きりの手間と同じ考え）。
- 可用性: どちらかの事業者の障害で止まりうる。今の偶発的な障害は VPS だけなので、段 2 では効かせない（前提の文だけ）。

### 2.5 実装した形（D-52・2026-11-01）

- **catalog の `stacks/cross.ts`**: `CROSS_PAIRS`（土台の事業者 × スロット × 部品の事業者 + 根拠の要約と出典）・`CROSS_COMPONENTS`（他の事業者の部品）・`applyCross`（構成に差す）・`accountsOf`（課金のアカウント）。
  `ComponentOption` に `hosts`（差せる土台の事業者。省略は自分の事業者だけ）と `link`（`via: 'http'`・`as`: 振る舞いが同じ部品の id）を足した。`componentsOf(土台, スロット)` は `hosts` で引く。表に無い組の部品はテストで弾く。
- 今の組は 1 つ: **Vercel（Hobby・Pro、Next.js・SPA）の画像 × Cloudflare**。部品は 2 つ。
  - `cf-images`「Cloudflare: R2 に置き、閲覧のときに Images で変換」（`as: 'images'`）: Vercel の `image`・`blob` のノードを外し、`cf-cache`（画像のドメインのキャッシュ・ヒット率 0.9 は仮定で Cloudflare の構成と同じ値）→ `cf-r2`（R2 Standard）と、`cf-images`（Hobby は Images Free・Pro は Images Paid。**どちらを使うかは仮定**）。前提の文に R2 のカスタムドメイン・URL の変換の条件・Next.js のローダー（Next.js だけ）を出す。
  - `cf-resize`「Cloudflare: 投稿のときに一律で縮めて R2 に置く」（`as: 'resize'`）: 変換のサービスなし。画像の大きさ・サイズ違い・保存量・デザインの刷新の提案は Vercel の「一律で縮める」と同じ扱い（`imagesBehavior` で振る舞いの id を引く）。
  - 『R2 にサイズ違いを置く（投稿のときに変換）』は入れていない。Vercel の関数で変換すると Vercel の CPU、Cloudflare Images で変換すると URL の変換を投稿のときに呼ぶ形になり、どちらも今のモデルにない経路になる（段 3 の候補）。
- 経路: `image-read` は `cf-cache → cf-r2`（Vercel の CDN を通らない＝Fast Data Transfer・CDN Requests にならない）。投稿 `image-write` は今と同じく Vercel の関数が受けて R2 に書く（Class A）。
  **関数から外への通信の Vercel の課金**は [CDN の料金と使用量](https://vercel.com/docs/manage-cdn-usage)（2026-09-14 更新）に記載が無い（Fast Origin Transfer は「Data sent between the CDN and Vercel Functions」）ので**未確認として数えない**。R2 の受信（書き込みの転送）は料金表に項目が無い。
- アカウントの手間（AX-11）: **構成の既定より増えた課金のアカウント 1 つにつき毎月 0.5**、増える部品を差すときに一度きり **1**（ゲーム上の仮定・`EFFORT.accountUpkeep`・`accountSetup`）。
  既定の Vercel + Supabase の Supabase は数えない。**既存の Cloudflare + Hyperdrive（Supabase）・VPS + 前段の CDN（Cloudflare）にも同じ規則が効く**（基準プレイ・golden はどれも変わらなかった）。
  月の手間の内訳に「他の事業者の管理」を出し（増えていなければ出さない）、始める画面の手間のバー（D-36）では**マスの左半分を薄い維持の色で塗る**（0.5 の表示の形）。選んでいる構成のカードだけ、選んだ部品で増えるアカウントの名前を添える。
- **AWS への拡張（D-52 の追記・2026-11-01）**: `CROSS_PAIRS` に AWS × 画像 × Cloudflare を足し、2 つの部品の `hosts` を `['vercel', 'aws']` にした。土台ごとの差は `cross.ts` の `hostImageShape` に閉じる（aws.ts は変えない）。
  - Amplify（Next.js）: 画像の最適化（`image`）・画像だけの CloudFront（`cf`）・S3 を外す。投稿は Amplify の SSR から R2 へ。**Amplify の SSR から外への通信の課金は [Amplify の料金](https://aws.amazon.com/amplify/pricing/) に記載が無い**（転送は「per GB served」だけ）ので未確認として数えない。
  - S3 + CloudFront + Lambda（SPA）: S3 を外す（CloudFront はシェルと API に残る）。投稿は Lambda から R2 へ書き、その転送を**東京 → インターネットの転送**で数える。
    [Lambda の料金](https://aws.amazon.com/lambda/pricing/): 関数とリージョンの外とのデータの出入りは「charged at the Amazon EC2 data transfer rates」。
    AWSDataTransfer（東京・版 2026-09-16）の「AWS Outbound」: $0.114/GB（「first 10 TB / month data transfer out beyond the global free tier」）・$0.089・$0.086・$0.084。
    [EC2 の料金](https://aws.amazon.com/ec2/pricing/on-demand/): 「100 GB of free data transfer out to the internet free each month」（全サービス・リージョンの合計）。providers/aws.ts にプラン `data-transfer-out` とプール `internet-free-transfer` を足した。記事コミュニティの投稿は月 1 GB 未満で、無料の内に収まる。
  - 変換は Images Paid（仮定）。
- 未確認: R2 を使うのに支払い方法の登録・別の申し込みが要るか（料金表は「applies regardless of your Workers plan」だけ）。Images Paid の基本料（取得したページに記載なし・既存の notes）。
  R2 のカスタムドメインを部分的な（CNAME の）設定で置くときのプランの条件。Cloudflare の CDN の規約（画像の割合）が R2 のカスタムドメインの配信にどう当たるか（Cloudflare の構成と同じく前提に出していない）。

## 3. ゲームへの載せ方

### 3.1 始める画面

今: シナリオ → 構成のカード（フレームワーク・構成・部品）。部品は構成ごと（D-45）。

案:

1. **構成のカードに AWS を足す**（段 1）。他の構成と同じ並び。
2. 段 2 から、部品のスロットごとに**「同じ事業者」と「他の事業者」の 2 つの小見出し**で選択肢を並べる。他の事業者の部品には事業者の名前を前に付ける（例: 「Cloudflare: R2 + Images」）。
   選べない組（`requires` を満たさない）は無効にして理由を出す（D-45 の `componentConflict` と同じ見せ方）。
3. 他の事業者の部品を 1 つでも選ぶと、手間のバー（D-36）の維持の分が増えて見える（§2.4）。アカウントの数を「請求先: Vercel・Cloudflare」と添える。
4. 「基盤の事業者」という言葉は画面に出さず、構成の名前（例: 「Vercel Pro + Next.js」）がそれにあたる。DB の既定（Supabase）も「同じ構成の既定」として並べる。

### 3.2 説明文（フレーバー）の方針

D-41・D-45 と同じ: **事実として間違っていないが、それだけで選ぶと外れうる文。** 数値は書かない。他の事業者の部品は利点だけを書き、損（手間・遅延・転送）は ⓘ の `note` と前提の文で分かるようにする。

| 部品 | 説明文の案 | 外れうる点（ⓘ・前提で分かる） |
|---|---|---|
| AWS: Amplify Hosting の Next.js | 大手のクラウドのマネージドなホスティング。使った分だけの支払いで、無料で使える量も多い | 無料の量は CloudFront の話で Amplify の配信には効かない（推測）。即時反映は非対応 |
| AWS: Aurora Serverless v2（0 まで縮む） | 使われていない間は止まり、費用がかからない DB | 閲覧が続くサイトでは止まらない。止まると再開に十数秒 |
| AWS: DynamoDB | 使った分だけの支払いで、保存も一定量まで無料 | RDB ではないので、複雑なデータの扱いに手間がかかる |
| AWS: RDS | 定番の Postgres。小さいインスタンスから始められる | 時間課金で、使わなくても毎月かかる |
| Cloudflare: D1（Vercel から） | 安い SQL のデータベース。ほかの事業者からも使える | Worker の API を挟む必要がある（直接は管理用の API） |
| Cloudflare: R2 + Images（Vercel から） | 転送量に課金されないストレージから画像を配る | アカウントが 1 つ増える。画像の配信が別のドメインになる |
| Neon（Vercel から） | 使っていない間は止まり、従量で小さく始められる Postgres | 東京のリージョンが無い |

### 3.3 提案・出来事の候補

| 種類 | 内容 | 効き方（ゲーム上の仮定） |
|---|---|---|
| 提案 | **画像の配信を別の事業者に移す**（Vercel・AWS のとき・転送量の前提が 70% を超えた月） | 受けると画像のスロットを Cloudflare に差し替える（手間 2 + 1）。以後、アカウントの維持 0.5 |
| 提案 | **DB を別の事業者に移す**（固定費の DB を従量の DB へ・または D1 の 10 GB に近づいたとき RDS へ） | 今の DB の差し替え（6 × 1 か月・新旧両方の費用）に、またぐ分の手間 1 を足す |
| 出来事 | 事業者の障害（片方だけ） | 段 3。可用性の 1 段下げ（どちらかに依存する機能だけ） |
| 出来事（既存の流用） | 込み分・クレジットの 70% を超えた（D-48） | AWS の常時無料のプール（CloudFront 1 TB など）にもそのまま効く |

### 3.4 勝ち筋の方針（ユーザーの入力・2026-11-01）と、各案の評価

ユーザーの方針: 「勝ち筋はおおらかでよい。どの構成でも正解に持って行きやすいシナリオがあってもいいし、正解がほぼ 1 つに絞られるシナリオがあってもいい。
最初の要求がシビアなほど難易度が高い（正解が絞られる）のが自然。シナリオを不自然にしてまで調整しない。今は Vercel + Supabase Pro を選んだ時点で固定費が大きいので、
従量課金の AWS や事業者をまたぐ構成（例: Vercel + 従量の DB）を入れて、正解の道筋を増やす方向で考えたい」。

→ 目標の値（記事コミュニティ $1,730・受託 $1,700）は**動かさない**。道筋を増やすのは構成と部品の側で行い、合否は基準プレイで確かめる。

| 候補 | 固定費を下げるか | 従量で小さく始められるか | 記事コミュニティで効きそうか（今ある数字からの見立て・要基準プレイ） |
|---|---|---|---|
| Vercel Pro + **画像だけ Cloudflare** | 変わらない（Vercel $20/席・Supabase $25 のまま + Workers の $5 が要るかは部品しだい） | — | **最も効く見込み**。D-48 で Vercel Pro の費用の大半は Fast Data Transfer（12 か月目に約 1.36 TB）で、その多くは画像。R2 の転送は無料 |
| Vercel Pro + **従量の DB**（DynamoDB・Neon） | Supabase Pro の $25 → 0 に近づく | 〇 | **単独では届かない見込み**。月 $25 × 12 = $300 は、D-48 の後の Vercel Pro の所持金（$546〜$768）と目標（$1,730）の差より小さい |
| Vercel Pro + **RDS** | $25 → 約 $21（+ IPv4 $3.65） | × | ほぼ変わらない。「AWS の DB は安い」は誤解を誘う好例 |
| **AWS（Amplify + DynamoDB）** | Vercel の席の $20 が無い・DB の固定費が無い | 〇（常時無料のプールが効く） | 不明。Amplify の転送 $0.15/GB は Vercel と同じ側の単価で、画像が多い記事コミュニティでは画像の部品しだい |
| **AWS（S3 + CloudFront + Lambda の SPA・または OpenNext）** | 固定費がほぼ無い | 〇（CloudFront の常時無料 1 TB・1,000 万リクエスト） | **勝てる見込みがある**。1 TB / 月の無料の転送は記事コミュニティの前半をほぼ覆う。リクエストは 1,000 万を超えると $0.012 / 1 万 |
| 受託（業務アプリ）で Aurora の 0 ACU | 夜間・休日に止まる | 〇 | 受託は閲覧が業務時間に寄るので効きうる。ただし今の受託のシナリオは「稼働時間帯は入れない」（C-01〜C-11）ので、効かせるには稼働時間帯が要る（AX-12） |

- 見立ての数字は D-48 の記録と §1.5 の単価だけから出したもので、基準プレイを回していない。
- **ユーザーの「Vercel + 従量の DB」の直感は、今のモデルでは単独では届かない**見込みで、基準プレイでそれを確かめて見せる価値がある（D-12 の「前提が生むポイント」: 固定費に見えて、実は転送量が支配的）。
  道筋を増やす目的には「画像だけ Cloudflare」を段 2 の最初の組にする案（AX-09）。

### 3.5 基準プレイで確かめる観点

| 観点 | 基準プレイの案 | 期待（仮説） |
|---|---|---|
| AWS の何もしない方針がどの程度か | AWS（段 1 の構成）・何もしない・シード 1〜50（記事コミュニティ・受託 × Next.js・SPA） | CF Paid と Vercel Pro の間。合格は画像の部品しだい |
| AWS の従量の構成が記事コミュニティで勝てるか | AWS・画像は投稿のときにサイズ違い・提案を受ける | 合格がありうる（CloudFront の無料 1 TB） |
| Vercel Pro + 従量の DB | Vercel Pro・DB を DynamoDB（段 2）・何もしない | **不合格のまま**（仮説）。費用の差を「DB の差し替えで減った分」として出す |
| Vercel Pro + 画像だけ Cloudflare | Vercel Pro・images を Cloudflare・何もしない | 合格の数が 0 / 50 から増える（仮説） |
| またぐ構成が負けるケース | Vercel + D1（Workers の API を挟む） | 手間（一度きり + 維持）と Workers Paid の $5 で、Vercel + Supabase と同程度か悪い |
| 詰まない | シード 1〜50 のどれでも、基準プレイの少なくとも 1 本が合格（今の性質） | 構成が増えても保たれる |

### 3.6 基準プレイの結果（D-52・2026-11-01）

記事コミュニティ × Vercel Pro。D-58（画像の形式）を取り込んだ後の値（画像の形式は既定の JPEG）。シード 1〜20・何もしない（提案に返事をしない）+ 1 か月目の終わりに画像の部品を替える（替えないものは既定）。12 か月の費用は事業者別の中央値（請求の明細を事業者で足した。クレジットを引いた後）。

| フレームワーク | 画像の部品 | 達成 | 12 か月の費用 | うち Vercel / Supabase / Cloudflare | 所持金 |
|---|---|---|---|---|---|
| Next.js | （比較）CF Paid・既定 | **20 / 20** | $182 | — / — / $182 | $2,152 |
| Next.js | 既定（Vercel の画像の最適化） | 0 / 20 | $1,491 | $1,191 / $300 / — | $851 |
| Next.js | Vercel で一律で縮める | 0 / 20 | $1,624 | $1,324 / $300 / — | $714 |
| Next.js | **Cloudflare: R2 + Images** | 0 / 20 | $1,082 | $666 / $300 / $116 | $1,255 |
| Next.js | **Cloudflare: R2 に一律で縮める** | 0 / 20 | $968 | $666 / $300 / $2 | $1,369 |
| SPA | （比較）CF Paid・既定 | **20 / 20** | $175 | — / — / $175 | $1,870 |
| SPA | 既定 | 0 / 20 | $1,274 | $974 / $300 / — | $774 |
| SPA | Vercel で一律で縮める | 0 / 20 | $1,220 | $920 / $300 / — | $830 |
| SPA | **Cloudflare: R2 + Images** | 0 / 20 | $825 | $416 / $300 / $109 | $1,222 |
| SPA | **Cloudflare: R2 に一律で縮める** | 0 / 20 | $718 | $416 / $300 / $2 | $1,328 |

- **仮説の前半（Vercel Pro の負けの主因は画像の Fast Data Transfer）は当たった。** 画像を Cloudflare に出すと Vercel の請求が約半分になる（Next.js $1,191 → $666。D-58 の前はシード 1 の Fast Data Transfer が $980 → $341）。
  同じ「一律で縮める」でも、Vercel に置くと 12 か月の費用がかえって $133 増える（D-58 で既定の next/image が WebP で配るようになり、一律で縮めた JPEG より小さい。転送は Vercel の CDN を通る）のに、R2 に置くと $523 減る。**効いているのは画像の大きさでなく配信の事業者**で、「転送量の単価が支配的」という D-12 の前提が生むポイントが見える。
- **仮説の後半（画像だけ Cloudflare で勝ち筋ができる）は外れた: 0 / 20。** 所持金は約 $400〜$520 増えるが、目標 $1,730 に $360〜$480 届かない（SPA は $400〜$510）。
  残る費用は Vercel の席の基本料（$360）・HTML と JS の Fast Data Transfer（$340）・CDN Requests（$118）と、Supabase Pro の基本料（$300）。
  Supabase を従量の DB に替えて $300 が消えても約 $1,560〜$1,670 で、まだ届かない見込み（推測・回していない）。**記事コミュニティの Vercel Pro は、画像と DB の両方を替えてもぎりぎり届かない側**にある。
- CF Paid・既定（目標の根拠）は変わらない（20 / 20・既存の golden もすべて同じ）。D-58 を取り込んで変わったのは Vercel Pro の Next.js の行だけ（既定の所持金 $647 → $851・Cloudflare に出した行は $5〜$6 増）。SPA と AWS の表は変わらない。満足度は替えても同じ（速さは「普通」のまま。またぐ往復の遅延は計算しない・AX-13）。
- 目標の値は動かさない（§3.4 のユーザーの方針）。道筋を増やすなら、次は「従量の DB」（AX-09 の ②）と組んだ基準プレイで確かめる。

**AWS（D-51 の構成・常時無料だけ）× 画像だけ Cloudflare**（同じ条件。AWS の既定の画像は「投稿のときに縮める」）:

| フレームワーク | 画像の部品 | 達成 | 12 か月の費用 | うち AWS / Cloudflare | 所持金 |
|---|---|---|---|---|---|
| Next.js（Amplify） | 既定 | 10 / 20 | $623 | $623 / — | $1,702 |
| Next.js（Amplify） | **Cloudflare: R2 + Images** | **20 / 20** | $501 | $385 / $116 | $1,835 |
| Next.js（Amplify） | **Cloudflare: R2 に一律で縮める** | **20 / 20** | $387 | $385 / $2 | $1,948 |
| SPA（S3 + CloudFront + Lambda） | 既定 | 19 / 20 | $179 | $179 / — | $1,860 |
| SPA | **Cloudflare: R2 + Images** | **20 / 20** | $140 | $31 / $109 | $1,905 |
| SPA | **Cloudflare: R2 に一律で縮める** | **20 / 20** | $33 | $31 / $2 | $2,012 |

- D-58 との整合（形式を WebP・AVIF に替えて 3 か月回して確かめた）: Cloudflare: R2 + Images は形式で変換の数が増えない（変換の請求は同じ）。Cloudflare: R2 に一律で縮めるは JPEG のフォールバックも R2 に置く（Vercel・VPS の一律で縮めると同じ扱い・保存量が増える）。
  Cloudflare の変換の URL（`format=auto`）も next/image と同じくブラウザに合わせて WebP・AVIF を返すが、Cloudflare の構成の Images と同じく設定の形式で配る扱いにしている（D-58 の Cloudflare と揃えた。既定の JPEG では Vercel の next/image より大きく配る）。
- AWS の Next.js は既定で半分のシードが所持金で落ちる（Amplify の転送 $0.15/GB）。画像を R2 に出すと AWS の請求が $238 減り、**全シードで合格**する。**AWS では「画像だけ Cloudflare」が勝ち筋を作る**（Vercel Pro では作らない。席の基本料と Supabase Pro の固定費の差）。
- SPA は既定でも CloudFront の常時無料 1 TB にほぼ収まっている。画像を出すと残りの 1 シードも合格する。Lambda から R2 への転送は月 100 GB の無料の内（費用 0）。
- **CloudFront の定額のプラン（D-61）との組み合わせ**（記事コミュニティ・シード 1〜20・始める画面で選んで 12 か月）: 画像を R2 に出すと CloudFront に残るのは HTML・JS・API だけになり、壊れる組は無い。
  - Next.js・前段の CloudFront なし: Amplify には画像だけの CloudFront しか無いので、R2 に出すと CloudFront が無くなり、定額のプランは何にも当たらない（従量と同じ結果: 20 / 20）。プランの選択肢は残る（基本料も数えない）。
  - Next.js・前段の CloudFront（静的と画像だけ）: 定額 Pro は R2 + Images 20 / 20（所持金 $1,849）・R2 に一律で縮める 20 / 20（$1,968）。定額 Free は 12 か月目に転送が込みの 1.3 倍で、速さが落ちて 0 / 20。
  - SPA: 定額 Pro は R2 に一律で縮める 20 / 20（$1,833）、R2 + Images は 8 / 20（$1,720。定額 $15 と変換の費用が重なり目標にわずかに届かない）。定額 Free はリクエストの込みを超えて 0 / 20。

## 4. 既存の仕組みで足りないもの

### 4.1 estimator

| 足りないもの | 案 | 段 |
|---|---|---|
| DynamoDB 型（要求の単位で課金する DB） | `kv` の `mode: 'db'` に近いが、読み取り 1 単位 = 4 KB・書き込み 1 単位 = 1 KB で数える（単位の大きさは**未確認**・DynamoDB の文書で確かめる）。新しい種類 `request-db` か、`kv` に `unitKB` を足す（AX-05） | 1 |
| 時間課金の DB の止まる / 止まらない | `managed-db` に `minCapacity`・`pausable` を足し、記事コミュニティでは常時動く（止まらない）と判定する。Aurora の ACU の伸縮は段 1 では最小の値で固定（仮定） | 2 |
| 接続時間で課金するリアルタイム（API Gateway の WebSocket） | `durable-object` とは別の種類（接続分 + メッセージ）。チャットの提案を AWS で出すとき | 3 |
| 事業者の境界 | 経路の列から境界を導く純関数（§2.3）。段 2 は印と前提の文だけ、段 3 で遅延 | 2・3 |
| ~~1 回きり・期限つきのクレジット~~ | AX-06 で入れないことにした（常時無料だけ）。入れるなら prd/03 §7 の `Credit` に `period: 'once'`・`expiresAfterMonths` を足す | — |
| 全サービス共通の転送の無料枠 | 今のプール（`scope: 'account'`）で表せる。AWS の複数のサービス（S3・EC2・RDS）が同じプールを食う形 | 1 |

### 4.2 catalog

| 足りないもの | 案 |
|---|---|
| `providers/aws.ts` | 段 1 のサービスだけ（Amplify Hosting・CloudFront・Lambda・S3・DynamoDB・RDS・データ転送）。出典は Price List API の URL と版の日付 + 料金ページ |
| `Platform` に `'aws'` | `STACK_DEFS` に AWS の構成を後ろに足す（添字を変えない。sakura-4gb と同じ作法） |
| DeployTarget | Next.js × AWS（Amplify・`native`・`onDemandIsr: false`・Next.js 15 まで）、Vite の SPA × AWS（S3 + CloudFront） |
| `ComponentOption.hosts`・`link`・`CROSS_PAIRS` | §2.2。段 2 |
| 説明文 | `STACK_FLAVOR`・`COMPONENT_FLAVOR` に AWS と他の事業者の部品（§3.2） |

### 4.3 game

| 足りないもの | 案 |
|---|---|
| アカウントの数による維持の手間 | `upkeepOf` に「課金のアカウントの数 − 1」× 0.5（仮定）を足す（§2.4） |
| 提案・出来事 | §3.3（画像を別の事業者に・DB を別の事業者に） |
| 乗り換え | AWS への・AWS からの乗り換え（手間は今の乗り換えと同じ 12〜18） |

## 5. 段階の計画

| 段 | 入れるもの | 規模の目安（推測） | golden |
|---|---|---|---|
| **段 1** | AWS の 1 構成（Amplify Hosting の Next.js + DynamoDB）と部品数個（DB: DynamoDB / RDS、画像: Amplify の最適化 / 投稿のときに縮める / 最適化しない、ISR: Amplify の既定 / しない）。SPA は S3 + CloudFront + Lambda（HTTP API）。常時無料のプール（AX-06）。estimator に DynamoDB 型（`request-db`） | catalog: `providers/aws.ts`（新規・約 400 行）・`stacks/index.ts`（`composeAws`・約 150 行）・`frameworks`・`flavor`。estimator: 種類 1 つ。テスト: 料金の単体（架空の料金・prd/05）・構成の検証・基準プレイ 2〜3 本。ファイル 8〜10 | 既存の基準プレイは変わらない（新しい構成を足すだけ）ことを確かめる |
| **段 2** | またぐ構成のデータの形（`hosts`・`link`・`CROSS_PAIRS`・境界の印）と少数の組（Vercel + 画像だけ Cloudflare・Vercel + RDS / DynamoDB・Cloudflare + Hyperdrive → RDS）。アカウントの維持の手間。提案「画像を別の事業者に」 | catalog の部品 5〜6 個・`componentConflict` の拡張・game の手間。テスト: 組の可否の性質・アカウントの数・基準プレイ 3〜4 本。ファイル 6〜8 | 既定の選択では変わらない。維持の手間を入れるコミットで、またぐ既存の構成（Hyperdrive・前段の CDN）の基準プレイが変わる |
| **段 3** | 往復の遅延（境界 × rtt の仮定）・API の置き場（prd/10 F-14）と組んだ「Vercel + Workers の API + D1」・Aurora の 0 ACU と受託の稼働時間帯・OpenNext・CloudFront の定額のプラン（挙動を確かめてから）・AWS のリアルタイム | 種類・仮定が増える。シナリオの値の見直しが要りうる | 速さの満足度が変わるので golden が広く変わる |

- 段 1 と段 2 は独立に近い（段 2 は AWS が無くても Vercel + Cloudflare の組で始められる）。**道筋を増やす効果が大きいのは段 2 の「Vercel + 画像だけ Cloudflare」**（§3.4）なので、順番を入れ替える案もある（AX-01）。

## 6. 既存の設計との関係

- prd/07 §4（G-04「Cloudflare を先に深く」）・§11.6・D-20 の将来の範囲（「画像だけ Cloudflare・DB だけ AWS」）を、この文書で具体化する。D-20 の例がそのまま段 2 の組になる。
- prd/10 §3（API の置き場・F-10〜F-14）と同じ「決まった組だけ・遅延は計算しない」を採る。「Vercel + D1」は API の置き場（F-14）が前提になるので段 3。
- prd/README の「MVP の対象外: AWS 全般」を改める必要がある（段 1 を決めるとき）。

## 7. 論点の一覧（2026-11-01 に決定・D-50）

> 番号の接頭辞は AX（AWS と cross-provider）。G-xx は D-17 で使っているので避けた。
> **決定**: AX-01 は「両方を並行で」（推奨の ② ではなく ③ に近い形。AWS の段 1 と、Vercel + 画像だけ Cloudflare を別々のブランチで同時に進める）、AX-06 は「常時無料だけ」（推奨の ① から改めた）。ほかはすべて推奨のとおり。
> **決まったもの（ユーザーの決定・2026-11-01・D-52）**: AX-01 は ③（AWS の段 1 と並行で、まず「Vercel + 画像だけ Cloudflare」）・AX-08 ①・AX-10 ①・AX-11 ①（0.5 はマスの半分で出す）・AX-13 ①。

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| AX-01 | 段の順番 | ① AWS の 1 構成が先（段 1）・またぐ構成が後（段 2）② またぐ構成（Vercel + 画像だけ Cloudflare）が先 ③ 同時 | **決定: ③（並行）**。推奨は ② だった:ユーザーの目的（Vercel を選んでも正解に持って行ける道筋）にいちばん効き、AWS の料金データを待たずに既存の事業者 2 つだけで入れられる。AWS はその後 |
| AX-02 | AWS の Next.js の載せ方（段 1） | ① Amplify Hosting ② OpenNext（Lambda + CloudFront + S3 + DynamoDB + SQS）③ ECS Fargate + ALB ④ 複数 | **①**。料金表 1 つで完結。② は ISR の置き場が文書で確定せず部品が多い。③ は VPS と同じ側の比較で後の段 |
| AX-03 | Amplify が Next.js 15 までであること | ① 前提の文で「16 の機能を使わない」と出す ② FrameworkProfile に版を持たせて弾く ③ 無視 | **①**。今の FrameworkProfile は版を持たない（prd/06 §2.2 の `version` は未実装） |
| AX-04 | AWS の SPA の形 | ① S3 + CloudFront + Lambda（HTTP API）② Amplify の静的 + Lambda | **①**。CloudFront の常時無料が効き、Amplify との違いが前提として出る |
| AX-05 | DynamoDB を estimator でどう表すか | ① 新しい種類 `request-db` ② `kv` の `mode: 'db'` に `unitKB` を足す | **①**。KV（同じキー 1 秒 1 回・反映の遅れ）の前提を引きずらない。単位の大きさは DynamoDB の文書で確かめてから |
| AX-06 | AWS の無料枠・クレジット | ① Paid plan + 新規のクレジット $100（1 回きり・期限は §1.4 で固定）+ 常時無料のプール ② 常時無料だけ ③ 旧来の 12 か月の無料枠も | **決定: ②**（既存のアカウントを想定。スキーマの追加は要らない）。推奨は ① だった:追加の $100（試すと付く）は入れない（プレイの行動と結びつかない）。期限の食い違いは「6 か月」に固定し、D-10 と同じく記録する |
| AX-07 | CloudFront の定額のプラン（→ D-61 で入れた・§12） | ① 超えたときの挙動を確かめるまで入れない ② Pro $15 をプランとして入れる | **①** |
| AX-08 | 他の事業者の部品の選べる範囲 | ① 表で許した組だけ（§2.2）② 全部の事業者 × 全部のスロット ③ 同じ事業者だけ | **①**（prd/10 F-11 と同じ理由） |
| AX-09 | 段 2 で最初に入れる組 | ① Vercel + 画像だけ Cloudflare ② Vercel + 従量の DB ③ 両方 | **③**。① は道筋を増やす、② は「固定費に見えて転送量が支配的」を見せる（届かないことが学び）。どちらも基準プレイで確かめる |
| AX-10 | D1 を REST API で直接つなぐ部品 | ① 出さない（Workers の API を挟む形だけ・段 3）② 不適切相当の部品として出し、API の上限（5 分 1,200 回）に当てる | **①**。API の上限で止まる以前に、管理用の面をアプリに使う前提の文が弱い（本番向けかの記述が無い） |
| AX-11 | アカウントが増える手間 | ① 2 つ目以降 1 つごとに維持 0.5 + 差すときの一度きり 1 ② 足さない ③ 一度きりだけ | **①**。値は基準プレイで確かめて確定 |
| AX-12 | Aurora の 0 ACU（止まる DB）をいつ入れるか（→ ユーザーの決定で段 1 に前倒し・§11） | ① 段 3（受託に稼働時間帯を入れるときと一緒）② 段 1 から（記事コミュニティでは止まらないと出すだけ） | **①**。今の受託は稼働時間帯が無い（prd/09）ので、効く場面が無い |
| AX-13 | 往復の遅延 | ① 段 2 は計算せず前提の文 ② 段 2 から仮定の rtt で速さに効かせる | **①**（prd/10 F-12 と同じ） |
| AX-14 | Neon（東京が無い）を入れるか | ① 入れて前提の文に「最寄りはシンガポール」② 入れない | **①**（段 2 の後半）。遅延を計算しない間は前提の文だけだが、「従量で小さく始められる Postgres」の代表で、ユーザーの「Vercel + 従量の DB」の具体例になる。料金は §2.1 の Neon の料金ページの値を取り直してから |

## 8. 出典（2026-11-01 取得）

- AWS Price List API（東京）: AWSLambda・AmazonCloudFront（全体の index）・AmazonS3・AmazonRDS・AmazonDynamoDB・AmazonApiGateway・AWSDataTransfer・AWSAmplify・AmazonECS・AWSELB・AmazonVPC・AWSAppRunner。
  `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<offer>/current/ap-northeast-1/index.json`（CloudFront は `…/AmazonCloudFront/current/index.json`）。版の日付は §1.5 の表。
- AWS: [Free Tier](https://aws.amazon.com/free/)・[Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/)・[RDS の無料](https://aws.amazon.com/rds/free/)・[Lambda の料金](https://aws.amazon.com/lambda/pricing/)・
  [CloudFront の料金](https://aws.amazon.com/cloudfront/pricing/)・[CloudFront の従量の料金](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)・[EC2 の料金（データ転送）](https://aws.amazon.com/ec2/pricing/on-demand/)・
  [Amplify の Next.js の対応](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)・[Aurora の auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)・[App Runner の可用性の変更](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)
- OpenNext: [opennext.js.org/aws](https://opennext.js.org/aws)・[architecture](https://opennext.js.org/aws/inner_workings/architecture)
- Cloudflare: [D1 の問い合わせ方](https://developers.cloudflare.com/d1/best-practices/query-d1/)・[D1 の Worker の API](https://developers.cloudflare.com/d1/worker-api/)・[D1 の料金](https://developers.cloudflare.com/d1/platform/pricing/)・
  [API の上限](https://developers.cloudflare.com/fundamentals/api/reference/limits/)・[Hyperdrive](https://developers.cloudflare.com/hyperdrive/)・[Hyperdrive の private database](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)・[R2 の料金](https://developers.cloudflare.com/r2/pricing/)
- Vercel: [関数のリージョン](https://vercel.com/docs/functions/configuring-functions/region)（2026-08-11 更新）・[Marketplace の AWS](https://vercel.com/marketplace/aws)
- Neon: [料金](https://neon.com/pricing)・[リージョン](https://neon.com/docs/introduction/regions)

## 9. 実装（段 1・2026-11-01・D-51）

- 料金: `packages/catalog/src/providers/aws.ts`（provider `aws`・東京・常時無料のプールだけ）。Amplify Hosting・Lambda（x86）・API Gateway（HTTP API）・CloudFront（従量の料金・日本）・S3 標準・DynamoDB（オンデマンド）・RDS for PostgreSQL（db.t4g.micro）。
  Amplify の画像の最適化は料金表に専用の行が無いので `unpriced`（料金未取得。明細に残り合計に入らない）。Amplify の無料枠は「Free for 12 months」なので入れない（AX-06）。メンバーと SLA は「取得していない」の文（`not-stated`）。
- 構成: `packages/catalog/src/stacks/aws.ts`（`composeAws`・部品・既定の選択）。`stacks/index.ts` は登録の数行だけ（`Platform` に `aws`・`STACK_DEFS`・`COMPONENTS`・`DEFAULT_CHOICES`・`composeStack` の分岐）。構成の添字は 6（既存の後ろ）。
  - Next.js: Amplify の CDN（転送 $0.15/GB）→ Amplify の SSR（リクエスト + GB 時間）→ DB。ISR は CDN の期間つきのキャッシュ（D-37 の式）で、miss は SSR が返す。オンデマンド ISR は非対応（`onDemandIsr: false`）。
  - SPA: CloudFront → API Gateway（HTTP API）→ Lambda → DB。シェルと静的なファイルは CloudFront が返す。
  - 部品: ISR（Amplify の ISR / キャッシュしない）・画像（Amplify の最適化（Next.js だけ）/ 最適化しない / 投稿のときに縮める。後の 2 つは S3 + CloudFront で配る）・DB（DynamoDB / RDS）・API の応答のキャッシュ（SPA・CloudFront）・ファイル（S3・固定）。既定は ISR・縮める・DynamoDB。
- estimator: ノードの種類 `request-db`（読み取りは応答を 4 KB 単位で切り上げ・結果整合は半分、書き込みは 1 行を 1 KB 単位。1 行の大きさ 1 KB は仮定）と、リソース `read-request-units`・`write-request-units`。単位の換算に GB 時間 ↔ GB 秒を足した。
- 仮定: Amplify の SSR と Lambda のメモリ 1 GB（Amplify は公式の記載が見当たらない）・画像の CDN のヒット率 0.9（Vercel と同じ）・DynamoDB の 1 行 1 KB。RDS のストレージは DB の大きさで近似、アプリと RDS の間の転送は数えない（未確認）。

### 9.1 基準プレイ（何もしない・シード 1〜20・目標は今の値）

| シナリオ | 構成・部品 | 合格 | 12 か月の費用（中央値） | 所持金（中央値） | 当たった前提 |
|---|---|---|---|---|---|
| 記事コミュニティ | AWS Next.js・既定（ISR・縮める・DynamoDB） | 10 / 20 | $671 | $1,751 | CloudFront の転送 1 TB |
| 〃 | AWS Next.js・Amplify の画像の最適化 | 0 / 20 | $832（＋料金未取得。D-58 の前は $1,016） | $1,525 | — |
| 〃 | AWS Next.js・最適化しない | 0 / 20（1 か月目に所持金が尽きる） | $237 | −$102 | CloudFront の転送 1 TB |
| 〃 | AWS Next.js・RDS | 0 / 20 | $885 | $1,537 | CloudFront の転送 1 TB |
| 〃 | AWS Next.js・キャッシュしない | 10 / 20 | $670 | $1,753 | CloudFront の転送 1 TB |
| 〃 | AWS SPA・既定（縮める・DynamoDB） | 19 / 20 | $197 | $1,885 | Lambda の 100 万・CloudFront の 1 TB・1,000 万 |
| 〃 | AWS SPA・API を CloudFront でキャッシュ | 19 / 20 | $197 | $1,886 | 同上 |
| 〃 | AWS SPA・RDS | 8 / 20 | $412 | $1,670 | 同上 |
| 〃 | CF Paid・何もしない（目標の根拠） | 20 / 20 | $182 | $2,153 | 変わらない |
| 受託 | AWS Next.js・既定 | 20 / 20 | $180 | $1,873 | — |
| 〃 | AWS Next.js・RDS | 0 / 20 | $388 | $1,665 | — |
| 〃 | AWS SPA・既定 | 20 / 20 | $50 | $2,003 | Lambda の 100 万 |
| 〃 | AWS SPA・RDS | 20 / 20 | $258 | $1,795 | — |
| 〃 | CF Paid・何もしない（目標の根拠） | 20 / 20 | $68 | $2,037 | 変わらない |

- 未達の理由はすべて所持金（満足度は 0.85〜0.89 で目標を超える）。受託は画像のスロットを出さないので、画像の部品の違いは効かない。
- **Next.js の AWS は目標の前後**（Amplify の転送 $0.15/GB が効く）。画像を Amplify で最適化すると転送が増えて届かない。**SPA の AWS は CloudFront の常時無料で記事コミュニティでも勝てる**（§3.4 の見立てどおり）。RDS の固定費（約 $18/月 + ストレージ）は小さな規模ほど効く。
- 「API を CloudFront でキャッシュ」がほぼ効かないのは、ゲームの API のキャッシュの期間の設定（D-37）が既定で 0 だから（他の事業者と同じ）。
- 所持金の目標と広告の単価は、この表を見て決め直す（D-50）。既存の golden（CF・Vercel・VPS の基準プレイ）は変わらない。

### 9.2 Amplify の前段の自前の CloudFront（2026-11-01・D-51 の追記）

ユーザーの問い: 「CloudFront を使ったキャッシュの設定を入れられないか。普通にプレイすると data-transfer-out で厳しい。Amplify で構成するとデフォルトで入らなかったか」。

公式で確かめたこと（2026-11-01 取得）:

| 問い | 事実 | 出典 |
|---|---|---|
| Amplify は CloudFront を使うか | 「Amplify uses Amazon CloudFront to manage the caching configuration」。ただし Amplify が管理する配信で、課金は Amplify の料金表（「$0.15 per GB served」）。料金表に CloudFront・キャッシュのヒットの扱いの記述は無い | [caching](https://docs.aws.amazon.com/amplify/latest/userguide/caching.html)・[Amplify の料金](https://aws.amazon.com/amplify/pricing/) |
| Amplify の既定のキャッシュ | 静的なファイルは 1 年、SSR（reverse proxy）の応答は 0 秒（キャッシュしない）。SSR の応答の `Cache-Control`（`s-maxage`）に従い、カスタムヘッダーで上書きできる | [caching](https://docs.aws.amazon.com/amplify/latest/userguide/caching.html)・[Cache-Control](https://docs.aws.amazon.com/amplify/latest/userguide/Using-headers-to-control-cache-duration.html) |
| CloudFront の常時無料は Amplify に効くか | CloudFront の料金ページの無料の取得の例は S3・EC2・ELB などで、**Amplify は挙がっていない**。Amplify の配信に CloudFront の常時無料（1 TB）を当てる記述は無い | [CloudFront の従量の料金](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| 自前の CloudFront を前に置けるか | Amplify の利用者ガイドに手順は無い。AWS Prescriptive Guidance に「Amplify の前に CloudFront を置く」パターンがある（本文は取得できず、検索の要約だけ）。re:Post の回答も同じ形（Amplify の既定のドメインを origin にする・独自ドメインは CloudFront 側に）。**Amplify 側の origin への応答の課金は記載が無い** | [Prescriptive Guidance のパターン](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/enable-aws-waf-for-web-applications-hosted-by-aws-amplify.html)・re:Post |

- 既存のモデルでも ISR のページは Amplify の CDN でキャッシュしていた（D-37 の式）。問題は**キャッシュしたものも Amplify の配信（$0.15/GB）として課金される**こと。
- 入れた部品「前段の CDN」（AWS × Next.js だけ。D-31 と同じ id）: なし / 自前の CloudFront（静的と画像だけ）/ 自前の CloudFront（ISR のページもキャッシュ）。
  前段のヒット分は CloudFront の単価・常時無料、外れた分と HTML・API は **Amplify の配信としても課金**（二重）とみなす（catalog の `front-cloudfront` の解釈。高めの側の読み）。キャッシュは前段の 1 層で数え、Amplify の CDN は前段が持つクラスを素通しにする。
  「ISR のページも」は D-31 と同じく鮮度を 1 段下げる（オンデマンドの再検証が届かない。Amplify はもともとオンデマンド ISR に非対応）。手間は前段の CDN と同じ 2。
- 同じ確認で、課金の明細のメーターの名前を `amplify-transfer-out` と `cloudfront-transfer-out` に分けた（どちらも `data-transfer-out` で、画面で見分けられなかった）。

基準プレイ（記事コミュニティ × AWS Next.js・何もしない・シード 1〜20。D-58 の画像の形式を取り込んだ後の値）:

| 画像 | 前段 | 合格 | 12 か月の費用 | 所持金（中央値） | 満足度 |
|---|---|---|---|---|---|
| 縮める（既定。画像はもともと S3 + CloudFront） | なし | 10 / 20 | $671 | $1,751 | 0.89 |
| 〃 | 静的と画像 | 10 / 20 | $623 | $1,779 | 0.89 |
| 〃 | ISR のページも | 8 / 20 | $518 | $1,706 | 0.84（鮮度） |
| Amplify の最適化（料金未取得・費用は下限） | なし | 0 / 20 | $832 以上 | $1,525 以下 | 0.89 |
| 〃 | 静的と画像 | 20 / 20（下限の費用での合格） | $261 以上 | $2,083 以下 | 0.89 |
| 〃 | ISR のページも | 20 / 20（同上） | $232 以上 | $1,912 以下 | 0.84 |

- 縮める画像（既定）では、画像の配信がもともと CloudFront にあり、前段で減るのは HTML と静的なファイルだけ。HTML・API は二重に課金されるので効果は小さい。
- Amplify で最適化した画像を前段の CloudFront から配ると、記事コミュニティで全シード合格する（画像の転送が Amplify の $0.15/GB から CloudFront の常時無料 1 TB へ移る）。**ただし変換の料金が未取得（0 として合計に入っていない）ので、この合格は下限の費用でのもので、最適な選択とは言えない**（§9.3）。
- 前段の課金の解釈（外れた分を Amplify の配信として数える）が逆なら、さらに安くなる。

## 10. Amplify の制限（文書化だけ・2026-11-01）

ユーザーが確かめた Amplify の制限。ゲームで使う仕組み（依存の大きさ・応答の大きさ・ストリーミング）が今は無いので、catalog の前提には入れず、ここに記録する（Next.js の版とオンデマンド ISR は既存の部品・事実で出している）。

| 制限 | 内容 | 出典 |
|---|---|---|
| SSR のビルド出力 | 計算のリソースの束は展開して 220 MB まで | [デプロイの仕様](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html) |
| 応答の大きさ | Next.js 12 以降（Web Compute）の応答は 5.72 MB まで。超えると 504（中身なし） | [SSR のトラブルシューティング](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html) |
| 画像の最適化の出力 | 出力する画像は 4.3 MB まで | [Amplify の Next.js の対応](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html) |
| 非対応の機能 | オンデマンド ISR・ストリーミング・Edge のミドルウェア・静的アセットと最適化した画像へのミドルウェア・`unstable_after` | 同上 |
| Next.js の版 | 12〜15 | 同上 |
| 実行の時間・一時領域 | 実行は最大 15 分、一時領域は 512 MB（`/tmp` だけ書ける） | [デプロイの仕様](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html)（検索の要約で確認。本文は未読） |

ゲームで扱うなら（将来の出来事の候補・仮定）:

- **依存を足す提案**（機能追加で大きなライブラリ・画像処理のネイティブの依存が増える）→ SSR のビルド出力が 220 MB に近づき、超えるとデプロイできない。対策は依存の整理（手間）か、重い処理だけ Lambda・別の事業者へ出す（prd/10 F-14 の API の置き場と重なる）。
- **大きな応答**（一覧のページ・CSV の出力など）→ 5.72 MB を超えると 504。受託の業務アプリの「帳票の出力」の出来事の候補。
- **ストリーミングを前提にする機能**（AI の応答の逐次表示など）→ Amplify では使えない。Vercel・Cloudflare では使える、という前提の差として出せる。
- **原本の大きい画像**（4.3 MB を超える出力）→ D-47 の「最適化しない＝原本 4 MB」の近くにある。原本の大きさを上げる出来事と組むと当たる。

## 11. Aurora 系の DB（2026-11-01・D-51 の追記。AX-12 の「段 3」を前倒し）

ユーザーの決定で、AWS の DB に Aurora Serverless v2 と Aurora DSQL を足した。確かめた事実（2026-11-01 取得）:

| 項目 | 事実 | 出典 |
|---|---|---|
| Serverless v2 の料金（東京・PostgreSQL） | 標準 $0.15 / ACU 時間・保存 $0.12/GB 月・I/O $0.24 / 100 万。I/O-Optimized は $0.20 / ACU 時間・保存 $0.27/GB 月で I/O に課金されない | Price List API（AmazonRDS・2026-10-29）・[Aurora の料金](https://aws.amazon.com/rds/aurora/pricing/) |
| I/O-Optimized の目安 | 「if your I/O spend exceeds 25% of your total Aurora database spend, you can save up to 40%」 | 同上 |
| 0 ACU と自動停止 | 最小の容量を 0 ACU にすると、ユーザーの接続が指定の時間（最短 300 秒・既定も 300 秒）無いと止まり、止まっている間はインスタンスの料金が 0。再開はふつう約 15 秒、24 時間を超えて止まると 30 秒以上。RDS Proxy を付けると止まらない。0 にしないときの最小は 0.5 ACU | [auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) |
| DSQL の料金（東京） | $0.00001 / DPU（$10 / 100 万 DPU）・保存 $0.40/GB 月。毎月 10 万 DPU と 1 GB は無料（常時無料） | Price List API（AuroraDSQL・2026-09-11）・[DSQL の料金](https://aws.amazon.com/rds/aurora/dsql/pricing/)・[RDS の無料](https://aws.amazon.com/rds/free/) |
| DSQL の DPU | SQL の処理（ComputeDPU）と保存の読み書き（ReadDPU・WriteDPU）などの量。**1 件あたりの DPU は書かれていない**。料金ページに「10 万 DPU ≈ TPC-C 由来の 70 万トランザクション（読み 95%）」の例 | [DSQL の料金](https://aws.amazon.com/rds/aurora/dsql/pricing/) |
| DSQL の制約 | 一時テーブル・トリガー・PL/pgSQL が無い。1 トランザクションで変更できる行は 3,000 まで・DDL と DML は別のトランザクション。分離レベルは Repeatable Read に固定・楽観的な並行制御で競合すると再試行。接続は 1 時間で切れる | [PostgreSQL との違い](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html) |

扱い（判断）:

- **Serverless v2 は I/O-Optimized を既定（唯一）にした**。標準の I/O は「1 件あたりの I/O の数」という確かめられない量に依るため（I/O を料金未取得にすると標準が不当に安く見える）。
- 容量は最小の 0.5 ACU で固定（負荷で伸びた分は数えない。RDS の db.t4g.micro と同じ単純化）。部品は「最小 0.5 ACU」と「0 ACU まで縮める」の 2 つ。
- **0 ACU の止まり方は素直に計算する**: 接続の無い時間 T（300 秒）の間に DB へ 1 件も届かない割合を、月の平均の到着率 λ から `1 / (1 + λT)` で近似し、動いている割合 `λT / (1 + λT)` だけ ACU を課金する（キャッシュのヒット率と同じ近似。estimator の `managed-db` に `capacityUnits`・`pauseAfterIdleSeconds`）。夜間に減る分は入れていない。
  記事コミュニティ・受託ともに常に誰かが見ているので、**ほぼ止まらない**（動いている割合 0.9 を超える）。再開の待ち（約 15 秒）は止まる時間がほぼ無いので速さに入れない（前提の文で出す）。
- DSQL は estimator の新しい種類 `processing-db`（DB に届く 1 件 = 0.14 DPU。料金ページの例からの**仮定**）。DPU の単価・無料枠は公式の値。

基準プレイ（何もしない・シード 1〜20・ほかの部品は既定（ISR・縮める・前段なし））:

| シナリオ | フレームワーク | DynamoDB | RDS | Aurora（0.5 ACU） | Aurora（0 ACU まで） | DSQL |
|---|---|---|---|---|---|---|
| 記事コミュニティ | Next.js | 10/20・$671 | 0/20・$885 | 0/20・$1,543 | 0/20・$1,537 | 10/20・$684 |
| 記事コミュニティ | SPA | 19/20・$197 | 8/20・$412 | 0/20・$1,070 | 0/20・$1,063 | 19/20・$207 |
| 受託 | Next.js | 20/20・$180 | 0/20・$388 | 0/20・$1,048 | 0/20・$1,043 | 20/20・$189 |
| 受託 | SPA | 20/20・$50 | 20/20・$258 | 0/20・$918 | 0/20・$913 | 20/20・$59 |

（合格数・12 か月の費用の中央値。未達の理由はすべて所持金）

- **Aurora Serverless v2 は AWS を有利にしない**（ユーザーの見立てどおり）。最小 0.5 ACU × $0.20 で月約 $73 の固定費になり、12 か月で約 $870 増える。0 ACU まで縮めても止まらないので、差は $5 前後しか縮まない。
- DSQL は DynamoDB とほぼ同じ（無料の 10 万 DPU の後は月数ドル）。ただし DPU の量は仮定に強く依る（1 件 0.14 DPU）。RDB を使えるが制約がある、という前提の文で選び分ける形になる。

### 9.3 Amplify の画像の最適化の課金（2026-11-01・D-51 の追記）

「Next.js の画像の最適化は SSR の compute で動き、compute のリクエストと GB 時間で課金されるはず」という見立てを公式で確かめた。

| 確かめたこと | 事実 | 出典 |
|---|---|---|
| 料金表 | SSR の行はリクエスト数（$0.30 / 100 万）と時間（$0.20 / GB 時間）だけ。画像の最適化の行も、SSR に含むという記述も無い | [Amplify の料金](https://aws.amazon.com/amplify/pricing/)・Price List API（AWSAmplify） |
| 仕組み | デプロイの仕様は **Compute とは別の基本の仕組み（primitive）として Image optimization を挙げる**（「Provides frameworks with a service to optimize images at runtime」）。経路の行き先も `Compute` と `ImageOptimization` で別 | [デプロイの仕様](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html) |
| Next.js の対応 | 画像の最適化に対応・Sharp は Amplify が入れる・出力は 4.3 MB まで。課金の記述は無い | [Amplify の Next.js の対応](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html) |

- **compute のリクエストと GB 時間として数える根拠は見つからなかった**（公式は別の仕組みとして書いている）。そのため推測で compute に載せず、**料金未取得のまま**にした。
- 誤解を減らすため、部品の名前を「Amplify の画像の最適化（料金未取得）」にし、ⓘ の説明の先頭に「⚠ 料金未取得（この部品を選ぶと費用は下限）」、短い説明に「変換の料金は未取得で、費用は下限」を入れた。月の明細には前から「（料金未取得 N 件。費用は下限）」が出ている。
- 基準プレイの数字は変わらない（§9.1・§9.2 の Amplify の最適化の行に「下限」と注記した）。確かめ方: 実際の請求で、画像の最適化が別の行で来るか、SSR のリクエスト・時間に含まれるかを見る。

## 12. CloudFront の定額のプラン（2026-11-01・D-61）

ユーザーの方針（より現実的なコスト感・費用を抑える複雑な構成も可能にしたい）を受けて、AX-07（定額のプランは挙動を確かめるまで入れない）を改め、超えたときの挙動を公式で確かめて入れた。

確かめた事実（2026-11-01 取得）:

| 項目 | 事実 | 出典 |
|---|---|---|
| プランと込みの量（1 distribution あたり月額） | Free $0（100 万リクエスト・100 GB）/ Pro $15（1,000 万・50 TB）/ Business $200（1 億 2,500 万・50 TB）/ Premium $1,000（5 億・50 TB） | [CloudFront の料金](https://aws.amazon.com/cloudfront/pricing/)・[定額のプランの文書](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html) |
| 込みのもの | WAF・DDoS の保護・Route 53・TLS 証明書・CloudFront Functions（サーバーレスのエッジの計算）・ログの取り込み・S3 Standard の保存のクレジット。Lambda@Edge は従量 | 同上 |
| 超えたとき | 「you will not incur overage charges, regardless of how much you exceed your allowance」。最初の急増は込みの 3 倍までその月に影響しない。超えた状態は 2〜3 か月以上で評価。続けて大きく超えると、より少ない・遠い拠点から配るなど性能が調整されうる（超えた量に比例）。止めるとは書かれていない | [定額のプランの文書](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)・[紹介のブログ](https://aws.amazon.com/blogs/networking-and-content-delivery/introducing-flat-rate-pricing-plans-with-no-overages) |
| 制約 | 1 プラン = 1 distribution。Free は 1 アカウントで 3 つまで。他の割引と併用できない。オリジンの例は S3・ALB・API Gateway（AWS のオリジンからの転送は無料のまま） | 同上 |
| 未確認 | Amplify・Lambda の関数 URL をオリジンにできるか。東京での違い | — |

入れた形:

- 部品のスロット「CDN の料金のプラン」（`cdnPlan`。AWS の Next.js・SPA の両方）: 従量（常時無料つき・既定）/ 定額 Free / Pro / Business。ゲーム中の切り替えは手間 1（設定の変更に近い。仮定）。Premium は入れていない（規模に合わない）。
  AWS の構成の CloudFront（SPA の配信・画像の S3 + CloudFront・Amplify の前段）を **1 つの distribution にまとめる**とみなし、選んだプランで数える（基本料は 1 回）。
- 料金データ: 定額のプランは基本料 + 込みの量のプール（リクエスト・転送）。超えたときの挙動に新しい種類 `adjust`（請求は増えず止まりもしないが、続くと性能が調整されうる）を足し、前提の効き方も `adjust` で出す。S3 の保存のクレジットは数えていない（費用は高めの側）。
- 性能の調整（**ゲーム上の仮定**。`FLAT_PLAN_ADJUST`）: 込みの **3 倍を超えた月**、または **2 か月続けて超えた月**に、速さを 1 段下げる。収益の直接の減り（遅延の `throttle` のような損）は入れない。月の報告と速さの理由に「配信の性能が調整された」を出す。
- Amplify の前段に定額を使うと、前提の文に「Amplify をオリジンにする構成は公式に未確認」を出す（選べなくはしない）。

基準プレイ（何もしない・シード 1〜20・画像は既定の「投稿のときに縮める」）:

| シナリオ | 構成 | 従量 | 定額 Free | 定額 Pro |
|---|---|---|---|---|
| 記事コミュニティ | Next.js・前段 CF（静的と画像） | 10/20・$623 | 0/20・$141（満足度 0.79） | **20/20・$381** |
| 〃 | Next.js・前段 CF（ISR も） | 8/20・$518 | 0/20・$127（0.74） | 20/20・$361 |
| 〃 | SPA | 19/20・$197 | 0/20・$28（0.79） | 20/20・$218 |
| 受託 | Next.js・前段 CF（静的と画像 / ISR も） | 20/20・$154 | 0/20・$133（0.71） | 16/20・$334 |
| 〃 | SPA | 20/20・$50 | 0/20・$44（0.71） | 20/20・$230 |

（合格数・12 か月の費用の中央値）

- **記事コミュニティでは定額 Pro が全シードで合格**する（Next.js の前段の CloudFront で、従量の 1 TB・1,000 万を超えた分が込みに入る）。公式どおりの結果として受け入れる（目標と単価は後でまとめて決め直す）。
- 定額 Free は安いが込み（100 万・100 GB）を最初から大きく超え、2 か月目から速さが下がり続けて満足度で落ちる。受託でも同じ。
- 受託のように小さな規模では、Pro の $15 × 12 が従量の常時無料より高くつく（従量のほうが安い）。規模によって最適が入れ替わる例になる。
