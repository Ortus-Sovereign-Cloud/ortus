// The harness itself: a fresh installation in the chosen shape answers,
// shows its web client, and every step id used by a spec exists.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { join } from "node:path";
import { test, expect, STEPS } from "../harness/story.ts";

test("a fresh installation answers and shows the web client", async ({ page, ortus }) => {
  const health = await (await fetch(`${ortus.url}/api/v1/health`)).json();
  expect(health.status).toBe("ok");
  await page.goto("/");
  await expect(page.locator("ortus-root")).toBeAttached();
  // A new installation asks for its first owner.
  await expect(page).toHaveURL(/\/setup$/);
});

test("the installation keeps its data where its shape says", async ({ ortus }) => {
  if (ortus.shape === "one-machine") {
    expect(existsSync(join(ortus.dataDir, "ortus.db"))).toBe(true);
  } else {
    expect(existsSync(join(ortus.dataDir, "ortus.db"))).toBe(false);
    const client = new pg.Client({ connectionString: process.env.ORTUS_TEST_POSTGRES });
    await client.connect();
    const result = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ortus_migrations'",
      [ortus.schema],
    );
    await client.end();
    expect(result.rows[0].n).toBe(1);
  }
});

test("every step a spec names is a real story step", () => {
  const ids = new Set(STEPS.map((s) => s.id));
  const dir = import.meta.dirname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".spec.ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const match of text.matchAll(/\bstep\("([^"]+)"/g)) {
      expect(ids.has(match[1]), `${file}: ${match[1]}`).toBe(true);
    }
  }
});
