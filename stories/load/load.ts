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
// For the scale run (.github/workflows/load.yml):
//   LOAD_HISTORY=20     messages each person already has, before the clock starts
//   LOAD_PAUSE_MS=6000  the mean pause between one person's actions (an
//                       office day is one every few seconds, not every 0.6 s)
//   LOAD_STEPS=25,50,100,200  then that many people at once with no pauses,
//                       a step each: the busiest the installation stays
//                       within budget
//   LOAD_SEALED=50      people in each end-to-end room (teams): everyone
//                       has a device with signed keys, cross-signing keys,
//                       signatures on their device and on a few colleagues,
//                       and a key backup (LOAD_BACKUP_KEYS room keys);
//                       LOAD_TRUST=0 leaves end-to-end trust out
//   LOAD_CONNECTIONS=16 the program's database connections
//
// The report goes to stdout and to test-results/load.json (with the
// server's memory and CPU), and as Markdown to test-results/load.md.
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { startOrtus, type Installation } from "../harness/ortus.ts";
import { deliver } from "../harness/smtp.ts";

const PEOPLE = Number(process.env.LOAD_PEOPLE ?? 20);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 45);
const HISTORY = Number(process.env.LOAD_HISTORY ?? 0);
/** Mean pause between a person's actions; the default is the CI's 0.2 to 1 s. */
const PAUSE = process.env.LOAD_PAUSE_MS ? Number(process.env.LOAD_PAUSE_MS) : undefined;
const STEPS = (process.env.LOAD_STEPS ?? "").split(",").filter(Boolean).map(Number);
const STEP_SECONDS = Number(process.env.LOAD_STEP_SECONDS ?? 30);
const TRUST = process.env.LOAD_TRUST !== "0";
const SEALED = Number(process.env.LOAD_SEALED ?? 50);
const BACKUP_KEYS = Number(process.env.LOAD_BACKUP_KEYS ?? 200);
/** Requests in flight at once while setting up. */
const SETUP_AT_ONCE = 16;

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
  /** Their end-to-end room (a team's), and their key backup's version. */
  sealed?: string;
  backup?: string;
}

let ortus: Installation;
/** The database statements the current operation cost (Server-Timing). */
const statements = new AsyncLocalStorage<{ n: number }>();
let room = "";

async function api(p: Person | null, method: string, path: string, body?: unknown, raw?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (p) headers.Cookie = p.cookie;
  if (method !== "GET") headers["X-Requested-With"] = "ortus";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = "application/octet-stream";
  const r = await fetch(`${ortus.url}/api/v1${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const said = r.headers.get("server-timing")?.match(/desc="(\d+) statements"/);
  const spent = statements.getStore();
  if (said && spent) spent.n += Number(said[1]);
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

const LIST_PROPERTIES = ["threadId", "subject", "from", "to", "receivedAt", "preview", "keywords", "mailboxIds", "hasAttachment", "ortusCategory", "ortusInvite", "ortusDelivery"];
const READ_PROPERTIES = [...LIST_PROPERTIES, "cc", "replyTo", "messageId", "references", "attachments", "ortusText", "ortusVerified", "ortusSnoozedUntil"];

/** One JMAP request as the web mail client sends it; answers by call id. */
async function jmap(p: Person, calls: unknown[]): Promise<Record<string, Record<string, unknown>>> {
  const using = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"];
  const answer = (await api(p, "POST", "/mail/web/jmap", { using, methodCalls: calls }).then((r) => r.json())) as { methodResponses: [string, Record<string, unknown>, string][] };
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, args, id] of answer.methodResponses) {
    if (name === "error") throw new Error(`jmap: ${JSON.stringify(args).slice(0, 200)}`);
    if (!(id in out)) out[id] = args;
  }
  return out;
}

/** Runs `work` on each item, `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i]!, i);
      }
    }),
  );
}

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
  {
    name: "mail.list",
    kind: "read",
    weight: 6,
    // What the web inbox asks when it opens: the boxes, then the newest
    // hundred conversations and what waits for a reply.
    run: async (p) => {
      await jmap(p, [
        ["Mailbox/get", {}, "b"],
        ["EmailSubmission/get", { ids: null }, "sub"],
        ["Email/query", { filter: { notKeyword: "$deleted" }, limit: 500 }, "k"],
        ["Email/get", { "#ids": { resultOf: "k", name: "Email/query", path: "/ids" }, properties: ["keywords"] }, "kw"],
      ]);
      await jmap(p, [
        ["Email/query", { filter: { notKeyword: "$deleted" }, sort: [{ property: "receivedAt", isAscending: false }], collapseThreads: true, limit: 100 }, "q"],
        ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: LIST_PROPERTIES }, "l"],
      ]);
    },
  },
  {
    name: "mail.open",
    kind: "read",
    weight: 4,
    run: async (p) => {
      const found = await jmap(p, [["Email/query", { sort: [{ property: "receivedAt", isAscending: false }], limit: 20 }, "q"]]);
      const ids = (found.q?.ids as string[] | undefined) ?? [];
      if (ids.length) await jmap(p, [["Email/get", { ids: [pick(ids)], properties: READ_PROPERTIES, fetchTextBodyValues: true }, "m"]]);
    },
  },
  { name: "chat.rooms", kind: "read", weight: 3, run: async (p) => void (await api(p, "GET", "/chat/rooms").then((r) => r.json())) },
  {
    name: "calendar.week",
    kind: "read",
    weight: 3,
    run: async (p) => {
      const from = Date.now() - 3 * 86_400_000;
      void (await api(p, "GET", `/calendar/events?from=${from}&to=${from + 7 * 86_400_000}`).then((r) => r.json()));
    },
  },
  {
    name: "calendar.add",
    kind: "write",
    weight: 1,
    run: async (p) => {
      const start = Date.now() + Math.floor(Math.random() * 10) * 86_400_000;
      void (await api(p, "POST", "/calendar/events", { summary: `${pick(words)} briefing`, start, end: start + 1_800_000, allDay: false }).then((r) => r.json()));
    },
  },
  { name: "tasks.mine", kind: "read", weight: 2, run: async (p) => void (await api(p, "GET", "/tasks/mine").then((r) => r.json())) },
  { name: "people.find", kind: "read", weight: 1, run: async (p) => void (await api(p, "GET", `/people/directory?q=person${Math.floor(Math.random() * 9)}`).then((r) => r.json())) },
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
  // End-to-end trust: a sender asks for the room's devices with who vouches
  // for whom before sharing a room key; new room keys go to the backup; a
  // device checks the backup on start and, rarely, restores all of it.
  { name: "trust.devices", kind: "read", weight: 2, run: async (p) => void (await api(p, "GET", `/chat/rooms/${p.sealed}/devices`).then((r) => r.json())) },
  { name: "trust.backup.version", kind: "read", weight: 1, run: async (p) => void (await api(p, "GET", "/chat/backup/version").then((r) => r.json())) },
  { name: "trust.backup.upload", kind: "write", weight: 2, run: async (p) => void (await api(p, "PUT", `/chat/backup/keys?version=${p.backup}`, backupKeys(p.sealed!, 3)).then((r) => r.json())) },
  { name: "trust.backup.restore", kind: "read", weight: 1, run: async (p) => void (await api(p, "GET", `/chat/backup/keys?version=${p.backup}`).then((r) => r.json())) },
];
if (!TRUST) OPS.splice(0, OPS.length, ...OPS.filter((o) => !o.name.startsWith("trust.")));
const total = OPS.reduce((n, o) => n + o.weight, 0);

function choose(): Op {
  let at = Math.random() * total;
  for (const op of OPS) {
    at -= op.weight;
    if (at <= 0) return op;
  }
  return OPS[0]!;
}

type Timings = Map<string, number[]>;
/** Database statements of each operation, by name. */
const spentBy = new Map<string, number[]>();
/** Every operation of a phase: [started ms since the phase began, name, ms taken]. */
type Trace = [number, string, number][];
type Failures = Map<string, string[]>;

async function person(until: number, p: Person, timings: Timings, failures: Failures, pauses = true, trace?: Trace, origin = 0): Promise<void> {
  // People start their day at different moments, not all in the same
  // millisecond (that burst was a quarter of the slow operations of a
  // 200-person run).
  if (pauses) await new Promise((r) => setTimeout(r, Math.random() * (PAUSE ?? 600)));
  while (Date.now() < until) {
    const op = choose();
    const started = performance.now();
    try {
      // An operation that never finishes fails after a minute instead of
      // holding up the whole run.
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${op.name}: no answer in 60 s`)), 60_000)));
      const spent = { n: 0 };
      await Promise.race([statements.run(spent, () => op.run(p)), late]).finally(() => clearTimeout(timer));
      const took = performance.now() - started;
      const counted = spentBy.get(op.name) ?? [];
      if (counted.length < 1000) counted.push(spent.n);
      spentBy.set(op.name, counted);
      const list = timings.get(op.name) ?? [];
      list.push(took);
      timings.set(op.name, list);
      trace?.push([Math.round(started - origin), op.name, Math.round(took)]);
    } catch (e) {
      const list = failures.get(op.name) ?? [];
      list.push(String(e));
      failures.set(op.name, list);
    }
    if (!pauses) continue;
    // A person pauses between things: 0.2 to 1 s, or around PAUSE (half
    // to one and a half times it).
    const pause = PAUSE === undefined ? 200 + Math.random() * 800 : PAUSE * (0.5 + Math.random());
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
  }
}

/** The program's memory (MB) and CPU used so far (seconds), from /proc. */
function usage(): { rss: number; cpu: number } | undefined {
  if (!ortus.pid) return undefined;
  try {
    const status = readFileSync(`/proc/${ortus.pid}/status`, "utf8");
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
    const fields = readFileSync(`/proc/${ortus.pid}/stat`, "utf8").split(") ")[1]!.split(" ");
    const ticks = Number(fields[11]) + Number(fields[12]);
    return { rss: Math.round(rss), cpu: ticks / 100 };
  } catch {
    return undefined;
  }
}

/** CPU seconds so far of the whole machine (busy) and of the processes
 * that share it, by name: the program, the database, the object store,
 * the load maker and Docker's port forwarders. */
function machine(): { busy: number; by: Record<string, number> } {
  const by: Record<string, number> = {};
  let busy = 0;
  try {
    const cpu = readFileSync("/proc/stat", "utf8").split("\n")[0]!.trim().split(/\s+/).slice(1).map(Number);
    // user nice system idle iowait irq softirq steal
    busy = (cpu[0]! + cpu[1]! + cpu[2]! + cpu[5]! + cpu[6]! + cpu[7]!) / 100;
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
        const key = ["ortus", "postgres", "rustfs", "node", "docker-proxy"].find((k) => name.startsWith(k));
        if (!key) continue;
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        by[key] = (by[key] ?? 0) + (Number(fields[11]) + Number(fields[12])) / 100;
      } catch {
        // gone meanwhile
      }
    }
  } catch {
    // not Linux
  }
  return { busy, by };
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((done) => execFile(command, args, (e, out) => done(e ? "" : out)));
}

/** TCP counters that show lost or refused connections. */
async function tcp(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const line of (await run("nstat", ["-az"])).split("\n")) {
    const [name, value] = line.trim().split(/\s+/);
    if (name && ["TcpExtListenOverflows", "TcpExtListenDrops", "TcpRetransSegs", "TcpExtTCPTimeouts", "TcpAttemptFails", "TcpEstabResets"].includes(name)) out[name] = Number(value);
  }
  return out;
}

/** The database's committed transactions so far, and what its sessions wait on now. */
async function database(): Promise<{ commits: number; waiting: Record<string, number> } | undefined> {
  const url = process.env.ORTUS_TEST_POSTGRES;
  if (!url || ortus.shape !== "cluster") return undefined;
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    const commits = Number((await c.query("SELECT sum(xact_commit + xact_rollback) AS n FROM pg_stat_database")).rows[0]?.n ?? 0);
    const waiting: Record<string, number> = {};
    for (const r of (await c.query("SELECT state, wait_event_type, wait_event, count(*) AS n FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid() GROUP BY 1, 2, 3")).rows) {
      waiting[`${r.state ?? "-"}/${r.wait_event_type ?? "cpu"}/${r.wait_event ?? "-"}`] = Number(r.n);
    }
    return { commits, waiting };
  } catch {
    return undefined;
  } finally {
    await c.end().catch(() => {});
  }
}

/** The program's slow requests (ORTUS_SLOW_MS), by route: how many, and
 * on average how long, how many statements, how long in the database and
 * waiting for a connection. */
function slowLog(): void {
  const by = new Map<string, { n: number; ms: number; statements: number; db: number; wait: number }>();
  const re = /ortus: slow: (\S+) (\S+) (\d+) ms: (\d+) statements, (\d+) ms in the database, (\d+) ms waiting/;
  for (const line of ortus.log.join("").split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const route = `${m[1]} ${m[2]!.split("?")[0]!.replace(/\/[^/]*[0-9][^/]*/g, "/:id")}`;
    const e = by.get(route) ?? { n: 0, ms: 0, statements: 0, db: 0, wait: 0 };
    e.n += 1;
    e.ms += Number(m[3]);
    e.statements += Number(m[4]);
    e.db += Number(m[5]);
    e.wait += Number(m[6]);
    by.set(route, e);
  }
  const rows = [...by].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  for (const [route, e] of rows) {
    console.log(`slow request: ${route}: ${e.n}, ${Math.round(e.ms / e.n)} ms, ${Math.round(e.statements / e.n)} statements, ${Math.round(e.db / e.n)} ms in the database, ${Math.round(e.wait / e.n)} ms waiting for a connection`);
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// ---- end-to-end trust, as clients make it ---------------------------------

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64").replace(/=+$/, "");

/** Matrix canonical JSON: sorted keys, no spaces. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

interface Signer {
  id: string;
  public: string;
  key: KeyObject;
}

function signer(name?: string): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = b64(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
  return { id: `ed25519:${name ?? pub}`, public: pub, key: privateKey };
}

/** `object` with `by`'s signature as `mx`, beside those it has. */
function signed<T extends Record<string, unknown>>(object: T, mx: string, by: Signer): T {
  const { signatures, unsigned: _, ...rest } = object as T & { signatures?: Record<string, Record<string, string>>; unsigned?: unknown };
  const sig = b64(sign(null, Buffer.from(canonical(rest)), by.key));
  return { ...object, signatures: { ...signatures, [mx]: { ...signatures?.[mx], [by.id]: sig } } };
}

/** Room keys for a backup as clients upload them (the server keeps them opaque). */
function backupKeys(room: string, n: number): unknown {
  const sessions: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    sessions[b64(randomBytes(32))] = {
      first_message_index: 0,
      forwarded_count: 0,
      is_verified: true,
      session_data: { ephemeral: b64(randomBytes(32)), ciphertext: b64(randomBytes(240)), mac: b64(randomBytes(8)) },
    };
  }
  return { rooms: { [room]: { sessions } } };
}

/** Each person: a device with signed keys, cross-signing keys, their
 * self-signing key's signature on the device, their user-signing key's
 * on three colleagues' master keys (verified), a key backup; teams of
 * SEALED in an end-to-end room each. */
async function setUpTrust(olena: Person): Promise<void> {
  const started = Date.now();
  await api(olena, "PATCH", "/chat/policy", { encryptedRooms: true });
  const ids = new Map<Person, { mx: string; master: Signer; usk: Signer }>();
  await inBatches(people, SETUP_AT_ONCE, async (p) => {
    const mx = ((await api(p, "GET", "/chat/rooms").then((r) => r.json())) as { me: string }).me;
    const device = "LOAD" + randomBytes(4).toString("hex").toUpperCase();
    const ed = signer(device);
    const deviceKeys = signed({ user_id: mx, device_id: device, algorithms: ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"], keys: { [`curve25519:${device}`]: b64(randomBytes(32)), [ed.id]: ed.public } }, mx, ed);
    await api(p, "PUT", `/chat/devices/${device}`, { deviceKeys, oneTimeKeys: {}, fallbackKeys: {} });
    const master = signer();
    const ssk = signer();
    const usk = signer();
    const key = (s: Signer, usage: string) => ({ user_id: mx, usage: [usage], keys: { [s.id]: s.public } });
    await api(p, "PUT", "/chat/cross-signing", { master: key(master, "master"), selfSigning: signed(key(ssk, "self_signing"), mx, master), userSigning: signed(key(usk, "user_signing"), mx, master) });
    const done = (await api(p, "POST", "/chat/signatures", { [mx]: { [device]: signed(deviceKeys, mx, ssk) } }).then((r) => r.json())) as { kept: number };
    if (done.kept !== 1) throw new Error(`device signature not kept: ${JSON.stringify(done)}`);
    p.backup = ((await api(p, "POST", "/chat/backup/version", { algorithm: "m.megolm_backup.v1.curve25519-aes-sha2", authData: { public_key: b64(randomBytes(32)) } }).then((r) => r.json())) as { version: string }).version;
    ids.set(p, { mx, master, usk });
  });
  // Colleagues vouch for each other: three each, by the user-signing key.
  await inBatches(people, SETUP_AT_ONCE, async (p) => {
    const me = ids.get(p)!;
    const body: Record<string, unknown> = {};
    for (let n = 0; n < 3 && people.length > 1; n++) {
      const other = ids.get(pick(people.filter((x) => x !== p)))!;
      body[other.mx] = { [other.master.public]: signed({ user_id: other.mx, usage: ["master"], keys: { [other.master.id]: other.master.public } }, me.mx, me.usk) };
    }
    await api(p, "POST", "/chat/signatures", body);
  });
  // Teams in end-to-end rooms, and each person's backup of that room's keys.
  const teams = Array.from({ length: Math.ceil(people.length / SEALED) }, (_, t) => people.slice(t * SEALED, (t + 1) * SEALED));
  await inBatches(teams, SETUP_AT_ONCE, async (team) => {
    const [lead, ...rest] = team;
    const made = (await api(lead!, "POST", "/chat/rooms", { kind: "private", name: `team-${lead!.email.split("@")[0]}`, members: rest.map((p) => p.email), encrypted: true }).then((r) => r.json())) as { id: string };
    for (const p of team) p.sealed = made.id;
    await inBatches(rest, 4, async (p) => void (await api(p, "POST", `/chat/rooms/${made.id}/join`)));
  });
  await inBatches(people, SETUP_AT_ONCE, async (p) => {
    for (let left = BACKUP_KEYS; left > 0; left -= 500) await api(p, "PUT", `/chat/backup/keys?version=${p.backup}`, backupKeys(p.sealed!, Math.min(500, left)));
  });
  console.log(`trust: ${people.length} devices, cross-signing, ${teams.length} end-to-end rooms of ${SEALED}, ${BACKUP_KEYS} backed-up room keys each in ${Math.round((Date.now() - started) / 1000)} s`);
}

async function setUp(): Promise<void> {
  const owner = await api(null, "POST", "/setup", { token: ortus.setupToken, name: "Olena Hrytsenko", email: "olena@ministry.example" });
  const olena: Person = { email: "olena@ministry.example", cookie: cookieOf(owner) };
  await api(olena, "POST", "/mail/admin/domains", { domain: "ministry.example" });
  people = [olena];
  const others = Array.from({ length: PEOPLE - 1 }, (_, i) => i + 1);
  const joined: Person[] = [];
  await inBatches(others, SETUP_AT_ONCE, async (i) => {
    const email = `person${i}@ministry.example`;
    const invited = (await api(olena, "POST", "/admin/users", { email, name: `Person ${i}` }).then((r) => r.json())) as { link: string };
    const token = new URL(invited.link).hash.slice(1);
    const accepted = await api(null, "POST", "/invitation/accept", { token });
    joined.push({ email, cookie: cookieOf(accepted) });
  });
  people.push(...joined);
  const made = (await api(olena, "POST", "/chat/rooms", { kind: "channel", name: "flood-response", members: people.slice(1).map((p) => p.email) }).then((r) => r.json())) as { id: string };
  room = made.id;
  await inBatches(people.slice(1), SETUP_AT_ONCE, async (p) => void (await api(p, "POST", `/chat/rooms/${room}/join`)));
  if (TRUST) await setUpTrust(olena);
  // History: the mail each person already has, and the room's past.
  if (HISTORY > 0) {
    const started = Date.now();
    const letters = people.flatMap((p) => Array.from({ length: HISTORY }, (_, n) => ({ p, n })));
    await inBatches(letters, SETUP_AT_ONCE, async ({ p, n }) => {
      const subject = `${pick(words)} ${pick(words)} ${n}`;
      await deliver(ortus.smtpPort, `colleague${n % 40}@partner.example`, p.email, `From: Colleague ${n % 40} <colleague${n % 40}@partner.example>\r\nTo: ${p.email}\r\nSubject: ${subject}\r\nMessage-ID: <h${n}.${Math.random()}@partner.example>\r\n\r\nAbout the ${pick(words)} and the ${pick(words)}: ${"words ".repeat(120)}\r\n`);
    });
    await inBatches(Array.from({ length: Math.min(2000, PEOPLE * 2) }, (_, n) => n), SETUP_AT_ONCE, async (n) => {
      await api(pick(people), "POST", `/chat/rooms/${room}/messages`, { text: `${pick(words)} ${pick(words)} earlier ${n}` });
    });
    console.log(`history: ${letters.length} messages and the room's past in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

interface Row {
  name: string;
  kind: Kind;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  budget: number;
  /** Database statements, the median of the operation's. */
  statements: number;
}

function rowsOf(timings: Timings, failures: Failures): Row[] {
  return OPS.map((op) => {
    const t = timings.get(op.name) ?? [];
    const errors = failures.get(op.name)?.length ?? 0;
    return { name: op.name, kind: op.kind, count: t.length, errors, p50: Math.round(percentile(t, 50)), p95: Math.round(percentile(t, 95)), p99: Math.round(percentile(t, 99)), budget: BUDGET[op.kind], statements: Math.round(percentile(spentBy.get(op.name) ?? [], 50)) };
  });
}

/** One phase: who runs, how long, with or without pauses. */
interface Machine {
  /** Cores busy on average, the whole machine and each process kind. */
  cores: Record<string, number>;
  /** Database transactions per operation. */
  transactionsPerOp?: number;
  /** Database sessions by what they were doing, summed over samples every 2 s. */
  waiting?: Record<string, number>;
  tcp: Record<string, number>;
}

async function phase(who: Person[], seconds: number, pauses: boolean): Promise<{ rows: Row[]; count: number; errors: number; perSecond: number; cpu: number; rss: number; failures: Failures; machine: Machine; trace: Trace }> {
  const timings: Timings = new Map();
  const failures: Failures = new Map();
  const trace: Trace = [];
  const before = usage();
  const machineBefore = machine();
  const tcpBefore = await tcp();
  const dbBefore = await database();
  const waiting: Record<string, number> = {};
  let peak = before?.rss ?? 0;
  const sampler = setInterval(() => {
    peak = Math.max(peak, usage()?.rss ?? 0);
    void database().then((d) => {
      for (const [k, n] of Object.entries(d?.waiting ?? {})) waiting[k] = (waiting[k] ?? 0) + n;
    });
  }, 2000);
  const origin = performance.now();
  const until = Date.now() + seconds * 1000;
  await Promise.all(who.map((p) => person(until, p, timings, failures, pauses, trace, origin)));
  clearInterval(sampler);
  const after = usage();
  const machineAfter = machine();
  const tcpAfter = await tcp();
  const dbAfter = await database();
  const rows = rowsOf(timings, failures);
  const count = rows.reduce((n, r) => n + r.count, 0);
  const errors = rows.reduce((n, r) => n + r.errors, 0);
  // CPU as cores busy on average over the phase.
  const cpu = before && after ? (after.cpu - before.cpu) / seconds : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  const cores: Record<string, number> = { machine: round((machineAfter.busy - machineBefore.busy) / seconds) };
  for (const [k, v] of Object.entries(machineAfter.by)) cores[k] = round((v - (machineBefore.by[k] ?? 0)) / seconds);
  const tcpDelta: Record<string, number> = {};
  for (const [k, v] of Object.entries(tcpAfter)) tcpDelta[k] = v - (tcpBefore[k] ?? 0);
  const m: Machine = { cores, tcp: tcpDelta };
  if (dbBefore && dbAfter) {
    m.transactionsPerOp = round((dbAfter.commits - dbBefore.commits) / Math.max(1, count));
    m.waiting = waiting;
  }
  return { rows, count, errors, perSecond: count / seconds, cpu: round(cpu), rss: peak, failures, machine: m, trace };
}

/** How the slow operations of a phase are spread: per op over 150 ms, a
 * histogram by 50 ms, and the seconds of the phase they started in. */
function slowness(trace: Trace): { histogram: Record<string, number>; bySecond: Record<string, number> } {
  const histogram: Record<string, number> = {};
  const bySecond: Record<string, number> = {};
  for (const [at, , took] of trace) {
    if (took < 150) continue;
    const bucket = `${Math.floor(took / 50) * 50}`;
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    const second = `${Math.floor(at / 1000)}`;
    bySecond[second] = (bySecond[second] ?? 0) + 1;
  }
  return { histogram, bySecond };
}

async function main(): Promise<void> {
  // The program logs requests slower than this, with their database time.
  ortus = await startOrtus({ ORTUS_SERVER_TIMING: "1", ORTUS_SLOW_MS: process.env.ORTUS_SLOW_MS ?? "300", ...(process.env.LOAD_CONNECTIONS ? { ORTUS_DATABASE_MAX_CONNECTIONS: process.env.LOAD_CONNECTIONS } : {}) });
  let failed = false;
  try {
    await setUp();
    const day = await phase(people, SECONDS, true);
    const { rows, count, errors } = day;
    console.log(`${ortus.shape}: ${PEOPLE} people for ${SECONDS} s, ${count} operations (${day.perSecond.toFixed(1)} a second), ${errors} errors, ${day.cpu} cores busy, ${day.rss} MB at most`);
    console.table(rows);
    console.log("machine:", JSON.stringify(day.machine));
    console.log("slow:", JSON.stringify(slowness(day.trace)));
    const over = rows.filter((r) => r.count && r.p95 > r.budget);
    for (const r of over) console.error(`over budget: ${r.name} p95 ${r.p95} ms > ${r.budget} ms`);
    const rate = errors / Math.max(1, count + errors);
    if (rate > ERRORS) console.error(`errors: ${(rate * 100).toFixed(2)} % > ${ERRORS * 100} %`);
    for (const [name, list] of day.failures) console.error(`${name}: ${list.length} failed, e.g. ${list[0]}`);
    failed = over.length > 0 || rate > ERRORS || rows.some((r) => r.count === 0);

    // The steps: more and more at once with no pauses, to see where the
    // installation leaves its budget. Reported, not failed on.
    const steps = [];
    for (const at of STEPS) {
      const step = await phase(people.slice(0, Math.min(at, people.length)), STEP_SECONDS, false);
      const p95 = (kind: Kind) => Math.max(0, ...step.rows.filter((r) => r.kind === kind && r.count).map((r) => r.p95));
      const within = p95("read") <= BUDGET.read && p95("write") <= BUDGET.write && step.errors / Math.max(1, step.count + step.errors) <= ERRORS;
      steps.push({ atOnce: at, perSecond: Math.round(step.perSecond), readP95: p95("read"), writeP95: p95("write"), errors: step.errors, cpu: step.cpu, rss: step.rss, within, rows: step.rows, machine: step.machine });
      console.log(`step: ${at} at once: ${step.perSecond.toFixed(0)} a second, read p95 ${p95("read")} ms, write p95 ${p95("write")} ms, ${step.errors} errors, ${step.cpu} cores${within ? "" : " (over budget)"}`);
      console.log("  machine:", JSON.stringify(step.machine));
    }

    slowLog();

    mkdirSync("test-results", { recursive: true });
    const report = { shape: ortus.shape, people: PEOPLE, seconds: SECONDS, history: HISTORY, pauseMs: PAUSE ?? 600, count, errors, perSecond: Math.round(day.perSecond * 10) / 10, cpu: day.cpu, rssMb: day.rss, rows, machine: day.machine, steps };
    writeFileSync("test-results/load.json", JSON.stringify(report, null, 2));
    writeFileSync("test-results/load.trace.json", JSON.stringify(day.trace));
    writeFileSync("test-results/load.md", markdown(report));
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

function markdown(r: { shape: string; people: number; seconds: number; history: number; pauseMs: number; count: number; errors: number; perSecond: number; cpu: number; rssMb: number; rows: Row[]; machine?: Machine; steps: { atOnce: number; perSecond: number; readP95: number; writeP95: number; errors: number; cpu: number; rss: number; within: boolean }[] }): string {
  const lines = [
    `### ${r.shape}: ${r.people} people, ${r.seconds} s`,
    "",
    `${r.count} operations (${r.perSecond} a second), ${r.errors} errors; each person acts about every ${(r.pauseMs / 1000).toFixed(1)} s; ${r.history} messages each beforehand. The program used ${r.cpu} cores on average and ${r.rssMb} MB of memory at most.`,
    "",
    ...(r.machine ? [`Cores busy on the runner: ${Object.entries(r.machine.cores).map(([k, v]) => `${k} ${v}`).join(", ")}${r.machine.transactionsPerOp === undefined ? "" : `; ${r.machine.transactionsPerOp} database transactions an operation`}.`, ""] : []),
    "| Operation | Kind | Count | Errors | p50 ms | p95 ms | p99 ms | Budget p95 | Statements |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...r.rows.map((x) => `| ${x.name} | ${x.kind} | ${x.count} | ${x.errors} | ${x.p50} | ${x.p95} | ${x.p99} | ${x.budget} | ${x.statements} |`),
  ];
  if (r.steps.length) {
    lines.push("", "| At once, no pauses | Operations a second | Read p95 ms | Write p95 ms | Errors | Cores | MB | Within budget |", "|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const s of r.steps) lines.push(`| ${s.atOnce} | ${s.perSecond} | ${s.readP95} | ${s.writeP95} | ${s.errors} | ${s.cpu} | ${s.rss} | ${s.within ? "yes" : "no"} |`);
  }
  return lines.join("\n") + "\n";
}

await main();
