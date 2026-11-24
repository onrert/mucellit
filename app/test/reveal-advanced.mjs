/*
 * reveal-advanced.mjs — the one test helper of the M10 layout (used by e2e.mjs and web-subpath.mjs).
 * In the Imposition tab the rarely needed controls sit in closed <details class="advanced"> groups (custom sizes,
 * advanced settings, save to project, more page tools) and the page grid is in the "Pages" view (#pages-view, hidden;
 * the default view is the sheet preview). Playwright's fill/click/check wait for a visible element, so a flow that uses
 * those controls calls this helper first: it opens the groups and shows the Pages view next to the sheet preview.
 * The product defaults (groups closed, sheet preview first) are tested on their own in e2e.mjs (m10LayoutFlow), without it.
 */
export async function revealAdvanced(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details.advanced').forEach((d) => { d.open = true; });
    const pages = document.getElementById('pages-view');
    if (pages) pages.hidden = false;
  });
}
