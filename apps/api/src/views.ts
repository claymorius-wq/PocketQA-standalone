// The view layer, split by domain owner (docs/plans/firebase-vercel-refactor.md §11):
//   core (lead): users, audit · studies (pqa-be1) · evidence (pqa-be2) · escrow (pqa-be3).
// This barrel keeps every existing import working.
export * from './views/core';
export * from './views/studies';
export * from './views/evidence';
export * from './views/escrow';
