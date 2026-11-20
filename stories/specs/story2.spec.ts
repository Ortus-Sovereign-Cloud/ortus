// Story 2: an IT admin sets up the organisation.
//
// S2.1  Taras opens the admin console for the first time and follows the
//       setup checklist: creates the owner, saves the recovery kit, adds a
//       passkey, signs out and back in with it, confirms where data lives.
// S2.2  Taras adds ministry.example, copies the DNS records into the
//       (test) DNS, and waits for the checks to turn green.
// S2.3  Taras connects the HR directory and imports users and groups
//       (a test OpenLDAP, ORTUS_TEST_LDAP; CI requires it).
// S2.8  Taras sets data location, keys, federation partners and
//       retention on the Sovereignty screen; each change is audited.
// S2.9  After two clean weeks of DMARC reports (our servers pass), Taras
//       switches DMARC from p=none to quarantine and the domain is verified.
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { deliver } from "../harness/smtp.ts";
import { expect, step, story, test } from "../harness/story.ts";

/** A virtual authenticator for this browser, as a phone or laptop would have. */
async function authenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

function checklistStep(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title });
}

/** Taras's browser, kept between the steps of the story. */
const tarasState = (dataDir: string) => join(dataDir, "taras.json");

async function asTaras(browser: { newContext(o: object): Promise<BrowserContext> }, dataDir: string): Promise<Page> {
  const context = await browser.newContext({ storageState: tarasState(dataDir) });
  return context.newPage();
}

story("Story 2", () => {
  step("S2.1", async ({ page, ortus }) => {
    await authenticator(page);
    await page.goto(`/setup#${ortus.setupToken}`);
    await page.getByLabel("Your name").fill("Taras Bondar");
    await page.getByLabel("Work email").fill("taras@ministry.example");
    await page.getByRole("button", { name: "Create the owner" }).click();
    await expect(page.locator("ortus-shell")).toBeAttached();

    // The admin console opens on the checklist.
    await page.getByRole("navigation").getByRole("link", { name: "Admin" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Taras. 6 steps to go live.");
    await expect(page.getByText("0 of 6 done")).toBeVisible();

    // 1. The recovery kit, and a passkey while there.
    await checklistStep(page, "Save the recovery kit").getByRole("link", { name: "Save the kit" }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    await page.getByRole("button", { name: "Make a recovery kit" }).click();
    await expect(page.getByText("Your new codes are below. They are shown only now.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Work laptop");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("The passkey is added.")).toBeVisible();

    // Signed out, the passkey signs Taras back in.
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page.locator("ortus-shell")).toBeAttached();

    // 5. Where data lives, confirmed; the checklist keeps count.
    await page.goto("/admin");
    await expect(checklistStep(page, "Save the recovery kit").getByText("Done", { exact: true })).toBeVisible();
    const data = checklistStep(page, "Confirm where data lives");
    await expect(data).toContainText(ortus.shape === "cluster" ? "PostgreSQL" : "SQLite");
    await data.getByRole("button", { name: "Confirm" }).click();
    await expect(data.getByText("Done", { exact: true })).toBeVisible();
    await expect(page.getByText("2 of 6 done")).toBeVisible();
    await page.context().storageState({ path: tarasState(ortus.dataDir) });
  });

  step("S2.2", async ({ browser, ortus }) => {
    const page = await asTaras(browser, ortus.dataDir);
    await page.goto("/admin/domains");
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByLabel("Domain", { exact: true }).fill("ministry.example");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const tab = page.getByRole("tab", { name: /ministry\.example/ });
    await expect(tab).toContainText("Waiting for DNS");

    // He copies each record from the table into the DNS provider.
    const records = page.getByRole("row");
    const value = async (purpose: string) => (await records.filter({ hasText: purpose }).locator("td.value code").getAttribute("title"))!;
    const name = async (purpose: string) => (await records.filter({ hasText: purpose }).locator("td.name code").textContent())!;
    ortus.dns.publish("ministry.example", "MX", [{ preference: 10, exchange: "mail.ministry.example" }]);
    ortus.dns.publish("ministry.example", "TXT", [[await value("SPF")]]);
    const dkim = await value("DKIM RSA");
    ortus.dns.publish(`${await name("DKIM RSA")}.ministry.example`, "TXT", [dkim.match(/.{1,255}/g)]);
    ortus.dns.publish("_dmarc.ministry.example", "TXT", [[await value("DMARC")]]);

    // The checks turn green.
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(tab).toContainText("Verified");
    for (const purpose of ["Receive mail", "SPF", "DKIM RSA", "DMARC"]) {
      await expect(records.filter({ hasText: purpose }).first()).toContainText("OK");
    }
    await page.context().close();
  });

  step("S2.3", async ({ browser, ortus }) => {
    const directory = process.env.ORTUS_TEST_LDAP;
    test.skip(!directory && !process.env.ORTUS_REQUIRE_LDAP, "needs a test directory: .deps/ortus-core/ci/ldap-test.sh, then export ORTUS_TEST_LDAP");
    expect(directory, "ORTUS_REQUIRE_LDAP is set but ORTUS_TEST_LDAP is not").toBeTruthy();
    const page = await asTaras(browser, ortus.dataDir);
    await page.goto("/admin");
    await checklistStep(page, "Bring in your people").getByRole("link", { name: "Bring people in" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);

    await page.getByRole("button", { name: "Connect directory" }).click();
    await page.getByLabel("Directory address").fill(directory!);
    await page.getByLabel("Sign in as (bind DN)").fill("cn=admin,dc=ministry,dc=example");
    await page.getByLabel("Password").fill("adminpass");
    await page.getByLabel("Search under (base DN)").fill("dc=ministry,dc=example");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("The directory is connected.");

    await page.getByRole("button", { name: "Sync from directory" }).click();
    await expect(page.getByRole("status")).toHaveText("New people: 2. Updated: 0. Groups: 1.");
    await page.getByLabel("Filter by name, address or group").fill("logistics");
    await expect(page.getByRole("row").filter({ hasText: "olena@ministry.example" })).toContainText("Invited");
    await expect(page.getByRole("row").filter({ hasText: "marek@ministry.example" })).toContainText("Invited");

    await page.goto("/admin");
    await expect(checklistStep(page, "Bring in your people").getByText("Done", { exact: true })).toBeVisible();
    await expect(page.getByText("3 of 6 done")).toBeVisible();
    await page.context().close();
  });

  step("S2.8", async ({ browser, ortus }) => {
    const page = await asTaras(browser, ortus.dataDir);
    await page.goto("/admin/sovereignty");
    await expect(page.getByRole("heading", { level: 1, name: "Sovereignty & compliance" })).toBeVisible();
    // Data location and keys: where things are, said plainly.
    await expect(page.getByRole("region", { name: "Data location" })).toContainText(ortus.shape === "cluster" ? "PostgreSQL" : "SQLite");
    await expect(page.getByRole("region", { name: "Data location" })).toContainText("No calls to third-party clouds");
    await expect(page.getByRole("region", { name: "Encryption keys" })).toContainText("AES-256-GCM");

    // Federation: the health ministry may exchange mail and chat.
    await page.getByRole("button", { name: "+ Allow an organisation" }).click();
    await page.getByLabel("Domain").fill("health.example.gov");
    await page.getByLabel("Name", { exact: true }).fill("Ministry of Health");
    await page.getByRole("checkbox", { name: "Chat" }).check();
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByRole("region", { name: "Federation" })).toContainText("health.example.gov");

    // Retention: chat kept seven years, recordings one.
    await page.getByLabel("Chat messages").selectOption("2555");
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await page.getByLabel("Call recordings").selectOption("365");

    // Every change is in the audit log, and the chain holds.
    const audit = await (await page.request.get("/api/v1/admin/audit?action=policy.partner_added")).json();
    expect(audit.events[0].detail).toContain("health.example.gov");
    const retention = await (await page.request.get("/api/v1/admin/audit?action=retention.changed")).json();
    expect(retention.events.length).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText(/last check .* OK/)).toBeVisible();
    await page.context().close();
  });
  step("S2.9", async ({ browser, ortus }) => {
    const page = await asTaras(browser, ortus.dataDir);
    // He started cautiously: DMARC at p=none, so spoofed mail still lands.
    ortus.dns.publish("_dmarc.ministry.example", "TXT", [["v=DMARC1; p=none; rua=mailto:dmarc-reports@ministry.example"]]);
    ortus.dns.publish("mail.ministry.example", "A", ["192.0.2.10"]);
    await page.goto("/admin/domains");
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByRole("tab", { name: /ministry\.example/ })).toContainText("Needs 1 fix");

    // Two weeks of reports from a large provider: only our servers send as us.
    const now = Math.floor(Date.now() / 1000);
    for (let day = 14; day >= 1; day--) {
      const end = now - (day - 1) * 86400;
      const xml = `<?xml version="1.0"?><feedback><report_metadata><org_name>google.com</org_name><report_id>s29-${day}</report_id><date_range><begin>${end - 86400}</begin><end>${end}</end></date_range></report_metadata><policy_published><domain>ministry.example</domain><p>none</p></policy_published><record><row><source_ip>192.0.2.10</source_ip><count>${1200 + day}</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>ministry.example</header_from></identifiers></record></feedback>`;
      const attachment = gzipSync(Buffer.from(xml)).toString("base64").replace(/.{76}/g, "$&\n");
      const message = `From: noreply-dmarc-support@google.com\nTo: dmarc-reports@ministry.example\nSubject: Report domain: ministry.example\nMessage-ID: <s29-${day}@google.com>\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: application/gzip; name="google.com!ministry.example!${day}.xml.gz"\nContent-Disposition: attachment\nContent-Transfer-Encoding: base64\n\n${attachment}\n--b--\n`;
      expect(await deliver(ortus.smtpPort, "noreply-dmarc-support@google.com", "dmarc-reports@ministry.example", message)).toMatch(/^250/);
    }
    await page.goto("/admin/deliverability");
    const senders = page.getByRole("region", { name: "Who sends as ministry.example" });
    await expect(senders.getByRole("listitem")).toHaveCount(1);
    await expect(senders.getByRole("listitem")).toContainText("Our servers");
    await expect(senders.getByRole("listitem")).toContainText("Pass");

    // Clean: he switches DMARC to quarantine, and the domain is verified.
    await page.goto("/admin/domains");
    await expect(page.getByRole("note")).toContainText("p=none");
    const dmarc = await (await page.request.get("/api/v1/mail/admin/domains/ministry.example")).json();
    const value = dmarc.records.find((r: { purpose: string }) => r.purpose === "dmarc").value;
    expect(value).toContain("p=quarantine");
    ortus.dns.publish("_dmarc.ministry.example", "TXT", [[value]]);
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByRole("tab", { name: /ministry\.example/ })).toContainText("Verified");
    await expect(page.getByRole("note")).toHaveCount(0);
    await page.context().close();
  });
});
