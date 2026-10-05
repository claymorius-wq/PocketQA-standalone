#!/usr/bin/env node
// Secret scan over every file git would commit (tracked + untracked, minus ignored).
// Exit 1 on any finding. A line can opt out with the marker `check-secrets: allow`;
// the marker covers only its own line and is reserved for deliberate, non-secret
// test fixtures that reviewers check one by one.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOW_MARKER = 'check-secrets: allow';
const MAX_BYTES = 8 * 1024 * 1024;

// Identifier fragments that name a credential. Matched case-insensitively anywhere
// inside an identifier, so dbPassword, DB_PASSWORD and SOLANA_PRIVATE_KEY all count.
const CRED_WORD = '(?:password|passwd|secret|api_?key|access_?token|auth_?token|refresh_?token|private_?key|client_?secret|_authtoken)';

const LINE_RULES = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/ },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'anthropic-or-openai-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'bearer-literal', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
  // Base58 Solana secret keys (64 bytes → 87/88 chars). Transaction signatures have the
  // same shape, so fixtures that need one must build it at runtime or use the marker.
  { id: 'base58-secret-key', re: /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{86,88}(?![1-9A-HJ-NP-Za-km-z])/ },
  // Quoted single-token literal assigned to a credential-named identifier.
  {
    id: 'hardcoded-credential',
    re: new RegExp(`[A-Za-z0-9_$]*${CRED_WORD}[A-Za-z0-9_]*['"]?\\s*[:=]\\s*['"\`][^'"\`\\s]{12,}['"\`]`, 'i'),
  },
  // .env / shell style: NAME=value with no quotes.
  {
    id: 'env-style-credential',
    re: new RegExp(`^\\s*(?:export\\s+)?[A-Za-z0-9_]*${CRED_WORD}[A-Za-z0-9_]*\\s*=\\s*[^'"\\s#\`$]{12,}`, 'i'),
  },
];

// Solana CLI keypair files are JSON arrays of 64 byte values, often pretty-printed.
const KEYPAIR_ARRAY = /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/;

const FORBIDDEN_PATHS = [
  /(^|\/)\.env(?!\.example$)[^/]*$/,
  /\.(pem|key|p12|p8|keystore|jks|mobileprovision)$/,
  /(^|\/)id\.json$/,
  /keypair[^/]*\.json$/i,
  /(^|\/)credentials[^/]*\.json$/i,
  /(^|\/)google-services\.json$/,
  /(^|\/)GoogleService-Info\.plist$/,
  /\.(sqlite3?|db)(-[a-z]+)?$/,
  /(^|\/)\.data\//,
  // Protected preview: generated gate secret, credentials and synthetic data (ADR 0004).
  /(^|\/)\.preview\//,
  /(^|\/)preview-data\//,
  /(^|\/)\.preview-test\//,
  // Local cloud-integration material (ADR 0005): web config, server credentials.
  /(^|\/)\.cloud-local\//,
];

// Public on-chain evidence pinned by content hash: the Squads devnet pilot receipts list base58
// TRANSACTION SIGNATURES, which have the same shape as a base58 secret key (each was read back
// from devnet as a finalized transaction; see the receipts and the pilot readback). For these exact
// bytes only the base58-secret-key rule is skipped; every other rule still runs, and any edit to
// the file changes its hash and brings every finding back. Each entry is reviewed by pqa-qa.
export const PINNED_EVIDENCE = new Map([
  ['docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.json', '5fa8fa93b066572ba82c3134097374f34335bae453186a59c3dd005d8df84422'],
  ['docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.md', '373a8ca53f5415de6d7cef2c3d614aec4db3a580cdd2f9c803bd5b0c1651e4c2'],
  ['docs/reviews/wallet-rewards/devnet-pilot-run1-readback.json', '5702cddd8e5f9aee7043bdd939b0867cd9258501958af8b69044d715103a22e5'],
  ['docs/reviews/wallet-rewards/devnet-pilot-run1-completion.json', '2bde52405b81627788e21f039a8734341a5bc39e8f3d306d750d9562ba91d14a'],
  ['docs/reviews/wallet-rewards/devnet-pilot-run1-completion.md', '147f7cca1f00ab85604307a309bacc7e4f79f3922610405c45c8588ef8461998'],
  // pqa-qa's live verdict r2, an exact copy: its one long token is the completion signature.
  ['docs/reviews/wallet-rewards/qa-devnet-pilot-live-verdict-r2.md', 'a2828474b409f67c0a3c0d3cb3f94cd5e13d1195c2e5dbdb615f3ca8fc6d8cb8'],
]);

/** Rules skipped for this file's exact content (none unless it is pinned evidence with that hash). */
export function pinnedSkips(file, buf, pins = PINNED_EVIDENCE) {
  const want = pins.get(file);
  return want && createHash('sha256').update(buf).digest('hex') === want ? ['base58-secret-key'] : [];
}

export function scanText(text, { skipRules = [] } = {}) {
  const hits = [];
  const kept = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    kept.push(line);
    for (const rule of LINE_RULES) {
      if (skipRules.includes(rule.id)) continue;
      if (rule.re.test(line)) hits.push({ line: i + 1, rule: rule.id });
    }
  });
  if (KEYPAIR_ARRAY.test(kept.join(' ').replace(/\s+/g, ' '))) hits.push({ line: 0, rule: 'solana-keypair-array' });
  return hits;
}

export function isForbiddenPath(file) {
  return FORBIDDEN_PATHS.some((re) => re.test(file));
}

function listFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf8',
  });
  return [...new Set(out.split('\0').filter(Boolean))];
}

export function scanRepo(cwd = process.cwd()) {
  const findings = [];
  const files = listFiles(cwd);
  for (const file of files) {
    if (isForbiddenPath(file)) {
      findings.push(`${file}: forbidden-path (secret- or data-bearing file must stay untracked)`);
      continue;
    }
    let st;
    try {
      st = statSync(`${cwd}/${file}`);
    } catch {
      continue; // deleted in working tree
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) {
      findings.push(`${file}: too-large-to-scan (${st.size} bytes; keep large blobs out of git)`);
      continue;
    }
    const buf = readFileSync(`${cwd}/${file}`);
    if (buf.includes(0)) continue; // binary; data files are caught by FORBIDDEN_PATHS
    for (const hit of scanText(buf.toString('utf8'), { skipRules: pinnedSkips(file, buf) })) findings.push(`${file}:${hit.line}: ${hit.rule}`);
  }
  return { scanned: files.length, findings };
}

function main() {
  const { scanned, findings } = scanRepo();
  if (findings.length) {
    // Print locations and rule ids only, never the matched value.
    console.error(`check:secrets FAILED (${findings.length} finding(s) in ${scanned} files):`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`check:secrets passed: ${scanned} committable files scanned, no findings.`);
}

// realpath + pathToFileURL so symlinked or percent-encoded paths still run main().
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
