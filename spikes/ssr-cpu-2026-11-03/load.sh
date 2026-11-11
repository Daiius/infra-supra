#!/usr/bin/env bash
# deploy 済みの 2 つの Worker に、サイズごとに直列でリクエストを送る。
#
#   ./load.sh <astro-url> <vinext-url> [--requests N] [--warmup W] [--sizes "10 30"]
#
# 既定: サイズ（items=10, 30）ごと・アプリごとに 300 回。
# GraphQL の workersInvocationsAdaptive は URL（path・query）で分けられないので、
# **サイズを時間帯で分ける**: 各サイズの計測を分の境目から始め、次のサイズは次の分の境目まで待つ。
# Worker 名（scriptName）でフレームワークを、時間帯でサイズを分けられる。
# 窓は runs/<日時>/windows.tsv に残し、results.sh がそれを読む。
# 最初の W 回（既定 5）は計測の窓の前に送る（コールドスタートを窓に入れない）。
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '2,12p' "$0"; }

[ $# -ge 2 ] || {
  usage
  exit 2
}
ASTRO_URL="${1%/}"
VINEXT_URL="${2%/}"
shift 2
REQUESTS=300
WARMUP=5
SIZES="10 30"
while [ $# -gt 0 ]; do
  case "$1" in
    --requests) REQUESTS="$2"; shift 2 ;;
    --warmup) WARMUP="$2"; shift 2 ;;
    --sizes) SIZES="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

RUN_DIR="$SPIKE_DIR/runs/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"
WINDOWS="$RUN_DIR/windows.tsv"
REQS="$RUN_DIR/requests.tsv"
printf 'framework\tworker\titems\tstart_utc\tend_utc\trequests\n' >"$WINDOWS"
printf 'framework\titems\tseq\thttp_code\tbytes\tttfb_s\ttotal_s\n' >"$REQS"

declare -A URL=([astro]="$ASTRO_URL" [vinext]="$VINEXT_URL")
declare -A WORKER=([astro]=ssr-cpu-astro [vinext]=ssr-cpu-vinext)

hit() { # $1=url → "code bytes ttfb total"（必ず 1 行）
  # 同じ URL を CDN が返さないよう、毎回変わる無害な値を付ける（両 Worker とも no-store で返す）
  # curl が失敗しても -w の行は出るので、受けてから成功の値か代わりの値のどちらか一方だけを出す。
  local out
  if out="$(curl -sS -o /dev/null -H 'Cache-Control: no-cache' \
    -w '%{http_code}\t%{size_download}\t%{time_starttransfer}\t%{time_total}' "$1&_r=$RANDOM$RANDOM")"; then
    printf '%s\n' "$out"
  else
    printf '000\t0\t0\t0\n'
  fi
}

wait_next_minute() {
  local now next
  now="$(date -u +%s)"
  next=$(((now / 60 + 1) * 60))
  echo "  分の境目まで $((next - now)) 秒待ちます（窓をサイズごとに分けるため）"
  sleep $((next - now))
}

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

echo "== 送り先: astro=$ASTRO_URL vinext=$VINEXT_URL"
echo "== 1 サイズ・1 アプリあたり $REQUESTS 回（前に $WARMUP 回の暖機）。出力: $RUN_DIR"

# 暖機（窓の外）。両アプリとも最小サイズで数回。
for fw in astro vinext; do
  for _ in $(seq 1 "$WARMUP"); do hit "${URL[$fw]}/feed?items=10" >/dev/null; done
done

for items in $SIZES; do
  wait_next_minute
  start="$(date -u +%s)"
  for fw in astro vinext; do
    echo "== [$fw] items=$items"
    for i in $(seq 1 "$REQUESTS"); do
      printf '%s\t%s\t%s\t%s\n' "$fw" "$items" "$i" "$(hit "${URL[$fw]}/feed?items=$items")" >>"$REQS"
    done
  done
  end="$(date -u +%s)"
  # 窓は [分の境目, 終了の分を切り上げた境目 - 1 秒]。次のサイズは切り上げた境目以降に始まる。
  end_ceil=$((((end + 59) / 60) * 60 - 1))
  for fw in astro vinext; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$fw" "${WORKER[$fw]}" "$items" "$(iso "$start")" "$(iso "$end_ceil")" "$REQUESTS" >>"$WINDOWS"
  done
done

echo
echo "== 応答（HTTP コード・サイズ・TTFB はネットワーク込みで CPU 時間ではない）"
awk -F'\t' 'NR>1 {
  k=$1" items="$2; n[k]++; b[k]+=$5; t[k]+=$6
  if ($4!="200") bad[k]++
  codes[k]=codes[k] (index(codes[k], $4) ? "" : " " $4)
} END {
  for (k in n) printf "  %-22s n=%d  非200=%d  平均 %.1f KB  平均 TTFB %.0f ms  codes:%s\n", k, n[k], bad[k]+0, b[k]/n[k]/1024, t[k]/n[k]*1000, codes[k]
}' "$REQS" | sort
echo
echo "非200 に 503 / 1102 が並ぶ場合は CPU 上限（Free 10 ms）超過の可能性。"
echo "次: 数分待って（集計の遅延）から  ./results.sh $RUN_DIR"
