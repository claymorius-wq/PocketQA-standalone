export const credits = (n: number) => `${n.toLocaleString('en-US')} test credit${n === 1 ? '' : 's'}`;

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const statusLabel: Record<string, string> = {
  consented: 'Consented',
  in_progress: 'In progress',
  submitted: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  disputed: 'Disputed',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
