#!/usr/bin/env bash
# astro / vinext の 2 アプリをビルドして Cloudflare Workers（ssr-cpu-astro / ssr-cpu-vinext）へ deploy する。
#
#   ./deploy.sh --check   何もせず、手順・版・ログイン状態だけを表示する
#   ./deploy.sh           確認のうえ install → build → wrangler deploy（何度実行してもよい）
#   ./deploy.sh --yes     確認を省く
#
# 前提: `npx wrangler login` 済み（またはこのシェルで CLOUDFLARE_API_TOKEN を設定済み）。
# 秘密はディスクに書かない。
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS=(astro vinext)
export ASTRO_TELEMETRY_DISABLED=1
export WRANGLER_SEND_METRICS=false

mode=deploy
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --check) mode=check ;;
    --yes | -y) assume_yes=1 ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

worker_name() {
  # wrangler.jsonc の "name" を読む（コメント入り JSON なので素朴に grep する）
  grep -m1 -oE '"name":[[:space:]]*"[^"]+"' "$SPIKE_DIR/$1/wrangler.jsonc" | sed -E 's/.*"([^"]+)"$/\1/'
}

wrangler_in() {
  (cd "$SPIKE_DIR/$1" && pnpm exec wrangler "${@:2}")
}

echo "== 対象"
for app in "${APPS[@]}"; do
  echo "  $app -> worker '$(worker_name "$app")'  ($SPIKE_DIR/$app)"
done

echo "== ログイン状態（wrangler whoami）"
# whoami は node_modules が無いと動かないので、無ければ npx の版で見る
whoami_dir="$SPIKE_DIR/astro"
if [ -d "$whoami_dir/node_modules" ]; then
  whoami_out="$(cd "$whoami_dir" && pnpm exec wrangler whoami 2>&1 || true)"
else
  whoami_out="$(npx --yes wrangler@4.156.2 whoami 2>&1 || true)"
fi
if printf '%s' "$whoami_out" | grep -qiE 'not authenticated|not logged in|You are not'; then
  echo "  未ログイン。先に次を実行してください:  npx wrangler login"
  logged_in=0
else
  printf '%s\n' "$whoami_out" | grep -iE 'logged in|account|email' | sed 's/^/  /' || true
  logged_in=1
fi

if [ "$mode" = check ]; then
  echo "== --check: 実行する内容（今回は何もしない）"
  for app in "${APPS[@]}"; do
    echo "  (cd $app && pnpm install --frozen-lockfile && pnpm build && pnpm exec wrangler deploy)"
  done
  echo "  → 各 deploy の出力から https://<worker>.<subdomain>.workers.dev を拾って表示"
  echo "== 版（package.json の固定値）"
  for app in "${APPS[@]}"; do
    echo "  [$app]"
    jq -r '(.dependencies + .devDependencies) | to_entries[] | "    \(.key) \(.value)"' "$SPIKE_DIR/$app/package.json"
  done
  exit 0
fi

if [ "$logged_in" -eq 0 ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ログインしていないため中止します（npx wrangler login の後に再実行）。" >&2
  exit 1
fi

if [ "$assume_yes" -eq 0 ]; then
  read -r -p "上の 2 つの Worker を deploy します。続けますか? [y/N] " ans
  case "$ans" in y | Y | yes) ;; *)
    echo "中止しました。"
    exit 1
    ;;
  esac
fi

declare -A urls=()
# deploy の出力は表示しつつ URL を拾う（出力にトークンは含まれない。終了時に消す）
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for app in "${APPS[@]}"; do
  echo "== [$app] install / build"
  (cd "$SPIKE_DIR/$app" && pnpm install --frozen-lockfile && pnpm build)
  echo "== [$app] wrangler deploy"
  wrangler_in "$app" deploy 2>&1 | tee "$log"
  urls[$app]="$(grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' "$log" | head -n1 || true)"
done

echo
echo "== deploy 済みの URL"
for app in "${APPS[@]}"; do
  echo "  $app: ${urls[$app]:-(出力から拾えませんでした。ダッシュボードで確認してください)}"
done
if [ -n "${urls[astro]:-}" ] && [ -n "${urls[vinext]:-}" ]; then
  echo
  echo "次: ./load.sh ${urls[astro]} ${urls[vinext]}"
fi
