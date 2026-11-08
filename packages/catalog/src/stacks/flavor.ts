// 構成の短い説明（始める画面のフレーバー。D-41）。構成の id（STACK_DEFS）で引く。
// 事実として間違ってはいないが、それだけで選ぶと外れうる書き方にしている（何が効くかは遊んで確かめる）。
// 数値は書かない。事実の根拠は同じ catalog のデータ（プランの制限・規約・SLA・転送量・席の料金）にある。
export const STACK_FLAVOR: Readonly<Record<string, string>> = {
  'cloudflare-vinext-free':
    'Cloudflare の無料プラン。無料枠が大きく、デプロイなどの管理もしやすいですが、各種の制限やストレージの性質に注意',
  'cloudflare-vinext-paid':
    '月額の基本料がかかる有料プラン。無料プランで足りる規模なら、払う必要はないかもしれません',
  'vercel-supabase-hobby':
    'Next.js の開発元のホスティングの無料プラン。様々な無料枠がつき、データベースも無料で始められます。個人の開発で試すのにちょうどよいです',
  'vercel-supabase-pro':
    'チーム・本番向けのプラン。込みのクレジットがあり、アクセスが伸びても自動で追従します',
  'sakura-vps-2gb':
    '月額が固定で、使った分の請求に驚かされません。サーバーの中を自由に設定できます',
  'sakura-vps-4gb':
    'メモリに余裕のある上のプラン。稼働率の SLA の対象にもなり、アクセスが増えても安心です',
  'aws-opennext':
    'Next.js を関数と CDN とストレージに自分で載せます。部品ごとの従量で安く組めますが、仕組みの面倒は自分で見ます',
  'aws-amplify':
    '大手のクラウドのマネージドなホスティング。基本料が無く使った分だけの支払いで、常に無料で使える量もあります',
  'netlify-supabase-free':
    '静的なサイトの老舗のホスティングの無料プラン。毎月のクレジットの中なら請求は来ず、データベースも無料で始められます',
  'netlify-supabase-personal':
    '個人向けの手ごろな月額のプラン。クレジットが増え、足りなければ少額ずつ買い足せます',
  'netlify-supabase-pro':
    'チーム向けのプラン。メンバーを何人足しても月額は同じで、クレジットも多いです',
  'gcp-cloud-run':
    '大手のクラウドでコンテナを動かします。使った分だけの支払いで、無料で使える量もあり、同時のリクエストはまとめてさばけます',
};

/**
 * 部品の選択肢の短い説明（始める画面とゲーム中の部品の欄。D-45）。「事業者:スロット:部品の id」で引く。
 * 構成の説明と同じ方針: 事実として間違ってはいないが、それだけで選ぶと外れうる文。適切な選択肢にも損に見える面を書き、
 * 説明だけで正解が分からないようにする。数値は書かない。事実の説明は部品の note（ⓘ）に残す。
 * シナリオをまたいで使うので「記事」でなく「ページ」と書く。
 */
const BASE_COMPONENT_FLAVOR: Readonly<Record<string, string>> = {
  // Cloudflare
  'cloudflare:isrCache:kv':
    '世界中の拠点に置かれるキーと値の保存。ページを近くの拠点から返せます',
  'cloudflare:isrCache:r2':
    '書いたらすぐ全世界で見える、強い整合のストレージ。転送量に課金されません',
  'cloudflare:isrCache:workers-cache':
    '拠点ごとのキャッシュから返し、更新はタグでまとめて消せます。キャッシュの API に料金の記載はありません',
  'cloudflare:isrCache:none':
    'キャッシュを持たないので、ページはいつも最新です。仕組みがいちばん単純です',
  'cloudflare:images:images':
    '閲覧のときに必要なサイズへ変換する画像のサービス。元の画像を置くだけで済みます',
  'cloudflare:images:r2-variants':
    '投稿のときに一度だけ変換して置いておきます。保存する画像はサイズ違いの分だけ増えます',
  'cloudflare:images:none':
    '原本をそのまま配るので、画質が落ちません。R2 は転送量に課金しません',
  'cloudflare:images:resize':
    '投稿のときに一度だけ縮めて置くので、保存も配信も軽く、変換の費用もかかりません',
  'cloudflare:images:d1':
    '画像もデータと一緒にまとめて管理でき、バックアップも一度で済みます',
  'cloudflare:db:d1':
    'Workers から直接使える SQLite。データベースの大きさには上限があります',
  'cloudflare:db:kv':
    '世界中のエッジで読める高速なキーと値の保存。読み取りが多いサイトに向きます',
  'cloudflare:db:hyperdrive':
    '実績のある Postgres を使えます。事業者が増え、請求も別の所から来ます',
  'cloudflare:realtime:none':
    'リアルタイムの機能を持ちません。費用も手間もかかりません',
  'cloudflare:realtime:durable-objects':
    '接続を保ったまま休止でき、休止中は実行時間を課金しない WebSocket',
  // Vercel
  'vercel:isrCache:default':
    '再検証すると、全リージョンのキャッシュがすぐ更新されます',
  'vercel:isrCache:none':
    '毎回関数で描くので、ページはいつも最新です。キャッシュの仕組みを気にしなくて済みます',
  'vercel:cdnPlan:flat-rate':
    '新しい Pro の既定。CDN の配信を段の定額で払い、急な伸びの月も請求が増えません',
  'vercel:cdnPlan:on-demand':
    '使った分だけの支払い。月のクレジットが当たり、量の少ない月は安く済みます',
  'vercel:images:default':
    '閲覧のときに自動で最適化されます。Next.js の画像の部品がそのまま使えます',
  'vercel:images:none':
    '原本をそのまま配るので、画質が落ちず、変換の費用もかかりません',
  'vercel:images:resize':
    '投稿のときに一度だけ縮めて置くので、変換の費用がかからず、仕組みも単純です',
  // 他の事業者の部品（Vercel の画像だけ Cloudflare。D-52）。利点だけを書き、損（アカウント・請求が増える）は ⓘ と手間に出す
  'cloudflare:images:cf-images':
    '転送量に課金されないストレージから画像を配り、閲覧のときに必要なサイズへ変換します',
  'cloudflare:images:cf-resize':
    '投稿のときに一度だけ縮め、転送量に課金されないストレージから配ります',
  // 原本だけ R2・変換は Vercel の画像の最適化、画像だけ S3 + CloudFront（D-114 段 2c）
  'cloudflare:images:cf-r2-origin':
    '原本を転送量に課金されないストレージに置き、変換と配信は今の画像の最適化のまま',
  'aws:images:aws-s3-resize':
    '投稿のときに一度だけ縮め、常時無料の枠が大きい CloudFront から配ります',
  // Netlify（D-71）
  'netlify:isrCache:default':
    'ページは CDN から返し、更新したページだけをすぐ作り直せます。設定なしで動きます',
  'netlify:isrCache:none':
    '毎回関数で描くので、ページはいつも最新です。キャッシュの仕組みを気にしなくて済みます',
  'netlify:images:default':
    '閲覧のときに自動で変換されます。変換そのものに料金の項目はありません',
  'netlify:images:none':
    '原本をそのまま配るので、画質が落ちず、変換の仕組みも要りません',
  'netlify:images:resize':
    '投稿のときに一度だけ縮めて置くので、配信が軽く、仕組みも単純です',
  'netlify:api:same':
    '同じサイトの関数に API を置くので、デプロイも請求もひとまとめです',
  'netlify:ogp:none':
    '全ページで同じカードを出します。シェルは CDN から静的なまま配れます',
  'netlify:ogp:prerender':
    'ページごとのカードを出せます。シェルの読み込みが関数の起動になります',
  'netlify:apiCache:none':
    'API を毎回関数で処理するので、ページの中身はいつも最新です',
  'netlify:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し、タグですぐ消せます',
  'netlify:files:blob':
    '同じサイトから使えるファイルの置き場。プランに含まれ、すぐに使い始められます',
  // さくらの VPS
  'sakura:isrCache:default':
    'キャッシュをサーバーのディスクに置きます。追加の費用はかかりません',
  'sakura:isrCache:none':
    'キャッシュを持たないので、ページはいつも最新です。ディスクも使いません',
  'sakura:images:default':
    'サーバーの中で変換するので、外部のサービスに払う費用がありません',
  'sakura:images:none':
    '原本をそのまま配ります。転送量は無制限なので、費用は増えません',
  'sakura:images:resize':
    '投稿のときに一度だけ縮めて置くので、サーバーで変換する負荷がなく、ディスクも節約できます',
  'sakura:frontCdn:none':
    '間に何も挟まないので構成が単純で、問題の切り分けもしやすいです',
  'sakura:frontCdn:static':
    '静的なファイルと画像を無料の CDN から返し、小さな VPS の回線を空けます。HTML はサーバーが返すままです',
  'sakura:frontCdn:html':
    'ページまで CDN から返し、サーバーの負荷がいちばん下がります。更新のたびにキャッシュを消せば古いページも残りません',
  // SPA の API の応答のキャッシュ（D-37）
  'cloudflare:apiCache:none':
    'API を毎回処理するので、ページの中身はいつも最新です。キャッシュの消し忘れも起きません',
  'cloudflare:apiCache:cdn':
    'ヒットは Worker を動かさずに返すので、CPU とデータベースの読み取りが減ります',
  'cloudflare:apiCache:cache-api':
    'コードの中で拠点のキャッシュを読みます。何をどうキャッシュするかを細かく決められます',
  'vercel:apiCache:none':
    'API を毎回関数で処理するので、ページの中身はいつも最新です',
  'vercel:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し関数が起動しません',
  'sakura:apiCache:none':
    'API はいつもサーバーが処理します。前段の CDN が無くても使えます',
  'sakura:apiCache:cdn':
    '前段の CDN が API の応答も返し、サーバーの CPU と回線が減ります',
  // SPA の API の置き場（D-65）。他の事業者の部品は利点だけを書き、損（CORS・アカウント・転送・移行）は ⓘ と手間に出す
  'cloudflare:api:same':
    'サイトと同じ Worker に API を置くので、ドメインが一つで設定も少なく済みます',
  'vercel:api:same':
    '同じプロジェクトの関数に API を置くので、デプロイも請求もひとまとめです',
  'aws:api:same':
    '同じ CDN の後ろに API を置くので、ドメインが一つで CORS の設定も要りません',
  'cloudflare:api:cf-workers':
    '起動の速い Worker に API を置き、安い SQL のデータベースをそのまま使います',
  'aws:api:aws-lambda':
    '静的なファイルは無料の配信に任せ、API は使った分だけの支払いの関数と DB に置きます',
  // Next.js のサーバーから呼ぶ API（D-67）と、VPS の API（D-67）
  'cloudflare:api:cf-workers-server':
    'データの読み書きを安い SQL のデータベースと起動の速い Worker に任せ、ページの描画だけを今の事業者に残します',
  'sakura:api:sakura-vps-2gb':
    '月額が固定の VPS に API とデータベースを置き、使った分の請求に驚かされません',
  'sakura:api:sakura-vps-4gb':
    'メモリとディスクに余裕のある上のプランの VPS に、API とデータベースを置きます',
  // Astro のサーバーから呼ぶ API（D-69）
  'cloudflare:api:cf-workers-astro':
    'データの読み書きを安い SQL のデータベースと起動の速い Worker に任せ、ページの描画だけを今の場所に残します',
  'sakura:api:same':
    '同じサーバーのデータベースを直接読むので、部品も請求もひとまとめです',
  'aws-opennext:api:same':
    'サーバーの関数が同じクラウドの DB を直接読みます。部品が一か所にまとまります',
  // ファイルの保存（構成が暗黙に持つ置き場。1 択。files.ts の fileStorageOf）
  'cloudflare:files:r2':
    '転送量に課金されない S3 互換のストレージ。ファイルなら何でも置けます',
  'vercel:files:blob':
    '同じ Vercel のアカウントで使えるファイルの置き場。設定いらずですぐに使い始められます',
  'sakura:files:host-disk':
    'サーバーのディスクにそのまま置きます。追加の契約も費用も要りません',
  // SPA の SNS のカード（OGP）
  'cloudflare:ogp:none':
    '全ページで同じカードを出します。シェルは静的なファイルのまま配れます',
  'cloudflare:ogp:prerender':
    'ページごとのカードを出せます。シェルの読み込みも Worker の起動として数えられます',
  'vercel:ogp:none':
    '全ページで同じカードを出します。シェルは CDN から静的なまま配れます',
  'vercel:ogp:prerender':
    'ページごとのカードを出せます。シェルの読み込みが関数の起動になります',
  'sakura:ogp:none':
    '全ページで同じカードを出します。シェルは nginx が静的なまま配れます',
  'sakura:ogp:prerender':
    'ページごとのカードを出せます。シェルは nginx でなく Node が返すようになります',
  // AWS（prd/11 段 1・D-50）
  'aws:isrCache:default':
    'ページは CDN から返し、期限が来たら自動で作り直します。追加のサービスは要りません',
  'aws:isrCache:none':
    '毎回サーバーで描くので、ページはいつも最新です。キャッシュの仕組みを気にしなくて済みます',
  'aws:images:default':
    'Next.js の画像の部品がそのまま使え、自動で最適化されます。変換の料金は未取得で、費用は下限です',
  'aws:images:none':
    '原本をそのまま配るので、画質が落ちません。CDN の無料で使える量も大きいです',
  'aws:images:resize':
    '投稿のときに一度だけ縮めて置き、CDN から配ります。変換の費用がかからず、仕組みも単純です',
  'aws:frontCdn:none':
    '間に何も挟まないので構成が単純です。Amplify が管理する CDN がそのまま配ります',
  'aws:frontCdn:static':
    '自前の CDN を前に置き、静的なファイルと画像を CDN の料金と無料の量で配ります',
  'aws:frontCdn:html':
    'ページまで自前の CDN から返すので、Amplify から配る量がいちばん減ります',
  'aws:cdnPlan:payg':
    '使った分だけの支払い。毎月の無料で使える量も大きく、小さいうちはほぼかかりません',
  'aws:cdnPlan:flat-free':
    '月額なしで使え、超えても請求は増えません。防御や証明書も込み',
  'aws:cdnPlan:flat-pro':
    '手ごろな月額で込みの量が大きく、超えても請求は増えません。防御や証明書も込み',
  'aws:cdnPlan:flat-business':
    '大きな込みの量と高度な機能。超えても請求は増えず、急な伸びにも備えられます',
  'aws:db:dynamodb':
    '使った分だけの支払いで、保存も一定量まで無料です。アクセスが増えても自動で追従します',
  'aws:db:aurora':
    '大手のクラウドの看板の Postgres。負荷に応じて自動で容量が伸び縮みします',
  'aws:db:aurora-pause':
    '使われていない間は止まり、その間の費用がかかりません。小さく始めるのに向きます',
  'aws:db:dsql':
    'サーバーの管理が要らない分散の SQL。使った分だけの支払いで、無料で使える量もあります',
  'aws:db:rds':
    '定番の Postgres を小さいインスタンスから始められます。いつもの SQL がそのまま使えます',
  'aws:apiCache:none': 'API を毎回処理するので、ページの中身はいつも最新です',
  'aws:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し関数が起動しません',
  'aws:ogp:none':
    '全ページで同じカードを出します。シェルは CDN から静的なまま配れます',
  // DB（D-77）。Vercel・Netlify は Supabase が既定、Neon は他の事業者の部品
  'vercel:db:supabase':
    '認証やストレージまで揃う人気の Postgres。決まった月額で、サーバーが常に動いています',
  'netlify:db:supabase':
    '認証やストレージまで揃う人気の Postgres。決まった月額で、サーバーが常に動いています',
  // さくらの VPS の DB と、他の土台の Supabase の部品（D-114 段 2d）
  'sakura:db:mysql':
    '同じ VPS の MySQL を使うので、月額の中に収まり、部品も請求もひとまとめです',
  'supabase:db:supabase':
    '認証やストレージまで揃う人気の Postgres。決まった月額で、サーバーが常に動いています',
  'neon:db:neon':
    '使われていない間は止まる従量の Postgres。基本料が無く、小さく始めるのに向きます',
  // Google Cloud（D-88）
  'gcp:isrCache:default':
    'ページは CDN から返り、外れてもサーバーの手元のキャッシュから返せます',
  'gcp:isrCache:none':
    '毎回コンテナで描くので、ページはいつも最新です。キャッシュの仕組みを気にしなくて済みます',
  'gcp:images:default':
    'Next.js の画像の部品がそのまま使え、変換は自分のコンテナで行います',
  'gcp:images:none':
    '原本をそのまま配るので、画質が落ちず、変換の手間もかかりません',
  'gcp:images:resize':
    '投稿のときに一度だけ縮めて置くので、変換の費用がかからず、仕組みも単純です',
  'gcp:db:firestore':
    '使った分だけ払うドキュメントの DB。無料で使える量があり、小さく始めるのに向きます',
  'gcp:db:cloud-sql':
    '定番の Postgres を小さいインスタンスから始められます。いつもの SQL がそのまま使えます',
  'gcp:minInstances:0':
    '使われていない間はコンテナを止め、その間の費用がかかりません',
  'gcp:minInstances:1': 'いつでもすぐ応答できるよう、コンテナを温めておきます',
  'gcp:api:same': '同じドメインの中で API を返すので、設定が少なく済みます',
  'gcp:ogp:none':
    '全ページで同じカードを出します。シェルは CDN から静的なまま配れます',
  'gcp:ogp:prerender': '記事ごとのカードを出せます。シェルをコンテナで返します',
  'gcp:apiCache:none': 'API を毎回処理するので、ページの中身はいつも最新です',
  'gcp:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返しコンテナが動きません',
  'gcp:files:gcs':
    'クラウドの定番のストレージ。同じリージョンのコンテナからの読み出しは転送の料金がかかりません',
  'aws:files:s3':
    'クラウドの定番のストレージ。保存も読み書きも安く、CDN からそのまま配れます',
};

/** OpenNext の構成（D-63）が Amplify の構成と共有する部品は、同じ説明文を使う。 */
const SHARED_WITH_OPENNEXT =
  /^aws:(db|cdnPlan|ogp|apiCache|files):|^aws:images:(none|resize)$/;

export const COMPONENT_FLAVOR: Readonly<Record<string, string>> = {
  ...BASE_COMPONENT_FLAVOR,
  ...Object.fromEntries(
    Object.entries(BASE_COMPONENT_FLAVOR)
      .filter(([k]) => SHARED_WITH_OPENNEXT.test(k))
      .map(([k, v]) => [k.replace(/^aws:/, 'aws-opennext:'), v]),
  ),
  'aws-opennext:isrCache:default':
    'ページは CDN から返し、更新したページだけをすぐ作り直せます。仕組みは自分で組みます',
  'aws-opennext:isrCache:none':
    '毎回サーバーで描くので、ページはいつも最新です。キャッシュの仕組みを気にしなくて済みます',
  // CDN の無効化のまとめ方（D-79）
  'aws-opennext:cdnInvalidation:default':
    '更新したページだけを消すので、ほかのページは CDN から返り続けます。設定は要りません',
  'aws-opennext:cdnInvalidation:wildcard':
    'まとめて消すので、無効化の数が更新するページの数に比例しません。処理は自分で書きます',
  'aws-opennext:images:default':
    'Next.js の画像の部品がそのまま使え、変換は自分の関数で行います。使った分だけの支払いです',
  // DB のバックアップ（D-93）。どの事業者も同じ 2 択
  ...Object.fromEntries(
    [
      'cloudflare',
      'vercel',
      'sakura',
      'aws',
      'aws-opennext',
      'netlify',
      'gcp',
    ].flatMap((p) => [
      [
        `${p}:dbBackup:default`,
        p === 'sakura'
          ? '何も足さないので、費用も手間も増えません'
          : '事業者が既定で残す分だけで、設定も追加の費用も要りません',
      ],
      [
        `${p}:dbBackup:pitr`,
        p === 'sakura'
          ? '自分の手で毎日の写しを外に残し、壊れても直近の時点に戻せます'
          : '誤操作や不具合でデータが壊れても、直前の時点に戻せます',
      ],
    ]),
  ),
  // メール送信（D-95）。構成の既定は Cloudflare Paid が自前の Email Service、ほかは Amazon SES
  'cloudflare:email:default':
    '同じアカウントの中で送れ、設定が少なく済みます。新しい機能なので、上限は使い方で決まります',
  'aws:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'aws-opennext:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'vercel:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'netlify:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'gcp:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'sakura:email:default':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'aws:email:ses':
    '大手のクラウドの送信のサービスで、送った通数だけの支払い。月額はありません',
  'resend:email:resend-free':
    '開発者に人気の送信のサービスの無料プラン。小さく始めるなら費用がかかりません',
  'resend:email:resend-pro':
    '開発者に人気の送信のサービスの有料プラン。月額で通数がたっぷり込み',
  'resend:email:resend-pro-100k':
    '同じ有料プランの込みの通数が倍の段。送る通数が多いなら超過より安いです',
  // Bunny（D-98）。転送の安い従量の CDN を、画像の配信と前段に差す
  'bunny:images:bunny-images':
    '転送の安い CDN から配り、変換は月額で使い放題。大きな画像の多いサイトに向きます',
  'bunny:images:bunny-resize':
    '縮めた画像を転送の安い CDN から配ります。変換の月額もかかりません',
  'bunny:frontCdn:bunny':
    '転送の安い従量の CDN を前に置き、静的なファイルと画像を返します。画像の多さを問われません',
};
