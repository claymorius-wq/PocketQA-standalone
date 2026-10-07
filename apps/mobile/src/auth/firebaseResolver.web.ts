import { browserPopupRedirectResolver } from 'firebase/auth';

/**
 * Web: Google sign-in opens a popup, which `initializeAuth` can only do when it is given the
 * browser resolver (without it, signInWithPopup rejects at once: the live "didn't complete"
 * with no popup, Hamza's report 2026-10-06).
 */
export const popupRedirectResolver = browserPopupRedirectResolver;
