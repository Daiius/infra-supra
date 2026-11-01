// 構成の短い説明（始める画面のフレーバー。D-41）。構成の id（STACK_DEFS）で引く。
// 事実として間違ってはいないが、それだけで選ぶと外れうる書き方にしている（何が効くかは遊んで確かめる）。
// 数値は書かない。事実の根拠は同じ catalog のデータ（プランの制限・規約・SLA・転送量・席の料金）にある。
export const STACK_FLAVOR: Readonly<Record<string, string>> = {
  'cloudflare-vinext-free':
    'Cloudflare の無料プラン。無料枠が大きく、デプロイなどの管理もしやすいが、各種の制限やストレージの性質に注意',
  'cloudflare-vinext-paid':
    '月額の基本料がかかる有料プラン。無料プランで足りる規模なら、払う必要はないかもしれない',
  'vercel-supabase-hobby':
    'Next.js の開発元のホスティングの無料プラン。様々な無料枠がつき、データベースも無料で始められる。個人の開発で試すのにちょうどよい',
  'vercel-supabase-pro':
    'チーム・本番向けのプラン。込みのクレジットがあり、アクセスが伸びても自動で追従する',
  'sakura-vps-2gb':
    '月額が固定で、使った分の請求に驚かされない。サーバーの中を自由に設定できる',
  'sakura-vps-4gb':
    'メモリに余裕のある上のプラン。稼働率の SLA の対象にもなり、アクセスが増えても安心',
  'aws-opennext':
    'Next.js を関数と CDN とストレージに自分で載せる。部品ごとの従量で安く組めるが、仕組みの面倒は自分で見る',
  'aws-amplify':
    '大手のクラウドのマネージドなホスティング。基本料が無く使った分だけの支払いで、常に無料で使える量もある',
  'netlify-supabase-free':
    '静的なサイトの老舗のホスティングの無料プラン。毎月のクレジットの中なら請求は来ず、データベースも無料で始められる',
  'netlify-supabase-personal':
    '個人向けの手ごろな月額のプラン。クレジットが増え、足りなければ少額ずつ買い足せる',
  'netlify-supabase-pro':
    'チーム向けのプラン。メンバーを何人足しても月額は同じで、クレジットも多い',
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
    '世界中の拠点に置かれるキーと値の保存。ページを近くの拠点から返せる',
  'cloudflare:isrCache:r2':
    '書いたらすぐ全世界で見える、強い整合のストレージ。転送量に課金されない',
  'cloudflare:isrCache:workers-cache':
    '拠点ごとのキャッシュから返し、更新はタグでまとめて消せる。キャッシュの API に料金の記載はない',
  'cloudflare:isrCache:none':
    'キャッシュを持たないので、ページはいつも最新。仕組みがいちばん単純',
  'cloudflare:images:images':
    '閲覧のときに必要なサイズへ変換する画像のサービス。元の画像を置くだけでよい',
  'cloudflare:images:r2-variants':
    '投稿のときに一度だけ変換して置いておく。保存する画像はサイズ違いの分だけ増える',
  'cloudflare:images:none':
    '原本をそのまま配るので、画質が落ちない。R2 は転送量に課金しない',
  'cloudflare:images:resize':
    '投稿のときに一度だけ縮めて置くので、保存も配信も軽く、変換の費用もかからない',
  'cloudflare:images:d1':
    '画像もデータと一緒にまとめて管理でき、バックアップも一度で済む',
  'cloudflare:db:d1':
    'Workers から直接使える SQLite。データベースの大きさには上限がある',
  'cloudflare:db:kv':
    '世界中のエッジで読める高速なキーと値の保存。読み取りが多いサイトに向く',
  'cloudflare:db:hyperdrive':
    '実績のある Postgres を使える。事業者が増え、請求も別の所から来る',
  'cloudflare:realtime:none':
    'リアルタイムの機能を持たない。費用も手間もかからない',
  'cloudflare:realtime:durable-objects':
    '接続を保ったまま休止でき、休止中は実行時間を課金しない WebSocket',
  // Vercel
  'vercel:isrCache:default':
    '再検証すると、全リージョンのキャッシュがすぐ更新される',
  'vercel:isrCache:none':
    '毎回関数で描くので、ページはいつも最新。キャッシュの仕組みを気にしなくてよい',
  'vercel:images:default':
    '閲覧のときに自動で最適化される。Next.js の画像の部品がそのまま使える',
  'vercel:images:none':
    '原本をそのまま配るので、画質が落ちず、変換の費用もかからない',
  'vercel:images:resize':
    '投稿のときに一度だけ縮めて置くので、変換の費用がかからず、仕組みも単純',
  // 他の事業者の部品（Vercel の画像だけ Cloudflare。D-52）。利点だけを書き、損（アカウント・請求が増える）は ⓘ と手間に出す
  'cloudflare:images:cf-images':
    '転送量に課金されないストレージから画像を配り、閲覧のときに必要なサイズへ変換する',
  'cloudflare:images:cf-resize':
    '投稿のときに一度だけ縮め、転送量に課金されないストレージから配る',
  // Netlify（D-71）
  'netlify:isrCache:default':
    'ページは CDN から返し、更新したページだけをすぐ作り直せる。設定なしで動く',
  'netlify:isrCache:none':
    '毎回関数で描くので、ページはいつも最新。キャッシュの仕組みを気にしなくてよい',
  'netlify:images:default':
    '閲覧のときに自動で変換される。変換そのものに料金の項目はない',
  'netlify:images:none':
    '原本をそのまま配るので、画質が落ちず、変換の仕組みも要らない',
  'netlify:images:resize':
    '投稿のときに一度だけ縮めて置くので、配信が軽く、仕組みも単純',
  'netlify:api:same':
    '同じサイトの関数に API を置くので、デプロイも請求もひとまとめ',
  'netlify:ogp:none':
    '全ページで同じカードを出す。シェルは CDN から静的なまま配れる',
  'netlify:ogp:prerender':
    'ページごとのカードを出せる。シェルの読み込みが関数の起動になる',
  'netlify:apiCache:none':
    'API を毎回関数で処理するので、ページの中身はいつも最新',
  'netlify:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し、タグですぐ消せる',
  'netlify:files:blob':
    '同じサイトから使えるファイルの置き場。プランに含まれ、すぐに使い始められる',
  // さくらの VPS
  'sakura:isrCache:default':
    'キャッシュをサーバーのディスクに置く。追加の費用はかからない',
  'sakura:isrCache:none':
    'キャッシュを持たないので、ページはいつも最新。ディスクも使わない',
  'sakura:images:default':
    'サーバーの中で変換するので、外部のサービスに払う費用がない',
  'sakura:images:none':
    '原本をそのまま配る。転送量は無制限なので、費用は増えない',
  'sakura:images:resize':
    '投稿のときに一度だけ縮めて置くので、サーバーで変換する負荷がなく、ディスクも節約できる',
  'sakura:frontCdn:none':
    '間に何も挟まないので構成が単純で、問題の切り分けもしやすい',
  'sakura:frontCdn:static':
    '静的なファイルと画像を CDN から返す。HTML はサーバーが返すまま',
  'sakura:frontCdn:html':
    'ページまで CDN から返すので、サーバーの負荷がいちばん下がる',
  // SPA の API の応答のキャッシュ（D-37）
  'cloudflare:apiCache:none':
    'API を毎回処理するので、ページの中身はいつも最新。キャッシュの消し忘れも起きない',
  'cloudflare:apiCache:cdn':
    'ヒットは Worker を動かさずに返すので、CPU とデータベースの読み取りが減る',
  'cloudflare:apiCache:cache-api':
    'コードの中で拠点のキャッシュを読む。何をどうキャッシュするかを細かく決められる',
  'vercel:apiCache:none':
    'API を毎回関数で処理するので、ページの中身はいつも最新',
  'vercel:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し関数が起動しない',
  'sakura:apiCache:none':
    'API はいつもサーバーが処理する。前段の CDN が無くても使える',
  'sakura:apiCache:cdn':
    '前段の CDN が API の応答も返し、サーバーの CPU と回線が減る',
  // SPA の API の置き場（D-65）。他の事業者の部品は利点だけを書き、損（CORS・アカウント・転送・移行）は ⓘ と手間に出す
  'cloudflare:api:same':
    'サイトと同じ Worker に API を置くので、ドメインが一つで設定も少ない',
  'vercel:api:same':
    '同じプロジェクトの関数に API を置くので、デプロイも請求もひとまとめ',
  'aws:api:same':
    '同じ CDN の後ろに API を置くので、ドメインが一つで CORS の設定も要らない',
  'cloudflare:api:cf-workers':
    '起動の速い Worker に API を置き、安い SQL のデータベースをそのまま使う',
  'aws:api:aws-lambda':
    '静的なファイルは無料の配信に任せ、API は使った分だけの支払いの関数と DB に置く',
  // Next.js のサーバーから呼ぶ API（D-67）と、VPS の API（D-67）
  'cloudflare:api:cf-workers-server':
    'データの読み書きを安い SQL のデータベースと起動の速い Worker に任せ、ページの描画だけを今の事業者に残す',
  'sakura:api:sakura-vps-2gb':
    '月額が固定の VPS に API とデータベースを置き、使った分の請求に驚かされない',
  'sakura:api:sakura-vps-4gb':
    'メモリとディスクに余裕のある上のプランの VPS に、API とデータベースを置く',
  // Astro のサーバーから呼ぶ API（D-69）
  'cloudflare:api:cf-workers-astro':
    'データの読み書きを安い SQL のデータベースと起動の速い Worker に任せ、ページの描画だけを今の場所に残す',
  'sakura:api:same':
    '同じサーバーのデータベースを直接読むので、部品も請求もひとまとめ',
  'aws-opennext:api:same':
    'サーバーの関数が同じクラウドの DB を直接読む。部品が一か所にまとまる',
  // ファイルの保存（構成が暗黙に持つ置き場。1 択。files.ts の fileStorageOf）
  'cloudflare:files:r2':
    '転送量に課金されない S3 互換のストレージ。ファイルなら何でも置ける',
  'vercel:files:blob':
    '同じ Vercel のアカウントで使えるファイルの置き場。設定いらずですぐに使い始められる',
  'sakura:files:host-disk':
    'サーバーのディスクにそのまま置く。追加の契約も費用も要らない',
  // SPA の SNS のカード（OGP）
  'cloudflare:ogp:none':
    '全ページで同じカードを出す。シェルは静的なファイルのまま配れる',
  'cloudflare:ogp:prerender':
    'ページごとのカードを出せる。シェルの読み込みも Worker の起動として数えられる',
  'vercel:ogp:none':
    '全ページで同じカードを出す。シェルは CDN から静的なまま配れる',
  'vercel:ogp:prerender':
    'ページごとのカードを出せる。シェルの読み込みが関数の起動になる',
  'sakura:ogp:none':
    '全ページで同じカードを出す。シェルは nginx が静的なまま配れる',
  'sakura:ogp:prerender':
    'ページごとのカードを出せる。シェルは nginx でなく Node が返すようになる',
  // AWS（prd/11 段 1・D-50）
  'aws:isrCache:default':
    'ページは CDN から返し、期限が来たら自動で作り直す。追加のサービスは要らない',
  'aws:isrCache:none':
    '毎回サーバーで描くので、ページはいつも最新。キャッシュの仕組みを気にしなくてよい',
  'aws:images:default':
    'Next.js の画像の部品がそのまま使え、自動で最適化される。変換の料金は未取得で、費用は下限',
  'aws:images:none':
    '原本をそのまま配るので、画質が落ちない。CDN の無料で使える量も大きい',
  'aws:images:resize':
    '投稿のときに一度だけ縮めて置き、CDN から配る。変換の費用がかからず、仕組みも単純',
  'aws:frontCdn:none':
    '間に何も挟まないので構成が単純。Amplify が管理する CDN がそのまま配る',
  'aws:frontCdn:static':
    '自前の CDN を前に置き、静的なファイルと画像を CDN の料金と無料の量で配る',
  'aws:frontCdn:html':
    'ページまで自前の CDN から返すので、Amplify から配る量がいちばん減る',
  'aws:cdnPlan:payg':
    '使った分だけの支払い。毎月の無料で使える量も大きく、小さいうちはほぼかからない',
  'aws:cdnPlan:flat-free':
    '月額なしで使え、超えても請求は増えない。防御や証明書も込み',
  'aws:cdnPlan:flat-pro':
    '手ごろな月額で込みの量が大きく、超えても請求は増えない。防御や証明書も込み',
  'aws:cdnPlan:flat-business':
    '大きな込みの量と高度な機能。超えても請求は増えず、急な伸びにも備えられる',
  'aws:db:dynamodb':
    '使った分だけの支払いで、保存も一定量まで無料。アクセスが増えても自動で追従する',
  'aws:db:aurora':
    '大手のクラウドの看板の Postgres。負荷に応じて自動で容量が伸び縮みする',
  'aws:db:aurora-pause':
    '使われていない間は止まり、その間の費用がかからない。小さく始めるのに向く',
  'aws:db:dsql':
    'サーバーの管理が要らない分散の SQL。使った分だけの支払いで、無料で使える量もある',
  'aws:db:rds':
    '定番の Postgres を小さいインスタンスから始められる。いつもの SQL がそのまま使える',
  'aws:apiCache:none': 'API を毎回処理するので、ページの中身はいつも最新',
  'aws:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し関数が起動しない',
  'aws:ogp:none':
    '全ページで同じカードを出す。シェルは CDN から静的なまま配れる',
  // DB（D-77）。Vercel・Netlify は Supabase が既定、Neon は他の事業者の部品
  'vercel:db:supabase':
    '認証やストレージまで揃う人気の Postgres。決まった月額で、サーバーが常に動いている',
  'netlify:db:supabase':
    '認証やストレージまで揃う人気の Postgres。決まった月額で、サーバーが常に動いている',
  'neon:db:neon':
    '使われていない間は止まる従量の Postgres。基本料が無く、小さく始めるのに向く',
  'aws:files:s3':
    'クラウドの定番のストレージ。保存も読み書きも安く、CDN からそのまま配れる',
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
    'ページは CDN から返し、更新したページだけをすぐ作り直せる。仕組みは自分で組む',
  'aws-opennext:isrCache:none':
    '毎回サーバーで描くので、ページはいつも最新。キャッシュの仕組みを気にしなくてよい',
  'aws-opennext:images:default':
    'Next.js の画像の部品がそのまま使え、変換は自分の関数で行う。使った分だけの支払い',
};
