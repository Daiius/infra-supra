#!/usr/bin/env bash
# load.sh の窓（フレームワーク × サイズ）ごとに、CPU 時間の分位を GraphQL Analytics API から取る。
#
#   ./results.sh [runs/<日時>]      既定は runs/ の最新
#   ./results.sh --schema           分位のフィールド名と説明（単位）を API から引いて表示する
#
# 環境変数（ディスクには書かない）:
#   CLOUDFLARE_API_TOKEN   Account > Account Analytics > Read の権限を持つ API トークン
#   CLOUDFLARE_ACCOUNT_ID  アカウント ID（ダッシュボードの URL の dash.cloudflare.com/<ここ>）
#
# 使うデータセット: viewer.accounts.workersInvocationsAdaptive（Workers の呼び出しの集計。標本抽出あり）。
# 分位は quantiles.cpuTimeP50 など。単位はマイクロ秒と想定して ms に直して表示する（--schema で説明を確かめる）。
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="https://api.cloudflare.com/client/v4/graphql"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN を設定してください（Account Analytics: Read）}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID を設定してください}"

gql() { # $1 = JSON body。トークンはコマンドライン引数に載せず、標準入力からヘッダーとして渡す
  printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN" |
    curl -sS -X POST "$API" -H @- -H 'Content-Type: application/json' --data-binary "$1"
}

if [ "${1:-}" = "--schema" ]; then
  echo "== AccountWorkersInvocationsAdaptive のフィールド"
  out="$(gql "$(jq -n '{query: "{ __type(name: \"AccountWorkersInvocationsAdaptive\") { fields { name type { name ofType { name } } } } }"}')")"
  printf '%s' "$out" | jq -r '.data.__type.fields[]? | "  \(.name): \(.type.name // .type.ofType.name)"'
  qtype="$(printf '%s' "$out" | jq -r '.data.__type.fields[]? | select(.name=="quantiles") | (.type.name // .type.ofType.name)')"
  if [ -z "$qtype" ] || [ "$qtype" = null ]; then
    echo "型名を引けませんでした（introspection が無効か、型名が違う）。応答:"
    printf '%s\n' "$out" | jq .
    exit 1
  fi
  echo "== $qtype（分位）のフィールドと説明"
  gql "$(jq -n --arg t "$qtype" '{query: ("{ __type(name: \"" + $t + "\") { fields { name description } } }")}')" |
    jq -r '.data.__type.fields[]? | "  \(.name)\t\(.description // "")"'
  exit 0
fi

RUN_DIR="${1:-}"
if [ -z "$RUN_DIR" ]; then
  RUN_DIR="$(find "$SPIKE_DIR/runs" -mindepth 1 -maxdepth 1 -type d -name '20*' 2>/dev/null | sort | tail -n1 || true)"
  [ -n "$RUN_DIR" ] || {
    echo "runs/ がありません。先に ./load.sh を実行してください。" >&2
    exit 1
  }
fi
RUN_DIR="${RUN_DIR%/}"
WINDOWS="$RUN_DIR/windows.tsv"
[ -f "$WINDOWS" ] || {
  echo "$WINDOWS がありません" >&2
  exit 1
}

query_for() { # $1 = quantiles { } の中身
  cat <<EOF
query (\$account: string!, \$script: string!, \$start: Time!, \$end: Time!) {
  viewer {
    accounts(filter: { accountTag: \$account }) {
      workersInvocationsAdaptive(limit: 100, filter: { scriptName: \$script, datetime_geq: \$start, datetime_leq: \$end }) {
        dimensions { status }
        sum { requests errors subrequests }
        quantiles { $1 }
      }
    }
  }
}
EOF
}
# 公式チュートリアルで確認できた分位は cpuTimeP50 / cpuTimeP99 だけ。P90・P999・wallTimeP50 は未確認なので、
# 全部入りで失敗したら確認済みの 2 つだけで取り直す。
QUERY_FULL="$(query_for 'cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999 wallTimeP50')"
QUERY_MIN="$(query_for 'cpuTimeP50 cpuTimeP99')"

n_errors() { jq '(.errors // []) | length' 2>/dev/null || echo 1; }

echo "== $RUN_DIR"
echo "CPU 時間は API の値をマイクロ秒とみなし ms で表示。status ごとに 1 行（success 以外は CPU 超過・例外など）"
printf '%-8s %5s %-20s %8s %6s %8s %8s %8s %8s %8s\n' framework items status requests errors cpuP50 cpuP90 cpuP99 cpuP999 wallP50
OUT_JSON="$RUN_DIR/results.json"
echo '[]' >"$OUT_JSON"
while IFS=$'\t' read -r fw worker items start end _n; do
  ask() {
    gql "$(jq -n --arg q "$1" --arg a "$CLOUDFLARE_ACCOUNT_ID" --arg s "$worker" --arg st "$start" --arg en "$end" \
      '{query: $q, variables: {account: $a, script: $s, start: $st, end: $en}}')" || echo '{"errors":[{"message":"curl failed"}]}'
  }
  resp="$(ask "$QUERY_FULL")"
  if [ "$(printf '%s' "$resp" | n_errors)" != 0 ]; then
    echo "[$fw items=$items] 全部入りのクエリが失敗。cpuTimeP50/P99 だけで取り直します: $(printf '%s' "$resp" | jq -c '[.errors[]?.message]' 2>/dev/null)" >&2
    resp="$(ask "$QUERY_MIN")"
  fi
  if [ "$(printf '%s' "$resp" | n_errors)" != 0 ]; then
    echo "[$fw items=$items] GraphQL エラー:" >&2
    printf '%s\n' "$resp" >&2
    continue
  fi
  rows="$(printf '%s' "$resp" | jq -c '.data.viewer.accounts[0].workersInvocationsAdaptive // []')"
  if [ "$rows" = "[]" ]; then
    printf '%-8s %5s %s\n' "$fw" "$items" "(データなし: 集計の遅延なら数分後に再実行)"
    continue
  fi
  printf '%s' "$rows" | jq -r --arg fw "$fw" --arg items "$items" '
    def ms: if . == null then "-" else ((. / 10) | round / 100 | tostring) end;
    .[] | [$fw, $items, .dimensions.status, .sum.requests, .sum.errors,
      (.quantiles.cpuTimeP50 | ms), (.quantiles.cpuTimeP90 | ms), (.quantiles.cpuTimeP99 | ms),
      (.quantiles.cpuTimeP999 | ms), (.quantiles.wallTimeP50 | ms)] | @tsv' |
    awk -F'\t' '{ printf "%-8s %5s %-20s %8d %6d %8s %8s %8s %8s %8s\n", $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 }'
  # 生の応答も残す（単位や件数を後で確かめられるように。トークンは含まない）
  jq --arg fw "$fw" --arg items "$items" --arg st "$start" --arg en "$end" --argjson rows "$rows" \
    '. + [{framework: $fw, items: ($items | tonumber), start: $st, end: $en, rows: $rows}]' "$OUT_JSON" >"$OUT_JSON.tmp"
  mv "$OUT_JSON.tmp" "$OUT_JSON"
done < <(tail -n +2 "$WINDOWS")
echo
echo "生の応答: $OUT_JSON"
echo "※ workersInvocationsAdaptive は標本抽出（adaptive sampling）された集計。数百件なら全件に近いはず（未確認）。"
echo "※ 単位が怪しいとき: ./results.sh --schema で分位フィールドの説明を見る。"
