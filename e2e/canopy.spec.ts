// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mounts the React component in the playground and checks the guarantees after every kind of input.

import { type Page, expect, test } from "@playwright/test";

const violations = (page: Page) => page.evaluate(() => window.__canopy!.checkGuarantees());

test.beforeEach(async ({ page }) => {
  await page.goto("/?motion=0");
  await page.waitForFunction(() => Boolean(window.__canopy?.layout));
});

test("nothing hides anything after drag, zoom, lens and search", async ({ page }, info) => {
  expect(await violations(page)).toEqual([]);
  await info.attach("overview", { body: await page.screenshot(), contentType: "image/png" });

  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(820, 260, { steps: 8 });
  await page.mouse.up();
  expect(await violations(page)).toEqual([]);
  await info.attach("turned", { body: await page.screenshot(), contentType: "image/png" });

  await page.mouse.move(700, 420);
  await page.mouse.wheel(0, -700);
  expect(await violations(page)).toEqual([]);
  await info.attach("zoomed", { body: await page.screenshot(), contentType: "image/png" });

  await page.evaluate(() => window.__canopy!.resetView());
  const title = page.locator("b", { hasText: /^library$/ });
  const box = (await title.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => window.__canopy!.layout?.focus)).toBe("library");
  expect(await violations(page)).toEqual([]);
  await info.attach("lens", { body: await page.screenshot(), contentType: "image/png" });

  await page.getByRole("searchbox", { name: "Search notes" }).fill("note 1");
  await expect(page.locator("span", { hasText: /hits?$/ }).first()).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await info.attach("search", { body: await page.screenshot(), contentType: "image/png" });
});

test("the outline tree mirrors the grove and drives the lens", async ({ page }) => {
  const tree = page.getByRole("tree");
  await expect(tree.getByRole("treeitem").first()).toBeAttached();
  const first = tree.locator("[role=treeitem][tabindex='0']");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  const focused = await page.evaluate(() => window.__canopy!.layout?.focus);
  expect(focused).toBeTruthy();
  await expect(page.locator("[aria-live]")).toContainText(/items? in \d+ topics?/);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__canopy!.layout?.focus ?? null)).toBeNull();
});

test("labels never overlap on screen", async ({ page }) => {
  for (const az of [0, 60, 140, 250]) {
    await page.evaluate((a) => window.__canopy!.setView({ azimuth: (a * Math.PI) / 180 }, false), az);
    const rects = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[aria-hidden=true] > div")]
        .filter((el) => getComputedStyle(el).opacity !== "0" && el.textContent)
        .map((el) => el.getBoundingClientRect())
        .map((r): [number, number, number, number] => [r.left, r.top, r.right, r.bottom]),
    );
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i]!, rects[j]!];
        expect(a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5).toBe(false);
      }
  }
});

test("an equal search passed again keeps the view", async ({ page }) => {
  await page.goto("/?motion=0&vanilla=1");
  await page.waitForFunction(() => Boolean(window.__canopy?.layout));
  const zoomAfter = (ids: string[]) =>
    page.evaluate((hits) => {
      const c = window.__canopy as unknown as { update(o: { highlight: Set<string> }): void; view: { zoom: number } };
      c.update({ highlight: new Set(hits) });
      return c.view.zoom;
    }, ids);
  expect(await zoomAfter(["home/preferences#0"])).toBe(1);
  await page.evaluate(() => window.__canopy!.setView({ zoom: 3 }, false));
  // A new Set with the same hits, as a parent re-render would pass it: no relayout, no jump back to the overview.
  expect(await zoomAfter(["home/preferences#0"])).toBe(3);
  expect(await zoomAfter(["home/preferences#1"])).toBe(1);
});
