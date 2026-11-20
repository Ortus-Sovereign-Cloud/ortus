// Story 1 in Docs (slice 6), on the release program with the real Drive:
//
//  - S1.7: Marek writes the flood plan, shares it in Drive with Ana (who
//    may comment) and Olena (who may edit); Ana suggests a change while
//    Marek is in the document, and he accepts it;
//  - S1.8: Marek sends the plan for approval; Olena finds it waiting,
//    reads it and approves it before 14:05; the plan is found by its text.
import type { Browser, Page } from "@playwright/test";
import { expect, step, story } from "../harness/story.ts";

const headers = { "X-Requested-With": "ortus" };
let olena: Page;
let marek: Page;
let ana: Page;
let plan = "";

/** Olena invites a colleague, who follows the link in a browser of their own. */
async function colleague(browser: Browser, baseURL: string, name: string, email: string): Promise<Page> {
  const r = await olena.request.post("/api/v1/admin/users", { headers, data: { email, name, groups: ["Crisis team"] } });
  expect(r.status()).toBe(200);
  const link = new URL((await r.json()).link);
  const page = await (await browser.newContext({ baseURL, timezoneId: "UTC" })).newPage();
  await page.goto(link.pathname + link.hash);
  await expect(page).toHaveURL(/\/welcome$/);
  return page;
}

story("Story 1 · Docs", () => {
  step("S1.7", async ({ browser, ortus }) => {
    olena = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC" })).newPage();
    await olena.goto(`/setup#${ortus.setupToken}`);
    await olena.getByLabel("Your name").fill("Olena Hrytsenko");
    await olena.getByLabel("Work email").fill("olena@ministry.example");
    await olena.getByRole("button", { name: "Create the owner" }).click();
    await expect(olena.locator("ortus-shell")).toBeAttached();
    marek = await colleague(browser, ortus.url, "Marek Nowak", "marek@ministry.example");
    ana = await colleague(browser, ortus.url, "Ana Kovač", "ana@ministry.example");

    // Marek writes the plan.
    await marek.goto("/docs");
    await marek.locator("ortus-docs-home").getByRole("button", { name: "New document" }).click();
    const editor = marek.locator("ortus-docs-editor");
    await editor.getByLabel("Document name").fill("Flood response plan 2026");
    await editor.getByLabel("Document name").press("Enter");
    await editor.locator(".ProseMirror").click();
    await editor.getByRole("toolbar").getByLabel("Style").selectOption("1");
    await marek.keyboard.type("Flood response plan 2026");
    await marek.keyboard.press("Enter");
    await editor.getByRole("toolbar").getByLabel("Style").selectOption("p");
    await marek.keyboard.type("Each district opens at least one shelter. District 4 uses the sports hall.");
    await expect(editor.getByText("saved", { exact: false })).toBeVisible();
    plan = marek.url();

    // He shares it in Drive: Ana may comment, Olena may edit.
    await editor.getByRole("button", { name: "Share", exact: true }).click();
    const share = marek.locator("ortus-drive-file").getByRole("dialog", { name: "Share “Flood response plan 2026”" });
    for (const [who, role] of [["ana@ministry.example", "Can comment"], ["olena@ministry.example", "Can edit"]]) {
      await share.getByLabel("Role").selectOption({ label: role! });
      await share.getByLabel("Add people or email addresses").fill(who!);
      await share.getByRole("button", { name: "Add", exact: true }).click();
      await expect(share.getByRole("list", { name: "Who has access" })).toContainText(role!);
    }
    await share.getByRole("button", { name: "Done" }).click();

    // The plan is in his Drive and opens from there.
    await marek.goto("/drive");
    await marek.locator("ortus-drive-home").getByRole("table").getByRole("button", { name: "Flood response plan 2026" }).dblclick();
    await expect(marek).toHaveURL(plan);
    await expect(editor.locator(".ProseMirror")).toContainText("sports hall");

    // Ana opens it: she may only suggest.
    await ana.goto(plan);
    const hers = ana.locator("ortus-docs-editor");
    await expect(hers.locator(".ProseMirror")).toContainText("sports hall");
    await expect(hers.getByLabel("Mode")).toHaveValue("suggesting");
    await expect(hers.getByLabel("Mode").locator("option")).toHaveText(["Suggesting", "Viewing"]);
    await expect(editor.getByLabel("Here now").locator("span")).toHaveCount(2);
    await hers.locator(".ProseMirror p").first().click();
    await ana.keyboard.press("End");
    await ana.keyboard.type(" Buses leave from the central depot at 14:00.");

    // Marek sees her suggestion as she types it, and accepts it.
    const card = editor.getByRole("region", { name: "Suggestion by Ana Kovač" });
    await expect(card).toContainText("Add “ Buses leave from the central depot at 14:00.”");
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(editor.locator(".ProseMirror ins")).toHaveCount(0);
    await expect(hers.locator(".ProseMirror ins")).toHaveCount(0);
    await expect(hers.locator(".ProseMirror")).toContainText("Buses leave from the central depot at 14:00.");
    await marek.screenshot({ path: "test-results/s1.7-editor.png" });
    await ana.context().close();
  });

  step("S1.8", async () => {
    // Marek sends it for approval: Olena, by 14:05.
    await marek.goto(plan);
    const editor = marek.locator("ortus-docs-editor");
    await expect(editor.locator(".ProseMirror")).toContainText("central depot");
    await editor.getByRole("button", { name: "Send for approval" }).click();
    const send = editor.getByRole("dialog", { name: "Send for approval" });
    await send.getByLabel("Reviewer 1", { exact: true }).fill("olena@ministry.example");
    await send.getByLabel("What reviewer 1 does").fill("approve the plan");
    const today = new Date().toISOString().slice(0, 10);
    await send.getByLabel("Reviewer 1 by").fill(`${today}T14:05`);
    await send.getByRole("button", { name: "Send", exact: true }).click();
    await expect(send).toBeHidden();
    await expect(editor.getByText("In review")).toBeVisible();

    // Olena finds it waiting for her, reads it and approves it.
    await olena.goto("/docs");
    await olena.locator("ortus-docs-home").getByRole("link", { name: /Flood response plan 2026/ }).click();
    const review = olena.locator("ortus-docs-review");
    await expect(review.getByRole("article")).toContainText("Buses leave from the central depot at 14:00.");
    const turn = review.getByRole("region", { name: "Your turn" });
    await expect(turn).toContainText("Your turn · step 1 of 1");
    await expect(turn).toContainText("Marek asks you approve the plan");
    await expect(turn).toContainText("by 14:05");
    await olena.screenshot({ path: "test-results/s1.8-review.png" });
    await turn.getByLabel("Comment (optional)").fill("Approved. Keep the depot as the meeting point.");
    await turn.getByRole("button", { name: "Approve" }).click();
    await expect(review.getByRole("status")).toHaveText("Everyone approved it.");
    await expect(review.getByRole("region", { name: "Route" })).toContainText("Keep the depot");

    // Marek's plan shows it; and the plan is found by its words.
    await marek.goto(plan);
    await expect(editor.getByText("Approved", { exact: true })).toBeVisible();
    const found = await (await olena.request.get("/api/v1/search?q=depot")).json();
    expect(JSON.stringify(found)).toContain("Flood response plan 2026");
    await marek.context().close();
    await olena.context().close();
  });
});
