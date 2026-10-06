import type { Evidence } from '@pocket-qa/contracts';


export type EvidenceRow = {
  id: string;
  participation_id: string;
  kind: Evidence['kind'];
  mime_type: Evidence['mimeType'];
  size_bytes: number;
  duration_ms: number | null;
  task_id: string | null;
  captured_on: Evidence['capturedOn'];
  client_segment_id: string;
  storage_key: string;
  created_at: string;
};

export function evidenceView(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    participationId: row.participation_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    taskId: row.task_id,
    capturedOn: row.captured_on,
    createdAt: row.created_at,
  };
}
