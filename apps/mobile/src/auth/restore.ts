type Flags = { get(): Promise<string | null>; set(v: string): Promise<void> };
type Tokens = { get(): Promise<string | null>; clear(): Promise<void> };

/**
 * The iOS keychain survives app uninstall (and Maestro's clearState), so a reinstalled app
 * would silently sign in as whoever used it before. The install marker lives in app storage,
 * which is wiped with the app: if it is missing, this is a fresh install and any leftover
 * keychain session is dropped instead of restored.
 */
export async function restoreToken(flags: Flags, tokens: Tokens): Promise<string | null> {
  if ((await flags.get()) !== '1') {
    await tokens.clear();
    await flags.set('1');
    return null;
  }
  return tokens.get();
}
