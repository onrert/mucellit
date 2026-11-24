/*
 * reveal-advanced.mjs — the one test helper of the M10 layout (used by e2e.mjs and web-subpath.mjs).
 * The rarely needed controls sit in closed <details class="advanced"> groups: in the Imposition tab the custom sizes,
 * the advanced settings, save to a book and the more page tools; in My books the "Backup" group (#backup: export,
 * import, delete all); in the Calculator the "Advanced" group (#calc-advanced). The Imposition page grid is in the
 * "Pages" view (#pages-view, hidden; the default view is the sheet preview). Playwright's fill/click/check wait for a
 * visible element, so a flow that uses those controls calls this helper first: it opens every such group and shows the
 * Pages view next to the sheet preview.
 * The product defaults are tested on their own, without it: the Imposition groups and views in e2e.mjs m10LayoutFlow,
 * Backup and Advanced closed at start and opening on a click in m10TabsFlow.
 */
export async function revealAdvanced(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details.advanced').forEach((d) => { d.open = true; });
    const pages = document.getElementById('pages-view');
    if (pages) pages.hidden = false;
  });
}
