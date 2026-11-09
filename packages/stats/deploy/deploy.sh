#!/bin/sh
# VPS で集計のサーバーを、指定したコミットのイメージに入れ替える（prd/15 §7.1）。compose.yml と同じディレクトリで流す。
#
#   sh deploy.sh <コミットの SHA> --check   # 変えずに、今の状態と入れ替え先だけを見る
#   sh deploy.sh <コミットの SHA>           # pull → migration → 入れ替え → /api/version の確認
#
# 前提: compose.example.yml・server.env.example・migrate.env.example を compose.yml・server.env・migrate.env に写して埋めてある。
#       イメージが private なら、先に docker login ghcr.io（read:packages の PAT）。
# 切り戻し: 前の SHA でもう一度流す（migration は足す方向だけなので、前の版のサーバーも新しい表で動く範囲に保つ）。
set -eu

SHA="${1:-}"
MODE="${2:-}"
case "$SHA" in
  ''|-*) echo '使い方: sh deploy.sh <コミットの SHA（40 桁）> [--check]' >&2; exit 1 ;;
esac
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo 'SHA は 40 桁の 16 進で渡してください（git rev-parse HEAD）' >&2; exit 1; }

for f in compose.yml server.env migrate.env; do
  [ -f "$f" ] || { echo "$f がありません（*.example を写して埋めてください）" >&2; exit 1; }
done
for f in server.env migrate.env; do
  perm=$(stat -c %a "$f")
  [ "$perm" = 600 ] || echo "⚠ $f のパーミッションが $perm です（600 を推奨: chmod 600 $f）" >&2
done

export STATS_TAG="$SHA"
DC="docker compose -f compose.yml"

echo "== 今の stats コンテナ"
$DC ps stats || true
echo "== 今の版（/api/version）"
curl -fsS http://127.0.0.1:4000/api/version 2>/dev/null || echo '(応答なし)'
echo
echo "== 入れ替え先: ghcr.io/daiius/infra-supra-stats:$SHA"

if [ "$MODE" = "--check" ]; then
  docker manifest inspect "ghcr.io/daiius/infra-supra-stats:$SHA" >/dev/null 2>&1 \
    && echo 'イメージは GHCR にあります' \
    || echo '⚠ イメージが見つかりません（Actions の Stats image を走らせたか・login が要るか）'
  exit 0
fi

printf 'この版で migration を流して入れ替えます。よいですか？ [y/N] '
read -r ok
[ "$ok" = y ] || { echo 'やめました'; exit 1; }

$DC pull stats migrate
echo "== migration"
$DC --profile migrate run --rm migrate
echo "== 入れ替え"
$DC up -d stats

echo "== 起動を待つ"
i=0
until v=$(curl -fsS http://127.0.0.1:4000/api/version 2>/dev/null); do
  i=$((i + 1))
  [ $i -lt 30 ] || { echo '⚠ 30 秒待っても応答がありません: docker compose -f compose.yml logs stats' >&2; exit 1; }
  sleep 1
done
echo "$v"
case "$v" in
  *"$SHA"*) echo '✓ 指定した版で動いています' ;;
  *) echo '⚠ 版が一致しません（GIT_COMMIT のビルド引数を確かめてください）' >&2; exit 1 ;;
esac
