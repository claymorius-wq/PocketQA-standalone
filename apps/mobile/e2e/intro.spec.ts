import { expect, test, type Page } from '@playwright/test';

// The intro (Welcome): a first visit to "/" opens it once; every way out lands on Sign in or
// Create an account, and the next visit goes straight to Sign in. These specs start with empty
// browser storage (the config starts every other spec past the intro, e2e/introSeen.ts).
const FRESH = { cookies: [], origins: [] };
test.use({ storageState: FRESH });

const GROUND = { dark: 'rgb(11, 10, 31)', light: 'rgb(246, 246, 244)' } as const;

test('a first visit walks through the intro to Sign in, and the next visit skips it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await expect(page.getByTestId('intro-label')).toHaveText('POCKET QA');
  await page.getByTestId('intro-next').click();
  await expect(page.getByTestId('intro-label')).toHaveText('FOR TESTERS');
  await page.getByTestId('intro-next').click();
  await expect(page.getByTestId('intro-label')).toHaveText('FOR BUILDERS');
  await expect(page.getByTestId('intro-skip')).toHaveCount(0);
  await expect(page.getByTestId('intro-get-started')).toHaveText(/Create an account/);
  await page.getByTestId('intro-sign-in').click();
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
});

test('Skip goes straight to Sign in, and Create an account opens sign-up', async ({ browser }) => {
  const skip = await (await browser.newContext({ storageState: FRESH })).newPage();
  await skip.goto('/');
  await skip.getByTestId('intro-skip').click();
  await expect(skip.getByTestId('sign-in-screen')).toBeVisible();

  const join = await (await browser.newContext({ storageState: FRESH })).newPage();
  await join.goto('/');
  // The dots open a page directly.
  await join.getByTestId('intro-dot-2').click();
  await join.getByTestId('intro-get-started').click();
  await expect(join.getByTestId('sign-up-screen')).toBeVisible();
});

async function chrome(page: Page) {
  return page.evaluate(() => ({
    themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')?.toLowerCase()),
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  }));
}

for (const scheme of ['dark', 'light'] as const) {
  test(`the page and the browser's bars take the ground, and content starts near the top (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: FRESH, colorScheme: scheme })).newPage();
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    const c = await chrome(page);
    // No white around the app: Safari's status bar and toolbar, and overscroll, show the ground.
    expect(c.html).toBe(GROUND[scheme]);
    expect(c.body).toBe(GROUND[scheme]);
    expect(c.themeColors.length).toBeGreaterThan(0);
    for (const color of c.themeColors) expect(color).toBe(scheme === 'dark' ? '#0b0a1f' : '#f6f6f4');
    expect(c.viewport).toContain('viewport-fit=cover');
    // In a browser tab the page starts below the browser's own status bar, so no 44px band is
    // reserved above the brand row (it was 58 before; now the band is 10 and the row sits at 24).
    const label = await page.getByText('POCKET QA', { exact: true }).first().boundingBox();
    expect(label?.y ?? 999).toBeLessThan(64);
  });
}
