// S2.4  Taras imports the mailboxes from the old server. Two accounts fail
//       (the passwords he was given are wrong); he fixes both with the right
//       ones and their mail arrives in Ortus. (The phones' Admin screen does
//       the same from his phone: ortus-ios and ortus-android, against Ortus.)
//
// The old server is an older Ortus with IMAP over TLS and a certificate of
// its own, which the new installation trusts (ORTUS_IMPORT_CA).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext, Browser } from "@playwright/test";
import { startOrtus, type Installation } from "../harness/ortus.ts";
import { deliver } from "../harness/smtp.ts";
import { expect, step, story, test } from "../harness/story.ts";

const XRW = { "X-Requested-With": "ortus" };

// The old server's certificate, made once for this file.
const certs = mkdtempSync(join(tmpdir(), "ortus-old-server-"));
const ca = join(certs, "ca.pem");
const cert = join(certs, "cert.pem");
const key = join(certs, "key.pem");
// A small CA and the server's certificate from it (a CA certificate is not
// taken as a server's own).
const run = (args: string[]) => execFileSync("openssl", args, { stdio: "ignore" });
run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(certs, "ca.key"), "-out", ca, "-days", "2", "-subj", "/CN=test-ca"]);
run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", join(certs, "cert.csr"), "-subj", "/CN=old-server"]);
writeFileSync(join(certs, "cert.ext"), "subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
run(["x509", "-req", "-in", join(certs, "cert.csr"), "-CA", ca, "-CAkey", join(certs, "ca.key"), "-CAcreateserial", "-days", "2", "-extfile", join(certs, "cert.ext"), "-out", cert]);
test.use({ ortusEnv: { ORTUS_IMPORT_CA: ca } });

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => done(typeof a === "object" && a ? a.port : 0));
    });
  });
}

async function ok(r: Promise<import("@playwright/test").APIResponse>): Promise<Record<string, unknown>> {
  const response = await r;
  expect(response.ok(), `${response.url()}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

/** Someone invited on an installation, signed in by their invitation. */
async function person(browser: Browser, owner: APIRequestContext, url: string, email: string, name: string): Promise<APIRequestContext> {
  const made = await ok(owner.post(`${url}/api/v1/admin/users`, { headers: XRW, data: { email, name } }));
  const context = await browser.newContext({ baseURL: url });
  await ok(context.request.post("/api/v1/invitation/accept", { headers: XRW, data: { token: new URL(made.link as string).hash.slice(1) } }));
  return context.request;
}

let old: Installation | undefined;
test.afterAll(async () => {
  await old?.stop();
});

story("Story 2 · Mailboxes from the old server", () => {
  step("S2.4", async ({ browser, page, ortus }) => {
    test.setTimeout(180_000);
    // The old server: Olena's and Marek's mailboxes, with mail in them.
    const imaps = await freePort();
    old = await startOrtus({ ORTUS_MAIL_TLS_CERT: cert, ORTUS_MAIL_TLS_KEY: key, ORTUS_IMAPS_LISTEN: `127.0.0.1:${imaps}`, ORTUS_MAIL_HOSTNAME: "mail.old.example" });
    const oldOwner = await browser.newContext({ baseURL: old.url });
    await ok(oldOwner.request.post("/api/v1/setup", { headers: XRW, data: { token: old.setupToken, name: "Old Admin", email: "admin@old.example" } }));
    await ok(oldOwner.request.post("/api/v1/mail/admin/domains", { headers: XRW, data: { domain: "old.example" } }));
    const passwords: Record<string, string> = {};
    for (const [login, name, subject] of [
      ["olena@old.example", "Olena Hrytsenko", "Shelter agreement 2025"],
      ["marek@old.example", "Marek Nowak", "Bus contract 2025"],
    ] as const) {
      const them = await person(browser, oldOwner.request, old.url, login, name);
      passwords[login] = (await ok(them.post("/api/v1/me/app-passwords", { headers: XRW, data: { name: "Migration" } }))).password as string;
      await deliver(old.smtpPort, "anna@regional.example", login, `From: Anna Kowalska <anna@regional.example>\r\nTo: ${login}\r\nSubject: ${subject}\r\nMessage-ID: <${login}.1@regional.example>\r\nDate: Thu, 19 Nov 2026 08:05:00 +0000\r\n\r\nClause 4 is signed.\r\n`);
    }

    // The new installation: Taras, the domain, and the two people.
    await page.goto(`/setup#${ortus.setupToken}`);
    await page.getByLabel("Your name").fill("Taras Bondar");
    await page.getByLabel("Work email").fill("taras@ministry.example");
    await page.getByRole("button", { name: "Create the owner" }).click();
    await expect(page.locator("ortus-shell")).toBeAttached();
    await ok(page.request.post("/api/v1/mail/admin/domains", { headers: XRW, data: { domain: "ministry.example" } }));
    const olena = await person(browser, page.request, ortus.url, "olena@ministry.example", "Olena Hrytsenko");
    await person(browser, page.request, ortus.url, "marek@ministry.example", "Marek Nowak");

    // He starts the import with the passwords he was given: both wrong.
    await page.goto("/admin/migrations");
    await page.getByRole("button", { name: "New import" }).first().click();
    const form = page.getByRole("region", { name: "New import" });
    await form.getByRole("textbox", { name: "Old server" }).fill("127.0.0.1");
    await form.getByRole("textbox", { name: "Port" }).fill(String(imaps));
    await form.getByRole("combobox", { name: "Security" }).selectOption({ label: "TLS (993)" });
    await form.getByRole("textbox", { name: "Accounts to copy" }).fill("olena@old.example, not-it, olena@ministry.example\nmarek@old.example, not-it-either, marek@ministry.example");
    await form.getByRole("button", { name: "Start copying" }).click();
    await expect(page.getByText("Copying 2 accounts.")).toBeVisible();

    // Both fail.
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("2 failed")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });

    // He puts in the right passwords and retries each.
    for (const login of ["olena@old.example", "marek@old.example"]) {
      await page.getByLabel(`New password for ${login}`).fill(passwords[login]!);
      await page.getByRole("row").filter({ hasText: login }).getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText(`Trying ${login} again.`)).toBeVisible();
    }

    // Both copy; their mail is in Ortus.
    await expect(async () => {
      const imports = (await ok(page.request.get("/api/v1/mail/admin/imports"))).imports as { accounts: { login: string; state: string }[] }[];
      const states = imports.flatMap((i) => i.accounts).map((a) => `${a.login}:${a.state}`).sort();
      expect(states).toEqual(["marek@old.example:done", "olena@old.example:done"]);
    }).toPass({ timeout: 90_000 });
    await page.reload();
    await expect(page.getByText(/\d+ failed/)).toHaveCount(0);
    // Olena's mailbox holds her old mail (JMAP, as her mail apps read it).
    const got = await ok(olena.post("/api/v1/mail/web/jmap", {
      headers: XRW,
      data: { using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"], methodCalls: [["Email/query", {}, "q"], ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["subject"] }, "g"]] },
    }));
    expect(JSON.stringify(got.methodResponses)).toContain("Shelter agreement 2025");
  });
});
