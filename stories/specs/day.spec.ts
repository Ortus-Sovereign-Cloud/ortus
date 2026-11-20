// Olena's day on the release program (slice 9):
//
//  - S1.2: she reads the catch-up card: two mails need a reply (Anna,
//    Daniel), one invitation for Thursday 14:00, one alert (the gauge);
//  - S1.3: the gauge alert is in her notifications; it opens the channel
//    it came from;
//  - S1.6: the response team joins the channel call; Marek presents the
//    shelter sheet and they fill it in together, with a live note and an
//    action item for Jonas.
import type { Browser, Page } from "@playwright/test";
import { expect, step, story } from "../harness/story.ts";

const headers = { "X-Requested-With": "ortus" };
let olena: Page;
const people: Record<string, Page> = {};
let room = "";

async function colleague(browser: Browser, baseURL: string, name: string, email: string): Promise<Page> {
  const r = await olena.request.post("/api/v1/admin/users", { headers, data: { email, name } });
  expect(r.status()).toBe(200);
  const link = new URL((await r.json()).link);
  const page = await (await browser.newContext({ baseURL, timezoneId: "UTC", permissions: ["camera", "microphone"] })).newPage();
  await page.goto(link.pathname + link.hash);
  await expect(page).toHaveURL(/\/welcome$/);
  return page;
}

async function mail(page: Page, to: string, subject: string, body: string): Promise<void> {
  await page.goto("/mail");
  await page.locator("ortus-mail-inbox").getByRole("link", { name: "New message" }).click();
  const compose = page.locator("ortus-mail-compose");
  await compose.getByRole("combobox", { name: "To" }).fill(to);
  await compose.getByRole("combobox", { name: "To" }).press("Enter");
  await compose.getByRole("textbox", { name: "Subject" }).fill(subject);
  await compose.getByRole("textbox", { name: /Message|Body/ }).fill(body);
  await compose.getByRole("button", { name: "Send", exact: true }).click();
  await expect(compose).toHaveCount(0, { timeout: 15_000 });
}

/** Thursday at 14:00 UTC after today. */
function thursdayTwo(): number {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 4);
  return d.getTime();
}

story("Story 1 · The day", () => {
  step("S1.2", async ({ browser, ortus }) => {
    olena = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC", permissions: ["camera", "microphone"] })).newPage();
    await olena.goto(`/setup#${ortus.setupToken}`);
    await olena.getByLabel("Your name").fill("Olena Hrytsenko");
    await olena.getByLabel("Work email").fill("olena@ministry.example");
    await olena.getByRole("button", { name: "Create the owner" }).click();
    await expect(olena.locator("ortus-shell")).toBeAttached();
    expect((await olena.request.post("/api/v1/mail/admin/domains", { headers, data: { domain: "ministry.example" } })).status()).toBe(200);
    for (const [name, email] of [["Anna Kowalska", "anna@ministry.example"], ["Daniel Price", "daniel@ministry.example"], ["Marek Nowak", "marek@ministry.example"], ["Jonas Weber", "jonas@ministry.example"]]) {
      people[name!.split(" ")[0]!] = await colleague(browser, ortus.url, name!, email!);
    }
    // Overnight: Anna and Daniel write, Daniel invites, the gauge alerts.
    await mail(people.Anna!, "olena@ministry.example", "Gauge report and updated shelter agreement", "Attached is today's gauge report. Legal should look at clause 4.");
    await mail(people.Daniel!, "olena@ministry.example", "Hydrology data for the briefing", "Can you send the district figures before Thursday?");
    const start = thursdayTwo();
    const invited = await people.Daniel!.request.post("/api/v1/calendar/events", { headers, data: { summary: "Hydrology briefing", start, end: start + 30 * 60_000, attendees: ["olena@ministry.example"] } });
    expect(invited.status()).toBe(200);
    const made = await olena.request.post("/api/v1/chat/rooms", { headers, data: { kind: "channel", name: "flood-response-2026", members: ["marek@ministry.example", "anna@ministry.example", "jonas@ministry.example"] } });
    room = (await made.json()).id;
    for (const who of ["Marek", "Anna", "Jonas"]) await people[who]!.request.post(`/api/v1/chat/rooms/${room}/join`, { headers });
    const hook = await (await olena.request.post(`/api/v1/chat/rooms/${room}/hooks`, { headers, data: { name: "River Authority alerts" } })).json();
    const outside = await olena.context().request;
    expect((await outside.post(new URL(hook.url).pathname, { data: { text: "Gauge at the bridge passed 4.2 m", alert: true } })).status()).toBe(200);

    // Olena's morning: the catch-up card.
    await olena.goto("/mail");
    const inbox = olena.locator("ortus-mail-inbox");
    const card = inbox.getByRole("region", { name: "Catch up" });
    // Both came in the same minute: either order.
    await expect(card).toContainText(/2 need a reply \((Daniel, Anna|Anna, Daniel)\)/, { timeout: 15_000 });
    await expect(card).toContainText("1 invite for Thu");
    await expect(card).toContainText("One alert: Gauge at the bridge passed 4.2 m.");
    await card.getByRole("button", { name: "Show the 3" }).click();
    await expect(inbox.getByText("Hydrology briefing").first()).toBeVisible();
    await olena.screenshot({ path: "test-results/s1.2-catch-up.png" });
  });

  step("S1.3", async () => {
    await olena.goto("/mail");
    await olena.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
    const panel = olena.getByRole("dialog", { name: "Notifications" });
    await panel.getByRole("button", { name: /Alerts/ }).click();
    await expect(panel.getByRole("link", { name: /Gauge at the bridge passed 4\.2 m/ })).toBeVisible();
    await olena.screenshot({ path: "test-results/s1.3-notifications.png" });
    await panel.getByRole("link", { name: /Gauge at the bridge passed 4\.2 m/ }).click();
    await expect(olena).toHaveURL(new RegExp(`/chat\\?room=${room}`));
    const chat = olena.locator("ortus-chat-main");
    await expect(chat.getByRole("heading", { level: 1 })).toHaveText("# flood-response-2026");
    await expect(chat.getByText("Gauge at the bridge passed 4.2 m")).toBeVisible();
  });

  step("S1.6", async () => {
    const marek = people.Marek!;
    // Marek's shelter sheet, shared with Olena to edit.
    const doc = await (await marek.request.post("/api/v1/docs/documents", { headers, data: { name: "shelter-capacity" } })).json();
    expect((await marek.request.post(`/api/v1/drive/items/${doc.id}/shares`, { headers, data: { email: "olena@ministry.example", role: "edit" } })).status()).toBe(200);
    // Marek starts the channel's call; Olena joins it from the channel.
    await marek.goto(`/chat?room=${room}`);
    await marek.locator("ortus-chat-main").getByRole("link", { name: "Call" }).click();
    const his = marek.locator("ortus-call");
    await his.getByRole("button", { name: "Start a call" }).click();
    await expect(his.getByRole("button", { name: "Leave" })).toBeVisible();
    await olena.goto(`/chat?room=${room}`);
    await olena.locator("ortus-chat-main").getByRole("link", { name: /Join the call \(1\)/ }).click({ timeout: 15_000 });
    const hers = olena.locator("ortus-call");
    await hers.getByRole("button", { name: "Join the call" }).click();
    await expect(hers.getByText("2 people in the call")).toBeVisible({ timeout: 15_000 });
    await expect(his.getByRole("group", { name: "Olena Hrytsenko" }).locator("video")).toBeAttached({ timeout: 15_000 });

    // Marek presents the sheet; they fill it in together.
    await his.getByRole("button", { name: "Share screen" }).click();
    await his.getByRole("dialog", { name: "What to show" }).getByRole("button", { name: "shelter-capacity" }).click();
    await expect(hers.getByText("Marek Nowak is presenting")).toBeVisible({ timeout: 15_000 });
    const sheet = hers.locator("ortus-docs-editor");
    await sheet.getByRole("textbox", { name: "shelter-capacity" }).click();
    await olena.keyboard.type("District 4: 147 of 160 beds used, 92%.");
    await expect(his.locator("ortus-docs-editor").getByText("District 4: 147 of 160 beds used, 92%.")).toBeVisible({ timeout: 15_000 });

    // A live note, and an action item for Jonas.
    await his.getByLabel("Add a note").fill("District 4 is at 92%, we need the school by tonight.");
    await his.getByLabel("Add a note").press("Enter");
    await expect(hers.getByText("District 4 is at 92%, we need the school by tonight.")).toBeVisible({ timeout: 15_000 });
    await olena.screenshot({ path: "test-results/s1.6-call.png" });
    await hers.getByLabel("What is to be done").fill("Bus escort");
    await hers.getByRole("button", { name: "Add", exact: true }).click();
    await expect(hers.getByText(/Bus escort/)).toBeVisible();
    await his.getByRole("button", { name: "Leave" }).click();
    await hers.getByRole("button", { name: "Leave" }).click();
  });
});
