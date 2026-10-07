import { z } from 'zod';

// Imported FIRST by index.ts, before any schema is created or parsed. Zod's JIT probes with
// `new Function('')`, and under the app's strict CSP (script-src 'self', no 'unsafe-eval') every page
// load then reports a securitypolicyviolation even though zod catches the throw (pqa-be2 hosted
// rehearsal, 2492203). Jitless parsing is the same validation without generated code; never add
// 'unsafe-eval' to the CSP instead.
z.config({ jitless: true });
