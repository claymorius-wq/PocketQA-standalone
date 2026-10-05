import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

// The intro (Welcome): a first visit to "/" opens it once; every way out lands on Sign in or
// Create an account, and the next visit goes straight to Sign in. These specs start with empty
// browser storage (the config starts every other spec past the intro, e2e/introSeen.ts).
const FRESH = { cookies: [], origins: [] };
test.use({ storageState: FRESH });

const GROUND = { dark: 'rgb(11, 10, 31)', light: 'rgb(246, 246, 244)' } as const;

const closers: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** A page in its own fresh context; the context closes when the test ends. */
async function fresh(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ storageState: FRESH, ...options });
  closers.push(() => context.close());
  return context.newPage();
}

test('a first visit walks through the intro to Sign in, and the next visit skips it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  // The opening title is one heading, however its words arrive.
  await expect(page.getByRole('heading', { name: 'Usability tests on real phones' })).toBeVisible();
  await expect(page.getByTestId('intro-label')).toHaveText('POCKET QA');
  await page.getByTestId('intro-next').click();
  await expect(page.getByTestId('intro-label')).toHaveText('FOR TESTERS');
  await page.getByTestId('intro-next').click();
  await expect(page.getByTestId('intro-label')).toHaveText('FOR BUILDERS');
  // The last page: Create an account, and Sign in in the corner where Skip was.
  await expect(page.getByTestId('intro-skip')).toHaveCount(0);
  await expect(page.getByTestId('intro-get-started')).toHaveText(/Create an account/);
  await page.getByTestId('intro-sign-in').click();
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
});

test('a swipe moves the pages; Skip goes to Sign in; Create an account opens Sign up over the intro', async ({ browser }) => {
  const swipe = await fresh(browser);
  await swipe.goto('/');
  const pager = swipe.getByTestId('intro-pager');
  await pager.hover();
  await swipe.mouse.wheel(260, 0);
  await expect(swipe.getByTestId('intro-label')).toHaveText('FOR TESTERS');
  await swipe.getByTestId('intro-skip').click();
  await expect(swipe.getByTestId('sign-in-screen')).toBeVisible();

  const join = await fresh(browser);
  await join.goto('/');
  // The dots open a page directly.
  await join.getByTestId('intro-dot-2').click();
  await join.getByTestId('intro-get-started').click();
  await expect(join.getByTestId('sign-up-screen')).toBeVisible();
  // Back returns to the intro's last page (Sign up opened over it), not out of the app.
  await join.goBack();
  await expect(join.getByTestId('welcome-screen')).toBeVisible();
  await expect(join.getByTestId('intro-label')).toHaveText('FOR BUILDERS');
});

// Safari on a 390 × 844 iPhone leaves about 664 px with its toolbars; an iPhone SE about 548.
test('on a short screen every page starts below the top row, fits at 664, and scrolls to its last step at 548', async ({ browser }) => {
  for (const [width, height] of [[390, 664], [375, 548]] as const) {
    const page = await fresh(browser, { viewport: { width, height } });
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
    for (const [i, key] of (['welcome', 'testers', 'builders'] as const).entries()) {
      if (i > 0) {
        await page.getByTestId(`intro-dot-${i}`).click();
        await expect(page.getByTestId('intro-label')).toHaveText(['POCKET QA', 'FOR TESTERS', 'FOR BUILDERS'][i]!);
      }
      const frame = (await page.getByTestId('intro-pager-frame').boundingBox())!;
      const dock = (await page.getByTestId('screen-dock').boundingBox())!;
      const title = (await page.getByTestId(`intro-page-${key}`).getByRole('heading').boundingBox())!;
      expect(title.y, `${key} at ${width}x${height}: the title is never cut at the top`).toBeGreaterThanOrEqual(frame.y);
      const last = page.getByTestId(`intro-page-${key}`).locator('[dir="auto"]').last();
      if (height >= 664) {
        // It fits as it is: the last line ends above the dock.
        const box = (await last.boundingBox())!;
        expect(box.y + box.height, `${key} fits at ${width}x${height}`).toBeLessThanOrEqual(dock.y);
      } else {
        // Taller than the room: the page scrolls, and its last line can be brought above the dock.
        await last.scrollIntoViewIfNeeded();
        const box = (await last.boundingBox())!;
        expect(box.y + box.height, `${key} scrolls into view at ${width}x${height}`).toBeLessThanOrEqual(dock.y);
      }
    }
  }
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
    const page = await fresh(browser, { colorScheme: scheme });
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

test("the browser's bars follow the app's own theme, not only the system's", async ({ browser, baseURL }) => {
  // The system is dark, but the app is set to light: only the app's script can paint light.
  const page = await fresh(browser, {
    colorScheme: 'dark',
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL!).origin, localStorage: [{ name: 'pocketqa.theme', value: 'light' }] }] },
  });
  await page.goto('/sign-in');
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();
  await expect.poll(async () => (await chrome(page)).html).toBe(GROUND.light);
  const c = await chrome(page);
  expect(c.body).toBe(GROUND.light);
  for (const color of c.themeColors) expect(color).toBe('#f6f6f4');
});
