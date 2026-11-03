# 13. ページごとの描き方（ルートの描き方 S1〜S6）

> 状態: **段 0〜5 は実装済み**（段 0 = D-99〜D-101、段 1 = D-103、段 2 = D-106、段 3 = D-107、段 4 = D-109、段 5 = D-108）。§7 の残りの論点は推奨案つき。
> 2026-11-03: 7 つ目の描き方「部品ごとにキャッシュ（Cache Components）」を足し、Vercel × Next.js の既定にした（D-111。数え方は §5e、確かめた事実は §9）。
> 2026-11-03 の公式の文書の調べで、vinext の S1 を出し（RS-15）、Workers Cache が Free でも使えることを事実にし（D-103）、S6 の対応を §8 に記録した（D-106・D-107 の補足）。
> 出発点（2026-11-03）: 記事コミュニティ × Astro × Cloudflare Free で、Workers Free の 1 リクエスト CPU 10 ms に当たって止まった。原因は記事ではなく、個人向けのページ（SSR・CPU 15 ms）だった。
> 「Astro = 静的 = 軽い」と思って選ぶと、個人向けのページが SSR のまま残る。ページの描き方がフレームワークで暗に決まり、選ぶ前に見えないことが混乱の元だった。
> 料金の新しい数値は書いていない。値の根拠の無いものは**ゲーム上の仮定**、事実の確認が要るものは**要確認**と書く。

## 1. 柱: 選ぶ順番を、人の考える順にする

人が自然に考える順は次のとおり。

```
① どんなページがあり、それぞれ何が要るか（鮮度・個人化・OGP / 検索・動きのある部品）
      ↓ だから
② ページごとの描き方（S1〜S6）
      ↓ それを
③ どのフレームワーク・事業者がうまく扱えるか（対応・費用・制限）
```

採る形は **案 B**: フレームワークは先に選ぶまま、ページごとの帰結（各ページをどう描くか・ほかに何ができるか）を選ぶ前に見せ、選んだ後にページの行で描き方を直せるようにする（段 3）。
今の画面と行動（作り直し D-81 = フレームワークを替える）を壊さずに、段 2（読むだけの表）→ 段 3（選べる）と積める。

採らなかった案:

- 案 A「描き方を先に選び、合うフレームワークだけを残す」: 見積モードの「要件から構成を探す」機能として後の段に回す。
- 案 C「2 つのモードを切り替える」: 実装と説明が 2 倍になる。

## 2. 描き方のメニュー

catalog の `ROUTE_STRATEGIES`（`packages/catalog/src/frameworks/route-strategies.ts`）。id は下の英語の名前。

| 番号 | id | 画面の名前 | 中身 | 個人化のページ |
|---|---|---|---|---|
| S1 | `static-build` | 静的（ビルドし直し） | ビルドのときに HTML にする。更新はビルドし直し | 使えない |
| S2 | `cached-ttl` | サーバーで描いてキャッシュ（時間で取り直す） | 最初の閲覧で描いてキャッシュし、期限で取り直す | 使えない |
| S3 | `cached-purge` | サーバーで描いてキャッシュ（更新で消す） | 投稿・編集のときに、そのページのキャッシュを消す | 使えない |
| S4 | `ssr` | 毎回描く | リクエストのたびに描く | 使える |
| S5 | `shell-api` | 枠 + ブラウザが API で取る | HTML は静的な枠で、中身はブラウザが API で取る | 使える |
| S6 | `server-island` | 枠 + サーバーの島 | 枠は使い回し、個人化した部分だけをサーバーが描く（Server Islands・PPR） | 使える（**人ごとに違うページだけに出す**。§5c・D-108） |
| S7（画面では番号を出さない） | `cache-components` | 部品ごとにキャッシュ（Cache Components） | Next.js 16 の `cacheComponents`。全員に同じ部品は `'use cache'`（`cacheLife`・`cacheTag`）で静的な枠に入れ、人ごとに違う部分（動的な穴）だけを閲覧ごとに描いて同じ応答で流す（PPR） | 使える（記事にも人ごとに違うページにも。§5e・D-111） |

- 個人化のページ（人ごとに違う中身）に S1〜S3 を入れると、ある人の中身が他の人に見える。対応表とプリセットで弾き、画面では灰色にして理由を添える。
- 各描き方には、見る人ごとの「なぜ」（何の要件に応えるか）を持たせ、表の「なぜ」の列に出す。
- **estimator には新しい種類を足さない**（RS-05）。Workload の `rendering` への写し方は次のとおり。
  - S1 → `static` + `build`
  - S2・S3 → `isr`（期限か、オンデマンドの値）
  - S4 → `ssr`
  - S5 → `spa`。全員に同じ中身のページ（記事）を Next.js・Astro・静的書き出しで S5 にすると、記事ごとの枠（`shellPerView`・S1 と同じビルド）にする（段 4・D-109。§5d）
  - S6 → Astro は `isr` の枠（期限 1 日）+ 閲覧ごとの島のリクエスト（ルートの `island.request`）。Next.js の PPR は `ssr` のまま CPU を島の分にして `island: {}`（§5c）。種類は足さず、ルートに任意の欄 `island` を足した（D-108）
  - 部品ごとにキャッシュ → 記事は `isr` のまま（S2・S3 と同じ）。人ごとに違うページは `ssr` のまま CPU・DB の問い合わせを動的な穴の分にして `island: { label: '動的な穴' }`（§5e・D-111）
- 画面の S 番号は分かりにくいので外す方針（後の UI の作業）。部品ごとにキャッシュは最初から番号を出さない（`code` は空。文書の中だけ S7 と呼ぶ）。

## 3. 対応表（フレームワーク × 事業者）

catalog の `capabilityRow`・`strategySupport`（`route-capability.ts`）。今の catalog のデータから組み立てる。

- DeployTarget の出典
- Astro の記事の置き場 `pageCache`（D-103）
- Next.js の ISR のキャッシュの部品の `onDemandIsr`（D-32）
- 描き方ごとに確かめた公式の文書（Next.js の `generateStaticParams`・vinext の README と caching の文書。D-107 とその補足）

各セルには、使えるか・理由の文・出典かゲーム上の仮定か（`basis`）・出典を持たせる。
使えるか: ✓ 使える、部 = 部品で決まる、✗ 使えない、? = 確かめていない（画面に出さない。RS-04）。
「仮」は、出典の無い「使える」（ゲーム上の仮定）。

| | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| Next.js × Cloudflare（vinext） | ✓（開発中・Worker を通る。RS-15） | ✓ | 部（R2・Workers Cache は消せる、KV は消せない） | ✓ | ✓仮 | ✗（cacheComponents が未完成） |
| Next.js × Vercel・VPS・Netlify・OpenNext | ✓ | ✓ | ✓ | ✓ | ✓仮 | ✓（Vercel・VPS）／?（Netlify・OpenNext） |
| Next.js × AWS（Amplify）・Google Cloud | ✓（処理を通さないのは仮） | ✓ | ✗（Amplify の ISR・Hosting の CDN は消して全体に届けられない） | ✓ | ✓仮 | ✗（Amplify は 15 まで）／✓（Google Cloud） |

部品ごとにキャッシュ（D-111・§9）: Next.js × Vercel（**既定**）・VPS・Google Cloud は ✓（出典）、vinext・Amplify は ✗、Netlify・OpenNext は ?（出さない）。Astro・静的書き出し・Vite の SPA には無い（✗）。Google Cloud の記事をタグで消す形は S3 と同じく部品の判定（Hosting の CDN が消せない）で灰色になる。
| Astro × Cloudflare・Vercel・VPS・Netlify | ✓ | ✓ | ✓ | ✓ | ✓仮 | ✓（Vercel は仮） |
| Astro × Google Cloud | ✓ | ✓ | ✗（Hosting の CDN はデプロイでしか消えない） | ✓ | ✓仮 | ✓仮 |
| Next.js 静的書き出し（どこでも） | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Vite SPA（どこでも） | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

- Next.js の S1 は `generateStaticParams` と `dynamicParams = false`（一覧に無いページは 404。新しい記事はビルドし直すまで開けない）。公式の文書（2026-10-01 更新・2026-11-03 取得）を出典にした（D-107・RS-18）。
- **vinext の S1**（RS-15・2026-11-03 取得の [README](https://github.com/cloudflare/vinext)・[docs/caching.mdx](https://github.com/cloudflare/vinext/blob/main/docs/caching.mdx)）: `prerender: true` と `cache: { cdn: staticAssetsAdapter() }` で、事前描画した HTML・RSC をアセットに写し、**実行時に Worker が `ASSETS` の binding から読んで返す**（「reads them from the `ASSETS` binding at runtime」。Worker-first）。書き込み・無効化は何もせず、次のデプロイで置き換わる。
  - 数え方（catalog の `vinext-prerender` の解釈・`composeStack` の `vinextPrerender`）: 記事の閲覧（`document-static`）を Worker に通し、**1 回ごとに Worker のリクエストに数える**（Free では 1 日 10 万件に入る）。描画はせず、1 回の CPU はキャッシュから返すのと同じ 2 ms（テンプレートの `cachedServeCpuMs` と同じ値・**ゲーム上の仮定**）。JS・CSS は今までどおり静的アセット（Worker を通さない）。ビルドし直しはほかの S1 と同じく Workers Builds の分。
  - Worker を通ることは README の設計の文からの読みで、課金の明記は無い（`output: 'export'` の「served as assets only」は別の経路で、静的書き出しが使う）。
  - 選択肢の ⓘ に「vinext は開発中（README）」を出す。
- **Amplify・Google Cloud の S1**: 静的なページを CDN が返し、処理（Amplify の compute・Cloud Run）を通さないとみなすのは**ゲーム上の仮定**（対応表の文に書いた）。Amplify の公式の文書は Next.js 15 までの「Static pages・SSG に対応」までで配り方・課金の記載が無い。Firebase App Hosting は「CDN に載った応答は Cloud Run に届かない」と書くが、キャッシュの外れ・期限切れは Cloud Run を呼ぶ（[About App Hosting](https://firebase.google.com/docs/app-hosting/about-app-hosting)・[Optimize caching](https://firebase.google.com/docs/app-hosting/optimize-cache)。2026-11-03 取得）。
- S6 の列の根拠は §8（D-108 で画面に出した）。S6 は人ごとに違うページだけに出し、全員に同じページ（記事）では「このゲームでは人ごとに違うページだけ」の理由つきの灰色にする（記事の動く部品は記事の行の部品「コメント欄」・ルートの API で数える。段 4・D-109）。
- 載せられない組（Astro × AWS など）は、すべて ✗ になる。理由は DeployTarget の文。
- 「部」のセルは、今の部品で判定する。ゲームの `onDemandBlocker` を使い、前段の CDN の選択も見る。
- AWS（Amplify・OpenNext）・Netlify の構成は隠している（D-100）が、古い保存の再生に使うので表には入れてある。

## 4. フレームワークの既定（プリセット）と、今の設定の行き先

catalog の `FRAMEWORK_PRESETS`。見る人（`public` = 全員に同じ・`personal` = 人ごとに違う）で引く。

| フレームワーク | 記事（public） | 個人向け・業務の画面（personal） |
|---|---|---|
| Next.js | S2（再検証がオンデマンドなら S3）。**Vercel では部品ごとにキャッシュ**（D-111） | S4。**Vercel では部品ごとにキャッシュ**（D-111） |
| Astro | S3（消せない事業者では S2） | S4 |
| Next.js 静的書き出し | S1 | S5 |
| Vite SPA | S5 | S5 |

- **Astro の落とし先は S2**（D-103 の実装に合わせた）。下書きの RS-03 は「S1 に落とす」案だった。D-103 で Google Cloud は期限で取り直す形にしたので、S2 にそろえた。
- 段 2 では、プレイヤーは描き方を直接選ばない。今の設定・部品から、描き方が次のように決まる（game の `routeChoices`）。段 3 からは選べる（§5b）。選ばなければ今もこの決まり方の既定になる。
  - 再検証・記事のキャッシュ（`revalidateSec`）: オンデマンドなら S3、時間なら S2 の期限。静的書き出しでは S1 のビルドの間隔。
  - Next.js の ISR のキャッシュの部品「キャッシュしない」: 記事を S4 にする。`applyComponentsToWorkload` と同じ書き換えになる。
  - SPA の API の応答のキャッシュ（D-37）: 記事の S5 で、中身の応答をキャッシュする。個人化の応答はキャッシュしない。
  - コメントの描き方（D-82）: 段 4 で記事の行の部品「コメント欄」に移した（D-109・§5d）。

段 3 で移す予定だったもの（下書き §2.2 の表の推奨）。**段 3 では表のとおりには移していない**: `revalidateSec` は 1 つの欄のまま記事の描き方で意味を決め（S2 ↔ S3 はオンデマンドの値で切り替える）、「キャッシュしない」の部品と `renderingModes` も残した（§5b・§6 の「段 3 でしなかったこと」）。

| 今のもの | 行き先 |
|---|---|
| `revalidateSec`（ISR の間隔・ビルドの間隔・API のキャッシュの期間・記事のキャッシュを 1 つの欄で兼ねる） | ルートの描き方の値（S1 の間隔・S2 の期限・S5 のキャッシュの期間）。`FRAMEWORK_HIDDEN_SETTINGS` の出し分けが要らなくなる |
| オンデマンド（`ON_DEMAND_REVALIDATE`） | S2 → S3 の切り替え（S1 なら「更新のたび」） |
| ISR のキャッシュの部品 | 全体の部品のまま。S2・S3 のルートがあるときだけ出す。「キャッシュしない」は S4 と重なるので外す |
| OGP の前処理・API の置き場・前段の CDN | 全体の部品のまま |
| `FrameworkProfile.renderingModes` | 対応表に置き換えて消す（段 2 では残した） |

## 5. 実装（段 2・D-106）

- **catalog**: 描き方のモデルと対応表を入れた。`toSpa`・`toAstro`・`toNextExport`・`toStaticBuild` は、プリセットの呼び出しにした。
  - モデル: `ROUTE_STRATEGIES`・`FRAMEWORK_PRESETS`・`presetPlan`・`routeAudience`
  - 書き換え: `applyRouteStrategies(w, plan, ctx)`
  - 対応表: `capabilityRow`・`strategySupport`・`defaultStrategy`
  - Astro の JS・CSS の倍率は、描き方でなくフレームワークの性質として `withAstroAssets` に分けた。
- **game**:
  - `routeChoices`: 今の設定・部品からルートごとの描き方を決める。`workloadFor` はこれを `applyRouteStrategies` に当てる。
  - `routePlanRows` / `routePlanOf(state)`: 表の行。ページ・見る人・PV の割合・描き方・値・なぜ・既定から変わった理由・ほかの描き方を返す。ほかの描き方は、使えるか・理由・仮定かを持つ。
- **web**: `RoutePlanTable`（`route-plan-table.tsx`）。色は見取り図の作られ方の色を流用し、必ず文字を添える。次の 2 か所に出す。
  - 始める画面のフレームワークのカード: 選んでいる構成・設定・部品で描く。選んでいないフレームワークのカードは、その既定の設定と、選べる部品だけを残したもので描く。
  - 見積モードの「ページごとの描き方」のカード: 構成図の下。
- **等価のテスト**（`packages/game/src/route-strategies-equivalence.test.ts`）: 置き換える前の main（20901a9）で、`workloadFor` の出力をスナップショットに記録した。置き換えの後も変わらないことを確かめる。
  - 範囲: 2 シナリオ × 選べるフレームワーク × 載せられる構成（隠した構成も）× 部品の選択肢を 1 つずつ × 再検証 5 値 × コメント 2 値 × 個人向けの割合 2 値 × 在庫 2 値
  - 件数: 約 2 万の Workload
  - 基準プレイの golden も不変。
- 表の行の描き方が `workloadFor` の当てた Workload のルートと一致することも、全シナリオ × フレームワーク × 構成で確かめる（`route-plan.test.ts`）。

## 5b. 実装（段 3・D-107）

- **ページの性質**（RS-17）: テンプレートのデータ（catalog の `ARTICLE_COMMUNITY_ROUTES`・`BUSINESS_APP_ROUTES`）に、見る人・SNS のカードが要るか・鮮度の要件の文・部品を書いた。シナリオの `routeTraits` が参照する。estimator の Workload には入れない。
- **選んだ描き方** `GameState.routes`: ルートの id → 描き方。フレームワークの既定と分け方が違うものだけを持つ（既定のまま始めると持たない＝今までの状態と同じ）。
  - S2 と S3 は同じ「キャッシュ」で、期限かオンデマンドかは今までの設定（再検証・記事のキャッシュ）で決める（切り替えの手間も今までどおり）。
  - 選べるのは、対応表で使える（部品で決まるものを含む）・数え方がある・確かめた描き方だけ（`strategySelectable`）。
- **始める画面**: ① ページと要件（シナリオの説明）→ ② フレームワーク（カルーセル。カードは既定の描き方を短く出す）→ ③ ページの描き方（選べる表）→ ④ インフラの構成（カルーセル）→ 部品・設定。
  - ⚠ D-112 で ③ の欄をやめ、描き方は ② のフレームワークのカードのページの欄のチップで選ぶ。表は「詳しく比べる」のダイアログに移した（§5f）。
  - ③ の行ごとに、要件の判定（鮮度・SNS のカード・1 リクエストの CPU の制限と D-99 の当たったルート）と、ほかの描き方にしたときの 1 か月目の費用・止まる前提の差（`routePlanStatus`）を出す。
  - 選んだ描き方は、選んでいるフレームワークのカードの見取り図と、構成のカードの構成図に効く。見取り図は、その描き方を既定に持つフレームワークの図を借りる（無ければ本体の区画の作られ方を描き方で置き換える）。
- **途中の変更**（行動 `{ type: 'route', route, strategy, value? }`・翌月から）: 手間は枠 + API へ 4・それ以外 3（RS-08・ゲーム上の仮定）。作り直しの最中は選べない。作り直しが済むと既定に戻り、乗り換え先で使えない描き方は既定に戻る。
  - **替える前に見せる**（D-107 の補足）: 乗り換え・プラン変更・作り直しの選択肢と、始める画面の構成・フレームワークのカードに、既定に戻るページと理由を出す（「乗り換えると、記事のページは「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（時間で取り直す）」（既定）に戻る: …」。D-112 の前は番号で書いていた）。予測は game の `routeFallbacks` で、実際の乗り換え・作り直しの後と一致することをテストで確かめる。規則・手間は変えない。
- **記事の描き方で決まるもの**: 設定の意味（S1 はビルドの間隔・S2/S3 は ISR か記事のキャッシュ・SPA の S5 は API のキャッシュの期間。S4 と、API の応答のキャッシュの無い S5 では出さない）、鮮度の判定（S1 は D-104 の遅れ・S4 はキャッシュなし・S5 は SPA と同じ）、即時反映の要件、SNS のカード（RS-11）、コメントの描き方（S5 には含める HTML が無い。段 4 で記事の行の部品に移した）。
- **構成**: S1 の記事があればビルドのノードを足す（`composeStack` の `staticBuild`）。Astro で記事をキャッシュしない（S1・S4・S5）なら、Cloudflare の Workers Cache を前に置かない（`pageCache: false`。静的アセットを Workers の料金で数えない）。
- **保存**: `SAVE_VERSION` 2（始めた描き方 `routes`）。版 1 の保存は描き方を既定として読む（今の `routeChoices` で決まるもの。描き方を選べる前と同じ結果）。D-103 の行動の読み替えもそのまま効く。
- **見積モード**: 描き方は URL の `rp.<ルート>=<描き方>` に残る。表から選べ、行ごとに SNS のカード・CPU の制限と、今の PV での月額の差を出す（鮮度はゲームの満足度の判定なので出さない）。構成の比較・費用の曲線も、選んだ描き方（構成ごとに使えないものは既定）で引く。

## 5c. 実装（段 5・D-108）

- **数え方**（catalog の `SERVER_ISLAND`・`serverIslandDelivery`・`applyRouteStrategies`。値は**ゲーム上の仮定**）:
  - 島を描く CPU = ページ全体の SSR の **0.4 倍**（`islandShare`）。DB の問い合わせ・I/O 待ちはすべて島の側。フレームワークごとの描画の倍率は 1 のまま（RS-06）。
  - **Astro（Server Islands。`request`）**: 島は枠とは別の GET のリクエスト。ルートを `isr` の枠に書き換え、閲覧 1 回ごとに `document-ssr` を 1 件足す（estimator のルートの `island.request`）。
    - 枠: 島を除いた残り（CPU・応答の 0.6 倍・DB を読まない）。人ごとに違わないので事業者の置き場（Cloudflare は Workers Cache・Vercel は ISR・VPS は Node のメモリ・Google Cloud は Hosting の CDN）に**期限 1 日**でキャッシュする（S2 の経路。枠はデプロイでしか変わらない）。キャッシュから返す CPU は記事と同じ 2 ms。
    - 島の応答: 人ごとに違うのでキャッシュしない（`Cache-Control: private` の読み）。props が 2,048 バイトを超えると POST になりキャッシュされないことは文書の注だけ（どのみちキャッシュしない）。
  - **Next.js（PPR。`stream`）**: 静的な枠を先に流し、動的な部分を同じ応答で続けて流す。枠を CDN から配るかはアダプター・CDN の実装しだい（§8.2）なので仮定せず、**閲覧ごとに処理を通して島の分だけ描く**（origin だけの形）。ルートは `ssr` のままで CPU を 0.4 倍にし、`island: {}` を付ける。応答の大きさはページ全体のまま。
- **1 リクエストの CPU の内訳（D-99）**: 島は「個人向けのページ（サーバーの島・CPU 6 ms）」、Astro の枠の描き直しは「個人向けのページ（島の枠の閲覧と描き直し・CPU 11 ms）」と分けて出す（estimator の `RequestSource.island`・`islandShell`）。表の行の CPU の判定は、そのページのどちらかが当たれば ✗。
- **要件**: 人ごとに違うページに使える（S1〜S3 と違い、島はキャッシュしない）。枠の HTML（メタタグ）はそのまま返る（SNS のカードの判定は S5 だけが ✗）。鮮度の判定は全員に同じページだけなので S6 は関わらない。
- **選べる組**（§3・§8）: Astro × Cloudflare・VPS・Netlify（隠している）は出典、Vercel・Google Cloud は仮。Next.js × Vercel・VPS・Google Cloud は出典。vinext・Amplify は ✗、Next.js × Netlify・OpenNext は ?（出さない）。
- **構成**: Astro で S6 のページがあれば、記事をキャッシュしなくても Cloudflare の Workers Cache を前に置く（枠をキャッシュするため。game の `staticBuildOf`）。
- **途中の変更の手間**: S6 へも S6 からも 3（RS-08。人ごとに違う部品に `server:defer`・Suspense を付けるだけで API は書かない）。
- **画面**: 始める画面の ③・見積モードの表（`rp.<ルート>=server-island`）・途中の行動。見取り図は、人ごとに違う区画（シナリオの `islandRegions`）を「サーバーの島（閲覧ごとに一部だけ描く）」、ほかの HTML の区画を「枠（使い回す）」にする。構成図は、島の区画のあるページがあれば閲覧ごとに描く経路（`document-ssr`）の線に「サーバーの島」の流れ（破線）を載せる。
- **既定・基準プレイは変えない**: どのフレームワークの既定にも S6 は無いので、等価のスナップショット・golden は不変。
- 速さの判定（RS-10）は今までどおりフレームワークの SSR の CPU で見る（S6 の島の CPU を速さに入れるのは RS-10 の残り）。

## 5d. 実装（段 4・D-109）

### コメント欄を記事のページの部品に

- **置き場**: 全体の設定「コメントの描き方」（D-82。`Settings.comments`・行動 `{ type: 'set', key: 'comments' }`）を、記事のページの部品にした。
  - 状態 `GameState.routeParts`（ルートの id → `{ comments }`。既定のブラウザで読み込むは持たない）。描き方と違い、作り直し・乗り換えでは戻さない（前の設定と同じ）。
  - 行動 `{ type: 'route-part', route, part: 'comments', value }`（翌月から・手間はどちらの向きも 2。`EFFORT.route.comments`。前の設定の手間と同じ）。
  - 選べるのは、シナリオにコメントがあり記事のページが HTML のとき（`commentsChoosable`。SPA・枠 + API の記事では選べない。前の設定の出し分けと同じ）。
- **効き方は変えない**: 更新の数（オンデマンドの再生成・無効化・ビルドし直し）・鮮度の遅れ（D-85）・API の減り（記事を開いたときのコメントの取得）は D-82 のまま。
- **API の数え方（RS-02）**: コメント欄（といいね）の API を、全体の `perPage.apiCalls` でなく記事のルートの閲覧ごとに数える（estimator のルートの任意の欄 `apiCalls`）。
  - テンプレートの記事のルートに `apiCalls: 1`（perPage と同じ値）を付けた。件数・流れ・費用は今までと同じで、内訳（D-99 の `RequestSource`）が記事のルートに付く（「記事のページ（ページの部品が呼ぶ API）」）。
  - 二重に数えない: ルートの値はそのルートの閲覧に perPage の代わりに使う（`N(api) = PV × perPage + Σ 閲覧 × (apiCalls − perPage)`）。枠 + API の記事は中身とコメント欄で 2 回（RS-02 のとおり）。
  - 記事のページに含めると、記事のルートの `apiCalls` を書き込みの分（× writesPerCall）だけにし、全体の書き込みが同じになるよう writesPerCall を直す（D-82 の `withoutCommentFetch` と同じ値）。
- **保存**: `SAVE_VERSION` 3（`routeParts`）。版 2 までの `comments` と行動 `set comments` は、記事のページの部品として読み替える（同じ値・同じ手間。読み替えた再生が新しい形の保存と同じ結果になることをテストで確かめた）。
- **画面**: 「ページの描き方」の表の記事の行に、部品の選択（「└ コメント欄: ブラウザで読み込む / 記事のページに含める」）を出す。
  - 始める画面の ③・ゲームの途中の「ページの描き方（来月から）」・見積モードの表。設定の欄からは外した。
  - 見積モードの URL は `rp.<ルート>.comments`（例 `rp.article.comments=1`）。前の `cm` も読む。
  - 見取り図（コメント欄の札）・構成図（流れの凡例のページ）は今までどおり選んだ値で描く。

### 記事の S5 の記事ごとの枠

- **読み（D-10 の 1 つの読み。ゲーム上の仮定）**: ページごとの HTML を書き出せるフレームワーク（Next.js・Astro・静的書き出し）で、その事業者で S1 を選べるときは、全員に同じ中身のページの S5 を「記事ごとに書き出す枠（タイトル・メタタグ入り）+ ブラウザが API で中身を取る」とみなす（`shellPerPage`）。
  - Next.js は `generateStaticParams` で書き出すページに中身を取る Client Component、Astro は `getStaticPaths` で書き出すページに中身を取るアイランド、静的書き出しはそのまま。
  - 「閲覧のときに描いてキャッシュする枠」の読みは採らなかった（S2・S3 に島を置くのと区別がつかず、HTML を描く CPU が残る）。
  - Vite の SPA は 1 つのシェル（index.html）のまま（入口だけ・SNS のカードは前処理の部品）。人ごとに違うページの S5 も入口だけのまま（既定の静的書き出しのマイページは変わらない）。
- **数え方**（estimator の spa のルートの `shellPerView`）:
  - 枠と JS・CSS は閲覧のたびに読む（入口だけでない。MPA の遷移）。枠は静的な配信（vinext は S1 と同じく Worker が ASSETS から返し、閲覧ごとに Worker のリクエスト）。
  - 枠はビルドで作る（S1 と同じビルドの時間の式・記事のページの数）。記事の投稿・編集のたびにビルドする（間隔でまとめない。メタタグが変わりうる編集も含める・ゲーム上の仮定）。設定の revalidateSec は SPA と同じく API の応答のキャッシュの期間の意味のまま（Next.js・Astro には API の応答のキャッシュの部品が無いので出さない）。
  - 中身はデータの API（CPU = SSR × dataCpuFactor）。コメント欄の API は上の記事のルートの分。
- **要件**:
  - SNS のカードは枠に入る（RS-11 の `socialCardFactor` を掛けない）。
  - 鮮度: 中身は API で常に新しいが、新しい記事は枠のビルドが終わるまで開けない（D-104 の `newPostDelayed` で 1 段下げる。理由は「記事ごとの枠のビルドが終わるまで」）。
  - コメント欄は含められない（枠に中身が無い）。
- **構成**: ビルドのノードを足す（`staticBuildOf` の `staticBuild`）。Astro で記事をキャッシュしないので Cloudflare の Workers Cache は前に置かない。
- **画面**: 表の S5 の選択肢の文・行の「なぜ」・値（「枠: 記事ごとに書き出す」）、見取り図（ヘッダー・タイトルは「ビルドで静的」、本文などは「ブラウザが API で取る」。札「SNS のカード: 記事ごとの枠に入る」）、構成図（記事のページが静的な流れと API の流れに載り、ビルドのノード）。
- **既定は変えない**: どのフレームワークの既定にも全員に同じページの S5 を記事ごとの枠にするものは無い（SPA は 1 つのシェルのまま）。費用・使用量・前提の当たりの等価のスナップショット（段 4 の前の main で記録）・golden は不変。

## 5e. 部品ごとにキャッシュ（Cache Components。D-111）

ユーザーの決定（C-14・C-16・2026-11-03）: Next.js 16 の Cache Components（`cacheComponents: true`・`'use cache'` と `cacheLife`・`cacheTag`・描き方としての PPR）を、今の ISR（S2・S3）・S6 に**足す**描き方にする。**Vercel × Next.js では既定**にし、使えない組（vinext・Amplify）は今までの ISR のまま、自前の Node（さくらの VPS の standalone）と Cloud Run は選べるが既定は今までのまま。

### 数え方（D-10 の 1 つの読み。値は**ゲーム上の仮定**。catalog の `CACHE_COMPONENTS`）

ページは「静的な枠（ビルドで事前描画）+ キャッシュした部品（`'use cache'`・全員で共有・更新はタグか期限）+ 動的な穴（人ごとに違う・閲覧ごとに描いて同じ応答で流す）」でできているとみなす。

- **全員に同じページ（記事）**: ほぼすべてがキャッシュした部品で、穴は無いとみなす（ログインの表示はブラウザの API のまま）。数え方は ISR と同じ（ルートは `isr` のまま）で、期限（`cacheLife`）かタグ（`cacheTag` + 投稿・編集で `updateTag`）かは今までの再検証の設定で決める（オンデマンドなら S3、時間なら S2 と同じ費用・鮮度）。
  - Vercel の文書は PPR の枠を「ISR で返す」と書く（§9.2）ので、費用は ISR と同じになる。部品の粒度で作り直す範囲が狭くなる効果は数えていない。
  - 判定（設定の意味・鮮度・SNS のカード・コメント欄・即時反映の要件）は「キャッシュ」として扱う（game の `articleJudgeFamily`）。
- **人ごとに違うページ**: ルートは `ssr` のまま（閲覧ごとに処理を通る。Vercel の文書「most PPR requests incur a function invocation」）。
  - 穴を描く CPU = ページ全体の SSR の **0.4 倍**（`dynamicShare`。S6 の島と同じ）。
  - DB の問い合わせと I/O 待ち = 全員に同じ部品（おすすめ・ヘッダーなど）の分 **3 分の 1** を除いた残り（`cachedQueryShare`。記事コミュニティの個人向けのページの 3 問い合わせのうち 1 つ）。この分は枠に入り、閲覧ごとには読まない。
  - 応答の大きさはページ全体のまま（枠も同じ応答で返る）。内訳（D-99）の文は「動的な穴」（estimator のルートの `island.label`）。
  - S6（Next.js の PPR・origin だけの形）との違いは、全員に同じ部品の問い合わせが枠に入ること。
- **事業者ごとのキャッシュの効き**（§9.1）:
  - Vercel: 枠（キャッシュした部品を含む）は全体の ISR のキャッシュ + 地域の CDN。全員で共有される。
  - さくらの VPS（1 つの `next start`）: 枠はディスク、`'use cache'` はプロセスのメモリ（LRU）。1 台なので全員で共有される（Vercel と同じ数え方）。
  - Cloud Run: `'use cache'` の既定はインスタンスごとのメモリで共有されず、タグの無効化もほかのインスタンスに届かない（Next.js の文書）。人ごとに違うページの全員に同じ部品は**ビルドで事前描画した枠**に入るので、インスタンスごとに取り直しが増えるのは期限ごと × インスタンスの数で、閲覧ごとの穴に比べて小さいとみなして数えない。記事をタグで消す形は、Hosting の CDN が消せないのと同じく使えない（S3 と同じ部品の判定で灰色）。
  - 共有の `cacheHandlers`（Redis など）を足す形はこのゲームでは扱わない（部品にしない）。
- **ISR のキャッシュの部品「キャッシュしない」**: 枠の置き場が無いので毎回描く（S4）に書き換える（今までの「キャッシュしない」と同じ）。
- 速さの判定（RS-10）は今までどおりフレームワークの SSR の CPU で見る。

### 対応と既定

- 対応表（catalog の `nextCacheComponents`）: Vercel・VPS・Google Cloud ✓（出典）、vinext ✗（README: `'use cache'` は一部だけ）、Amplify ✗（Next.js 15 まで）、Netlify・OpenNext ?。Next.js 以外には無い。
- 既定（catalog の `defaultStrategy`・`cacheComponentsByDefault`）: Vercel × Next.js だけ、記事・人ごとに違うページ（受託の業務の画面も）とも部品ごとにキャッシュ。
- 選んだ描き方（`GameState.routes`）は「既定と分け方が違うものだけ」を持つので、既定が事業者で変わる。`withRouteChoice`・`validRouteOverrides` は事業者を見る（Vercel で ISR を選ぶと選んだ描き方として残り、VPS へ乗り換えると既定に溶ける）。

### 画面

- 名前は「部品ごとにキャッシュ（Cache Components）」。S 番号は出さない（`code` は空。表・行動・注意の文は `strategyTitle`）。D-112 でほかの描き方の番号も画面から外した（§5f）。
- 表（始める画面の ③（D-112 で「詳しく比べる」のダイアログ）・ゲームの途中・見積モード）: 行の値は、記事なら「部品の期限 〜（cacheLife）」か「部品をタグで作り直す（投稿・編集で updateTag）」、人ごとに違うページなら「人ごとに違う部分だけ閲覧ごとに描く」。
- 見取り図: 人ごとに違うページの `islandRegions` を「動的な穴（閲覧ごとに描く）」、ほかの HTML の区画を「部品をキャッシュ（'use cache'）」に。記事は HTML の区画がすべて「部品をキャッシュ」。事業者を渡すと Vercel × Next.js の既定も図に出る（`pageWireframes` の `platform`）。
- 構成図: 動的な穴の区画のあるページがあれば、閲覧ごとに描く経路（`document-ssr`）の線に「動的な穴」の流れ（点線）を載せる。キャッシュした部品は ISR の流れに載せる。
- 途中の変更の手間: どちらの向きも 3（RS-08）。見積モードの URL は `rp.<ルート>=cache-components`（Vercel では既定なので書かない。毎回描く・ISR を選ぶと `rp.personal=ssr` などが残る）。

### 保存

- `SAVE_VERSION` 4。版 3 までの保存は Vercel × Next.js の既定が ISR・毎回描くだったので、読むと `legacyRouteDefaults` を付け、今までの既定で再生する（途中で Vercel へ乗り換えた後も今までの既定。保存し直しても印は残る）。
- 等価のスナップショット（`route-strategies-equivalence.test.ts`）は `legacyRouteDefaults` で引いて記録を替えずに通る（古い保存が同じ結果で再生されることの確かめも兼ねる）。新しい既定の分は基準プレイの golden で見る。

## 5f. 始める画面のカードで選ぶ・番号を出さない（D-112）

- **選ぶ場所**: 始める画面の ③ の表をやめ、描き方はフレームワークのカードのページの欄で選ぶ（見取り図を左、右に描き方のチップ・要件の札・ページの札・行）。チップを押すと隣の見取り図がすぐ替わる。記事のページのコメント欄（D-109）も記事の欄で選ぶ。
  - チップはそのフレームワークの描き方をすべて `ROUTE_STRATEGY_ORDER` の順で並べる（表の描き方の列と同じ `choicesOf`）。選んでいるものは塗りと内側の枠と「選択中」、使えないものは灰色と理由の ⓘ。長い説明（なぜ・対応表の文・ゲーム上の仮定か）はチップの ⓘ。どれも同じ高さ（`h-7`・1 行・長い名前は省略して aria-label と title に全文）。枠は inset の ring なので、選んでも箱の大きさは変わらない。
  - 要件の判定（鮮度・SNS のカード・1 リクエストの CPU）は小さい札（`RowStatus` の badges）で、文は ⓘ。
  - 費用の差（ほかの描き方の 1 か月目の差）は「詳しく比べる」のダイアログの表（`RoutePlanTable`。見積モードと同じ）。`<dialog>` の showModal（フォーカスを閉じ込め、Esc・背景・閉じるのボタンで閉じ、ボタンへ戻す）。表で選んでもカードに効く。
  - 選んでいないフレームワークのカードは、既定の描き方のチップを 1 つ（「既定」）だけ読むだけで出す。
  - 行・要件の判定・選んだときの書き換えは web の `useRoutePlanEditor`（今までの ③ の欄と同じ計算）。値・規則・手間は変えない。
- **番号を出さない**: S1〜S6 の番号は画面（始める画面・見積モードの表・途中の行動の選択・ⓘ・既定に戻る注意・行動の記録・基準プレイの説明）に出さず、名前だけにする。`strategyTitle` は名前を返し（`strategyShortName` は消した）、既定に戻る注意は「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（時間で取り直す）」（既定）のように鉤括弧でくくる。`code` はデータ・文書・テストの名前の中の呼び名として残す。

## 6. 段取り

| 段 | 中身 | 状態 |
|---|---|---|
| 0 | 当たったルートを示す（D-99）・Astro の文を直す（D-101）・AWS の OpenNext と Netlify を隠す（D-100） | 済 |
| 1 | Astro の記事を S3 に（D-103） | 済 |
| 2 | 描き方のモデル・対応表・プリセット・`applyRouteStrategies`（Workload は不変）・読むだけの表（D-106） | 済 |
| 3 | 始める画面・見積モードで、ページごとに描き方を選べるようにする（S1〜S5）。要件の判定・保存 v2・途中の行動と手間（D-107） | 済 |
| 4 | 記事の S5（記事ごとの枠）・コメント欄をルートの部品に（D-82 を移す。§5d・D-109） | 済 |
| 5 | S6（Server Islands・PPR）。対応の事実は §8、数え方・画面は §5c（D-108） | 済 |
| 6 | 部品ごとにキャッシュ（Next.js 16 の Cache Components）を足し、Vercel × Next.js の既定にする。事実は §9、数え方・画面・保存は §5e（D-111） | 済 |

段 3 でしなかったこと: 速さの判定の重み付き CPU（RS-10）・乗り換え先で描き方が使えなくなるときの「描き方も替える（手間 +n）」の表示（RS-04 の残り。既定に戻ることの注意だけは出す）・ISR のキャッシュの部品「キャッシュしない」を S4 にまとめること・`FrameworkProfile.renderingModes` を消すこと・`revalidateSec` をルートごとの値に分けること（記事のルートは 1 つなので値は 1 つのまま）。

## 7. 未決（RS-01〜）

下書き（2026-11-03）の推奨案を、そのまま推奨として載せる。決まったものは決定の番号を書いた。

| # | 論点 | 推奨・状態 |
|---|---|---|
| RS-01 | 出す選択肢の広さ | **段 3 で採用**（D-107）: ルートはシナリオの 2 つ（業務は 1 つ）。描き方は対応表と見る人で絞る。期限・間隔は設定の欄のまま。S6 は段 5 で人ごとに違うページに出した（D-108） |
| RS-02 | アイランドの API の数え方 | **段 4 で採用**（D-109）: S5 のデータの API は、ルートの閲覧 × 1 回（CPU = SSR × `dataCpuFactor` 0.5。今の仮定）。コメント欄は記事のルートの `apiCalls`（閲覧 × 1 回。perPage の代わりに使い、二重に数えない）。S5 の記事は中身とコメント欄で 2 回 |
| RS-03 | フレームワークごとの既定 | **決定（D-103・D-106）**: §4 の表。消せない事業者は S2 に落とす |
| RS-04 | 載せられない組の扱い | **段 2 で採用**: 個人化の禁止と事業者の ✗ は、灰色 + ⓘ の理由。? は出さない。段 3: 乗り換え先で使えない描き方は、乗り換えが済むと既定に戻す（D-107）。「描き方も替える（手間 +n）」と見せるのは残り |
| RS-05 | 新しい kind（`ssr-cached`）を足すか | **決定（D-103）**: 足さない。`isr` の式が同じ |
| RS-06 | 計測が要る値 | **1 のまま**（C-13・D-107）。フレームワークごとの描画の CPU の倍率と、HTML の大きさの倍率。Workers の `CPUTimeMs` で測るまで 1 のまま。Astro が 0.4 倍なら個人向けの SSR が Free に収まり、バランスが大きく動く |
| RS-07 | バランスへの影響 | **基準プレイを 2 本足した**（D-107。「CF Free・個人向けを枠 + API」「CF Paid・個人向けを枠 + API」）。CF Free は記事の ISR の再生成・画像の変換・日次のリクエストで止まり、描き方だけでは勝てない（D-107 の表）。**目標（記事 $1,730・受託 $1,700）は変えない**（ユーザーの判断待ち） |
| RS-08 | 描き方の変更の手間（ゲーム上の仮定） | **段 3 で採用**（D-107）: S2 ↔ S3 は 2（今までの設定）、分け方が変わるものは 3、枠 + API へは 4、値だけは 0、フレームワークを替えるのは 24（D-81）。翌月から |
| RS-09 | CF の前段の Workers Cache（Astro S2・S3） | **Free でも使える（事実・2026-11-03）**: 公式のブログ（2026-07-06）「available today to every Worker on any plan」。ヒットも Worker のリクエストとして数える（料金の頁）。D-103 の解釈を事実に替えた（数え方は D-103 のまま。D-103 の補足）。拠点ごとのヒット率は計算に入れていない |
| RS-10 | 速さの判定（`heavySsrCpuMs` 12） | 今の 1 つの `ssrCpuMs` を、「描く閲覧の重み付きの CPU」に替える。描く閲覧は S4 の全部・S2 / S3 の取り直し・S6 の島。**段 3・段 5 ではしなかった**: 速さの CPU・初回表示はフレームワークの性質のまま（Next.js・Astro のページを S5 にしても、静的書き出しのマイページと同じく SSR の値で見る。D-80 の仮定に合わせた）|
| RS-11 | OGP の判定 | **段 3 で採用**（D-107）: `needsOgp` のルートが S5 で前処理の部品なし、のときだけ `socialCardFactor` を掛ける。**段 4 で改めた**（D-109）: Next.js・Astro・静的書き出しの記事の S5 は記事ごとの枠（メタタグ入り）なのでカードは出る。掛けるのは SPA（1 つのシェル）で前処理なしのときだけ |
| RS-12 | 消す呼び出しの制限 | URL で消す前提にし、前提の行に出す（CF Free の purge は URL なら毎秒 800 件。コメントを HTML に含めても 1 日 約 490 回で当たらない） |
| RS-13 | 見積モードの費用の差 | **段 3 で採用**（D-107）: 選択肢ごとに反実仮想で回す。構成の比較・費用の曲線は今の描き方で引く（「描き方を替えた案」の列は残り） |
| RS-14 | ページの一覧の欠け | 一覧・トップは記事のルートに含めたままにする。検索・ログインの画面は足さない |
| RS-15 | vinext の S1 | **解除（2026-11-03・D-107 の補足）**: README で `prerender: true` + `staticAssetsAdapter()` を確かめて出す。閲覧ごとに Worker のリクエスト・CPU はキャッシュから返すのと同じ（ゲーム上の仮定）。「vinext は開発中（README）」の注を添える。前は「確かめるまで出さない」（段 2） |
| RS-16 | 選ぶ順番 | **案 B を採用**（§1・D-107）: ① ページと要件 → ② フレームワーク → ③ ページの描き方 → ④ 構成 |
| RS-17 | ルートの性質（見る人・`needsOgp`・鮮度・部品）の置き場 | 段 2 では、テンプレートの `rendering` から見る人を読んでいる（ISR・静的 = 全員に同じ、SSR = 人ごと）。toSpa・toAstro が前から使っていた読み方。**決定（C-13・D-107）**: テンプレートのデータに書く（`RouteTraits`）。estimator の Workload には入れない |
| RS-18 | 出典の無い「使える」（Next.js の S1・S5 全般） | ゲーム上の仮定として出し、ⓘ に「ゲーム上の仮定」と書く（段 2 で採用）。**決定（C-13・D-107）**: S5 はゲーム上の仮定のまま出す。Next.js の S1 は公式の文書（`generateStaticParams`）で確かめて出典を付けた。vinext の S1 は README で確かめて出した（RS-15 の解除）。Amplify・Google Cloud の S1 で静的なページに処理を通さないのはゲーム上の仮定と書いた。S6 は §8 の文書で出し、Astro × Vercel・Google Cloud は仮と書いた（D-108） |

## 8. S6（Server Islands・PPR）の確かめた事実（2026-11-03 取得）

段 5 の前に、どの組で S6 が作れるかを公式の文書で確かめた（D-106・D-107 の補足）。D-108 でこの表のとおりに対応表・画面へ出した（数え方は §5c）。

### 8.1 対応

| フレームワーク × 事業者 | S6 | 根拠 |
|---|---|---|
| Astro × Cloudflare | ✓ | `@astrojs/cloudflare` の頁「deploy your on-demand rendered routes and features to Cloudflare, including server islands」（取得時の要約で逐語ではない） |
| Astro × VPS（Node） | ✓ | `@astrojs/node` の頁「including server islands, actions, and sessions」 |
| Astro × Netlify | ✓ | `@astrojs/netlify` の頁「automatically configures skew protection for Astro features like actions, server islands, …」 |
| Astro × Vercel | ✓仮 | `@astrojs/vercel` の頁は機能の一つとして触れるだけ。Server Islands の頁は「it will work with any host you have」 |
| Astro × Google Cloud（Cloud Run の Node） | ✓仮 | Node のアダプターと同じ（Cloud Run の頁は今回取得していない） |
| Next.js × Vercel・VPS（Node の standalone）・Google Cloud（Cloud Run） | ✓ | Next.js 16.0.0 で `cacheComponents` が安定し、PPR はその既定の挙動になった（`experimental.ppr` は廃止）。「A single `next start` process handles every Next.js feature correctly: … PPR, Cache Components …」。Node のランタイムが要る（`runtime = 'edge'` は使えない） |
| Next.js × Cloudflare（vinext） | ✗ | README「full `cacheComponents` behavior is still incomplete. … partial shells, resume behavior … do not yet match Next.js」 |
| Next.js × AWS（Amplify） | ✗ | Amplify は Next.js 15 まで（「You can deploy apps built with Next.js versions up through Next.js 15」）。`cacheComponents` は 16 |
| Next.js × Netlify | ? | 今回は一次情報を取っていない |
| Next.js 静的書き出し・Vite の SPA | ✗ | サーバーが無い・ページごとの HTML を作らない（今の対応表のまま） |

出典（2026-11-03 取得）:

- Astro: [Server Islands](https://docs.astro.build/en/guides/server-islands/)・[@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)・[@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/)・[@astrojs/netlify](https://docs.astro.build/en/guides/integrations-guide/netlify/)・[@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/)（いずれも更新日の表示なし）
- Next.js: [cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)（2026-10-15 更新）・[Caching](https://nextjs.org/docs/app/getting-started/caching)（2026-10-06 更新）・[Deploying to platforms](https://nextjs.org/docs/app/guides/deploying-to-platforms)（2026-03-30 更新）・[PPR platform guide](https://nextjs.org/docs/app/guides/ppr-platform-guide)（2026-03-30 更新）・[Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)（2026-10-15 更新）
- vinext: [README](https://github.com/cloudflare/vinext)（更新日の表示なし）
- Amplify: [Next.js の SSR の対応](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)（更新日の表示なし）

### 8.2 S6 を数えるのに要るもの（段 5）

- **島は別のリクエスト**: Astro の島は「retrieved via a GET request, passing props as an encrypted string in the URL query」。ページの閲覧 1 回に、枠（S1〜S3 の数え方）と島のリクエスト（島の数だけ・SSR の CPU の一部）が乗る。Next.js の PPR は 1 つの応答の中で静的な枠を先に流し、動的な部分を続けて流す（ストリーミング）。
- **島のキャッシュ**: GET なので「caching data with the Cache-Control HTTP header」ができる。ただし:
  - URL が 2,048 バイトを超えると POST になり（「Astro will instead send a POST request that contains all props in the body」）、キャッシュされない。
  - Vercel の ISR の経路では Cache-Control が無視される（`@astrojs/vercel`「routes use Vercel's cache shielding and any Cache-Control headers are ignored」）。
  - Cloudflare は Workers Cache を有効にしたときだけ前段で効く（ヒットも Worker のリクエストに数える。RS-09）。
  - 個人化した島は使い回せない（S6 を個人向けのページに使うときは島を毎回描く。このモデルの読み）。
- **PPR の費用**: 静的な枠を CDN から配るのはアダプター・CDN の実装しだい（「These are available building blocks, not finished integrations.」）。`next start` の既定は origin だけで描く形で、毎回処理を通る（費用は S4 に近い）。公式の文と合わせるなら、枠を CDN で配ることを仮定せず、origin だけを既定の数え方にする。
- 速さの判定（RS-10）では、S6 の島を「描く閲覧」に数える（RS-10 の残り）。
- D-108 で採った形: 個人化した島は毎回描きキャッシュしない。PPR は origin だけの形（閲覧ごとに処理を通る）にして、CPU だけを島の分にした（§5c）。

## 9. 部品ごとにキャッシュ（Cache Components）の確かめた事実（2026-11-03 取得）

D-111 の前に、公式の文書で確かめた。引用は取得時の原文。更新日は頁の表示（lastUpdated・last_updated）。

### 9.1 `'use cache'` のキャッシュの置き場

- **既定はプロセスごとのメモリ**: 「Outputs are stored by a cache handler, in memory by default」・「it can also cache data at runtime using in-memory LRU (Least Recently Used) storage」（[use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache)。2026-09-29 更新）。
  - 環境ごと: Serverless は「Cache entries typically don't persist across requests (each request can be a different instance), or during revalidation. Build-time caching works normally.」、Self-hosted は「Cache entries persist across requests.」（同じ頁の表）。
  - 「The default in-memory cache is isolated to each Next.js process. If you're running multiple servers or containers, each instance will have its own cache that isn't shared with others and is lost on restart.」（[cacheHandlers](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers)。2026-10-15 更新）。
- **共有は `cacheHandlers` か `'use cache: remote'`**: 「Custom handlers let you integrate with shared storage systems (like Redis, Memcached, or DynamoDB) that all your Next.js instances can access.」・「If you don't configure `cacheHandlers`, Next.js uses an in-memory LRU (Least Recently Used) cache for both `default` and `remote`.」・「The default in-memory handler only tracks tags locally, so calling `revalidateTag()` on one instance does not affect others.」（cacheHandlers）。
  - `'use cache: remote'` は「providing durable caching shared across all server instances. This comes with tradeoffs: infrastructure cost and network latency during cache lookups.」（[use cache: remote](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote)。2026-08-18 更新）。
  - 自前の Node: 「By default, Next.js uses an in-memory cache that is not shared across instances. For consistent caching behavior, use `'use cache: remote'` with a custom cache handler that stores data in external storage.」・「By default, calling `revalidateTag()` on one instance only invalidates the cache on that instance.」（[Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)。2026-10-15 更新）。
- **Vercel**: 枠は「At deployment time, Vercel writes the shell to the global ISR cache. On the first request in each region, Vercel pulls the shell into the regional CDN cache. The shell persists in the global ISR cache until you revalidate it.」（[Vercel の Partial Prerendering](https://vercel.com/docs/partial-prerendering)。2026-09-22 更新）。`'use cache'` そのものは Vercel でも関数のインスタンスのメモリで、`'use cache: remote'` が Vercel の Runtime Cache（「a regional, ephemeral cache」）に入る（「`use cache` is in-memory by default. This means that it is ephemeral, and disappears when the instance that served the request is shut down. `use cache: remote` is a declarative way telling the system to store the cached output in a remote cache such Vercel runtime cache.」。[Runtime Cache](https://vercel.com/docs/caching/runtime-cache)。2026-08-28 更新）。

### 9.2 静的な枠の配り方

- 事前描画: 「During prerendering, the header (static) and blog posts (cached with `use cache`) become part of the static shell」・「This rendering approach is called **Partial Prerendering (PPR)**, the default behavior with Cache Components.」・「Every produced static shell can be served directly from a CDN, without going through to the upstream server.」（[Caching](https://nextjs.org/docs/app/getting-started/caching)。2026-10-06 更新）。
- 置き場: 「The payload is rendered to HTML and stored on disk when self-hosting, or in your platform's durable storage behind a CDN.」（Caching の「Where cached content is stored」）。
- Vercel: 「PPR uses Incremental Static Regeneration (ISR) for the static shell of the page, and Vercel Functions to render the dynamic parts of the page.」・「even when the shell is served from the CDN cache, your function still runs to render the dynamic holes. It is possible to have a fully cached page, but most PPR requests incur a function invocation.」（Vercel の PPR）。
- 自前の Node: 「Cache Components works by default with Next.js and is not a CDN-only feature. This includes deployment as a Node.js server (through `next start`) and when used with a Docker container.」（Self-hosting）。枠を CDN で配るのは任意（§8.2）。

### 9.3 オンデマンドの無効化

- `updateTag`: 「can **only** be called from within Server Actions」・「`updateTag` immediately expires the cached data for the specified tag. The next request will wait to fetch fresh data rather than serving stale content from the cache」（[updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag)。2026-08-18 更新）。
- `revalidateTag`: 「can be called in Server Functions and Route Handlers」・「Calling `revalidateTag` marks the tagged data as stale. The next request for that data kicks off a revalidation and is served stale content while it runs, using stale-while-revalidate semantics.」・推奨は `profile="max"`、単一引数の形は非推奨（[revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)。2026-08-25 更新）。
- `cacheLife` の既定のプロファイル: `default`（stale 5 分・revalidate 15 分・expire なし）・`hours`（5 分・1 時間・1 日）・`days`（5 分・1 日・1 週）・`max`（5 分・30 日・1 年）など。「`revalidate` of `0`, or `expire` under 5 minutes: excluded from prerenders, becoming a "dynamic hole" resolved at request time.」（[cacheLife](https://nextjs.org/docs/app/api-reference/functions/cacheLife)。2026-09-29 更新）。
- Vercel: 「when you revalidate content, all caches across all regions update within 300 milliseconds」（Vercel の PPR）。タグの無効化の呼び出しは Pro で 1 秒あたり「200 per team」（Runtime Cache の頁）。

### 9.4 Vercel の課金

- PPR: 「When you use PPR with a framework on Vercel, you incur usage for: ISR reads and writes … Function invocations: your function runs to render the dynamic holes on most requests, plus any background revalidations. Fast Origin Transfer」（Vercel の PPR）。このゲームは今の ISR・関数の料金の数え方のまま（新しい料金の行は足していない）。
- Runtime Cache（`'use cache: remote'` の置き場）: 「billed as **Runtime Cache Reads** and **Runtime Cache Writes**」、Hobby は月 1M reads・200K writes が込み、Pro は「$0.40 - $0.64 per 1M read units」「$4.00 - $6.40 per 1M write units」（1 単位 8 KB）（Runtime Cache の頁）。**このゲームの読みは `'use cache'`（既定のメモリ）と枠の ISR だけで、`remote` は使わないので数えない**（料金データにも入れていない）。

