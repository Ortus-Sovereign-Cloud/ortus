// Which V1 story steps pass, from the last run's results
// (test-results/results.json) and the specs.
//
//   node tools/coverage.mjs           list them; always succeeds
//   node tools/coverage.mjs --strict  fail unless every V1 step passed
//
// A step done on the phones (`phones` in steps.json: repository and test)
// counts when its browser test passed, or, with none, when the CI of each of
// those phone repositories passed on main (GitHub's API; GITHUB_TOKEN if set).
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

const phoneCi = new Map();
async function phoneGreen(repo) {
  if (!phoneCi.has(repo)) {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    phoneCi.set(
      repo,
      fetch(`https://api.github.com/repos/Ortus-Sovereign-Cloud/${repo}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1`, { headers })
        .then((r) => (r.ok ? r.json() : { workflow_runs: [] }))
        .then((j) => j.workflow_runs?.[0]?.conclusion === "success")
        .catch(() => false),
    );
  }
  return phoneCi.get(repo);
}

let missing = 0;
console.log("Step   | V1 | Result  | Board");
for (const s of steps) {
  let result = passed.has(s.id) ? "passed" : failed.has(s.id) ? "FAILED" : "no test";
  if (result === "no test" && s.phones) {
    const green = await Promise.all(Object.keys(s.phones).map(phoneGreen));
    result = green.every(Boolean) ? "phones" : "phones?";
  }
  if (s.v1 && result !== "passed" && result !== "phones") missing += 1;
  console.log(`${s.id.padEnd(6)} | ${s.v1 ? "V1" : "  "} | ${result.padEnd(7)} | ${s.board}${s.phones ? ` (${Object.entries(s.phones).map(([r, t]) => `${r}: ${t}`).join(", ")})` : ""}`);
}
const v1 = steps.filter((s) => s.v1).length;
console.log(`\n${v1 - missing} of ${v1} V1 steps pass.`);
if (process.argv.includes("--strict") && missing > 0) process.exit(1);
