// Calendar with the world outside (task 4.9), on the release program:
//
//  - an invitation round trip with a real outside mail server (Postfix,
//    ci/outside-mail.sh): Olena invites bob@outside.example from the web
//    calendar; Bob's server gets the iMIP REQUEST; his REPLY comes back
//    through Postfix and his answer shows in Olena's calendar and inbox.
//    Bob then invites Olena; she accepts in her inbox and his server gets
//    her REPLY.
//  - a CalDAV client syncing: an app password, the well-known name,
//    sync-collection both ways.
//
// It needs Postfix (ORTUS_TEST_OUTSIDE_MAILDIR); with ORTUS_REQUIRE_OUTSIDE
// set it fails without it. Ortus listens for mail on 127.0.0.1:2526,
// where Postfix hands mail for ministry.example.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { deliver } from "../harness/smtp.ts";
import { startOrtus, type Installation } from "../harness/ortus.ts";

const maildir = process.env.ORTUS_TEST_OUTSIDE_MAILDIR;
if (!maildir && process.env.ORTUS_REQUIRE_OUTSIDE) throw new Error("ORTUS_REQUIRE_OUTSIDE is set but ORTUS_TEST_OUTSIDE_MAILDIR is not: run ci/outside-mail.sh");

test.describe.configure({ mode: "serial" });
test.skip(!maildir, "no outside mail server (ci/outside-mail.sh)");

let ortus: Installation;
let page: Page;
let davPort = 0;
const seen = new Set<string>();

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** The next new message in Bob's Maildir that contains `text`. */
async function bobGets(text: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const folder of ["new", "cur"]) {
      const dir = join(maildir!, folder);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (seen.has(name)) continue;
        const body = readFileSync(join(dir, name), "utf8");
        if (body.includes(text)) {
          seen.add(name);
          return body.replace(/=\r?\n/g, "");
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Bob got no mail with ${text}:\n${ortus.log.slice(-40).join("")}`);
}

function calendarMail(subject: string, ics: string): string {
  return [
    "From: Bob Outside <bob@outside.example>",
    "To: Olena Hrytsenko <olena@ministry.example>",
    `Subject: ${subject}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@outside.example>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=utf-8",
    "",
    subject,
    "--b",
    `Content-Type: text/calendar; charset=utf-8; method=${/METHOD:(\w+)/.exec(ics)?.[1] ?? "REQUEST"}`,
    "",
    ics,
    "--b--",
    "",
  ].join("\r\n");
}

test.beforeAll(async ({ browser }) => {
  davPort = await freePort();
  ortus = await startOrtus({
    ORTUS_SMTP_LISTEN: "127.0.0.1:2526",
    ORTUS_SMTP_OUTBOUND_PORT: "2525",
    ORTUS_SMTP_ALLOW_PRIVATE: "1",
    ORTUS_DAV_LISTEN: `127.0.0.1:${davPort}`,
  });
  // Bob's domain: his server on this machine, and his SPF and DMARC.
  ortus.dns.publish("outside.example", "MX", [{ preference: 10, exchange: "mail.outside.example" }]);
  ortus.dns.publish("mail.outside.example", "A", ["127.0.0.1"]);
  ortus.dns.publish("outside.example", "TXT", [["v=spf1 ip4:127.0.0.1 -all"]]);
  ortus.dns.publish("_dmarc.outside.example", "TXT", [["v=DMARC1; p=none"]]);
  // Mail already in the Maildir is not this run's.
  for (const folder of ["new", "cur"]) {
    const dir = join(maildir!, folder);
    if (existsSync(dir)) for (const name of readdirSync(dir)) seen.add(name);
  }
  page = await (await browser.newContext({ baseURL: ortus.url, timezoneId: "UTC" })).newPage();
  await page.goto(`/setup#${ortus.setupToken}`);
  await page.getByLabel("Your name").fill("Olena Hrytsenko");
  await page.getByLabel("Work email").fill("olena@ministry.example");
  await page.getByRole("button", { name: "Create the owner" }).click();
  await expect(page.locator("ortus-shell")).toBeAttached();
  const added = await page.request.post("/api/v1/mail/admin/domains", { headers: { "X-Requested-With": "ortus" }, data: { domain: "ministry.example" } });
  expect(added.status(), await added.text()).toBe(200);
});

test.afterAll(async () => {
  await page?.context().close();
  await ortus?.stop();
});

test("an invitation goes out through a real mail server and the answer comes back", async () => {
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/calendar");
  const week = page.locator("ortus-calendar-week");
  await week.getByRole("button", { name: "New event" }).click();
  const editor = week.getByRole("dialog", { name: "New event" });
  await editor.getByLabel("Title").fill("Shelter agreement review");
  await editor.getByLabel("Date").fill(day);
  await editor.getByLabel("Starts").fill("14:00");
  await editor.getByLabel("Ends").fill("14:30");
  await editor.getByLabel("Attendees").fill("bob@outside.example");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();

  // Bob's server has the invitation, from Olena, signed.
  const request = await bobGets("Shelter agreement review");
  expect(request).toContain("METHOD:REQUEST");
  expect(request).toMatch(/DKIM-Signature: .*d=ministry\.example/s);
  const uid = /UID:(\S+)/.exec(request)![1]!;

  // He accepts in his own calendar app; the REPLY goes back through his server.
  const reply = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bob//EN", "METHOD:REPLY", "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261120T120000Z", `DTSTART:${day.replace(/-/g, "")}T140000Z`, "ORGANIZER:mailto:olena@ministry.example", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:bob@outside.example", "SUMMARY:Shelter agreement review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  await deliver(2525, "bob@outside.example", "olena@ministry.example", calendarMail("Accepted: Shelter agreement review", reply));

  // Olena's calendar shows Bob's answer; her inbox says so.
  await expect
    .poll(
      async () => {
        const from = Date.parse(`${day}T00:00:00Z`);
        const r = await (await page.request.get(`/api/v1/calendar/events?from=${from}&to=${from + 86_400_000}`)).json();
        return r.events?.[0]?.attendees?.find((a: { email: string }) => a.email === "bob@outside.example")?.answer;
      },
      { timeout: 60_000 },
    )
    .toBe("ACCEPTED");
  await page.goto("/mail");
  const inbox = page.locator("ortus-mail-inbox");
  await inbox.getByRole("button", { name: /Bob Outside/ }).click();
  await expect(inbox.getByRole("status").filter({ hasText: "Bob accepted “Shelter agreement review”." })).toBeVisible();
});

test("an invitation from outside is answered in the inbox", async () => {
  const day = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  const invite = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bob//EN", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:levels@outside.example", "DTSTAMP:20261120T120000Z", `DTSTART:${day}T090000Z`, `DTEND:${day}T094500Z`, "SUMMARY:River levels briefing", "ORGANIZER;CN=Bob Outside:mailto:bob@outside.example", "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:olena@ministry.example", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  await deliver(2525, "bob@outside.example", "olena@ministry.example", calendarMail("Invitation: River levels briefing", invite));
  await page.goto("/mail");
  const inbox = page.locator("ortus-mail-inbox");
  const item = inbox.getByRole("button", { name: /Invitation: River levels briefing/ });
  await expect(item).toBeVisible({ timeout: 60_000 });
  await expect(item).toContainText("Invite");
  await item.click();
  const card = inbox.getByRole("region", { name: "Invitation", exact: true });
  await expect(card).toContainText("River levels briefing");
  await expect(card).toContainText("You're free");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByRole("button", { name: "Accept" })).toHaveAttribute("aria-pressed", "true");

  // Bob's server gets her answer.
  const answer = await bobGets("UID:levels@outside.example");
  expect(answer).toContain("METHOD:REPLY");
  expect(answer).toContain("PARTSTAT=ACCEPTED");
  await page.screenshot({ path: "test-results/calendar-invite.png" });
});

test("a CalDAV app syncs both ways", async () => {
  const made = await page.request.post("/api/v1/me/app-passwords", { headers: { "X-Requested-With": "ortus" }, data: { name: "Phone calendar" } });
  const password = (await made.json()).password as string;
  const auth = `Basic ${Buffer.from(`olena@ministry.example:${password}`).toString("base64")}`;
  const dav = `http://127.0.0.1:${davPort}`;
  const ask = (method: string, path: string, body?: string, headers: Record<string, string> = {}) => fetch(`${dav}${path}`, { method, body, redirect: "manual", headers: { Authorization: auth, "Content-Type": "application/xml", ...headers } });

  // The well-known name leads to the calendars; the home lists them.
  const known = await ask("PROPFIND", "/.well-known/caldav");
  expect(known.status).toBe(301);
  const home = await ask("PROPFIND", "/dav/calendar/home/", '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:sync-token/></d:prop></d:propfind>', { Depth: "1" });
  expect(home.status).toBe(207);
  const listing = await home.text();
  const collection = [...listing.matchAll(/<D:href>([^<]+\/)<\/D:href>/g)].map((m) => m[1]!).find((h) => h !== "/dav/calendar/home/")!;
  expect(collection).toBeTruthy();

  // Down: the web's events are there.
  const sync = (token: string) => ask("REPORT", collection, `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`);
  const first = await (await sync("")).text();
  const token = /<D:sync-token>([^<]+)<\/D:sync-token>/.exec(first)![1]!;
  const hrefs = [...first.matchAll(/<D:href>([^<]+\.ics)<\/D:href>/g)].map((m) => m[1]!);
  const bodies = await Promise.all(hrefs.map(async (h) => (await ask("GET", h)).text()));
  expect(bodies.some((b) => b.includes("Shelter agreement review"))).toBe(true);
  expect(bodies.some((b) => b.includes("River levels briefing"))).toBe(true);

  // Up: an event the app makes shows on the web; the next sync names only it.
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const put = await ask("PUT", `${collection}from-phone.ics`, ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Phone//EN", "BEGIN:VEVENT", "UID:phone-1@outside.example", "DTSTAMP:20261120T120000Z", `DTSTART:${day.replace(/-/g, "")}T100000Z`, `DTEND:${day.replace(/-/g, "")}T110000Z`, "SUMMARY:Made on the phone", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n"), { "Content-Type": "text/calendar", "If-None-Match": "*" });
  expect(put.status).toBe(201);
  const next = await (await sync(token)).text();
  expect(next).toContain("from-phone.ics");
  expect(next).not.toContain(hrefs[0]!);
  await page.goto(`/calendar?view=day&date=${Date.parse(`${day}T00:00:00Z`)}`);
  await expect(page.locator("ortus-calendar-week").locator(".ev", { hasText: "Made on the phone" })).toBeVisible();
});
