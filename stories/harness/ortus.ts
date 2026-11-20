// A fresh Ortus installation for a story: the real release program on its
// own data, in one of the two shapes.
//
//   ORTUS_STORY_SHAPE=one-machine  SQLite and a local directory (default)
//   ORTUS_STORY_SHAPE=cluster      PostgreSQL (ORTUS_TEST_POSTGRES) and S3
//                                  (ORTUS_TEST_S3_*), each story in its own
//                                  schema and prefix
//
// ORTUS_BINARY names the program (default ../target/release/ortus).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { startDns, type Dns } from "./dns.ts";

export type Shape = "one-machine" | "cluster";

export function shape(): Shape {
  const value = process.env.ORTUS_STORY_SHAPE ?? "one-machine";
  if (value !== "one-machine" && value !== "cluster") {
    throw new Error(`ORTUS_STORY_SHAPE is '${value}'; use one-machine or cluster`);
  }
  return value;
}

export interface Installation {
  url: string;
  shape: Shape;
  dataDir: string;
  /** The PostgreSQL schema of a cluster-shaped installation. */
  schema?: string;
  /** The DNS server this installation asks (records a story publishes). */
  dns: Dns;
  /** Where the installation receives mail (SMTP), on 127.0.0.1. */
  smtpPort: number;
  /** The first-start token: `/setup#<token>` creates the first owner. */
  setupToken: string;
  /** Lines the program has printed so far, for failure reports. */
  log: string[];
  stop(): Promise<void>;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`the cluster shape needs ${name}`);
  return value;
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess, log: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ortus stopped while starting:\n${log.join("")}`);
    }
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Ortus did not answer in 30 s:\n${log.join("")}`);
}

/** Starts a fresh installation. Extra settings go in `env`. */
export async function startOrtus(env: Record<string, string> = {}): Promise<Installation> {
  const which = shape();
  const binary = resolve(process.env.ORTUS_BINARY ?? join(import.meta.dirname, "..", "..", "target", "release", "ortus"));
  const dataDir = mkdtempSync(join(tmpdir(), "ortus-story-"));
  const port = await freePort();
  const settings: Record<string, string> = {
    ORTUS_ROLES: "all",
    ORTUS_DATA_DIR: dataDir,
    ORTUS_WEB_IP: "127.0.0.1",
    ORTUS_WEB_PORT: String(port),
    RWS_CONFIG_SHUTDOWN_DELAY_SECS: "0",
    ORTUS_SETUP_TOKEN: randomBytes(16).toString("hex"),
    // localhost, not 127.0.0.1: passkeys need a host name as their relying party.
    ORTUS_PUBLIC_URL: `http://localhost:${port}`,
    ORTUS_MAIL_HOSTNAME: "mail.ministry.example",
    // The media node on loopback, on a port of its own.
    ORTUS_MEDIA_LISTEN: "127.0.0.1:0",
  };
  // The mail role on free ports (25, 587 and 143 need privileges).
  const smtpPort = await freePort();
  settings.ORTUS_SMTP_LISTEN = `127.0.0.1:${smtpPort}`;
  settings.ORTUS_SUBMISSION_LISTEN = `127.0.0.1:${await freePort()}`;
  settings.ORTUS_IMAP_LISTEN = `127.0.0.1:${await freePort()}`;
  const dns = await startDns();
  settings.ORTUS_DNS_SERVERS = dns.address;
  let dropSchema: (() => Promise<void>) | undefined;
  let schemaName: string | undefined;
  if (which === "cluster") {
    const base = need("ORTUS_TEST_POSTGRES");
    const schema = `story_${randomBytes(6).toString("hex")}`;
    schemaName = schema;
    const client = new pg.Client({ connectionString: base });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.end();
    dropSchema = async () => {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    };
    const separator = base.includes("?") ? "&" : "?";
    settings.ORTUS_DATABASE_URL = `${base}${separator}options=-c%20search_path%3D${schema}`;
    settings.ORTUS_FILES_S3_ENDPOINT = need("ORTUS_TEST_S3_ENDPOINT");
    settings.ORTUS_FILES_S3_BUCKET = need("ORTUS_TEST_S3_BUCKET");
    settings.ORTUS_FILES_S3_ACCESS_KEY = need("ORTUS_TEST_S3_ACCESS_KEY");
    settings.ORTUS_FILES_S3_SECRET_KEY = need("ORTUS_TEST_S3_SECRET_KEY");
    settings.ORTUS_FILES_S3_ROOT = schema;
  }
  const log: string[] = [];
  const child = spawn(binary, ["serve"], {
    cwd: dataDir,
    env: { PATH: process.env.PATH ?? "", ...settings, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  const url = settings.ORTUS_PUBLIC_URL!;
  await waitForHealth(url, child, log);
  return {
    url,
    shape: which,
    dataDir,
    schema: schemaName,
    setupToken: settings.ORTUS_SETUP_TOKEN!,
    smtpPort,
    dns,
    log,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await exited;
      }
      await dropSchema?.();
      await dns.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
