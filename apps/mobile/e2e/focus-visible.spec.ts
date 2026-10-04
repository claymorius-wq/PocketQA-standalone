import { expect, test, type Page } from '@playwright/test';

// Keyboard focus never comes to rest under the stack header's scrim or under a screen's dock on the
// web build (WCAG 2.2 SC 2.4.11, Focus Not Obscured). New study is the long form with both: the
// header scrim over the top of its scroll area and the Save draft dock over the bottom. Tab walks
// down the whole form and Shift+Tab walks back up, in both themes.
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';

async function signUpBuilder(page: Page, name: string) {
  await page.goto('/sign-up');
  await page.getByTestId('role-builder').click();
  await page.getByTestId('sign-up-name').fill(name);
  await page.getByTestId('sign-up-email').fill(`${name.toLowerCase()}-${run}@example.test`);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
}

/** The focused control against the header scrim's end and the dock's top edge, when it is in the screen's scroll content. */
async function focusPlace(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const root = document.querySelector('[data-testid="new-study-screen"]');
    if (!el || !root || !root.contains(el)) return null;
    const r = el.getBoundingClientRect();
    const scrim = document.querySelector('[data-testid="header-scrim"]')?.getBoundingClientRect();
    const dock = document.querySelector('[data-testid="screen-dock"]')?.getBoundingClientRect();
    return {
      name: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName,
      top: r.top,
      bottom: r.bottom,
      scrimBottom: scrim ? scrim.bottom : 0,
      dockTop: dock ? dock.top : Number.POSITIVE_INFINITY,
    };
  });
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`keyboard focus never rests under the header scrim or the dock (New study, ${colorScheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme });
    const page = await ctx.newPage();
    await signUpBuilder(page, `Fern${colorScheme}`);
    await expect(page.getByTestId('studies-screen')).toBeVisible();
    await page.getByTestId('new-study').click();
    await expect(page.getByTestId('new-study-screen')).toBeVisible();
    await expect(page.getByTestId('screen-dock')).toBeVisible();
    await page.getByTestId('study-title').focus();
    const walked = new Set<string>();
    for (const key of [...Array<string>(28).fill('Tab'), ...Array<string>(28).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      const p = await focusPlace(page);
      if (!p) continue;
      walked.add(p.name);
      // Wholly between the scrim's end and the dock's top edge (1px for subpixel rounding).
      expect(p.top, `${p.name} (after ${key}) under the header scrim`).toBeGreaterThanOrEqual(p.scrimBottom - 1);
      expect(p.bottom, `${p.name} (after ${key}) under the dock`).toBeLessThanOrEqual(p.dockTop + 1);
    }
    // The walk really went through the form, not a couple of controls.
    expect(walked.size).toBeGreaterThan(8);
    await ctx.close();
  });
}
