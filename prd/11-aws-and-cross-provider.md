# 11. AWS の追加と、事業者をまたぐ構成（草案）

> 状態: **論点は決定済み（2026-11-01・D-50）・段 1（AWS）と段 2 の最初の組（Vercel + 画像だけ Cloudflare）を並行で実装中**。ユーザーの依頼「AWS の追加や部品の構成も追加したい。事業者をまたいだリソースの選定
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
| Vercel + **画像だけ Cloudflare（R2 + Images）** | 可と見込む。R2 の転送は「free」（[R2 の料金](https://developers.cloudflare.com/r2/pricing/)）。Next.js の画像のローダーを外部の変換に向ける形が一般的だが、**Cloudflare Images の URL の変換をそのドメインで使う条件は未確認** | R2 の料金（保存 $0.015/GB 月・Class A $4.50 / 100 万・Class B $0.36 / 100 万・無料 10 GB・100 万・1,000 万） | 画像のスロットに Cloudflare の部品（今の `images`・`r2-variants`）を差す。経路 `image-read` が Vercel の CDN を通らなくなり、**Fast Data Transfer が減る**（§3.4 でいちばん効く見込み） |
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

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| AX-01 | 段の順番 | ① AWS の 1 構成が先（段 1）・またぐ構成が後（段 2）② またぐ構成（Vercel + 画像だけ Cloudflare）が先 ③ 同時 | **決定: ③（並行）**。推奨は ② だった:ユーザーの目的（Vercel を選んでも正解に持って行ける道筋）にいちばん効き、AWS の料金データを待たずに既存の事業者 2 つだけで入れられる。AWS はその後 |
| AX-02 | AWS の Next.js の載せ方（段 1） | ① Amplify Hosting ② OpenNext（Lambda + CloudFront + S3 + DynamoDB + SQS）③ ECS Fargate + ALB ④ 複数 | **①**。料金表 1 つで完結。② は ISR の置き場が文書で確定せず部品が多い。③ は VPS と同じ側の比較で後の段 |
| AX-03 | Amplify が Next.js 15 までであること | ① 前提の文で「16 の機能を使わない」と出す ② FrameworkProfile に版を持たせて弾く ③ 無視 | **①**。今の FrameworkProfile は版を持たない（prd/06 §2.2 の `version` は未実装） |
| AX-04 | AWS の SPA の形 | ① S3 + CloudFront + Lambda（HTTP API）② Amplify の静的 + Lambda | **①**。CloudFront の常時無料が効き、Amplify との違いが前提として出る |
| AX-05 | DynamoDB を estimator でどう表すか | ① 新しい種類 `request-db` ② `kv` の `mode: 'db'` に `unitKB` を足す | **①**。KV（同じキー 1 秒 1 回・反映の遅れ）の前提を引きずらない。単位の大きさは DynamoDB の文書で確かめてから |
| AX-06 | AWS の無料枠・クレジット | ① Paid plan + 新規のクレジット $100（1 回きり・期限は §1.4 で固定）+ 常時無料のプール ② 常時無料だけ ③ 旧来の 12 か月の無料枠も | **決定: ②**（既存のアカウントを想定。スキーマの追加は要らない）。推奨は ① だった:追加の $100（試すと付く）は入れない（プレイの行動と結びつかない）。期限の食い違いは「6 か月」に固定し、D-10 と同じく記録する |
| AX-07 | CloudFront の定額のプラン | ① 超えたときの挙動を確かめるまで入れない ② Pro $15 をプランとして入れる | **①** |
| AX-08 | 他の事業者の部品の選べる範囲 | ① 表で許した組だけ（§2.2）② 全部の事業者 × 全部のスロット ③ 同じ事業者だけ | **①**（prd/10 F-11 と同じ理由） |
| AX-09 | 段 2 で最初に入れる組 | ① Vercel + 画像だけ Cloudflare ② Vercel + 従量の DB ③ 両方 | **③**。① は道筋を増やす、② は「固定費に見えて転送量が支配的」を見せる（届かないことが学び）。どちらも基準プレイで確かめる |
| AX-10 | D1 を REST API で直接つなぐ部品 | ① 出さない（Workers の API を挟む形だけ・段 3）② 不適切相当の部品として出し、API の上限（5 分 1,200 回）に当てる | **①**。API の上限で止まる以前に、管理用の面をアプリに使う前提の文が弱い（本番向けかの記述が無い） |
| AX-11 | アカウントが増える手間 | ① 2 つ目以降 1 つごとに維持 0.5 + 差すときの一度きり 1 ② 足さない ③ 一度きりだけ | **①**。値は基準プレイで確かめて確定 |
| AX-12 | Aurora の 0 ACU（止まる DB）をいつ入れるか | ① 段 3（受託に稼働時間帯を入れるときと一緒）② 段 1 から（記事コミュニティでは止まらないと出すだけ） | **①**。今の受託は稼働時間帯が無い（prd/09）ので、効く場面が無い |
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
