#!/usr/bin/env bash
# ローカル（wrangler dev = workerd）で 2 アプリの応答時間を比べる。**相対の目安だけ**。
# 手元の CPU は本番の Workers と違い、ネットワークも無いので、10 ms に収まるかの判定には使わない。
#
#   ./local-bench.sh [--requests N] [--no-build]
#
# アプリごとに: build → wrangler dev を起動 → 暖機 → items=10/30 を N 回ずつ直列 → 停止。
# サーバーはこのスクリプトの中で起動して必ず止める（終了時の trap でプロセスグループごと止める）。
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUESTS=100
BUILD=1
PORT=8799
while [ $# -gt 0 ]; do
  case "$1" in
    --requests) REQUESTS="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
export ASTRO_TELEMETRY_DISABLED=1
export WRANGLER_SEND_METRICS=false

server_pid=""
stop_server() {
  if [ -n "$server_pid" ]; then
    kill -TERM -- "-$server_pid" 2>/dev/null || true
    # グループ内（wrangler・workerd）が全部消えるまで最大 10 秒待ち、残れば KILL
    for _ in $(seq 1 20); do
      kill -0 -- "-$server_pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL -- "-$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
}
trap stop_server EXIT INT TERM

OUT="$SPIKE_DIR/runs/local-$(date -u +%Y%m%dT%H%M%SZ)"  # 結果と HTML の見本を残す（gitignore 対象）
mkdir -p "$OUT"
summary() { # stdin: 応答完了までの秒の列 → "median p90 mean"（ms）
  sort -n | awk '{ a[NR]=$1; s+=$1 } END {
    if (NR==0) { print "-"; exit }
    m=a[int((NR+1)/2)]; p=a[int(NR*0.9)>0?int(NR*0.9):1]
    printf "中央値 %6.2f ms  p90 %6.2f ms  平均 %6.2f ms", m*1000, p*1000, s/NR*1000 }'
}

for app in astro vinext; do
  dir="$SPIKE_DIR/$app"
  echo "== [$app]"
  if [ "$BUILD" -eq 1 ]; then
    (cd "$dir" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null 2>&1)
  fi
  log="$OUT/$app-dev.log"
  # setsid でプロセスグループを分け、workerd の子プロセスごと止められるようにする
  (cd "$dir" && exec setsid pnpm exec wrangler dev --ip 127.0.0.1 --port "$PORT" >"$log" 2>&1) &
  server_pid=$!
  base="http://127.0.0.1:$PORT"
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$base/feed?items=1" && break
    sleep 1
  done
  for _ in $(seq 1 20); do curl -s -o /dev/null "$base/feed?items=10"; done # 暖機
  for items in 10 30; do
    f="$OUT/$app-$items.tsv"
    curl -s -o "$OUT/$app-$items.html" "$base/feed?items=$items"
    for _ in $(seq 1 "$REQUESTS"); do
      curl -s -o /dev/null -w '%{time_total}\t%{size_download}\t%{http_code}\n' "$base/feed?items=$items" >>"$f"
    done
    bytes="$(cut -f2 "$f" | sort -u | tr '\n' ' ')"
    codes="$(cut -f3 "$f" | sort | uniq -c | awk '{printf "%s×%s ", $2, $1}')"
    printf '  items=%-3s %s  HTML %s B  (%s)\n' "$items" "$(cut -f1 "$f" | summary)" "$bytes" "$codes"
  done
  stop_server
done
echo "結果と HTML の見本: $OUT"
echo "※ ループバックでの応答完了までの時間（ストリーミングなので TTFB ではなく total）であり CPU 時間そのものではない。本番の値は deploy.sh → load.sh → results.sh で取る。"
