// DB のバックアップ・任意の時点への復元（PITR）（D-93・prd/04 §3.9・prd/11 §19）。構成を組み終えた後に、経路に載っている DB の
// ノードごとに、選んだバックアップ（事業者の既定のまま / 保持を延ばす・PITR を付ける）の費用のノード（db-backup）を足す。
// 保持の日数・課金の形は事業者の文書（catalog の料金データの前提の文）、1 行の書き込みが変える量は仮定。
import type { ArchitectureInput } from 'estimator';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** バックアップの部品の選択（スロット dbBackup）。 */
export type BackupChoice = 'default' | 'pitr';

/** 受託の要件「直近 7 日の任意の時点に戻せる」の日数（D-93。ゲームの要件 db-pitr）。 */
export const PITR_REQUIRED_DAYS = 7;

/**
 * 1 行の書き込みが変える量（KB。差分のバックアップ・WAL・バイナリログに残る量）。行の大きさに、索引の更新と
 * ログの見出し・ページの書き出しを足した仮定（ゲーム上の仮定・出典なし）。
 */
export const BACKUP_CHANGE_KB_PER_ROW = 2;

/** VPS の自前のバックアップで残す日次のダンプの数（7 日分。ダンプの大きさは DB と同じとみる。圧縮は数えない・高めの側）。 */
export const SELF_DUMP_COPIES = 7;

type Spec = {
  retentionDays: number;
  fullCopies?: number;
  /** 保持の間の変更（差分・ログ）を数えるか。 */
  changes?: boolean;
  freeUpToDbSize?: boolean;
  minFreeGB?: number;
  addonHours?: boolean;
  /** 課金先（省略は DB のノードと同じプラン）。 */
  billing?: { accountId: string; provider: string; planId: string };
  meter: string;
  label: string;
};

type Level = {
  /** 戻せる期間（日。0 は任意の時点に戻せない）。 */
  pitrDays: number;
  /** 費用のノード（無料・課金なしなら無し）。 */
  spec?: Spec;
  /** 画面の説明（何が残り、何に払うか）。 */
  text: string;
};

type Profile = {
  default: Level;
  pitr?: Level & { selfManaged?: boolean };
};

const RDS: Profile = {
  default: {
    pitrDays: 7,
    spec: {
      retentionDays: 7,
      fullCopies: 1,
      changes: true,
      freeUpToDbSize: true,
      minFreeGB: 20,
      meter: 'backup',
      label: 'RDS の自動バックアップ（保持 7 日）',
    },
    text: 'RDS の自動バックアップ（コンソールの既定 7 日）で、7 日の任意の時点に戻せる。割り当てた容量（20 GiB から）までは無料',
  },
  pitr: {
    pitrDays: 35,
    spec: {
      retentionDays: 35,
      fullCopies: 1,
      changes: true,
      freeUpToDbSize: true,
      minFreeGB: 20,
      meter: 'backup',
      label: 'RDS の自動バックアップ（保持 35 日）',
    },
    text: '保持を最長の 35 日に延ばす。割り当てた容量を超えた分が $0.095 / GB 月',
  },
};

const AURORA: Profile = {
  default: {
    pitrDays: 1,
    text: 'Aurora の自動バックアップは既定で保持 1 日（課金なし）。戻せるのは直近 1 日',
  },
  pitr: {
    pitrDays: 7,
    spec: {
      retentionDays: 7,
      fullCopies: 1,
      changes: true,
      freeUpToDbSize: true,
      meter: 'backup',
      label: 'Aurora の自動バックアップ（保持 7 日）',
    },
    text: '保持を 7 日に延ばす。クラスターの大きさを超えた分が $0.023 / GB 月',
  },
};

const PROFILES: Record<string, Profile> = {
  'aws:rds-postgres-t4g-micro': RDS,
  'aws:aurora-serverless-v2-io': AURORA,
  'aws:dynamodb-on-demand': {
    default: {
      pitrDays: 0,
      text: 'DynamoDB の PITR は既定で無効（任意の時点には戻せない）',
    },
    pitr: {
      pitrDays: 35,
      spec: {
        retentionDays: 35,
        fullCopies: 1,
        meter: 'pitr',
        label: 'DynamoDB の PITR',
      },
      text: 'PITR を有効にする（35 日）。テーブルの大きさに $0.228 / GB 月',
    },
  },
  'aws:aurora-dsql': {
    default: {
      pitrDays: 0,
      text: 'Aurora DSQL は AWS Backup の全体のバックアップだけで、任意の時点への復元の記載が無い',
    },
  },
  'gcp:cloud-sql-f1-micro': {
    default: {
      pitrDays: 7,
      spec: {
        retentionDays: 7,
        fullCopies: 1,
        changes: true,
        meter: 'backup',
        label: 'Cloud SQL の自動バックアップ（7 つ）',
      },
      text: 'Cloud SQL の自動バックアップ（既定 7 つ）と PITR（コンソールの既定で有効・ログ 7 日）。使った量に $0.104 / GiB 月',
    },
  },
  'gcp:firestore-standard': {
    default: {
      pitrDays: 0,
      text: 'Firestore の PITR は既定で無効（任意の時点には戻せない）',
    },
    pitr: {
      pitrDays: 7,
      spec: {
        retentionDays: 7,
        fullCopies: 1,
        meter: 'pitr',
        label: 'Firestore の PITR',
      },
      text: 'PITR を有効にする（7 日）。DB の大きさに 約 $0.195 / GiB 月',
    },
  },
  'supabase:free': {
    default: {
      pitrDays: 0,
      text: 'Supabase Free にはバックアップが無い（自分でデータを書き出す）。PITR は付けられない',
    },
  },
  'supabase:pro-micro': {
    default: {
      pitrDays: 0,
      text: 'Supabase Pro の日次のバックアップ（7 日分）。戻せるのは毎日の 1 時点だけ（任意の時点には戻せない）',
    },
    pitr: {
      pitrDays: 7,
      spec: {
        retentionDays: 7,
        addonHours: true,
        meter: 'pitr',
        label: 'Supabase の PITR（7 日）',
      },
      text: 'PITR（7 日）のアドオンを付け、compute を Small に上げる。1 時間 $0.137 + Small との差額（月 約 $105）',
    },
  },
  'neon:free': {
    default: {
      pitrDays: 0.25,
      text: 'Neon Free の履歴の窓は 6 時間で延ばせない（課金なし）',
    },
  },
  'neon:launch': {
    default: {
      pitrDays: 1,
      spec: {
        retentionDays: 1,
        changes: true,
        meter: 'history',
        label: 'Neon の履歴（窓 1 日）',
      },
      text: 'Neon Launch の履歴の窓は既定 1 日。変更の履歴に $0.20 / GB 月',
    },
    pitr: {
      pitrDays: 7,
      spec: {
        retentionDays: 7,
        changes: true,
        meter: 'history',
        label: 'Neon の履歴（窓 7 日）',
      },
      text: '履歴の窓を最長の 7 日に延ばす。7 日分の変更の履歴に $0.20 / GB 月',
    },
  },
  'd1:workers-paid': {
    default: {
      pitrDays: 30,
      text: 'D1 の Time Travel は常に有効で、直近 30 日の任意の時点に戻せる（追加の費用なし）',
    },
  },
  'd1:workers-free': {
    default: {
      pitrDays: 7,
      text: 'D1 の Time Travel は常に有効で、Free は直近 7 日の任意の時点に戻せる（追加の費用なし）',
    },
  },
  kv: {
    default: {
      pitrDays: 0,
      text: 'KV には過去の時点に戻す仕組みが無い',
    },
  },
};

const VPS: Profile = {
  default: {
    pitrDays: 0,
    text: 'さくらの VPS にはバックアップの機能が無い（自分で取らなければ何も残らない）',
  },
  pitr: {
    pitrDays: 7,
    selfManaged: true,
    spec: {
      retentionDays: 7,
      fullCopies: SELF_DUMP_COPIES,
      changes: true,
      billing: {
        accountId: 'sakura',
        provider: 'sakura-vps',
        planId: 'object-storage',
      },
      meter: 'storage',
      label: '自前のバックアップ（さくらのオブジェクトストレージ）',
    },
    text: '日次のダンプとバイナリログを、さくらのオブジェクトストレージに自分で送る（7 日分）。月 495 円（100 GiB まで込み）と、仕組みを作って見張る手間',
  },
};

/** DB のノードのバックアップの扱い（DB でなければ undefined）。 */
function profileOf(n: ArchNodeIn): Profile | undefined {
  const c = n.config;
  const b = n.billing;
  switch (c.kind) {
    case 'sql-db':
      return c.storesDb === false || !b
        ? undefined
        : PROFILES[`d1:${b.planId}`];
    case 'kv':
      return c.mode === 'db' ? PROFILES.kv : undefined;
    case 'host':
      return c.storesDb === false ? undefined : VPS;
    case 'managed-db':
    case 'request-db':
    case 'processing-db':
      return b ? PROFILES[`${b.provider}:${b.planId}`] : undefined;
    default:
      return undefined;
  }
}

/** 経路に載っている DB のノード（差し替えの途中の移す先は数えない）。 */
function servingDbs(
  arch: ArchitectureInput,
): { node: ArchNodeIn; profile: Profile }[] {
  const routed = new Set(Object.values(arch.routes).flat());
  return arch.nodes.flatMap((node) => {
    const profile = routed.has(node.id) ? profileOf(node) : undefined;
    return profile ? [{ node, profile }] : [];
  });
}

const levelOf = (p: Profile, choice: BackupChoice | string | undefined) =>
  choice === 'pitr' && p.pitr ? p.pitr : p.default;

/** 構成の DB にバックアップの費用のノードを足す（D-93）。choice は部品の dbBackup（省略は既定のまま）。 */
export function withBackups(
  arch: ArchitectureInput,
  choice: string | undefined,
): ArchitectureInput {
  const added: ArchNodeIn[] = servingDbs(arch).flatMap(({ node, profile }) => {
    const s = levelOf(profile, choice).spec;
    if (!s || !node.billing) return [];
    const billing = s.billing ?? {
      accountId: node.billing.accountId,
      provider: node.billing.provider,
      planId: node.billing.planId,
    };
    const resource = s.addonHours ? 'backup-hours' : 'backup-gb-month';
    return [
      {
        id: `${node.id}-backup`,
        label: s.label,
        config: {
          kind: 'db-backup',
          retentionDays: s.retentionDays,
          fullCopies: s.fullCopies ?? 0,
          changeKBPerRow: s.changes ? BACKUP_CHANGE_KB_PER_ROW : 0,
          freeUpToDbSize: s.freeUpToDbSize ?? false,
          minFreeGB: s.minFreeGB ?? 0,
          addonHours: s.addonHours ?? false,
        },
        billing: { ...billing, meters: { [resource]: s.meter } },
      },
    ];
  });
  return added.length ? { ...arch, nodes: [...arch.nodes, ...added] } : arch;
}

/** DB のバックアップの状態（要件のカード・部品の説明に使う。D-93）。 */
export type BackupStatus = {
  dbLabel: string;
  /** 戻せる期間（日。0 は任意の時点に戻せない）。 */
  pitrDays: number;
  text: string;
  /** 「保持を延ばす・PITR を付ける」を選べるか（選んで変わるか）。 */
  extendable: boolean;
  /** 自前で取る（VPS。維持の手間がかかる）。 */
  selfManaged: boolean;
};

/** 構成の DB ごとの、選んだバックアップでの状態。 */
export function backupStatus(
  arch: ArchitectureInput,
  choice: string | undefined,
): BackupStatus[] {
  return servingDbs(arch).map(({ node, profile }) => {
    const l = levelOf(profile, choice);
    return {
      dbLabel: node.label,
      pitrDays: l.pitrDays,
      text: l.text,
      extendable: profile.pitr !== undefined,
      selfManaged: l === profile.pitr && (profile.pitr.selfManaged ?? false),
    };
  });
}
