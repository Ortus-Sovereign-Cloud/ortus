// Which V1 story steps pass, from the last run's results
// (test-results/results.json) and the specs.
//
//   node tools/coverage.mjs           list them; always succeeds
//   node tools/coverage.mjs --strict  fail unless every V1 step passed
//
// A step done on the phones (`phones` in steps.json: repository and test)
// also needs each phone repository's CI green on main, run against a program
// commit with the same parts as this one; a phone-only step counts by that.
import { readFileSync, existsSync } from "node:fs";

const steps = JSON.parse(readFileSync(new URL("../steps.json", import.meta.url)));
const resultsFile = new URL("../test-results/results.json", import.meta.url);
const passed = new Set();
const failed = new Set();
if (existsSync(resultsFile)) {
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = spec.title.split(" ")[0];
      const ok = spec.tests.every((t) => t.results.length > 0 && t.results.every((r) => r.status === "passed"));
      (ok ? passed : failed).add(id);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of JSON.parse(readFileSync(resultsFile)).suites ?? []) walk(suite);
}

// The phone repositories' CI: green on main, and run against a program
// commit that pins exactly the parts this one does (their pins.toml names
// it; its pins.toml is compared with ours).
const ours = readFileSync(new URL("../../pins.toml", import.meta.url), "utf8");
const parts = (text) => text.split("\n").filter((l) => /^ortus-[a-z]+ = "[0-9a-f]{40}"$/.test(l)).sort().join("\n");
const phoneCi = new Map();
async function phoneGreen(repo) {
  if (!phoneCi.has(repo)) {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const raw = (r, ref, path) => fetch(`https://raw.githubusercontent.com/Ortus-Sovereign-Cloud/${r}/${ref}/${path}`).then((x) => (x.ok ? x.text() : ""));
    phoneCi.set(
      repo,
      (async () => {
        const answer = await fetch(`https://api.github.com/repos/Ortus-Sovereign-Cloud/${repo}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1`, { headers });
        // A refusal (the anonymous rate limit) is not a red CI: say which.
        if (!answer.ok) return `${repo}: GitHub did not answer (${answer.status})`;
        const runs = await answer.json();
        const run = runs.workflow_runs?.[0];
        if (run?.conclusion !== "success") return `${repo}: CI not green on main`;
        const pinned = (await raw(repo, run.head_sha, "pins.toml")).match(/^ortus = "([0-9a-f]{40})"$/m)?.[1];
        if (!pinned) return `${repo}: no program pin at ${run.head_sha}`;
        if (parts(await raw("ortus", pinned, "pins.toml")) !== parts(ours)) return `${repo}: tested against ortus ${pinned.slice(0, 7)}, whose parts differ from these`;
        return "";
      })().catch((e) => `${repo}: ${e}`),
    );
  }
  return phoneCi.get(repo);
}

let missing = 0;
console.log("Step   | V1 | Result  | Board");
for (const s of steps) {
  let result = passed.has(s.id) ? "passed" : failed.has(s.id) ? "FAILED" : "no test";
  if (s.phones && (result === "passed" || result === "no test")) {
    // Done on the phones too: both phones' tests must hold as well.
    const problems = (await Promise.all(Object.keys(s.phones).map(phoneGreen))).filter(Boolean);
    if (problems.length) console.log(`${s.id}: ${problems.join("; ")}`);
    result = problems.length ? "phones?" : result === "passed" ? "passed" : "phones";
  }
  if (s.v1 && result !== "passed" && result !== "phones") missing += 1;
  console.log(`${s.id.padEnd(6)} | ${s.v1 ? "V1" : "  "} | ${result.padEnd(7)} | ${s.board}${s.phones ? ` (${Object.entries(s.phones).map(([r, t]) => `${r}: ${t}`).join(", ")})` : ""}`);
}
const v1 = steps.filter((s) => s.v1).length;
console.log(`\n${v1 - missing} of ${v1} V1 steps pass.`);
if (process.argv.includes("--strict") && missing > 0) process.exit(1);
