import type { AuditEntry, DeviceProfile, User } from '@pocket-qa/contracts';
import type { z } from 'zod';

import type { DB } from '../db';


export type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  role: 'tester' | 'builder' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  device_json: string | null;
  created_at: string;
};

export function userView(db: DB, row: UserRow): User {
  const link = db.prepare('SELECT address, linked_at FROM wallet_links WHERE user_id = ?').get(row.id) as
    | { address: string; linked_at: string }
    | undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    device: row.device_json ? (JSON.parse(row.device_json) as DeviceProfile) : null,
    wallet: link ? { address: link.address, cluster: 'devnet', linkedAt: link.linked_at } : null,
    createdAt: row.created_at,
  };
}

type AuditRow = { id: string; actor_id: string; action: string; target_type: 'study' | 'user' | 'dispute' | 'participation' | 'storage_object'; target_id: string; reason: string; created_at: string };

export function auditView(row: AuditRow): z.infer<typeof AuditEntry> {
  return { id: row.id, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, reason: row.reason, createdAt: row.created_at };
}
