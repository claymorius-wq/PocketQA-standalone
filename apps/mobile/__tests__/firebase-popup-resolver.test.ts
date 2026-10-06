// Hamza's hosted report: "Continue with Google" failed instantly with no popup and no request.
// Root cause: initializeAuth without a popupRedirectResolver, so signInWithPopup rejected before
// opening anything (auth/argument-error). On web the client must pass the browser resolver.
const mockInit = jest.fn((_app: unknown, _opts: Record<string, unknown>) => ({}) as unknown);
const mockResolver = { resolver: 'browserPopupRedirectResolver' };
jest.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({ name: 'pocketqa' }) }));
jest.mock('firebase/auth', () => ({
  initializeAuth: (app: unknown, opts: Record<string, unknown>) => mockInit(app, opts),
  connectAuthEmulator: jest.fn(),
  browserPopupRedirectResolver: mockResolver,
  browserSessionPersistence: { type: 'SESSION' },
}));
jest.mock('../src/auth/firebaseResolver', () => jest.requireActual('../src/auth/firebaseResolver.web'));
jest.mock('../src/auth/firebasePersistence', () => ({ firebasePersistence: () => ({ type: 'SESSION' }) }));


it('web: Auth is initialised with the browser popup resolver, so Google sign-in can open its popup', () => {
  // Required here, not imported: the mocks above must be initialised before the client loads.
  const { firebaseAuth } = jest.requireActual<typeof import('../src/auth/firebaseClient')>('../src/auth/firebaseClient');
  firebaseAuth({ apiKey: 'k', authDomain: 'pocketqa-optijara.firebaseapp.com', projectId: 'pocketqa-optijara', authEmulatorUrl: null, googleSignIn: true });
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockInit.mock.calls[0]![1]).toMatchObject({ popupRedirectResolver: mockResolver });
});

it('native: no popup resolver (the default module exports none)', () => {
  expect(jest.requireActual('../src/auth/firebaseResolver').popupRedirectResolver).toBeUndefined();
});
