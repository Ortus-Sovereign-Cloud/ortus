// Story 3: a new employee's first day, from her invitation to her welcome page.
//
// S3.1    Taras invites Iryna from the admin console, into the Logistics
//         group (her laptop comes with Ortus OS, V2).
// S3.3–4  Iryna opens her invitation, picks her language (Ukrainian) and
//         makes her device her key (a passkey; the phone apps make the
//         phone her key, tested in ortus-ios and ortus-android).
// S3.6    Her welcome page: her people (Marek from Logistics, and Taras
//         for help) and three things to do today, the key one done.
import type { BrowserContext, Page } from "@playwright/test";
import { join } from "node:path";
import { expect, step, story } from "../harness/story.ts";

const XRW = { "X-Requested-With": "ortus" };

async function authenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const state = (dataDir: string, who: string) => join(dataDir, `${who}.json`);
const link = (dataDir: string) => join(dataDir, "iryna-link.txt");

async function as(browser: { newContext(o: object): Promise<BrowserContext> }, dataDir: string, who: string): Promise<Page> {
  const context = await browser.newContext({ storageState: state(dataDir, who) });
  return context.newPage();
}

story("Story 3 · First day", () => {
  step("S3.1", async ({ page, ortus }) => {
    await page.goto(`/setup#${ortus.setupToken}`);
    await page.getByLabel("Your name").fill("Taras Bondar");
    await page.getByLabel("Work email").fill("taras@ministry.example");
    await page.getByRole("button", { name: "Create the owner" }).click();
    await expect(page.locator("ortus-shell")).toBeAttached();
    // Marek is already in Logistics.
    const marek = await page.request.post("/api/v1/admin/users", { headers: XRW, data: { email: "marek@ministry.example", name: "Marek Nowak", groups: ["Logistics"] } });
    expect(marek.ok(), await marek.text()).toBeTruthy();
    const token = new URL(((await marek.json()) as { link: string }).link).hash.slice(1);
    const accepted = await page.context().browser()!.newContext();
    expect((await accepted.request.post("/api/v1/invitation/accept", { headers: XRW, data: { token } })).ok()).toBeTruthy();
    await accepted.close();

    // Taras invites Iryna from the people screen.
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Invite people" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite people" });
    await dialog.getByLabel("Name").fill("Iryna Melnyk");
    await dialog.getByLabel("Work email").fill("iryna@ministry.example");
    await dialog.getByLabel("Role").selectOption("member");
    await dialog.getByLabel("Groups (comma separated)").fill("Logistics");
    const sent = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/users") && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    const answer = await sent;
    expect(answer.ok(), await answer.text()).toBeTruthy();
    await expect(page.getByText("Invitation sent.")).toBeVisible();
    // She is listed, invited, in Logistics.
    const row = page.getByRole("row").filter({ hasText: "iryna@ministry.example" });
    await expect(row).toContainText("Iryna Melnyk");
    const listed = (await (await page.request.get("/api/v1/admin/users?q=iryna")).json()) as { users: { email: string; state: string; groups: string[] }[] };
    const iryna = listed.users.find((u) => u.email === "iryna@ministry.example")!;
    expect(iryna.state).toBe("invited");
    expect(iryna.groups).toContain("Logistics");
    // The link her welcome letter carries.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(link(ortus.dataDir), ((await answer.json()) as { link: string }).link);
  });

  step("S3.3–4", async ({ browser, ortus }) => {
    const { readFileSync } = await import("node:fs");
    const url = new URL(readFileSync(link(ortus.dataDir), "utf8"));
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticator(page);
    await page.goto(url.pathname + url.hash);
    await expect(page).toHaveURL(/\/welcome$/);

    // She picks her language: the workspace speaks Ukrainian.
    await page.goto("/settings");
    await page.getByRole("region", { name: "Language & accessibility" }).getByLabel("Language").selectOption("uk");
    await expect(page.getByRole("heading", { name: "Мова й доступність" })).toBeVisible();
    const prefs = (await (await page.request.get("/api/v1/me")).json()) as { language?: string | null; preferences?: { language?: string } };
    expect(prefs.language ?? prefs.preferences?.language).toBe("uk");

    // Her device becomes her key.
    await page.goto("/settings/security");
    await page.getByLabel("Назва", { exact: true }).fill("Робочий телефон");
    await page.getByRole("button", { name: "Додати ключ доступу" }).click();
    await expect(page.getByText("Ключ доступу додано.")).toBeVisible();
    const security = (await (await page.request.get("/api/v1/me/security")).json()) as { passkeys: { name: string }[] };
    expect(security.passkeys.map((p) => p.name)).toContain("Робочий телефон");
    await context.storageState({ path: state(ortus.dataDir, "iryna") });
    await context.close();
  });

  step("S3.6", async ({ browser, ortus }) => {
    const page = await as(browser, ortus.dataDir, "iryna");
    await page.goto("/welcome");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вітаємо, Iryna");
    // Her people: Marek from Logistics, and Taras for help.
    const people = page.getByRole("region", { name: "Ваші люди" });
    await expect(people).toContainText("Marek Nowak");
    await expect(people).toContainText("Logistics");
    await expect(people).toContainText("Taras Bondar");
    await expect(people).toContainText("Допомога з цим простором");
    // Three things to do today; the key is done already.
    await expect(page.getByRole("heading", { level: 2, name: "Налаштуйте вхід" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Прочитайте умови користування" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Привітайтеся з командою" })).toBeVisible();
    await expect(page.getByText("Ви в групах: Logistics. Представтеся їм.")).toBeVisible();
    await expect(page.getByText("Виконано 1 з 3")).toBeVisible();
  });
});
