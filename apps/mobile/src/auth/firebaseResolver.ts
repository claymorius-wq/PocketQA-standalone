import type { PopupRedirectResolver } from 'firebase/auth';

/** Native: no popup or redirect sign-in (Google sign-in is offered on web only). */
export const popupRedirectResolver: PopupRedirectResolver | undefined = undefined;
