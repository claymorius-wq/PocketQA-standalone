/**
 * The e2e API's address. 127.0.0.1:8787 by default; PQA_E2E_API_PORT moves the whole run (API,
 * web export and specs) elsewhere, so the gate can run while a USB-testing API holds 8787.
 */
export const API_PORT = process.env.PQA_E2E_API_PORT ?? '8787';
if (!/^\d{4,5}$/.test(API_PORT)) throw new Error('PQA_E2E_API_PORT must be a port number');
export const API = `http://127.0.0.1:${API_PORT}`;
