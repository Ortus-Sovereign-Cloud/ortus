// Story 1 (slice 7) and Story 3's must-read, on the release program:
//
//  - S1.5: the road decision becomes a task for Marek with a due time;
//  - S1.9: the plan goes through a route where Marek signs, Olena
//    approves and Katarzyna signs (on the web; the phone comes later);
//  - S1.10: the signed PDF is filed to the case and its signatures are
//    valid, also for an independent validator (pyHanko);
//  - S3.7: Iryna, new, reads and confirms the two must-read policies.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, step, story } from "../harness/story.ts";

const headers = { "X-Requested-With": "ortus" };
let olena: Page;
let marek: Page;
let katarzyna: Page;
let record = "";

async function colleague(browser: Browser, baseURL: string, name: string, email: string): Promise<Page> {
  const r = await olena.request.post("/api/v1/admin/users", { headers, data: { email, name, groups: ["Crisis team"] } });
  expect(r.status()).toBe(200);
  const link = new URL((await r.json()).link);
  const page = await (await browser.newContext({ baseURL, timezoneId: "UTC" })).newPage();
  await page.goto(link.pathname + link.hash);
  await expect(page).toHaveURL(/\/welcome$/);
  return page;
}

/** A document written in the editor: a heading and a paragraph. */
async function write(page: Page, title: string, text: string): Promise<string> {
  await page.goto("/docs");
  await page.locator("ortus-docs-home").getByRole("button", { name: "New document" }).click();
  const editor = page.locator("ortus-docs-editor");
  await editor.getByLabel("Document name").fill(title);
  await editor.getByLabel("Document name").press("Enter");
  await editor.locator(".ProseMirror").click();
  await editor.getByRole("toolbar").getByLabel("Style").selectOption("1");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await editor.getByRole("toolbar").getByLabel("Style").selectOption("p");
  await page.keyboard.type(text);
  await expect(editor.getByText("saved", { exact: false })).toBeVisible();
  return new URL(page.url()).searchParams.get("doc")!;
}

story("Story 1 · Approvals and records", () => {
  step("S1.5", async ({ browser, ortus }) => {
    olena = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC" })).newPage();
    await olena.goto(`/setup#${ortus.setupToken}`);
    await olena.getByLabel("Your name").fill("Olena Hrytsenko");
    await olena.getByLabel("Work email").fill("olena@ministry.example");
    await olena.getByRole("button", { name: "Create the owner" }).click();
    await expect(olena.locator("ortus-shell")).toBeAttached();
    marek = await colleague(browser, ortus.url, "Marek Nowak", "marek@ministry.example");
    katarzyna = await colleague(browser, ortus.url, "Katarzyna Lis", "katarzyna@ministry.example");

    await olena.goto("/tasks");
    const board = olena.locator("ortus-tasks-board");
    await board.getByRole("button", { name: "New project" }).click();
    const project = board.getByRole("dialog", { name: "New project" });
    await project.getByLabel("Project name").fill("Flood response 2026");
    await project.getByRole("button", { name: "Create" }).click();
    await board.getByRole("button", { name: "New task" }).click();
    const task = board.getByRole("dialog", { name: "New task" });
    await task.getByLabel("Title").fill("Close road R-12 and divert traffic");
    await task.getByLabel("Notes").fill("Decided with Marek, Anna and Jonas at 10:47.");
    await task.getByLabel("Who does it").fill("marek@ministry.example");
    const today = new Date().toISOString().slice(0, 10);
    await task.getByLabel("Due", { exact: true }).fill(`${today}T17:00`);
    await task.getByRole("button", { name: "Save" }).click();
    await expect(board.getByRole("region", { name: "To do" })).toContainText("Close road R-12 and divert traffic");
    await olena.screenshot({ path: "test-results/s1.5-tasks.png" });

    // Marek finds it among his tasks, due today.
    await marek.goto("/tasks?view=mine");
    const his = marek.locator("ortus-tasks-board");
    await expect(his.getByRole("tab", { name: /My tasks · 1/ })).toBeVisible();
    await expect(his.getByRole("table")).toContainText("Close road R-12 and divert traffic");
    await expect(his.getByRole("table")).toContainText("Today");
  });

  step("S1.9", async () => {
    // Marek writes the plan and shares it with the two who sign or approve.
    const doc = await write(marek, "Flood response plan 2026", "Approved for use by all districts from the date of the last signature below.");
    for (const [email, role] of [["olena@ministry.example", "edit"], ["katarzyna@ministry.example", "view"]]) {
      const r = await marek.request.post(`/api/v1/drive/items/${doc}/shares`, { headers, data: { email, role } });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
    // The team's channel, told when the plan is filed.
    const channel = await marek.request.post("/api/v1/chat/rooms", { headers, data: { kind: "channel", name: "flood-response" } });
    expect(channel.ok(), await channel.text()).toBeTruthy();
    const editor = marek.locator("ortus-docs-editor");
    await editor.getByRole("button", { name: "Send for approval" }).click();
    const send = editor.getByRole("dialog", { name: "Send for approval" });
    const route: [string, string, string][] = [
      ["marek@ministry.example", "Author signs", "sign"],
      ["olena@ministry.example", "Logistics review", "approve"],
      ["katarzyna@ministry.example", "Director signs", "sign"],
    ];
    for (const [i, [email, title, kind]] of route.entries()) {
      if (i > 0) await send.getByRole("button", { name: "Add a step" }).click();
      await send.getByLabel(`Reviewer ${i + 1}`, { exact: true }).fill(email);
      await send.getByLabel(`What reviewer ${i + 1} does`, { exact: true }).fill(title);
      await send.getByLabel(`Reviewer ${i + 1} approves or signs`).selectOption(kind);
    }
    await send.getByLabel("Case (the signed PDF is filed there)").fill("2026/EM/0114");
    await send.getByLabel("Tell a chat channel when it is filed").fill("#flood-response");
    await send.getByRole("button", { name: "Send", exact: true }).click();
    await expect(send).toBeHidden();

    // Each in turn, from their Approvals.
    const decide = async (page: Page, button: string) => {
      await page.goto("/approvals");
      await page.locator("ortus-approvals-home").getByRole("link", { name: /Flood response plan 2026/ }).click();
      const review = page.locator("ortus-docs-review");
      await expect(review.getByRole("article")).toContainText("Approved for use by all districts");
      await review.getByRole("region", { name: "Your turn" }).getByRole("button", { name: button, exact: true }).click();
      return review;
    };
    await expect((await decide(marek, "Sign")).getByRole("status")).toContainText("not your turn");
    await decide(olena, "Approve");
    await katarzyna.goto("/approvals");
    await katarzyna.locator("ortus-approvals-home").getByRole("link", { name: /Flood response plan 2026/ }).click();
    const review = katarzyna.locator("ortus-docs-review");
    await expect(review.getByRole("region", { name: "Route" })).toContainText("File and publish");
    await katarzyna.screenshot({ path: "test-results/s1.9-approvals.png" });
    await review.getByRole("region", { name: "Your turn" }).getByRole("button", { name: "Sign", exact: true }).click();
    await expect(review.getByRole("status")).toContainText("Everyone signed");
    record = (await review.getByRole("link", { name: "Open the record" }).getAttribute("href"))!;
    expect(record).toMatch(/^\/records\?record=/);
  });

  step("S1.10", async () => {
    await marek.goto(record);
    const page = marek.locator("ortus-records-record");
    await expect(page.getByRole("status")).toContainText("Signed by all 2 and filed at");
    const facts = page.getByRole("region", { name: "Record", exact: true });
    await expect(facts).toContainText("0114-001");
    await expect(facts).toContainText("2 of 2 valid");
    await expect(facts).toContainText("10 years");
    await expect(page.getByRole("region", { name: "What happened next" })).toContainText("Posted to #flood-response");
    await expect(page.locator(".seal")).toHaveText("Signed and sealed");
    await marek.screenshot({ path: "test-results/s1.10-record.png" });

    // The channel was told.
    await marek.goto("/chat");
    await expect(marek.locator("ortus-chat-main").getByRole("region", { name: "Messages" })).toContainText("is signed and filed as record 0114-001");

    // The filed PDF's signatures, checked by an independent validator.
    const id = new URL(record, "http://x").searchParams.get("record");
    const pdf = await (await marek.request.get(`/api/v1/records/records/${id}/pdf`, { headers })).body();
    const ca = await (await marek.request.get("/api/v1/approvals/authority.pem")).text();
    const pyhanko = process.env.ORTUS_TEST_PYHANKO;
    if (!pyhanko) {
      expect(process.env.ORTUS_REQUIRE_PYHANKO, "ORTUS_REQUIRE_PYHANKO is set but ORTUS_TEST_PYHANKO is not").toBeFalsy();
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "ortus-signed-"));
    writeFileSync(join(dir, "record.pdf"), pdf);
    writeFileSync(join(dir, "ca.pem"), ca);
    const out = execFileSync(pyhanko, ["sign", "validate", "--pretty-print", "--no-revocation-check", "--trust", join(dir, "ca.pem"), join(dir, "record.pdf")]).toString();
    // Both signatures, each judged valid and trusted.
    expect(out.match(/The signature is judged VALID\./g)?.length).toBe(2);
    expect(out.match(/The signer's certificate is trusted\./g)?.length).toBe(2);
  });

  step("S3.7", async ({ browser, ortus }) => {
    // Olena publishes two policies as must-read for everyone.
    for (const [title, text] of [
      ["Data protection policy", "Three rules cover most of your day. Look at the label."],
      ["Flood response plan 2026 summary", "Each district opens at least one shelter."],
    ]) {
      await write(olena, title, text);
      const editor = olena.locator("ortus-docs-editor");
      await editor.getByRole("button", { name: "Publish as must-read" }).click();
      const dialog = editor.getByRole("dialog", { name: "Publish as must-read" });
      await dialog.getByLabel("A line above the title").fill("Handbook · owner: Data protection officer");
      await dialog.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Published as must-read" })).toBeDisabled();
    }
    // Iryna starts today: her welcome page sends her to them.
    const iryna = await colleague(browser, ortus.url, "Iryna Savchenko", "iryna@ministry.example");
    await iryna.getByRole("link", { name: "Start reading" }).click();
    const read = iryna.locator("ortus-records-must-read");
    await expect(read.getByText("Policy 1 of 2")).toBeVisible();
    await expect(read.getByRole("article")).toContainText("Look at the label.");
    await iryna.screenshot({ path: "test-results/s3.7-must-read.png" });
    await read.getByRole("checkbox", { name: "I have read and understood this policy" }).check();
    await read.getByRole("button", { name: "Confirm and read the next one" }).click();
    await expect(read.getByRole("article")).toContainText("Each district opens at least one shelter.");
    await read.getByRole("checkbox", { name: "I have read and understood this policy" }).check();
    await read.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(read.getByRole("status")).toContainText("All read and confirmed");
    // Olena sees who confirmed.
    const mine = await (await olena.request.get("/api/v1/records/must-read", { headers })).json();
    for (const item of mine.items) {
      const who = await (await olena.request.get(`/api/v1/records/must-read/${item.id}/confirmations`, { headers })).json();
      expect(who.confirmed.map((c: { email: string }) => c.email)).toContain("iryna@ministry.example");
    }
    await iryna.context().close();
  });
});
