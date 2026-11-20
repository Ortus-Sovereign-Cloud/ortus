// Drive and search on the release program (task 5.11), in the shape
// the run asks for (one machine: SQLite and a directory; cluster:
// PostgreSQL and S3):
//
//  - a file shared by label rules: INTERNAL refuses a link, PUBLIC allows
//    it, and someone without an account opens it with its password;
//  - search finds mail, files and events together (Ctrl K).
import { expect, test, type Page } from "@playwright/test";
import { deliver } from "../harness/smtp.ts";
import { startOrtus, type Installation } from "../harness/ortus.ts";

test.describe.configure({ mode: "serial" });

let ortus: Installation;
let page: Page;
const headers = { "X-Requested-With": "ortus" };

test.beforeAll(async ({ browser }) => {
  ortus = await startOrtus();
  page = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC" })).newPage();
  await page.goto(`/setup#${ortus.setupToken}`);
  await page.getByLabel("Your name").fill("Olena Hrytsenko");
  await page.getByLabel("Work email").fill("olena@ministry.example");
  await page.getByRole("button", { name: "Create the owner" }).click();
  await expect(page.locator("ortus-shell")).toBeAttached();
});

test.afterAll(async () => {
  await page?.context().close();
  await ortus?.stop();
});

test("a file is shared by label rules", async ({ browser }) => {
  await page.goto("/drive");
  const home = page.locator("ortus-drive-home");
  await home.locator("input.files").setInputFiles([{ name: "shelter-agreement.txt", mimeType: "text/plain", buffer: Buffer.from("Clause 4: the school on Park Street is the second site.") }]);
  await home.getByRole("table").getByRole("button", { name: "shelter-agreement.txt" }).dblclick();
  const file = page.locator("ortus-drive-file");
  await file.getByRole("button", { name: "Share", exact: true }).click();
  const share = file.getByRole("dialog", { name: "Share “shelter-agreement.txt”" });
  // INTERNAL, the default, refuses links.
  await share.getByRole("button", { name: "Make a link" }).click();
  await expect(share.getByRole("alert")).toContainText("cannot be shared this way");
  // PUBLIC allows one.
  await share.getByLabel("Label").selectOption("public");
  await share.getByRole("button", { name: "Make a link" }).click();
  await expect(share.getByText("Anyone with the link")).toBeVisible();
  await share.getByLabel("Password").fill("river-gauge-42");
  await share.getByLabel("Password").press("Tab");
  await expect(share.getByLabel("Password")).toHaveAttribute("placeholder", "On");
  const address = (await share.locator(".url span").textContent())!;
  const visitor = await browser.newContext();
  const outside = await visitor.newPage();
  await outside.goto(`http://${address}`);
  const pub = outside.locator("ortus-drive-public");
  await pub.getByLabel("The link's password").fill("river-gauge-42");
  await pub.getByRole("button", { name: "Open" }).click();
  await expect(pub.getByRole("article")).toContainText("Park Street");
  await visitor.close();
});

test("search finds mail, files and events together", async () => {
  // Mail arrives for Olena.
  const added = await page.request.post("/api/v1/mail/admin/domains", { headers, data: { domain: "ministry.example" } });
  expect(added.status(), await added.text()).toBe(200);
  await deliver(ortus.smtpPort, "anna@regional.example", "olena@ministry.example", "From: Anna Kowalska <anna@regional.example>\nTo: olena@ministry.example\nSubject: Gauge report and updated shelter agreement\nMessage-ID: <g@regional.example>\n\nToday's gauge report: 4.2 m at the bridge.\n");
  // A file and an event about the gauge.
  const up = await (await page.request.post("/api/v1/drive/uploads", { headers, data: { name: "gauge-report.txt", size: 9, mime: "text/plain" } })).json();
  await page.request.put(`/api/v1/drive/uploads/${up.id}/parts/0`, { headers: { ...headers, "Content-Type": "application/octet-stream" }, data: Buffer.from("level 4.2") });
  expect((await page.request.post(`/api/v1/drive/uploads/${up.id}/finish`, { headers })).status()).toBe(200);
  const start = Date.now() + 2 * 86_400_000;
  expect((await page.request.post("/api/v1/calendar/events", { headers, data: { summary: "Gauge readings review", start, end: start + 1_800_000 } })).status()).toBe(200);

  await page.goto("/mail");
  await expect(page.locator("ortus-search")).toBeAttached();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("searchbox").fill("gauge");
  await expect(search.getByRole("list", { name: "Messages" })).toContainText("Gauge report and updated shelter agreement", { timeout: 15_000 });
  await expect(search.getByRole("list", { name: "Files" })).toContainText("gauge-report.txt");
  await expect(search.getByRole("list", { name: "Events" })).toContainText("Gauge readings review");
  await page.screenshot({ path: "test-results/search-across-apps.png" });
  // The file opens from the results.
  await search.getByRole("list", { name: "Files" }).getByRole("link", { name: /gauge-report/ }).click();
  await expect(page.locator("ortus-drive-file").getByRole("heading", { level: 1 })).toHaveText("gauge-report.txt");
});
