// The sample organisation (tools/sample-org.mjs) fills a fresh
// installation through the API: the owner then signs in with the password
// and authenticator code it gives, and finds a week of mail (dated over
// the week), channels with talk, the week's meetings, tasks and a shared
// document.
import { createHmac } from "node:crypto";
import { test, expect } from "../harness/story.ts";


function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[19]! & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("a sample organisation fills a fresh installation", async ({ ortus }) => {
  test.setTimeout(120_000);
  const { fill } = await import("../../tools/sample-org.mjs");
  const signIn = await fill(ortus.url, ortus.setupToken, "ministry.example", () => undefined);
  expect(signIn.email).toBe("olena@ministry.example");

  // The owner signs in with what the script gave: the next code (Ortus
  // takes each authenticator code once, and the script used this one).
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1_000));
  const headers = { "X-Requested-With": "ortus", "Content-Type": "application/json" };
  const ticket = (await (await fetch(`${ortus.url}/api/v1/session/password`, { method: "POST", headers, body: JSON.stringify({ email: signIn.email, password: signIn.password }) })).json()) as { ticket: string };
  const signed = await fetch(`${ortus.url}/api/v1/session/code`, { method: "POST", headers, body: JSON.stringify({ ticket: ticket.ticket, code: totp(signIn.secret) }) });
  expect(signed.status).toBe(200);
  const session = ((await signed.json()) as { session_token: string }).session_token;
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${ortus.url}/api/v1${path}`, { method, headers: { ...headers, Authorization: `Bearer ${session}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(r.ok, `${method} ${path}: ${r.status}`).toBe(true);
    return r.json() as Promise<Record<string, unknown>>;
  };

  const people = (await api("GET", "/admin/users")) as { users: unknown[] };
  expect(people.users).toHaveLength(12);

  // Her inbox: the week's mail, dated over the week, the last days unread.
  const mail = (await api("POST", "/mail/web/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [["Mailbox/get", {}, "b"]],
  })) as { methodResponses: [string, Record<string, unknown>, string][] };
  const boxes = mail.methodResponses[0]![1].list as { id: string; role: string; totalEmails: number; unreadEmails: number }[];
  const inbox = boxes.find((b) => b.role === "inbox")!;
  expect(inbox.totalEmails).toBeGreaterThanOrEqual(10);
  expect(inbox.unreadEmails).toBeGreaterThan(0);
  expect(inbox.unreadEmails).toBeLessThan(inbox.totalEmails);
  const dated = (await api("POST", "/mail/web/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Email/query", { filter: { inMailbox: inbox.id }, sort: [{ property: "receivedAt", isAscending: true }], limit: 1 }, "q"],
      ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["receivedAt", "subject"] }, "g"],
    ],
  })) as { methodResponses: [string, Record<string, unknown>, string][] };
  const oldest = (dated.methodResponses[1]![1].list as { receivedAt: string }[])[0]!;
  expect(Date.now() - Date.parse(oldest.receivedAt)).toBeGreaterThan(4 * 86_400_000);

  // Channels with talk, the week's meetings, tasks, the document.
  const rooms = (await api("GET", "/chat/rooms")) as { rooms: { name: string }[] };
  expect(rooms.rooms.map((r) => r.name)).toEqual(expect.arrayContaining(["general", "flood-response", "logistics"]));
  const from = Date.now() - 3 * 86_400_000;
  const events = (await api("GET", `/calendar/events?from=${from}&to=${from + 8 * 86_400_000}`)) as { events: unknown[] };
  expect(events.events.length).toBeGreaterThanOrEqual(5);
  const projects = (await api("GET", "/tasks/projects")) as { projects: { id: string; name: string }[] };
  const readiness = projects.projects.find((p) => p.name === "Spring flood readiness")!;
  const project = await api("GET", `/tasks/projects/${readiness.id}`);
  expect(JSON.stringify(project)).toContain("Move damp sandbag pallets indoors");
  const shared = JSON.stringify(await api("GET", "/drive/shared"));
  expect(shared).toContain("Evacuation plan 2026");
});
