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
  'aws-amplify':
    '大手のクラウドのマネージドなホスティング。基本料が無く使った分だけの支払いで、常に無料で使える量もある',
};

/**
 * 部品の選択肢の短い説明（始める画面とゲーム中の部品の欄。D-45）。「事業者:スロット:部品の id」で引く。
 * 構成の説明と同じ方針: 事実として間違ってはいないが、それだけで選ぶと外れうる文。適切な選択肢にも損に見える面を書き、
 * 説明だけで正解が分からないようにする。数値は書かない。事実の説明は部品の note（ⓘ）に残す。
 * シナリオをまたいで使うので「記事」でなく「ページ」と書く。
 */
export const COMPONENT_FLAVOR: Readonly<Record<string, string>> = {
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
    'Next.js の画像の部品がそのまま使え、閲覧のときに自動で最適化される',
  'aws:images:none':
    '原本をそのまま配るので、画質が落ちない。CDN の無料で使える量も大きい',
  'aws:images:resize':
    '投稿のときに一度だけ縮めて置き、CDN から配る。変換の費用がかからず、仕組みも単純',
  'aws:db:dynamodb':
    '使った分だけの支払いで、保存も一定量まで無料。アクセスが増えても自動で追従する',
  'aws:db:rds':
    '定番の Postgres を小さいインスタンスから始められる。いつもの SQL がそのまま使える',
  'aws:apiCache:none': 'API を毎回処理するので、ページの中身はいつも最新',
  'aws:apiCache:cdn':
    '応答にキャッシュの指定を足すだけで、ヒットは CDN が返し関数が起動しない',
  'aws:ogp:none':
    '全ページで同じカードを出す。シェルは CDN から静的なまま配れる',
  'aws:files:s3':
    'クラウドの定番のストレージ。保存も読み書きも安く、CDN からそのまま配れる',
};
