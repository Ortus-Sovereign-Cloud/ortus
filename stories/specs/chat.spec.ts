// Chat on the release program (slice 8):
//
//  - S1.4: Olena, Marek, Anna and Jonas agree in a thread to close road
//    R-12; the decision is recorded (audited, found in search);
//  - S3.8: Iryna says hello in her team channel and accepts her first
//    meeting.
import type { Browser, Page } from "@playwright/test";
import { expect, step, story } from "../harness/story.ts";

const headers = { "X-Requested-With": "ortus" };
let olena: Page;
const people: Record<string, Page> = {};

async function colleague(browser: Browser, baseURL: string, name: string, email: string): Promise<Page> {
  const r = await olena.request.post("/api/v1/admin/users", { headers, data: { email, name, groups: ["Crisis team"] } });
  expect(r.status()).toBe(200);
  const link = new URL((await r.json()).link);
  const page = await (await browser.newContext({ baseURL, timezoneId: "UTC" })).newPage();
  await page.goto(link.pathname + link.hash);
  await expect(page).toHaveURL(/\/welcome$/);
  return page;
}

story("Story 1 and 3 · Chat", () => {
  step("S1.4", async ({ browser, ortus }) => {
    olena = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC" })).newPage();
    await olena.goto(`/setup#${ortus.setupToken}`);
    await olena.getByLabel("Your name").fill("Olena Hrytsenko");
    await olena.getByLabel("Work email").fill("olena@ministry.example");
    await olena.getByRole("button", { name: "Create the owner" }).click();
    await expect(olena.locator("ortus-shell")).toBeAttached();
    for (const [name, email] of [["Marek Nowak", "marek@ministry.example"], ["Anna Kowalska", "anna@ministry.example"], ["Jonas Weber", "jonas@ministry.example"]]) {
      people[name!.split(" ")[0]!] = await colleague(browser, ortus.url, name!, email!);
    }
    // Olena's channel for the flood, with the three in it.
    await olena.goto("/chat");
    const hers = olena.locator("ortus-chat-main");
    await hers.getByRole("button", { name: "New channel" }).first().click();
    const dialog = hers.getByRole("dialog", { name: "New channel" });
    await dialog.getByLabel("Channel name").fill("flood-response-2026");
    await dialog.getByLabel("Invite (addresses)").fill("marek@ministry.example, anna@ministry.example, jonas@ministry.example");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(hers.getByRole("heading", { level: 1 })).toHaveText("# flood-response-2026");
    for (const who of ["Marek", "Anna", "Jonas"]) {
      const r = await people[who]!.request.get("/api/v1/chat/rooms", { headers });
      const room = (await r.json()).rooms[0];
      await people[who]!.request.post(`/api/v1/chat/rooms/${room.id}/join`, { headers });
    }
    // Anna asks; the others answer in her thread; Olena records the decision.
    const anna = people.Anna!;
    await anna.goto("/chat");
    const annas = anna.locator("ortus-chat-main");
    const box = annas.getByRole("textbox", { name: /Message/ });
    await box.fill("Water level at the bridge gauge is 4.2 m and rising. Do we close the road now?");
    await box.press("Enter");
    const question = hers.getByRole("region", { name: "Messages" }).getByRole("article", { name: "Message from Anna Kowalska" });
    await expect(question).toContainText("4.2 m and rising", { timeout: 10_000 });
    for (const [who, text] of [["Marek", "Yes. Forecast says another 30 cm by noon."], ["Jonas", "We can be there in 20 minutes."]]) {
      const page = people[who!]!;
      await page.goto("/chat");
      const main = page.locator("ortus-chat-main");
      const msg = main.getByRole("region", { name: "Messages" }).getByRole("article", { name: "Message from Anna Kowalska" });
      await msg.hover();
      await msg.getByRole("button", { name: "Reply in thread" }).click();
      const thread = main.getByRole("complementary", { name: "Thread" });
      await thread.getByRole("textbox", { name: "Reply" }).fill(text!);
      await thread.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(thread).toContainText(text!);
    }
    await question.getByRole("button", { name: "2 replies" }).click();
    const thread = hers.getByRole("complementary", { name: "Thread" });
    await expect(thread).toContainText("We can be there in 20 minutes.");
    await thread.getByRole("textbox", { name: "Reply" }).fill("Agreed. Closing R-12 at 11:30, Marek owns comms.");
    await thread.getByLabel("Record this as the decision").check();
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(thread.getByRole("note")).toContainText("Decision recorded");
    await olena.screenshot({ path: "test-results/s1.4-chat.png" });
    // Recorded: in the audit log, and found in search by those in the room.
    const audit = await (await olena.request.get("/api/v1/admin/audit?action=chat.decision_recorded", { headers })).json();
    expect(JSON.stringify(audit.events[0])).toContain("Closing R-12 at 11:30");
    const found = await (await people.Marek!.request.get("/api/v1/search?q=comms", { headers })).json();
    expect(found.results.length).toBeGreaterThan(0);
  });

  step("S3.8", async ({ browser, ortus }) => {
    const iryna = await colleague(browser, ortus.url, "Iryna Savchenko", "iryna@ministry.example");
    // Her team channel; she finds it and joins.
    const team = await olena.request.post("/api/v1/chat/rooms", { headers, data: { kind: "channel", name: "logistics", topic: "The logistics team" } });
    expect(team.ok()).toBeTruthy();
    await iryna.goto("/chat");
    const main = iryna.locator("ortus-chat-main");
    await main.getByRole("button", { name: "Browse channels" }).click();
    await main.getByRole("dialog", { name: "Browse channels" }).getByRole("listitem").filter({ hasText: "logistics" }).getByRole("button", { name: "Join" }).click();
    const box = main.getByRole("textbox", { name: /Message/ });
    await box.fill("Hello everyone, I'm Iryna. I start in logistics today.");
    await box.press("Enter");
    await expect(main.getByRole("region", { name: "Messages" })).toContainText("I start in logistics today.");
    await iryna.screenshot({ path: "test-results/s3.8-chat.png" });

    // Marek invites her to her first meeting; she accepts it in Calendar.
    // The next working day at 10:00 UTC (the week view shows Monday to
    // Friday).
    const day = new Date();
    day.setUTCHours(10, 0, 0, 0);
    do day.setUTCDate(day.getUTCDate() + 1);
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
    const start = day.getTime();
    const event = await people.Marek!.request.post("/api/v1/calendar/events", { headers, data: { summary: "Logistics stand-up", start, end: start + 30 * 60 * 1000, attendees: ["iryna@ministry.example"] } });
    expect(event.ok(), await event.text()).toBeTruthy();
    // The week of the meeting.
    await iryna.goto(`/calendar?date=${start}`);
    const calendar = iryna.locator("ortus-calendar-week");
    await calendar.getByRole("button", { name: /Logistics stand-up/ }).first().click();
    const viewer = calendar.getByRole("dialog", { name: "Logistics stand-up" });
    await viewer.getByRole("button", { name: "Accept" }).click();
    const mine = await (await iryna.request.get(`/api/v1/calendar/events?from=${start - 3600000}&to=${start + 3600000}`, { headers })).json();
    const ev = mine.events.find((e: { summary: string }) => e.summary === "Logistics stand-up");
    expect(String(ev.answer).toLowerCase()).toBe("accepted");
  });
});
