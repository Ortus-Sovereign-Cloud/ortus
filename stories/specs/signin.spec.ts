// Signing in with passkeys, and the policy that keeps it that way.
//
// S1.1  Olena signs in on the web with her passkey (the V1 stand-in for the
//       workstation's QR sign-in): her key, made when she joined, opens
//       her workspace with no password.
// S2.5  Taras keeps passkeys on (the phone, the computer or a security key)
//       and turns passwords off. While someone still signs in with a
//       password only, Ortus refuses, naming them; once they are set to
//       start again, passwords are off and a password sign-in is refused.
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { expect, step, story } from "../harness/story.ts";

const XRW = { "X-Requested-With": "ortus" };

/** A virtual authenticator for this browser, as a phone or laptop would have. */
async function authenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** Adds a passkey on the security page and waits until it is there. */
async function addPasskey(page: Page, name: string): Promise<void> {
  await page.goto("/settings/security");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("The passkey is added.")).toBeVisible();
}

/** The authenticator app's code now (RFC 6238, SHA-1, 30 s, 6 digits). */
function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const state = (dataDir: string, who: string) => join(dataDir, `${who}.json`);

async function as(browser: { newContext(o: object): Promise<BrowserContext> }, dataDir: string, who: string): Promise<Page> {
  const context = await browser.newContext({ storageState: state(dataDir, who) });
  return context.newPage();
}

/** An invitation made by Taras through the API, as its link. */
async function invite(request: APIRequestContext, email: string, name: string): Promise<string> {
  const made = await request.post("/api/v1/admin/users", { headers: XRW, data: { email, name } });
  expect(made.ok(), await made.text()).toBeTruthy();
  return ((await made.json()) as { link: string }).link;
}

story("Story 1 and 2 · Sign-in", () => {
  step("S1.1", async ({ browser, page, ortus }) => {
    // The installation's owner, with a passkey, as on the first day.
    await authenticator(page);
    await page.goto(`/setup#${ortus.setupToken}`);
    await page.getByLabel("Your name").fill("Taras Bondar");
    await page.getByLabel("Work email").fill("taras@ministry.example");
    await page.getByRole("button", { name: "Create the owner" }).click();
    await expect(page.locator("ortus-shell")).toBeAttached();
    await addPasskey(page, "Work laptop");
    await page.context().storageState({ path: state(ortus.dataDir, "taras") });

    // Olena joined earlier by her invitation and made her passkey then.
    const link = await invite(page.request, "olena@ministry.example", "Olena Hrytsenko");
    const context = await browser.newContext();
    const olena = await context.newPage();
    await authenticator(olena);
    await olena.goto(new URL(link).pathname + new URL(link).hash);
    await expect(olena).toHaveURL(/\/welcome$/);
    await addPasskey(olena, "Workstation");
    await olena.goto("/settings");
    await olena.getByRole("button", { name: "Sign out" }).click();
    await expect(olena).toHaveURL(/\/sign-in$/);

    // This morning: her passkey, nothing else.
    await olena.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(olena.locator("ortus-shell")).toBeAttached();
    const me = (await (await olena.request.get("/api/v1/me")).json()) as { email: string };
    expect(me.email).toBe("olena@ministry.example");
    const security = (await (await olena.request.get("/api/v1/me/security")).json()) as { password: boolean; session_methods: string };
    expect(security.password).toBe(false);
    expect(security.session_methods).toContain("passkey");
    await context.close();
  });

  step("S2.5", async ({ browser, ortus }) => {
    const page = await as(browser, ortus.dataDir, "taras");
    // Marek still signs in with a password (and his authenticator app's code) only.
    const link = await invite(page.request, "marek@ministry.example", "Marek Nowak");
    const marek = await browser.newContext();
    const accepted = await marek.request.post("/api/v1/invitation/accept", { headers: XRW, data: { token: new URL(link).hash.slice(1) } });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    const set = await marek.request.put("/api/v1/me/password", { headers: XRW, data: { password: "gauge-river-bridge-2026" } });
    expect(set.ok(), await set.text()).toBeTruthy();
    const app = (await (await marek.request.post("/api/v1/me/totp", { headers: XRW })).json()) as { secret: string };
    const confirmed = await marek.request.post("/api/v1/me/totp/confirm", { headers: XRW, data: { code: totp(app.secret) } });
    expect(confirmed.ok(), await confirmed.text()).toBeTruthy();

    await page.goto("/admin/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-in & devices");
    // Passkeys are always on: phone, computer or security key.
    await expect(page.getByText("Always on: the phone, the computer or a security key")).toBeVisible();
    const passkeys = page.getByRole("switch", { name: "Passkey" });
    await expect(passkeys).toBeChecked();
    await expect(passkeys).toBeDisabled();
    // Smart cards and national eID sign in through the organisation's own
    // sign-in (OpenID Connect or SAML), its row on this screen.
    await expect(page.getByRole("switch", { name: "Organisation sign-in" })).toBeAttached();

    // Passwords off: refused while Marek would be locked out.
    const passwords = page.getByRole("switch", { name: "Password with app code" });
    await expect(passwords).toBeChecked();
    await passwords.click();
    await expect(page.getByRole("alert")).toContainText("Marek Nowak");
    await expect(passwords).toBeChecked();

    // Taras sets Marek to start again (he makes a passkey next time) ...
    const people = (await (await page.request.get("/api/v1/admin/users?q=marek")).json()) as { users: { id: string; email: string }[] };
    const id = people.users.find((p) => p.email === "marek@ministry.example")!.id;
    const reset = await page.request.post(`/api/v1/admin/users/${id}/reset`, { headers: XRW });
    expect(reset.ok(), await reset.text()).toBeTruthy();

    // ... and passwords go off.
    await page.reload();
    await page.getByRole("switch", { name: "Password with app code" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect(page.getByText("Off: passkeys only")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Password with app code" })).not.toBeChecked();

    // A password no longer signs anyone in.
    const tried = await (await browser.newContext()).request.post("/api/v1/session/password", {
      headers: XRW,
      data: { email: "marek@ministry.example", password: "gauge-river-bridge-2026" },
    });
    expect(tried.status()).toBe(403);
    expect(((await tried.json()) as { error: { code: string } }).error.code).toBe("password_off");
    await marek.close();
  });
});
