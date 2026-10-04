import { expect, test } from '@playwright/test';

// Managed identity in the browser against the Firebase Auth emulator and the real API in
// firebase mode: sign-up sends verification, the account is created only after the email
// is verified and the user explicitly picks a role, and the session survives a reload.
const EMU = 'http://127.0.0.1:9099';
const PROJECT = 'demo-pocketqa';
const pw = 'correct horse battery staple';

async function verifyEmail(email: string) {
  // The emulator records the verification email; following its link verifies the address.
  const codes = (await (await fetch(`${EMU}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] };
  const code = codes.oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').pop();
  if (!code) throw new Error('no verification email recorded');
  const res = await fetch(code.oobLink);
  if (!res.ok) throw new Error(`verify link → ${res.status}`);
}

test('email sign-up → verify → sign in → choose a role → app; the session survives a reload', async ({ page }) => {
  const email = `fb-${Date.now()}@example.test`;
  await page.goto('/sign-up');
  await page.getByTestId('sign-up-name').fill('Fiona Firebase');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-verify')).toContainText('Check your email');
  // The instructions are the notice's own body text: bare text in a View showed in the browser's
  // default black (and is not drawn at all on native).
  const verifyBody = page.getByTestId('sign-up-verify').getByText(/We sent a verification link to/);
  await expect(verifyBody).toBeVisible();
  expect(await verifyBody.evaluate((e) => getComputedStyle(e).color)).not.toBe('rgb(0, 0, 0)');

  // Not verified yet: signing in is refused with an actionable message.
  await page.goto('/sign-in');
  // Honest about where data lives on a managed-identity deployment (review r1 P2).
  await expect(page.getByText('Sign-in is managed by Firebase · evidence is stored on the Pocket QA server')).toBeVisible();
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-error')).toContainText('Verify your email');

  await verifyEmail(email);
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('finish-account')).toContainText('Finish your account');
  // Prefilled from what was typed at sign-up (review r1 P3): no re-typing.
  await expect(page.getByTestId('finish-name')).toHaveValue('Fiona Firebase');
  await page.getByTestId('finish-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
});

test('the API refuses local password sign-in in firebase mode (one account system)', async ({ request }) => {
  const r = await request.post('http://127.0.0.1:8787/auth/login', { data: { email: 'x@example.test', password: pw } });
  expect(r.status()).toBe(409);
  const cfg = await (await request.get('http://127.0.0.1:8787/config')).json();
  expect(cfg).toMatchObject({ authMode: 'firebase', firebase: { projectId: PROJECT, authEmulatorUrl: 'http://127.0.0.1:9099' } });
});

async function oob(email: string, requestType: 'VERIFY_EMAIL' | 'PASSWORD_RESET') {
  const codes = (await (await fetch(`${EMU}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()) as { oobCodes: { email: string; requestType: string; oobCode: string }[] };
  return codes.oobCodes.filter((c) => c.email === email && c.requestType === requestType);
}

test('an unverified user can resend the verification email from sign-in (ledger I4)', async ({ page }) => {
  const email = `fb-resend-${Date.now()}@example.test`;
  await page.goto('/sign-up');
  await page.getByTestId('sign-up-name').fill('Rita Resend');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-verify')).toBeVisible();
  expect(await oob(email, 'VERIFY_EMAIL')).toHaveLength(1);

  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-error')).toContainText('Verify your email');
  await page.getByTestId('resend-verification').click();
  await expect(page.getByTestId('sign-in-notice')).toContainText('new verification link');
  expect(await oob(email, 'VERIFY_EMAIL')).toHaveLength(2);
  // Signed out of Firebase afterwards: the resend button is gone until the next refused sign-in.
  await expect(page.getByTestId('resend-verification')).toHaveCount(0);
});

test('password reset: same answer for known and unknown emails; the link really resets (ledger I4)', async ({ page }) => {
  const email = `fb-reset-${Date.now()}@example.test`;
  await page.goto('/sign-up');
  await page.getByTestId('sign-up-name').fill('Rob Reset');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-verify')).toBeVisible();

  const ask = async (address: string) => {
    await page.goto('/sign-in');
    await page.getByTestId('sign-in-email').fill(address);
    await page.getByTestId('forgot-password').click();
    await page.getByTestId('forgot-password').click();
    return (await page.getByTestId('sign-in-notice').textContent()) ?? '';
  };
  const known = await ask(email);
  const unknown = await ask(`nobody-${Date.now()}@example.test`);
  expect(known).toContain('If an account uses this email');
  expect(unknown).toBe(known);

  // Follow the emulator's reset code, set a new password, and sign in with it.
  const [code] = await oob(email, 'PASSWORD_RESET');
  if (!code) throw new Error('no reset email recorded');
  const newPw = 'a brand new long passphrase';
  const res = await fetch(`${EMU}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-web-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oobCode: code.oobCode, newPassword: newPw }),
  });
  expect(res.ok).toBe(true);
  await verifyEmail(email);
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(newPw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('finish-account')).toBeVisible();
});
