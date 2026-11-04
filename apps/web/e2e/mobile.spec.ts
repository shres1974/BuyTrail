import { expect, test } from "@playwright/test";

test("mobile: cost details stay visible, not hidden behind tooltips", async ({ page }) => {
  await page.goto("/products/prod_demo_clearpeak_cp27q?variant=var_demo_monitor_27_qhd");
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByTestId("offers-summary")).toBeVisible();
  // On narrow screens the ranked offers render as cards with every cost line visible.
  const list = page.getByRole("list", { name: "Eligible offers ranked by known total before tax" });
  const first = list.getByRole("listitem").first();
  await expect(first).toContainText("Store Cedar");
  await expect(first.getByText("Shipping included (confirmed free)")).toBeVisible();
  await expect(first.getByText("CAD 205.00").first()).toBeVisible();
  await expect(first.getByText("known total before tax")).toBeVisible();
  await expect(page.getByText(/before tax\. Retailer checkout is authoritative/)).toBeVisible();
  // The page body itself does not overflow horizontally (tables scroll in their own container).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile: search results readable", async ({ page }) => {
  await page.goto("/search?q=monitor");
  await expect(page.getByRole("heading", { name: /Results for “monitor”/ })).toBeVisible();
  await expect(page.getByText(/before tax/).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
