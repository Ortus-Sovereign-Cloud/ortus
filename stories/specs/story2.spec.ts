// Story 2: an IT admin sets up the organisation.
//
// S2.1  Taras opens the admin console for the first time and follows the
//       setup checklist: creates the owner, saves the recovery kit, adds a
//       passkey, signs out and back in with it, confirms where data lives.
// S2.3  Taras connects the HR directory and imports users and groups
//       (a test OpenLDAP, ORTUS_TEST_LDAP; CI requires it).
// S2.8  Taras sets data location, keys, federation partners and
//       retention on the Sovereignty screen; each change is audited.
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
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
});
