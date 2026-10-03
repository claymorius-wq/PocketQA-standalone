import { Platform } from 'react-native';

/**
 * Shared public demo preview only (ADR 0004, convenience addendum). The preview web build
 * sets EXPO_PUBLIC_PREVIEW=1; every other build (native, local web) has this off and never
 * fetches anything. No credential is ever compiled in: the demo sign-ins come at runtime
 * from the preview gate, which serves them only after the gate has been passed.
 */
export const PREVIEW_BUILD = process.env.EXPO_PUBLIC_PREVIEW === '1';
export const BOOTSTRAP_PATH = '/__preview/bootstrap.json';

export type DemoRole = 'tester' | 'builder' | 'admin';
export type DemoAccount = { role: DemoRole; email: string; password: string };
const ROLES: DemoRole[] = ['tester', 'builder', 'admin'];
// Only the seeded synthetic accounts can ever be filled in, whatever the server sends.
const SYNTHETIC = /^demo-(tester|builder|admin)@pocketqa\.example$/;

export function parseBootstrap(data: unknown): DemoAccount[] {
  const list = (data as { demoAccounts?: unknown } | null)?.demoAccounts;
  if (!Array.isArray(list)) return [];
  const out: DemoAccount[] = [];
  for (const a of list as Record<string, unknown>[]) {
    const role = a?.role as DemoRole;
    if (!ROLES.includes(role) || typeof a.email !== 'string' || typeof a.password !== 'string') continue;
    if (!SYNTHETIC.test(a.email) || a.email !== `demo-${role}@pocketqa.example` || a.password.length < 12) continue;
    if (out.some((x) => x.role === role)) continue;
    out.push({ role, email: a.email, password: a.password });
  }
  return ROLES.flatMap((r) => out.filter((a) => a.role === r));
}

export async function loadDemoAccounts(opts: { enabled?: boolean; fetchImpl?: typeof fetch } = {}): Promise<DemoAccount[]> {
  const enabled = opts.enabled ?? (PREVIEW_BUILD && Platform.OS === 'web');
  if (!enabled) return [];
  try {
    const res = await (opts.fetchImpl ?? fetch)(BOOTSTRAP_PATH, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return [];
    return parseBootstrap(await res.json());
  } catch {
    return [];
  }
}
