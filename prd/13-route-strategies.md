# 13. ページごとの描き方（ルートの描き方 S1〜S6）

> 状態: **段 0〜3 は実装済み**（段 0 = D-99〜D-101、段 1 = D-103、段 2 = D-106、段 3 = D-107）。**段 4・5 は未実装**で、§7 の残りの論点は推奨案つき。
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
| S6 | `server-island` | 枠 + サーバーの島 | 枠は使い回し、個人化した部分だけをサーバーが描く（Server Islands・PPR） | 使える（**未実装・要確認**） |

- 個人化のページ（人ごとに違う中身）に S1〜S3 を入れると、ある人の中身が他の人に見える。対応表とプリセットで弾き、画面では灰色にして理由を添える。
- 各描き方には、見る人ごとの「なぜ」（何の要件に応えるか）を持たせ、表の「なぜ」の列に出す。
- **estimator には新しい種類を足さない**（RS-05）。Workload の `rendering` への写し方は次のとおり。
  - S1 → `static` + `build`
  - S2・S3 → `isr`（期限か、オンデマンドの値）
  - S4 → `ssr`
  - S5 → `spa`

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
| Next.js × Cloudflare（vinext） | ✓（開発中・Worker を通る。RS-15） | ✓ | 部（R2・Workers Cache は消せる、KV は消せない） | ✓ | ✓仮 | ?（§8: ✗） |
| Next.js × Vercel・VPS・Netlify・OpenNext | ✓ | ✓ | ✓ | ✓ | ✓仮 | ? |
| Next.js × AWS（Amplify）・Google Cloud | ✓（処理を通さないのは仮） | ✓ | ✗（Amplify の ISR・Hosting の CDN は消して全体に届けられない） | ✓ | ✓仮 | ? |
| Astro × Cloudflare・Vercel・VPS・Netlify | ✓ | ✓ | ✓ | ✓ | ✓仮 | ? |
| Astro × Google Cloud | ✓ | ✓ | ✗（Hosting の CDN はデプロイでしか消えない） | ✓ | ✓仮 | ? |
| Next.js 静的書き出し（どこでも） | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Vite SPA（どこでも） | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

- Next.js の S1 は `generateStaticParams` と `dynamicParams = false`（一覧に無いページは 404。新しい記事はビルドし直すまで開けない）。公式の文書（2026-10-01 更新・2026-11-03 取得）を出典にした（D-107・RS-18）。
- **vinext の S1**（RS-15・2026-11-03 取得の [README](https://github.com/cloudflare/vinext)・[docs/caching.mdx](https://github.com/cloudflare/vinext/blob/main/docs/caching.mdx)）: `prerender: true` と `cache: { cdn: staticAssetsAdapter() }` で、事前描画した HTML・RSC をアセットに写し、**実行時に Worker が `ASSETS` の binding から読んで返す**（「reads them from the `ASSETS` binding at runtime」。Worker-first）。書き込み・無効化は何もせず、次のデプロイで置き換わる。
  - 数え方（catalog の `vinext-prerender` の解釈・`composeStack` の `vinextPrerender`）: 記事の閲覧（`document-static`）を Worker に通し、**1 回ごとに Worker のリクエストに数える**（Free では 1 日 10 万件に入る）。描画はせず、1 回の CPU はキャッシュから返すのと同じ 2 ms（テンプレートの `cachedServeCpuMs` と同じ値・**ゲーム上の仮定**）。JS・CSS は今までどおり静的アセット（Worker を通さない）。ビルドし直しはほかの S1 と同じく Workers Builds の分。
  - Worker を通ることは README の設計の文からの読みで、課金の明記は無い（`output: 'export'` の「served as assets only」は別の経路で、静的書き出しが使う）。
  - 選択肢の ⓘ に「vinext は開発中（README）」を出す。
- **Amplify・Google Cloud の S1**: 静的なページを CDN が返し、処理（Amplify の compute・Cloud Run）を通さないとみなすのは**ゲーム上の仮定**（対応表の文に書いた）。Amplify の公式の文書は Next.js 15 までの「Static pages・SSG に対応」までで配り方・課金の記載が無い。Firebase App Hosting は「CDN に載った応答は Cloud Run に届かない」と書くが、キャッシュの外れ・期限切れは Cloud Run を呼ぶ（[About App Hosting](https://firebase.google.com/docs/app-hosting/about-app-hosting)・[Optimize caching](https://firebase.google.com/docs/app-hosting/optimize-cache)。2026-11-03 取得）。
- S6 の列は画面に出さない（?）。確かめた対応は §8。
- 載せられない組（Astro × AWS など）は、すべて ✗ になる。理由は DeployTarget の文。
- 「部」のセルは、今の部品で判定する。ゲームの `onDemandBlocker` を使い、前段の CDN の選択も見る。
- AWS（Amplify・OpenNext）・Netlify の構成は隠している（D-100）が、古い保存の再生に使うので表には入れてある。

## 4. フレームワークの既定（プリセット）と、今の設定の行き先

catalog の `FRAMEWORK_PRESETS`。見る人（`public` = 全員に同じ・`personal` = 人ごとに違う）で引く。

| フレームワーク | 記事（public） | 個人向け・業務の画面（personal） |
|---|---|---|
| Next.js | S2（再検証がオンデマンドなら S3） | S4 |
| Astro | S3（消せない事業者では S2） | S4 |
| Next.js 静的書き出し | S1 | S5 |
| Vite SPA | S5 | S5 |

- **Astro の落とし先は S2**（D-103 の実装に合わせた）。下書きの RS-03 は「S1 に落とす」案だった。D-103 で Google Cloud は期限で取り直す形にしたので、S2 にそろえた。
- 段 2 では、プレイヤーは描き方を直接選ばない。今の設定・部品から、描き方が次のように決まる（game の `routeChoices`）。段 3 からは選べる（§5b）。選ばなければ今もこの決まり方の既定になる。
  - 再検証・記事のキャッシュ（`revalidateSec`）: オンデマンドなら S3、時間なら S2 の期限。静的書き出しでは S1 のビルドの間隔。
  - Next.js の ISR のキャッシュの部品「キャッシュしない」: 記事を S4 にする。`applyComponentsToWorkload` と同じ書き換えになる。
  - SPA の API の応答のキャッシュ（D-37）: 記事の S5 で、中身の応答をキャッシュする。個人化の応答はキャッシュしない。
  - コメントの描き方（D-82）: 記事の行に添える。段 4 でルートの部品に移す。

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
  - ③ の行ごとに、要件の判定（鮮度・SNS のカード・1 リクエストの CPU の制限と D-99 の当たったルート）と、ほかの描き方にしたときの 1 か月目の費用・止まる前提の差（`routePlanStatus`）を出す。
  - 選んだ描き方は、選んでいるフレームワークのカードの見取り図と、構成のカードの構成図に効く。見取り図は、その描き方を既定に持つフレームワークの図を借りる（無ければ本体の区画の作られ方を描き方で置き換える）。
- **途中の変更**（行動 `{ type: 'route', route, strategy, value? }`・翌月から）: 手間は枠 + API へ 4・それ以外 3（RS-08・ゲーム上の仮定）。作り直しの最中は選べない。作り直しが済むと既定に戻り、乗り換え先で使えない描き方は既定に戻る。
  - **替える前に見せる**（D-107 の補足）: 乗り換え・プラン変更・作り直しの選択肢と、始める画面の構成・フレームワークのカードに、既定に戻るページと理由を出す（「乗り換えると、記事のページは S1 → S2（既定）に戻る: …」）。予測は game の `routeFallbacks` で、実際の乗り換え・作り直しの後と一致することをテストで確かめる。規則・手間は変えない。
- **記事の描き方で決まるもの**: 設定の意味（S1 はビルドの間隔・S2/S3 は ISR か記事のキャッシュ・SPA の S5 は API のキャッシュの期間。S4 と、API の応答のキャッシュの無い S5 では出さない）、鮮度の判定（S1 は D-104 の遅れ・S4 はキャッシュなし・S5 は SPA と同じ）、即時反映の要件、SNS のカード（RS-11）、コメントの描き方（S5 には含める HTML が無い）。
- **構成**: S1 の記事があればビルドのノードを足す（`composeStack` の `staticBuild`）。Astro で記事をキャッシュしない（S1・S4・S5）なら、Cloudflare の Workers Cache を前に置かない（`pageCache: false`。静的アセットを Workers の料金で数えない）。
- **保存**: `SAVE_VERSION` 2（始めた描き方 `routes`）。版 1 の保存は描き方を既定として読む（今の `routeChoices` で決まるもの。描き方を選べる前と同じ結果）。D-103 の行動の読み替えもそのまま効く。
- **見積モード**: 描き方は URL の `rp.<ルート>=<描き方>` に残る。表から選べ、行ごとに SNS のカード・CPU の制限と、今の PV での月額の差を出す（鮮度はゲームの満足度の判定なので出さない）。構成の比較・費用の曲線も、選んだ描き方（構成ごとに使えないものは既定）で引く。

## 6. 段取り

| 段 | 中身 | 状態 |
|---|---|---|
| 0 | 当たったルートを示す（D-99）・Astro の文を直す（D-101）・AWS の OpenNext と Netlify を隠す（D-100） | 済 |
| 1 | Astro の記事を S3 に（D-103） | 済 |
| 2 | 描き方のモデル・対応表・プリセット・`applyRouteStrategies`（Workload は不変）・読むだけの表（D-106） | 済 |
| 3 | 始める画面・見積モードで、ページごとに描き方を選べるようにする（S1〜S5）。要件の判定・保存 v2・途中の行動と手間（D-107） | 済 |
| 4 | 記事の S5（毎ページの枠）・コメント欄をルートの部品に（D-82 を移す） | 未 |
| 5 | S6（Server Islands・PPR）。対応の事実は §8 に記録した（2026-11-03）。数え方は未 | 未 |

段 3 でしなかったこと: 速さの判定の重み付き CPU（RS-10）・乗り換え先で描き方が使えなくなるときの「描き方も替える（手間 +n）」の表示（RS-04 の残り。既定に戻ることの注意だけは出す）・ISR のキャッシュの部品「キャッシュしない」を S4 にまとめること・`FrameworkProfile.renderingModes` を消すこと・`revalidateSec` をルートごとの値に分けること（記事のルートは 1 つなので値は 1 つのまま）。

## 7. 未決（RS-01〜）

下書き（2026-11-03）の推奨案を、そのまま推奨として載せる。決まったものは決定の番号を書いた。

| # | 論点 | 推奨・状態 |
|---|---|---|
| RS-01 | 出す選択肢の広さ | **段 3 で採用**（D-107）: ルートはシナリオの 2 つ（業務は 1 つ）。描き方は対応表と見る人で絞る。期限・間隔は設定の欄のまま。S6 は出さない |
| RS-02 | アイランドの API の数え方 | S5 のデータの API は、ルートの閲覧 × 1 回（CPU = SSR × `dataCpuFactor` 0.5。今の仮定）。コメント欄は段 4 まで今の `perPage.apiCalls: 1` のまま（二重に数えない） |
| RS-03 | フレームワークごとの既定 | **決定（D-103・D-106）**: §4 の表。消せない事業者は S2 に落とす |
| RS-04 | 載せられない組の扱い | **段 2 で採用**: 個人化の禁止と事業者の ✗ は、灰色 + ⓘ の理由。? は出さない。段 3: 乗り換え先で使えない描き方は、乗り換えが済むと既定に戻す（D-107）。「描き方も替える（手間 +n）」と見せるのは残り |
| RS-05 | 新しい kind（`ssr-cached`）を足すか | **決定（D-103）**: 足さない。`isr` の式が同じ |
| RS-06 | 計測が要る値 | **1 のまま**（C-13・D-107）。フレームワークごとの描画の CPU の倍率と、HTML の大きさの倍率。Workers の `CPUTimeMs` で測るまで 1 のまま。Astro が 0.4 倍なら個人向けの SSR が Free に収まり、バランスが大きく動く |
| RS-07 | バランスへの影響 | **基準プレイを 2 本足した**（D-107。「CF Free・個人向けを枠 + API」「CF Paid・個人向けを枠 + API」）。CF Free は記事の ISR の再生成・画像の変換・日次のリクエストで止まり、描き方だけでは勝てない（D-107 の表）。**目標（記事 $1,730・受託 $1,700）は変えない**（ユーザーの判断待ち） |
| RS-08 | 描き方の変更の手間（ゲーム上の仮定） | **段 3 で採用**（D-107）: S2 ↔ S3 は 2（今までの設定）、分け方が変わるものは 3、枠 + API へは 4、値だけは 0、フレームワークを替えるのは 24（D-81）。翌月から |
| RS-09 | CF の前段の Workers Cache（Astro S2・S3） | **Free でも使える（事実・2026-11-03）**: 公式のブログ（2026-07-06）「available today to every Worker on any plan」。ヒットも Worker のリクエストとして数える（料金の頁）。D-103 の解釈を事実に替えた（数え方は D-103 のまま。D-103 の補足）。拠点ごとのヒット率は計算に入れていない |
| RS-10 | 速さの判定（`heavySsrCpuMs` 12） | 今の 1 つの `ssrCpuMs` を、「描く閲覧の重み付きの CPU」に替える。描く閲覧は S4 の全部・S2 / S3 の取り直し・S6 の島。**段 3 ではしなかった**: 速さの CPU・初回表示はフレームワークの性質のまま（Next.js・Astro のページを S5 にしても、静的書き出しのマイページと同じく SSR の値で見る。D-80 の仮定に合わせた）|
| RS-11 | OGP の判定 | **段 3 で採用**（D-107）: `needsOgp` のルートが S5 で前処理の部品なし、のときだけ `socialCardFactor` を掛ける。前処理の部品は SPA だけにあるので、Next.js・Astro の記事を S5 にするとカードは出ない |
| RS-12 | 消す呼び出しの制限 | URL で消す前提にし、前提の行に出す（CF Free の purge は URL なら毎秒 800 件。コメントを HTML に含めても 1 日 約 490 回で当たらない） |
| RS-13 | 見積モードの費用の差 | **段 3 で採用**（D-107）: 選択肢ごとに反実仮想で回す。構成の比較・費用の曲線は今の描き方で引く（「描き方を替えた案」の列は残り） |
| RS-14 | ページの一覧の欠け | 一覧・トップは記事のルートに含めたままにする。検索・ログインの画面は足さない |
| RS-15 | vinext の S1 | **解除（2026-11-03・D-107 の補足）**: README で `prerender: true` + `staticAssetsAdapter()` を確かめて出す。閲覧ごとに Worker のリクエスト・CPU はキャッシュから返すのと同じ（ゲーム上の仮定）。「vinext は開発中（README）」の注を添える。前は「確かめるまで出さない」（段 2） |
| RS-16 | 選ぶ順番 | **案 B を採用**（§1・D-107）: ① ページと要件 → ② フレームワーク → ③ ページの描き方 → ④ 構成 |
| RS-17 | ルートの性質（見る人・`needsOgp`・鮮度・部品）の置き場 | 段 2 では、テンプレートの `rendering` から見る人を読んでいる（ISR・静的 = 全員に同じ、SSR = 人ごと）。toSpa・toAstro が前から使っていた読み方。**決定（C-13・D-107）**: テンプレートのデータに書く（`RouteTraits`）。estimator の Workload には入れない |
| RS-18 | 出典の無い「使える」（Next.js の S1・S5 全般） | ゲーム上の仮定として出し、ⓘ に「ゲーム上の仮定」と書く（段 2 で採用）。**決定（C-13・D-107）**: S5 はゲーム上の仮定のまま出す。Next.js の S1 は公式の文書（`generateStaticParams`）で確かめて出典を付けた。vinext の S1 は README で確かめて出した（RS-15 の解除）。Amplify・Google Cloud の S1 で静的なページに処理を通さないのはゲーム上の仮定と書いた。S6 は出さない（§8） |

## 8. S6（Server Islands・PPR）の確かめた事実（2026-11-03 取得。画面には出さない）

段 5 の前に、どの組で S6 が作れるかを公式の文書で確かめた（D-106・D-107 の補足）。**対応表・画面は変えていない**（S6 は `unverified` のまま。数え方が無いので選べない）。

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
- 速さの判定（RS-10）では、S6 の島を「描く閲覧」に数える。

