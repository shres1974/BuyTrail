/**
 * Section 40 required end-to-end demonstration, as a browser test against web + worker.
 */
import { expect, test } from "@playwright/test";
import { eventually, latestEmail, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("anonymous: search → exact variant → truthful comparison (G01/G02/G03/G04)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("sample-banner")).toContainText("sample data");
  await page.getByLabel("Search products by name, brand, model or barcode").fill("CP27Q");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: /Results for “CP27Q”/ })).toBeVisible();
  const card = page.getByRole("listitem").filter({ hasText: "Clearpeak CP27Q 27-inch QHD monitor" });
  await expect(card.getByText(/before tax — choose a variant/)).toBeVisible();
  await card.getByRole("link", { name: "Choose a variant" }).click();
  await expect(page.getByRole("heading", { name: "Choose a variant" })).toBeVisible();

  await page.getByTestId("variant-var_demo_monitor_27_qhd").click();
  await expect(page).toHaveURL(/variant=var_demo_monitor_27_qhd/);
  const summary = page.getByTestId("offers-summary");
  await expect(summary).toContainText("before tax");
  // G01: Cedar's free-shipping 205.00 beats Pine's 199.99 + 9.99; the reason is explained.
  await expect(page.getByTestId("offers-explanation")).toContainText("Store Cedar ranks first: CAD 4.98 less than Store Pine");
  const ranked = page.getByRole("table", { name: "Eligible offers ranked by known total before tax" });
  await expect(ranked.getByRole("row").nth(1)).toContainText("Store Cedar");
  await expect(ranked).toContainText("CAD 209.98");
  // G02: unknown shipping in a separate, unranked group.
  const incomplete = page.getByRole("table", { name: "Offers whose total is not confirmed" });
  await expect(incomplete).toContainText("Store Maple");
  await expect(incomplete).toContainText("CAD 189.99");
  await expect(ranked).not.toContainText("Store Maple");
  // G03: USD offer is not compared.
  await expect(page.getByRole("table", { name: "Offers excluded from comparison" })).toContainText("Different currency");

  // Switching variant updates offers + history together; back restores the previous variant.
  await page.getByTestId("variant-var_demo_monitor_27_qhd_144").click();
  await expect(page).toHaveURL(/variant=var_demo_monitor_27_qhd_144/);
  await expect(page.getByRole("table", { name: "Eligible offers ranked by known total before tax" })).not.toContainText("CAD 205.00");
  await page.goBack();
  await expect(page).toHaveURL(/variant=var_demo_monitor_27_qhd(&|$)/);
  await expect(page.getByTestId("offers-explanation")).toContainText("Store Cedar");
  await expect(page.getByText(/Lowest observed since/)).toBeVisible(); // G25: honest coverage
});

test("empty results explain coverage and offer a demand request", async ({ page }) => {
  await page.goto("/search?q=espresso+machine");
  await expect(page.getByText("No matching supported products")).toBeVisible();
  await page.getByRole("button", { name: /Request “espresso machine”/ }).click();
  await expect(page.getByText(/doesn't mean the product or store will be added/)).toBeVisible();
});

test("stale and unknown-shipping states are labelled (G09, stale)", async ({ page }) => {
  await page.goto("/products/prod_demo_clearpeak_cp24f");
  await expect(page.getByRole("table", { name: "Stale offers" })).toContainText("Stale");
  await page.goto("/products/prod_demo_vantro_v27?variant=var_demo_vantro_v27");
  await expect(page.getByRole("table", { name: "Offers whose total is not confirmed" })).toContainText("only at or above CAD 250.00");
});

test("full journey: watch → simulated crossing → one alert + email → purchase → sample receipt → return date edit → deletion", async ({ page, context }) => {
  const email = uniqueEmail("journey");
  await signIn(page, email, "/products/prod_demo_clearpeak_cp27q?variant=var_demo_monitor_27_qhd");
  await expect(page).toHaveURL(/variant=var_demo_monitor_27_qhd/);

  // Reset the sample price and create a watch below the current best (205.00).
  const sim = page.getByText("Simulate a sample price change (demonstration mode)");
  await sim.click();
  await page.getByLabel("Sample listing").selectOption("CE-310");
  await page.getByLabel(/New item price/).fill("");
  await page.getByRole("button", { name: "Apply sample price" }).click();
  await expect(page.getByText(/applied through the normal pipeline/)).toBeVisible();

  await page.getByLabel("Target known total before tax (CAD)").fill("195.00");
  await page.getByRole("button", { name: "Save watch" }).click();
  await expect(page.getByText("Watch saved")).toBeVisible();

  // Simulated qualifying observation (clearly labelled demonstration).
  await page.reload();
  await page.getByText("Simulate a sample price change (demonstration mode)").click();
  await page.getByLabel("Sample listing").selectOption("CE-310");
  await page.getByLabel(/New item price/).fill("189.00");
  await page.getByRole("button", { name: "Apply sample price" }).click();
  await expect(page.getByText(/applied through the normal pipeline/)).toBeVisible();

  // Durable in-app event, processed by the worker.
  await page.goto("/notifications");
  await eventually(page, async () => (await page.getByTestId("alerts").getByText("Price dropped to your target").count()) > 0);
  await expect(page.getByTestId("alerts").getByText("Price dropped to your target")).toHaveCount(1);
  await expect(page.getByText("Sample alert — demonstration mode").first()).toBeVisible();
  const mail = await latestEmail(email, { subjectIncludes: "Price dropped" });
  expect(mail.subject).toContain("Sample data");
  expect(mail.text).toContain("CAD 189.00");
  expect(mail.text).toContain("your target: CAD 195.00");
  await eventually(page, async () => (await page.getByText("Email accepted by mail provider").count()) > 0);

  // Re-processing the same price does not create another alert (G12).
  await page.goto("/products/prod_demo_clearpeak_cp27q?variant=var_demo_monitor_27_qhd");
  await page.getByText("Simulate a sample price change (demonstration mode)").click();
  await page.getByLabel("Sample listing").selectOption("CE-310");
  await page.getByLabel(/New item price/).fill("189.00");
  await page.getByRole("button", { name: "Apply sample price" }).click();
  await page.waitForTimeout(4000);
  await page.goto("/notifications");
  await expect(page.getByTestId("alerts").getByText("Price dropped to your target")).toHaveCount(1);

  // Record the purchase (not assumed from the click-out), pausing the watch.
  await page.goto("/products/prod_demo_clearpeak_cp27q?variant=var_demo_monitor_27_qhd");
  await page.getByRole("link", { name: "Record the purchase" }).click();
  await page.getByLabel("Merchant").fill("Store Cedar");
  await page.getByLabel(/Amount paid/).fill("213.57");
  await expect(page.getByLabel("Pause my price watches for this item")).toBeChecked();
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Clearpeak CP27Q/ })).toBeVisible();
  await expect(page.getByText("Paid CAD 213.57")).toBeVisible();

  // G30: real uploads are disabled in demo; attach a synthetic receipt.
  await expect(page.getByTestId("uploads-disabled")).toBeVisible();
  await page.getByRole("button", { name: "Attach a sample receipt (image)" }).click();
  await expect(page.getByTestId("receipt").getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("receipt").getByText("Synthetic sample")).toBeVisible();
  await expect(page.getByAltText("Receipt preview")).toBeVisible();

  // Confirm a return date → durable reminders; edit it → only the new schedule remains.
  await page.getByRole("button", { name: "Set a return date" }).click();
  await page.getByLabel("Last day to return").fill("2026-12-04");
  await page.getByRole("button", { name: "Confirm date" }).click();
  await expect(page.getByText("Return date saved; reminders scheduled.")).toBeVisible();
  const reminders = page.getByTestId("reminder");
  await expect(reminders).toHaveCount(2);
  await expect(reminders.first()).toContainText("2026-12-01 09:00");
  await page.getByRole("button", { name: "Change date" }).click();
  await page.getByLabel("Last day to return").fill("2026-12-11");
  await page.getByRole("button", { name: "Confirm date" }).click();
  await expect(reminders.first()).toContainText("2026-12-08 09:00");
  await expect(page.getByText("2026-12-01 09:00")).toHaveCount(0);

  // Watch was paused by the purchase.
  await page.goto("/watchlist");
  await expect(page.getByText("Paused").first()).toBeVisible();

  // Restore the golden sample price for other tests.
  const reset = await context.request.post("/api/demo/simulate-price", { data: { externalListingId: "CE-310", itemPrice: null }, headers: { origin: "http://localhost:3000" } });
  expect(reset.status()).toBe(200);

  // Account deletion revokes access.
  await page.goto("/settings");
  await page.getByLabel(/Type .* to confirm/).fill(email);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL("**/");
  const r = await context.request.get("/api/purchases");
  expect(r.status()).toBe(401);
  await page.goto("/purchases");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("two-user isolation over HTTP (G21)", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await signIn(pa, uniqueEmail("a"), "/purchases/new");
  await pa.getByLabel("Merchant").fill("Corner hardware");
  await pa.getByLabel("Description").fill("Furnace filter (private item)");
  await pa.getByRole("button", { name: "Save purchase" }).click();
  await expect(pa.getByRole("heading", { level: 1, name: /Furnace filter/ })).toBeVisible();
  const purchaseId = pa.url().split("/purchases/")[1]!;
  await pa.getByRole("button", { name: "Attach a sample receipt (PDF)" }).click();
  await expect(pa.getByTestId("receipt").getByText("Ready")).toBeVisible({ timeout: 30_000 });
  const receiptHref = await pa.getByRole("link", { name: "Download" }).getAttribute("href");
  const receiptId = receiptHref!.split("/")[3]!;

  await signIn(pb, uniqueEmail("b"), "/purchases");
  for (const [method, url] of [
    ["GET", `/api/purchases/${purchaseId}`],
    ["PATCH", `/api/purchases/${purchaseId}`],
    ["GET", `/api/receipts/${receiptId}/download`],
    ["GET", `/api/receipts/${receiptId}/download?variant=preview`],
    ["DELETE", `/api/receipts/${receiptId}`],
    ["POST", `/api/receipts/${receiptId}/confirm`],
  ] as const) {
    const res = await b.request.fetch(url, { method, data: method === "PATCH" ? { version: 1, notes: "x" } : undefined, headers: { origin: "http://localhost:3000" } });
    expect(res.status(), `${method} ${url}`).toBe(404);
    expect(await res.text()).not.toContain("Furnace");
  }
  await pb.goto(`/purchases/${purchaseId}`);
  await expect(pb.getByRole("heading", { name: "Not found" })).toBeVisible();
  // A's receipt is still downloadable by A.
  const own = await a.request.get(`/api/receipts/${receiptId}/download`);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toBe("application/pdf");
  // Public search never exposes private content.
  const pub = await b.request.get("/api/search?q=Furnace");
  expect(await pub.text()).not.toContain("private item");
  await a.close();
  await b.close();
});

test("API contract: error envelope, version conflict, idempotency, unauthenticated", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, uniqueEmail("api"), "/watchlist");
  const origin = { origin: "http://localhost:3000" };
  const body = { variantId: "var_demo_kettle_17_steel", target: { amountMinor: "4000", currency: "CAD" } };
  const c1 = await ctx.request.post("/api/watches", { data: body, headers: { ...origin, "idempotency-key": "e2e-idem-0001" } });
  expect(c1.status()).toBe(201);
  const c2 = await ctx.request.post("/api/watches", { data: body, headers: { ...origin, "idempotency-key": "e2e-idem-0001" } });
  expect(c2.status()).toBe(200);
  expect((await c2.json()).watch.id).toBe((await c1.json()).watch.id);
  const c3 = await ctx.request.post("/api/watches", { data: { ...body, target: { amountMinor: "3000", currency: "CAD" } }, headers: { ...origin, "idempotency-key": "e2e-idem-0001" } });
  expect(c3.status()).toBe(409);
  expect((await c3.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  const id = (await c1.json()).watch.id;
  const p1 = await ctx.request.patch(`/api/watches/${id}`, { data: { version: 1, target: { amountMinor: "3900", currency: "CAD" } }, headers: origin });
  expect(p1.status()).toBe(200);
  const p2 = await ctx.request.patch(`/api/watches/${id}`, { data: { version: 1, target: { amountMinor: "3800", currency: "CAD" } }, headers: origin });
  expect(p2.status()).toBe(409);
  const e = (await p2.json()).error;
  expect(e).toMatchObject({ code: "VERSION_CONFLICT", retryable: false });
  expect(e.requestId).toMatch(/^req_/);
  expect(e.current.version).toBe(2);
  const bad = await ctx.request.post("/api/watches", { data: { variantId: "x" }, headers: origin });
  expect(bad.status()).toBe(400);
  const cross = await ctx.request.post("/api/watches", { data: body, headers: { origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);
  const anon = await (await browser.newContext()).request.get("/api/watches");
  expect(anon.status()).toBe(401);
  // Product link resolver: only allowlisted hosts; never fetches the URL.
  const link = await ctx.request.post("/api/product-links/resolve", { data: { url: "http://169.254.169.254/latest/meta-data" }, headers: origin });
  expect(link.status()).toBe(422);
  const okLink = await ctx.request.post("/api/product-links/resolve", { data: { url: "https://cedar.example/p/CE-310" }, headers: origin });
  expect(await okLink.json()).toMatchObject({ status: "matched", variantId: "var_demo_monitor_27_qhd" });
  // Upload endpoints are disabled in the demo deployment (G30).
  const up = await ctx.request.post("/api/receipts/upload-intents", { data: { purchaseId: "x", contentType: "image/png", size: 10 }, headers: origin });
  expect(up.status()).toBe(422);
  expect((await up.json()).error.code).toBe("DEMO_RESTRICTION");
  await ctx.close();
});

test("keyboard: search and variant selection are operable without a mouse", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab"); // skip link
  await expect(page.getByText("Skip to main content")).toBeFocused();
  await page.getByLabel("Search products by name, brand, model or barcode").focus();
  await page.keyboard.type("kettle");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Results for “kettle”/ })).toBeVisible();
  const link = page.getByRole("link", { name: "Hearthwell Brew Kettle electric kettle" });
  await link.focus();
  await page.keyboard.press("Enter");
  const v = page.getByTestId("variant-var_demo_kettle_17_2pk");
  await v.focus();
  await expect(v).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/variant=var_demo_kettle_17_2pk/);
  await expect(page.getByRole("heading", { name: "Selected variant" })).toBeVisible();
});
