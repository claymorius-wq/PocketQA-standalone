// Hamza's hosted report: "Continue with Google" failed instantly with no popup and no request.
// Root cause: initializeAuth without a popupRedirectResolver, so signInWithPopup rejected before
// opening anything (auth/argument-error). On web the client must pass the browser resolver.
// QA google-button r2 P2-G1: but NOT at initializeAuth, which makes Firebase preload Google's gapi
// (apis.google.com) for every visitor, so a Google-off site's CSP blocks it. The resolver goes to
// signInWithPopup alone: gapi loads only when someone presses the Google button.
const mockInit = jest.fn((_app: unknown, _opts: Record<string, unknown>) => ({}) as unknown);
const mockPopup = jest.fn((..._args: unknown[]) => Promise.resolve({}));
const mockResolver = { resolver: 'browserPopupRedirectResolver' };
jest.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({ name: 'pocketqa' }) }));
jest.mock('firebase/auth', () => ({
  initializeAuth: (app: unknown, opts: Record<string, unknown>) => mockInit(app, opts),
  connectAuthEmulator: jest.fn(),
  signInWithPopup: (...args: unknown[]) => mockPopup(...args),
  GoogleAuthProvider: class GoogleAuthProvider {},
  browserPopupRedirectResolver: mockResolver,
  browserSessionPersistence: { type: 'SESSION' },
}));
jest.mock('../src/auth/firebaseResolver', () => jest.requireActual('../src/auth/firebaseResolver.web'));
jest.mock('../src/auth/firebasePersistence', () => ({ firebasePersistence: () => ({ type: 'SESSION' }) }));


it('web: Auth is initialised WITHOUT the popup resolver (no gapi preload for every visitor)', () => {
  // Required here, not imported: the mocks above must be initialised before the client loads.
  const { firebaseAuth } = jest.requireActual<typeof import('../src/auth/firebaseClient')>('../src/auth/firebaseClient');
  firebaseAuth({ apiKey: 'k', authDomain: 'pocketqa-optijara.firebaseapp.com', projectId: 'pocketqa-optijara', authEmulatorUrl: null, googleSignIn: true });
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockInit.mock.calls[0]![1]).not.toHaveProperty('popupRedirectResolver');
});

it('web: Google sign-in passes the browser resolver to signInWithPopup, so the popup opens on the click', async () => {
  const { firebaseSession } = jest.requireActual<typeof import('../src/auth/firebaseClient')>('../src/auth/firebaseClient');
  const auth = { name: 'auth' };
  await firebaseSession.googleSignIn(auth as never);
  expect(mockPopup).toHaveBeenCalledTimes(1);
  expect(mockPopup.mock.calls[0]![0]).toBe(auth);
  expect(mockPopup.mock.calls[0]![2]).toBe(mockResolver);
});

it('native: no popup resolver (the default module exports none)', () => {
  expect(jest.requireActual('../src/auth/firebaseResolver').popupRedirectResolver).toBeUndefined();
});
