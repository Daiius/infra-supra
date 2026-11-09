// 記事コミュニティの始める画面の文言（D-33・prd/09 E-6。画面に固定で書いていたものをシナリオのデータへ移した）。
import type { PageWireframe, ScenarioText } from '../scenario.ts';

/**
 * ページの見取り図（D-102。ゲーム上の仮定の図）。区画の作られ方は今の計算のモデルに合わせる:
 * Next.js は記事 ISR・個人 SSR、コメント・いいね・ログインの表示はブラウザが API で取る（D-70）。
 * Astro は記事を閲覧のときに描いてキャッシュし投稿・編集で消す（D-103）・個人をアダプターで SSR、動きのある部品はアイランド。
 * 静的書き出しは記事を静的・個人を静的な枠 + API（D-80）。
 * SPA はシェル + API。記事のページの部品「コメント欄」（D-109）で記事のページに含めると、コメント欄は記事の HTML の一部になる（D-82）。
 */
const ARTICLE_WIREFRAMES: PageWireframe[] = [
  {
    route: 'article',
    regions: [
      {
        id: 'header',
        kind: 'header',
        label: 'ヘッダー・ナビ',
        width: 'half',
        needs: ['same'],
      },
      {
        id: 'login',
        kind: 'login',
        label: 'ログイン表示',
        width: 'half',
        needs: ['personal'],
      },
      {
        id: 'title',
        kind: 'title',
        label: '記事のタイトル・著者',
        needs: ['same', 'fresh', 'ogp'],
      },
      {
        id: 'body',
        kind: 'body',
        label: '本文',
        needs: ['same', 'fresh'],
      },
      {
        id: 'images',
        kind: 'image',
        label: '本文の画像（5 枚）',
        needs: ['same', 'media'],
      },
      { id: 'likes', kind: 'likes', label: 'いいね', needs: ['live'] },
      {
        id: 'comments',
        kind: 'comments',
        label: 'コメント欄（読む・書く）',
        height: 'md',
        needs: ['live', 'input'],
      },
      {
        id: 'footer',
        kind: 'related',
        label: '関連記事（サムネイル 4 枚）',
        needs: ['same'],
      },
    ],
    byFramework: {
      nextjs: {
        header: 'isr',
        login: 'api',
        title: 'isr',
        body: 'isr',
        images: 'image',
        likes: 'api',
        comments: 'api',
        footer: 'isr',
      },
      astro: {
        header: 'cached',
        login: 'island',
        title: 'cached',
        body: 'cached',
        images: 'image',
        likes: 'island',
        comments: 'island',
        footer: 'cached',
      },
      'nextjs-export': {
        header: 'build',
        login: 'api',
        title: 'build',
        body: 'build',
        images: 'image',
        likes: 'api',
        comments: 'api',
        footer: 'build',
      },
      'vite-spa': {
        header: 'shell',
        login: 'api',
        title: 'api',
        body: 'api',
        images: 'image',
        likes: 'api',
        comments: 'api',
        footer: 'api',
      },
    },
    // 記事ごとの枠（S5。D-109）: ヘッダー・タイトル（メタタグ）は記事ごとにビルドで書き出し、本文などはブラウザが API で取る
    shellPerPage: {
      sources: {
        header: 'build',
        login: 'api',
        title: 'build',
        body: 'api',
        images: 'image',
        likes: 'api',
        comments: 'api',
        footer: 'api',
      },
      badges: [
        {
          kind: 'freshness',
          text: '鮮度: 中身は常に新しい（新しい記事は枠のビルドまで開けない）',
        },
        { kind: 'ogp', text: 'SNS のカード: 記事ごとの枠に入る' },
        { kind: 'api', text: 'API: 1 PV あたり 1 回増える' },
      ],
    },
    // SPA は記事のページが無いので含められない（D-82）
    commentsInPage: {
      nextjs: { comments: 'isr' },
      astro: { comments: 'cached' },
      'nextjs-export': { comments: 'build' },
    },
    badges: {
      nextjs: [
        { kind: 'freshness', text: '鮮度: 再検証で載る' },
        { kind: 'ogp', text: 'SNS のカード: HTML に入る' },
      ],
      astro: [
        { kind: 'freshness', text: '鮮度: 投稿・編集でキャッシュを消す' },
        { kind: 'ogp', text: 'SNS のカード: HTML に入る' },
        {
          kind: 'cpu',
          text: 'CPU: 消した後の閲覧が描くのを待つ（Workers は 1 リクエストの上限に注意）',
        },
      ],
      'nextjs-export': [
        {
          kind: 'freshness',
          text: '鮮度: ビルドし直しで載る（新しい記事はビルドまで開けない）',
        },
        { kind: 'ogp', text: 'SNS のカード: HTML に入る' },
      ],
      'vite-spa': [
        { kind: 'freshness', text: '鮮度: 常に新しい' },
        { kind: 'ogp', text: 'SNS のカード: 前処理の部品が要る' },
        { kind: 'api', text: 'API: 1 PV あたり 1 回増える' },
      ],
    },
  },
  {
    route: 'personal',
    regions: [
      {
        id: 'header',
        kind: 'header',
        label: 'ヘッダー・ナビ',
        needs: ['same'],
      },
      {
        id: 'profile',
        kind: 'profile',
        label: 'プロフィール',
        width: 'half',
        height: 'md',
        needs: ['personal'],
      },
      {
        id: 'notifications',
        kind: 'notifications',
        label: '通知',
        width: 'half',
        height: 'md',
        needs: ['personal', 'live'],
      },
      {
        id: 'mine',
        kind: 'list',
        label: '自分の下書き・記事の一覧',
        height: 'lg',
        needs: ['personal', 'fresh'],
      },
      {
        id: 'editor',
        kind: 'post-button',
        label: '投稿・編集の画面へ（送信は API）',
        needs: ['input'],
      },
    ],
    // S6 で島になるのは人ごとに違う部分（D-108）。ヘッダー・投稿の画面への入口は枠
    islandRegions: ['profile', 'notifications', 'mine'],
    byFramework: {
      nextjs: {
        header: 'ssr',
        profile: 'ssr',
        notifications: 'ssr',
        mine: 'ssr',
        editor: 'ssr',
      },
      astro: {
        header: 'ssr',
        profile: 'ssr',
        notifications: 'ssr',
        mine: 'ssr',
        editor: 'ssr',
      },
      'nextjs-export': {
        header: 'build',
        profile: 'api',
        notifications: 'api',
        mine: 'api',
        editor: 'build',
      },
      'vite-spa': {
        header: 'shell',
        profile: 'api',
        notifications: 'api',
        mine: 'api',
        editor: 'shell',
      },
    },
    badges: {
      nextjs: [{ kind: 'cpu', text: 'CPU: 閲覧ごとにサーバーが描く' }],
      astro: [
        {
          kind: 'cpu',
          text: 'CPU: 閲覧ごとにサーバーが描く（Workers は 1 リクエストの上限に注意）',
        },
      ],
      'nextjs-export': [{ kind: 'api', text: 'API: 1 PV あたり 1 回増える' }],
      'vite-spa': [{ kind: 'api', text: 'API: 1 PV あたり 1 回増える' }],
    },
  },
];

export const ARTICLE_COMMUNITY_TEXT: ScenarioText = {
  intro:
    '利用者が記事を投稿し、コメント・いいねで交流するコミュニティです。記事・コメント・いいねはアプリの DB に入ります（別の CMS はありません）。広告収入で運営します（商用）。',
  pages: [
    '記事のページ（2,000 ページ・始めは PV の 60%）: 誰でも読み、全員に同じ中身です。記事ごとの SNS のカード（OGP）が要ります。投稿・編集が 5 分以内に見えれば鮮度は「良い」、1 時間以内なら「普通」です',
    '個人向けのページ（始めは PV の 40%）: ログインした会員のマイページ・下書き・通知と、記事の投稿・編集の画面です。人ごとに中身が違います',
    '一覧・トップのページは記事のページに含めて数えます',
  ],
  growth: {
    up: '利用者の満足度が高ければ口コミで伸び',
    down: '低ければ解約が増えます',
  },
  events: [
    {
      about: ['buzz'],
      text: 'SNS で話題になります（前の月に前兆が出ます）。会員の登録も増え、登録の確認のメールが話題の日に集中します。',
    },
    { about: ['bot'], text: 'Bot・クローラーが大量に来ます。' },
    { about: ['team'], text: 'チームが増えます。' },
    {
      about: [
        'p-notify',
        'p-images',
        'p-personal',
        'p-chat',
        'p-image-redesign',
      ],
      text: '機能追加の提案が来ます（受けるか断るかを選びます）。',
    },
    {
      about: [
        's-allowance',
        's-db-size',
        's-image-storage',
        's-concurrency',
        's-d1-limit',
      ],
      text: '投稿や画像がたまって上限に近づきます。',
    },
    {
      about: ['p-archive', 'p-sla'],
      text: 'まれに、構成の乗り換えを迫るほどの大きな出来事が来ます（1 か月前に予告が出ます）。',
    },
    {
      about: ['p-ondemand'],
      text: '投稿者から「記事を直してもすぐ反映されない」と苦情が来ることもあります。先に記事のキャッシュを「更新で消す」にしていれば苦情は来ず、すぐ反映されると好評になります（口コミが少し伸びます）。',
    },
  ],
  app: [
    '記事のページに本文の画像 5 枚（1 枚 150 kB）と関連記事のサムネイル 4 枚（1 枚 15 kB）です。画像は 5,000 種類 × サイズ違い 3 です（サムネイル・本文の幅・大きい表示）。記事の閲覧は人気の記事に偏ります（ゲーム上の仮定）',
    '1 PV あたり API 1 回。DB は小さい（0.3 GB）ですが、投稿とコメントで少しずつ大きくなります。投稿された画像もたまっていきます',
    'メール（登録の確認・パスワードの再設定・コメントの通知）は利用者の 2% と書き込み 10 回に 1 通です（30 万 PV で月 約 3,600 通・1 日 約 120 通。ゲーム上の仮定）。送信の仕組みに 1 日・月の通数の上限があると、超えた日は届かず、機能の満足度が 1 段下がります（サイトは止まりません）',
  ],
  byFramework: {
    nextjs: {
      note: '記事ごとの SNS のカード（OGP）は HTML に入ります',
      pages: [
        '記事のページ: ISR（最初の閲覧で描いてキャッシュし、再検証の間隔（既定 5 分）が過ぎたら描き直す）',
        '個人向けのページ: SSR（閲覧のたびにサーバーが描く）',
      ],
      app: [
        '記事のページは ISR（再検証 5 分・2,000 ページ）、個人向けのページは SSR です',
        '記事ごとの SNS のカード（OGP）は HTML に入ります',
        '即時反映（出来事で要件になる）は、投稿・修正のたびに revalidatePath・revalidateTag で再検証する形です。古い版を一度も出さないなら revalidateTag の { expire: 0 }（次のアクセスは作り直しを待つ）です',
      ],
    },
    astro: {
      note: '記事ごとの SNS のカード（OGP）は HTML に入ります。コメント欄はアイランドが API で読みます',
      pages: [
        '記事のページ: 閲覧時に SSR + キャッシュ（最初の閲覧でアダプターが描いて前段にキャッシュし、投稿・編集でそのページのキャッシュを消す。消した後の最初の閲覧は描き終わるのを待つ）',
        '個人向けのページ: アダプターで SSR（閲覧のたびにサーバーが描く。Cloudflare では Worker が描くので、1 リクエストの CPU の上限に注意）',
      ],
      app: [
        '記事のページ（2,000 ページ）は Astro の route caching でキャッシュします。置き場は事業者で決まります: Cloudflare は Worker の前の Workers Cache（静的なファイルも含めて全リクエストを Workers の料金で数える）、Vercel は ISR、VPS は Node のメモリ、Google Cloud は Hosting の CDN（消せないので期限で取り直す）です。個人向けのページはアダプターで SSR',
        '記事の投稿・編集では、そのページのキャッシュを消します（設定「記事のキャッシュ」。既定は「更新で消す」、時間の期限も選べます）。記事のためにサイトをビルドし直しません（ビルドはデプロイのときだけ）',
        '消した後の最初の閲覧は、サーバーが描き終わるのを待ちます。Cloudflare では、その閲覧の CPU（記事の描画）が Workers の 1 リクエストの上限に数えられます',
        'ブラウザの JS は動きのある部品（アイランド）の分だけです（ゲーム上の仮定: JS・CSS は Next.js の 0.3 倍、初回表示が軽く速さの重さを 1 つ減らす）',
        '記事ごとの SNS のカード（OGP）は HTML に入ります。コメントはアイランドが API で読みます',
      ],
    },
    'nextjs-export': {
      note: 'サーバーを持ちません。記事ごとの SNS のカード（OGP）は HTML に入ります',
      pages: [
        "記事のページ: ビルドのときに静的な HTML（output: 'export'。投稿・編集はビルドし直しで載るので、載るまで間隔 + ビルドの数分）",
        '個人向けのページ: 静的な枠を、ブラウザが API で埋める（サーバーでは描かない。API が 1 PV あたり 1 回増える）',
      ],
      app: [
        '記事のページ（2,000 ページ）はビルドのときに静的な HTML にし、事業者の静的な配信から返します。サーバーを持ちません（ISR・SSR・Cookie・Server Actions・Proxy は使えません）',
        '個人向けのページは静的な HTML の上で、ブラウザ（Client Component）が API で中身を取ります（SPA と同じく、中身の API が 1 PV あたり 1 回増えます。API の置き場は SPA と同じく選べます）',
        '利用者が投稿するたびにサイトをビルドし直す形なので、記事が増えるほど 1 回のビルドが長くなります（ゲーム上の仮定）。新しく投稿された記事はビルドが終わるまでページが無く、投稿した人がすぐ開けません（コミュニティの要件を満たさず、鮮度を 1 段下げます。ゲーム上の仮定）',
        '記事の投稿・編集はビルドし直しで反映します（間隔は設定「ビルドの間隔」。載るまで間隔 + ビルドの時間。1 回のビルドの時間: 記事 1,000 ページあたり 0.5 分 + 1 分）。ビルドの時間は Workers Builds・Vercel のビルドの料金、Netlify はデプロイの回数で数えます（VPS は同じホスト、AWS は手元か CI でビルドし、数えません）',
        '画像の部品（next/image）は既定のローダーが使えません。Cloudflare Images・Netlify Image CDN は変換の URL を返すローダーで使え、Vercel の画像の最適化・VPS のホストでの変換は選べません（既定は投稿のときに縮める）',
        '初回表示・JS の量は Next.js と同じとみなします。記事ごとの SNS のカード（OGP）は HTML に入ります',
      ],
    },
    'vite-spa': {
      note: '記事ごとの SNS のカードは、前処理の部品を付けないと出ません',
      pages: [
        '記事のページ: 1 つのシェルを、ブラウザが API で埋める（サーバーで描かないので、記事は常に新しい）',
        '個人向けのページ: 同じくシェル + API',
      ],
      app: [
        'ページは 1 つのシェル（5 kB）とブラウザの JS で描き、記事・個人向けのページの中身は API で取ります（ISR・SSR は無いので、記事は常に新しい）',
        'シェルと JS・CSS は訪問の入口（PV の半分）だけ読みます。記事ごとの SNS のカード（OGP）は、前処理の部品を付けないと出ません（ゲーム上の仮定: 話題の伸びが半分）',
        '初回表示はシェル → JS → API の順に待ちます（ゲーム上の仮定: 速さの重さを 1 つ数える）',
        '中身の API が 1 PV あたり 1 回増えます（API は同じ事業者に置きます）',
      ],
    },
  },
  wireframes: ARTICLE_WIREFRAMES,
  // メールはページの外で届く（D-117）。通数の仮定は app の行と同じ（D-95）
  offscreen: [
    {
      kind: 'email',
      label: 'メール（ページの外）',
      items: [
        '登録の確認（新しい会員）',
        'パスワードの再設定',
        'コメント・返信の通知',
      ],
      note: '送る仕組みは ① の構成のカードの「メール送信」で選びます。1 日・月の通数に上限のある仕組みでは、超えた日のメールが届かず機能の満足度が下がります。SNS で話題になった日は登録の確認が集中します',
    },
  ],
};
