import { expect, test } from '@playwright/test';

// Phase 7 acceptance through the UI: export, then typed-confirmation deletion; the account
// can't sign in afterwards.
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';

test('tester exports data, deletes the account with a typed confirmation, and cannot sign in again', async ({ page }) => {
  const email = `delete-${run}@example.test`;
  await page.goto('/sign-up');
  await page.getByTestId('role-tester').click();
  await page.getByTestId('sign-up-name').fill('Dana');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();

  await page.getByTestId('tab-settings').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-data').click();
  expect((await download).suggestedFilename()).toBe('pocket-qa-export.json');
  await expect(page.getByTestId('export-done')).toBeVisible();

  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('confirm-ok')).toBeDisabled();
  await page.getByTestId('delete-phrase').fill('delete');
  await expect(page.getByTestId('confirm-ok')).toBeDisabled();
  await page.getByTestId('delete-phrase').fill('DELETE MY ACCOUNT');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();

  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-error')).toContainText('incorrect');
});
