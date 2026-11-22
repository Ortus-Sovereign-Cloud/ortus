#!/usr/bin/env node
// Fills a fresh Ortus installation with a sample organisation (a district
// flood office): a dozen people, a week of mail between them, channels
// with talk, a calendar for the week, a project with tasks and a
// document. Everything goes through the public API, as people would.
//
//   node tools/sample-org.mjs <https://sample.example> <setup token> [mail domain]
//
// The setup token is the one from `ortus setup-link` on that installation
// (it only works before an owner exists). The owner, Olena, signs in with
// the password and authenticator secret printed at the end.
import { createHmac, randomBytes } from "node:crypto";

const DAY = 86_400_000;
const XRW = { "X-Requested-With": "ortus" };

/** Who works there: name, local part, role. The first is the owner. */
export const PEOPLE = [
  ["Olena Hrytsenko", "olena", "owner"],
  ["Marek Nowak", "marek", "admin"],
  ["Iryna Melnyk", "iryna", "member"],
  ["Anna Kowalska", "anna", "member"],
  ["Jonas Weber", "jonas", "member"],
  ["Daniel Price", "daniel", "member"],
  ["Sofia Bondarenko", "sofia", "member"],
  ["Piotr Zieliński", "piotr", "member"],
  ["Lena Fischer", "lena", "member"],
  ["Taras Shevchuk", "taras", "member"],
  ["Ana Ferreira", "ana", "member"],
  ["Karol Wiśniewski", "karol", "member"],
];

/** Mail: [from, to[], subject, text, days ago, hour, reply-of index]. */
const MAIL = [
  ["marek", ["olena"], "Sandbag stock after the March inspection", "Olena,\n\nWe have 4,800 filled sandbags at the depot and material for another 2,500. The pallets by the north gate are damp; I would move them indoors this week.\n\nMarek", 6, 9, null],
  ["olena", ["marek"], "Re: Sandbag stock after the March inspection", "Agreed, move them before Thursday. Can Piotr's team help on Wednesday afternoon?\n\nOlena", 6, 11, 0],
  ["marek", ["olena", "piotr"], "Re: Sandbag stock after the March inspection", "Piotr confirmed: Wednesday 14:00, four people and the forklift.\n\nMarek", 5, 8, 1],
  ["anna", ["olena", "iryna"], "Shelter agreement with the sports hall", "Hello both,\n\nThe sports hall signed the shelter agreement: 180 beds, kitchen access, available within six hours of a call. The signed copy is in Drive under Shelters.\n\nAnna", 5, 15, null],
  ["iryna", ["anna", "olena"], "Re: Shelter agreement with the sports hall", "Great news. I have added it to the evacuation plan, section 4.\n\nIryna", 4, 10, 3],
  ["daniel", ["olena", "jonas"], "Gauge readings: Oder at the bridge", "The gauge at the bridge read 3.6 m this morning, rising about 4 cm an hour. The forecast has rain on Friday. No action yet; I will send readings twice a day.\n\nDaniel", 3, 7, null],
  ["jonas", ["olena", "daniel"], "Re: Gauge readings: Oder at the bridge", "Thanks Daniel. Police are on standby for the riverside road closure if it passes 4.2 m.\n\nJonas", 3, 9, 5],
  ["sofia", ["olena"], "Volunteer list for spring", "Olena,\n\n46 volunteers registered so far, 12 with first-aid training. I will run the briefing next Tuesday at 18:00 in the community centre.\n\nSofia", 2, 13, null],
  ["lena", ["olena", "marek"], "Generator service report", "Both mobile generators passed the service. Generator 2 needs a new fuel pump within the month; the part is ordered.\n\nLena", 2, 16, null],
  ["karol", ["olena"], "Budget: emergency fund Q2", "Hi Olena,\n\nThe Q2 emergency fund stands at 212,400 zł after the pump purchase. Attached figures follow in the finance channel.\n\nKarol", 1, 10, null],
  ["ana", ["olena", "iryna", "anna"], "Town hall on Thursday: talking points", "Three points for Thursday: the new warning sirens, the shelter at the sports hall, and how to register for text alerts. Draft slides by Wednesday.\n\nAna", 1, 15, null],
  ["taras", ["olena"], "Radio check results", "All 18 handheld radios checked; two need new batteries. Channel plan unchanged.\n\nTaras", 0, 8, null],
];

/** Channels: [name, topic, members, messages [who, text]]. */
const CHANNELS = [
  ["general", "Everyone at the district flood office", "all", [
    ["olena", "Good morning everyone. Reminder: the readiness review is on Friday at 10:00."],
    ["marek", "Depot is open late on Wednesday for the sandbag move."],
    ["sofia", "Volunteer briefing next Tuesday, 18:00, community centre. Bring your ID badges."],
    ["ana", "Town hall slides draft is in Drive. Comments welcome."],
  ]],
  ["flood-response", "River levels, warnings and decisions", ["olena", "marek", "daniel", "jonas", "iryna", "anna", "taras"], [
    ["daniel", "Bridge gauge 3.6 m, +4 cm/h. Rain forecast Friday."],
    ["jonas", "Riverside road closure plan is ready if we pass 4.2 m."],
    ["olena", "Thanks. Let's agree: at 4.0 m we warn the riverside streets, at 4.2 m we close the road."],
    ["iryna", "Added the thresholds to the evacuation plan."],
    ["taras", "Radios checked, all on the usual channel plan."],
  ]],
  ["logistics", "Depot, vehicles, generators", ["marek", "piotr", "lena", "karol", "olena"], [
    ["piotr", "Forklift booked for Wednesday 14:00."],
    ["lena", "Generator 2 fuel pump arrives Monday."],
    ["karol", "Pump invoice paid, fund balance posted in the budget mail."],
  ]],
];

/** Events this week: [summary, day offset, hour, minutes, organiser, attendees, location]. */
const EVENTS = [
  ["Logistics stand-up", -2, 9, 30, "marek", ["piotr", "lena", "karol"], "Depot office"],
  ["Gauge readings review", -1, 11, 30, "daniel", ["olena", "jonas"], "Room 2"],
  ["Sandbag move", 0, 14, 120, "marek", ["piotr", "olena"], "Depot, north gate"],
  ["Volunteer briefing", 2, 18, 60, "sofia", ["olena", "ana"], "Community centre"],
  ["Town hall: spring readiness", 3, 18, 90, "ana", ["olena", "iryna", "anna", "jonas"], "Town hall"],
  ["Readiness review", 4, 10, 60, "olena", ["marek", "iryna", "daniel", "jonas", "anna"], "Room 1"],
];

/** The project and its tasks: [title, assignee, due in days, state]. */
const TASKS = [
  ["Move damp sandbag pallets indoors", "piotr", 1, "doing"],
  ["Order fuel pump for generator 2", "lena", -1, "done"],
  ["Update evacuation plan, section 4", "iryna", 2, "doing"],
  ["Draft town hall slides", "ana", 2, "todo"],
  ["Replace radio batteries", "taras", 3, "todo"],
  ["Confirm sports hall kitchen access", "anna", 5, "todo"],
  ["Publish volunteer briefing notes", "sofia", 6, "todo"],
];

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[19] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** An API client for one person. */
function client(base, token) {
  return async function call(method, path, body, extra = {}) {
    const headers = { ...XRW, Accept: "application/json", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (typeof body === "string") payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const r = await fetch(`${base}/api/v1${path}`, { method, headers, body: payload });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

const RFC2822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC2822_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rfc2822(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${RFC2822_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${RFC2822_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00 +0000`;
}

/** Fills the installation at `base`; answers the owner's sign-in. */
export async function fill(base, setupToken, domain, log = console.log) {
  base = base.replace(/\/$/, "");
  const at = (local) => `${local}@${domain}`;
  const name = (local) => PEOPLE.find((p) => p[1] === local)[0];
  const sessions = {};

  // The owner, and her way to sign in.
  const [ownerName, ownerLocal] = PEOPLE[0];
  const setup = await client(base)("POST", "/setup", { token: setupToken, name: ownerName, email: at(ownerLocal) });
  sessions[ownerLocal] = setup.session_token;
  const owner = client(base, sessions[ownerLocal]);
  const password = `${randomBytes(9).toString("base64url")}-${randomBytes(3).toString("hex")}`;
  await owner("PUT", "/me/password", { password });
  const { secret } = await owner("POST", "/me/totp");
  await owner("POST", "/me/totp/confirm", { code: totp(secret) });
  log(`owner: ${at(ownerLocal)}`);

  await owner("POST", "/mail/admin/domains", { domain });

  // Everyone else, invited and joined.
  for (const [full, local, role] of PEOPLE.slice(1)) {
    const invited = await owner("POST", "/admin/users", { email: at(local), name: full, role, send: false });
    const token = new URL(invited.link).hash.slice(1);
    sessions[local] = (await client(base)("POST", "/invitation/accept", { token })).session_token;
  }
  log(`people: ${PEOPLE.length}`);

  // Mail: each message in the sender's Sent and each recipient's Inbox,
  // dated over the past week.
  const boxes = {};
  const accounts = {};
  for (const [, local] of PEOPLE) {
    const call = client(base, sessions[local]);
    accounts[local] = (await call("GET", "/me")).id;
    const got = await call("POST", "/mail/web/jmap", { using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"], methodCalls: [["Mailbox/get", {}, "b"]] });
    boxes[local] = Object.fromEntries(got.methodResponses[0][1].list.map((b) => [b.role, b.id]));
  }
  const now = Date.now();
  const ids = [];
  const store = async (local, raw, role, received, seen) => {
    const call = client(base, sessions[local]);
    const up = await call("POST", `/mail/jmap/upload/${accounts[local]}`, raw, { "Content-Type": "message/rfc822" });
    const got = await call("POST", "/mail/web/jmap", {
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [["Email/import", { emails: { m: { blobId: up.blobId, mailboxIds: { [boxes[local][role]]: true }, keywords: seen ? { $seen: true } : {}, receivedAt: new Date(received).toISOString().replace(/\.\d+Z$/, "Z") } } }, "i"]],
    });
    if (!got.methodResponses[0][1].created?.m) throw new Error(`import for ${local}: ${JSON.stringify(got.methodResponses[0][1])}`);
  };
  for (const [i, [from, to, subject, text, daysAgo, hour, replyOf]] of MAIL.entries()) {
    const day = new Date(now - daysAgo * DAY);
    day.setUTCHours(hour, (i * 7) % 60, 0, 0);
    const received = Math.min(day.getTime(), now - 60_000);
    const id = `<sample-${i}-${now}@${domain}>`;
    ids.push(id);
    const thread = replyOf === null ? "" : `In-Reply-To: ${ids[replyOf]}\r\nReferences: ${ids.slice(0, i).filter((_, j) => j <= replyOf).join(" ")}\r\n`;
    const raw = `From: ${name(from)} <${at(from)}>\r\nTo: ${to.map((t) => `${name(t)} <${at(t)}>`).join(", ")}\r\nSubject: ${subject}\r\nDate: ${rfc2822(received)}\r\nMessage-ID: ${id}\r\n${thread}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text.replace(/\n/g, "\r\n")}\r\n`;
    await store(from, raw, "sent", received, true);
    // The owner has read most of the week; the last two days are new.
    for (const t of to) await store(t, raw, "inbox", received, daysAgo > 1);
  }
  log(`mail: ${MAIL.length} messages`);

  // Channels with talk.
  for (const [room, topic, members, messages] of CHANNELS) {
    const everyone = members === "all" ? PEOPLE.map((p) => p[1]) : members;
    const made = await owner("POST", "/chat/rooms", { kind: "channel", name: room, topic, members: everyone.filter((l) => l !== ownerLocal).map(at) });
    for (const l of everyone) if (l !== ownerLocal) await client(base, sessions[l])("POST", `/chat/rooms/${made.id}/join`);
    for (const [who, text] of messages) await client(base, sessions[who])("POST", `/chat/rooms/${made.id}/messages`, { text });
  }
  log(`channels: ${CHANNELS.length}`);

  // The week's calendar.
  for (const [summary, offset, hour, minutes, organiser, attendees, location] of EVENTS) {
    const start = new Date(now + offset * DAY);
    start.setUTCHours(hour - 1, 0, 0, 0);
    await client(base, sessions[organiser])("POST", "/calendar/events", { summary, start: start.getTime(), end: start.getTime() + minutes * 60_000, attendees: attendees.map(at), location });
  }
  log(`events: ${EVENTS.length}`);

  // A project with tasks.
  const project = await owner("POST", "/tasks/projects", { name: "Spring flood readiness", members: PEOPLE.slice(1).map((p) => at(p[1])) });
  const projectId = project.id;
  for (const [title, assignee, due, state] of TASKS) {
    await owner("POST", "/tasks/tasks", { project: projectId, title, assignee: at(assignee), dueAt: now + due * DAY, state });
  }
  log(`tasks: ${TASKS.length}`);

  // A document, shared.
  const doc = await client(base, sessions.iryna)("POST", "/docs/documents", { parent: "", name: "Evacuation plan 2026" });
  await client(base, sessions.iryna)("POST", `/drive/items/${doc.id}/shares`, { email: at(ownerLocal), role: "edit" });
  log("document: Evacuation plan 2026");

  return { email: at(ownerLocal), password, secret };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, token, domain] = process.argv.slice(2);
  if (!base || !token) {
    console.error("usage: node tools/sample-org.mjs <https://sample.example> <setup token> [mail domain]");
    process.exit(2);
  }
  const host = new URL(base).hostname;
  const signIn = await fill(base, token, domain ?? host);
  console.log(`\nSign in at ${base} as ${signIn.email}\n  password: ${signIn.password}\n  authenticator secret: ${signIn.secret}`);
}
