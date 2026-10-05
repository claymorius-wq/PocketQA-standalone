/**
 * Browser storage for specs that start past the intro. Welcome opens once per browser on a first
 * visit to "/" (src/onboarding/intro.ts), so every spec that expects Sign in at "/" runs with the
 * intro already seen; e2e/intro.spec.ts opts out to test the intro itself.
 */
export function introSeen(origin: string) {
  return { cookies: [], origins: [{ origin, localStorage: [{ name: 'pocketqa.introSeen', value: '1' }] }] };
}
