import { expect, test, type Page } from '@playwright/test';

// Keyboard focus never comes to rest under the stack header's scrim or under a screen's dock on the
// web build (WCAG 2.2 SC 2.4.11, Focus Not Obscured). New study is the long form with both: the
// header scrim over the top of its scroll area and the Save draft dock over the bottom.
// First the cause: the scroll container's scroll-padding covers the scrim and the dock. Then the
// effect: Tab walks down the whole form and Shift+Tab walks back up, in both themes, and every
// focused control sits wholly between the scrim and the dock frame. A multi-line field brings its
// whole box into view when it takes focus (the kit's Field), so text boxes meet the same rule.
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';
const SCREEN = 'new-study-screen';

async function signUpBuilder(page: Page, name: string) {
  await page.goto('/sign-up');
  await page.getByTestId('role-builder').click();
  await page.getByTestId('sign-up-name').fill(name);
  await page.getByTestId('sign-up-email').fill(`${name.toLowerCase()}-${run}@example.test`);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
}

/**
 * This screen's header scrim, dock frame and scroll container, looked up inside its own ground (so
 * a screen underneath never answers). Throws when one is missing, so a renamed testID fails the
 * test instead of switching a check off.
 */
async function geometry(page: Page) {
  return page.evaluate((screenId) => {
    const root = document.querySelector(`[data-testid="${screenId}"]`);
    if (!root) throw new Error(`no ${screenId}`);
    let ground: Element | null = root;
    while (ground && !ground.querySelector('[data-testid="header-scrim"]')) ground = ground.parentElement;
    const scrim = ground?.querySelector('[data-testid="header-scrim"]');
    const dock = ground?.querySelector('[data-testid="screen-dock"]');
    // New study's ground scrim behind the dock: focus must clear its fade too (Lens follow-ups r1 P3-1).
    const dockScrim = dock?.querySelector('[data-testid="dock-scrim"]');
    if (!scrim) throw new Error('no header-scrim around the screen');
    if (!dock) throw new Error('no screen-dock around the screen');
    if (!dockScrim) throw new Error('no dock-scrim in the dock');
    // The first scrollable element in the screen is its scroll view (text boxes scroll too, but sit inside it).
    const scroller = Array.from(root.querySelectorAll('*')).find((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY));
    if (!scroller) throw new Error('no scroll container in the screen');
    const box = scroller.getBoundingClientRect();
    const css = getComputedStyle(scroller);
    return {
      scrimBottom: scrim.getBoundingClientRect().bottom,
      dockTop: Math.min(dock.getBoundingClientRect().top, dockScrim.getBoundingClientRect().top),
      scrollerTop: box.top,
      scrollerBottom: box.bottom,
      paddingTop: parseFloat(css.scrollPaddingTop) || 0,
      paddingBottom: parseFloat(css.scrollPaddingBottom) || 0,
    };
  }, SCREEN);
}

/** The focused control's box, when it is in the screen's scroll content (not the header's Back or the dock's Save). */
async function focused(page: Page) {
  return page.evaluate((screenId) => {
    const el = document.activeElement;
    const root = document.querySelector(`[data-testid="${screenId}"]`);
    if (!el || !root || !root.contains(el)) return null;
    const r = el.getBoundingClientRect();
    return { name: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName, top: r.top, bottom: r.bottom };
  }, SCREEN);
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`keyboard focus never rests under the header scrim or the dock (New study, ${colorScheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme });
    const page = await ctx.newPage();
    await signUpBuilder(page, `Fern${colorScheme}`);
    await expect(page.getByTestId('studies-screen')).toBeVisible();
    await page.getByTestId('new-study').click();
    await expect(page.getByTestId(SCREEN)).toBeVisible();
    await expect(page.getByTestId('screen-dock')).toBeVisible();

    // The cause: the scroll area keeps the scrim's and the dock's room clear for focus (1px for rounding).
    const g = await geometry(page);
    expect(g.paddingTop, 'scroll-padding-top covers the header scrim').toBeGreaterThanOrEqual(g.scrimBottom - g.scrollerTop - 1);
    expect(g.paddingBottom, 'scroll-padding-bottom covers the dock and its scrim').toBeGreaterThanOrEqual(g.scrollerBottom - g.dockTop - 1);

    // The effect, down the form and back up.
    await page.getByTestId('study-title').focus();
    const walked = new Set<string>();
    for (const key of [...Array<string>(28).fill('Tab'), ...Array<string>(28).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      const p = await focused(page);
      if (!p) continue;
      walked.add(p.name);
      const { scrimBottom, dockTop } = await geometry(page);
      expect(p.top, `${p.name} (after ${key}) under the header scrim`).toBeGreaterThanOrEqual(scrimBottom - 1);
      expect(p.bottom, `${p.name} (after ${key}) under the dock`).toBeLessThanOrEqual(dockTop + 1);
    }
    // The walk really went through the form, text boxes included.
    expect(walked.size).toBeGreaterThan(8);
    expect([...walked]).toEqual(expect.arrayContaining(['study-objective', 'study-consent']));
    await ctx.close();
  });
}
