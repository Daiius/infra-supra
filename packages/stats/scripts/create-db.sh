#!/bin/sh
# 集計用の DATABASE とロールを、すでにある Postgres に作る（prd/15 §7.1 の朝の作業。一度だけ流す）。
#
#   PSQL='<既存の Postgres に管理者で繋ぐ psql のコマンド>' sh packages/stats/scripts/create-db.sh          # 作る
#   PSQL='<同上>' sh packages/stats/scripts/create-db.sh --check  # 変えずに、今あるかだけを見る
#
# PSQL の例（compose の db コンテナの中の psql。-T で標準入力から SQL を渡す）:
#   PSQL='docker compose -f <compose のファイル> exec -T db psql -U <管理者> -d postgres'
#
# 作るもの:
#   - ロール infra_supra_admin（migration の DDL。DATABASE の持ち主）
#   - ロール infra_supra_server（常駐のサーバー。results への SELECT・INSERT だけ）
#   - DATABASE infra_supra（ほかの DATABASE とは分ける）
# 🔒 パスワードはここで尋ね、引数にもファイルにも残さない（SQL は標準入力で psql に渡す）。
# 切り戻し（作り直したいとき。データも消える）:
#   DROP DATABASE infra_supra; DROP ROLE infra_supra_server; DROP ROLE infra_supra_admin;
set -eu

: "${PSQL:?PSQL に psql のコマンドを入れてください（このファイルの先頭を参照）}"

if [ "${1:-}" = "--check" ]; then
  $PSQL -v ON_ERROR_STOP=1 <<'SQL'
select rolname as role from pg_roles where rolname in ('infra_supra_admin', 'infra_supra_server');
select datname as database from pg_database where datname = 'infra_supra';
SQL
  exit 0
fi

ask() {
  printf '%s' "$1" >&2
  stty -echo 2>/dev/null || true
  read -r v
  stty echo 2>/dev/null || true
  printf '\n' >&2
  [ -n "$v" ] || { echo '空のパスワードは使えません' >&2; exit 1; }
  # SQL の文字列に入れるので ' を重ねる
  printf '%s' "$v" | sed "s/'/''/g"
}

ADMIN_PW=$(ask 'infra_supra_admin のパスワード: ')
SERVER_PW=$(ask 'infra_supra_server のパスワード: ')

printf 'infra_supra の DATABASE と 2 つのロールを作ります。よいですか [y/N] ' >&2
read -r ok
[ "$ok" = "y" ] || { echo 'やめました' >&2; exit 1; }

$PSQL -v ON_ERROR_STOP=1 <<SQL
create role infra_supra_admin login password '${ADMIN_PW}';
create role infra_supra_server login password '${SERVER_PW}';
create database infra_supra owner infra_supra_admin;
revoke all on database infra_supra from public;
grant connect on database infra_supra to infra_supra_server;
\connect infra_supra
-- migration（infra_supra_admin が作る表）に、常駐のサーバーが読み書きだけできるようにする（DDL・UPDATE・DELETE は無し）
revoke create on schema public from public;
grant usage on schema public to infra_supra_server;
alter default privileges for role infra_supra_admin in schema public grant select, insert on tables to infra_supra_server;
alter default privileges for role infra_supra_admin in schema public grant usage on sequences to infra_supra_server;
SQL

echo '作りました。次は migration を流します（prd/15 §7.1）。' >&2
