# infra-supra（仮称）

実在するクラウド／ホスティングの料金体系で、Web アプリのインフラ構成ごとの月額費用と性能上の制約を比べる見積ツールと、
同じ計算エンジンを使うインフラ運営シミュレーションゲーム。

- 状態: 設計中（Phase 0）。計算エンジン（Phase 1）は未着手。
- 仕様: [prd/README.md](./prd/README.md) / 開発ガイド: [AGENTS.md](./AGENTS.md)

- clone 後は `pnpm hooks:install` を一度実行（push 前の秘密の検査 Betterleaks。詳細は AGENTS.md）。

> 表示される金額は公開料金表に基づく**概算**です。税・為替・割引・契約条件は含みません。
