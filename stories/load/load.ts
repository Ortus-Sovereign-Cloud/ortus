// Many people at once on the one-machine install: the release program on
// its own data, people signed in through invitations, each doing what a
// working day does (reading and writing chat, mail coming in, the inbox,
// documents, files, search, notifications) with short pauses. Latency per
// operation and errors are measured against budgets; over budget fails.
//
//   node load/load.ts                     the CI size (20 people, 45 s)
//   LOAD_PEOPLE=200 LOAD_SECONDS=300 node load/load.ts
//   ORTUS_STORY_SHAPE=cluster ...         PostgreSQL and S3 (see harness)
//
// The report goes to stdout and to test-results/load.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { startOrtus, type Installation } from "../harness/ortus.ts";
import { deliver } from "../harness/smtp.ts";

const PEOPLE = Number(process.env.LOAD_PEOPLE ?? 20);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 45);

/** p95 in milliseconds each kind of operation must stay under. */
const BUDGET = { read: 400, write: 1000 } as const;
/** Share of operations that may fail. */
const ERRORS = 0.005;

type Kind = keyof typeof BUDGET;

interface Op {
  name: string;
  kind: Kind;
  weight: number;
  run: (p: Person) => Promise<void>;
}

interface Person {
  email: string;
  cookie: string;
}

let ortus: Installation;
let room = "";
const timings = new Map<string, number[]>();
const failures = new Map<string, string[]>();

async function api(p: Person | null, method: string, path: string, body?: unknown, raw?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (p) headers.Cookie = p.cookie;
  if (method !== "GET") headers["X-Requested-With"] = "ortus";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = "application/octet-stream";
  const r = await fetch(`${ortus.url}/api/v1${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

function cookieOf(r: Response): string {
  return r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const words = ["shelter", "gauge", "bridge", "escort", "school", "budget", "river", "agreement", "bus", "volunteers"];
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
let people: Person[] = [];

const OPS: Op[] = [
  { name: "me", kind: "read", weight: 4, run: async (p) => void (await api(p, "GET", "/me").then((r) => r.json())) },
  { name: "notifications", kind: "read", weight: 4, run: async (p) => void (await api(p, "GET", "/notifications").then((r) => r.json())) },
  { name: "chat.read", kind: "read", weight: 8, run: async (p) => void (await api(p, "GET", `/chat/rooms/${room}/messages`).then((r) => r.json())) },
  {
    name: "chat.send",
    kind: "write",
    weight: 4,
    run: async (p) => void (await api(p, "POST", `/chat/rooms/${room}/messages`, { text: `${pick(words)} ${pick(words)} update ${Date.now()}` }).then((r) => r.json())),
  },
  { name: "mail.inbox", kind: "read", weight: 6, run: async (p) => void (await api(p, "GET", "/mail/catch-up").then((r) => r.json())) },
  {
    name: "mail.receive",
    kind: "write",
    weight: 3,
    run: async (p) => {
      const subject = `${pick(words)} report ${Date.now()}`;
      await deliver(ortus.smtpPort, "alerts@river.example", p.email, `From: River Authority <alerts@river.example>\r\nTo: ${p.email}\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}.${Math.random()}@river.example>\r\n\r\nThe ${pick(words)} reading is attached.\r\n`);
    },
  },
  { name: "drive.list", kind: "read", weight: 4, run: async (p) => void (await api(p, "GET", "/drive/items").then((r) => r.json())) },
  {
    name: "drive.upload",
    kind: "write",
    weight: 2,
    run: async (p) => {
      const bytes = new TextEncoder().encode(`${pick(words)} ${"x".repeat(2000)}`);
      const started = (await api(p, "POST", "/drive/uploads", { parent: "", name: `notes-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`, size: bytes.length, mime: "text/plain" }).then((r) => r.json())) as { id: string };
      await api(p, "PUT", `/drive/uploads/${started.id}/parts/0`, undefined, bytes);
      await api(p, "POST", `/drive/uploads/${started.id}/finish`, {});
    },
  },
  { name: "docs.create", kind: "write", weight: 1, run: async (p) => void (await api(p, "POST", "/docs/documents", { parent: "", name: `Minutes ${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }).then((r) => r.json())) },
  { name: "search", kind: "read", weight: 3, run: async (p) => void (await api(p, "GET", `/search?q=${pick(words)}`).then((r) => r.json())) },
];
const total = OPS.reduce((n, o) => n + o.weight, 0);

function choose(): Op {
  let at = Math.random() * total;
  for (const op of OPS) {
    at -= op.weight;
    if (at <= 0) return op;
  }
  return OPS[0]!;
}

async function person(until: number, p: Person): Promise<void> {
  while (Date.now() < until) {
    const op = choose();
    const started = performance.now();
    try {
      await op.run(p);
      const list = timings.get(op.name) ?? [];
      list.push(performance.now() - started);
      timings.set(op.name, list);
    } catch (e) {
      const list = failures.get(op.name) ?? [];
      list.push(String(e));
      failures.set(op.name, list);
    }
    // A person pauses between things (0.2 to 1 s).
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function setUp(): Promise<void> {
  const owner = await api(null, "POST", "/setup", { token: ortus.setupToken, name: "Olena Hrytsenko", email: "olena@ministry.example" });
  const olena: Person = { email: "olena@ministry.example", cookie: cookieOf(owner) };
  await api(olena, "POST", "/mail/admin/domains", { domain: "ministry.example" });
  people = [olena];
  for (let i = 1; i < PEOPLE; i++) {
    const email = `person${i}@ministry.example`;
    const invited = (await api(olena, "POST", "/admin/users", { email, name: `Person ${i}` }).then((r) => r.json())) as { link: string };
    const token = new URL(invited.link).hash.slice(1);
    const accepted = await api(null, "POST", "/invitation/accept", { token });
    people.push({ email, cookie: cookieOf(accepted) });
  }
  const made = (await api(olena, "POST", "/chat/rooms", { kind: "channel", name: "flood-response", members: people.slice(1).map((p) => p.email) }).then((r) => r.json())) as { id: string };
  room = made.id;
  await Promise.all(people.slice(1).map((p) => api(p, "POST", `/chat/rooms/${room}/join`)));
}

async function main(): Promise<void> {
  ortus = await startOrtus();
  let failed = false;
  try {
    await setUp();
    const until = Date.now() + SECONDS * 1000;
    await Promise.all(people.map((p) => person(until, p)));

    const rows = OPS.map((op) => {
      const t = timings.get(op.name) ?? [];
      const errors = failures.get(op.name)?.length ?? 0;
      return { name: op.name, kind: op.kind, count: t.length, errors, p50: Math.round(percentile(t, 50)), p95: Math.round(percentile(t, 95)), p99: Math.round(percentile(t, 99)), budget: BUDGET[op.kind] };
    });
    const count = rows.reduce((n, r) => n + r.count, 0);
    const errors = rows.reduce((n, r) => n + r.errors, 0);
    console.log(`${ortus.shape}: ${PEOPLE} people for ${SECONDS} s, ${count} operations (${(count / SECONDS).toFixed(1)} a second), ${errors} errors`);
    console.table(rows);
    const over = rows.filter((r) => r.count && r.p95 > r.budget);
    for (const r of over) console.error(`over budget: ${r.name} p95 ${r.p95} ms > ${r.budget} ms`);
    const rate = errors / Math.max(1, count + errors);
    if (rate > ERRORS) console.error(`errors: ${(rate * 100).toFixed(2)} % > ${ERRORS * 100} %`);
    for (const [name, list] of failures) console.error(`${name}: ${list.length} failed, e.g. ${list[0]}`);
    failed = over.length > 0 || rate > ERRORS || rows.some((r) => r.count === 0);
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/load.json", JSON.stringify({ shape: ortus.shape, people: PEOPLE, seconds: SECONDS, count, errors, rows }, null, 2));
  } catch (e) {
    console.error(e);
    console.error(ortus.log.slice(-30).join("\n"));
    failed = true;
  } finally {
    await ortus.stop();
  }
  if (failed) process.exit(1);
  console.log("load within budget");
}

await main();
