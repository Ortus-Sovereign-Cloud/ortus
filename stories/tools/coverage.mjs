// Which V1 story steps have a passing browser test, from the last run's
// results (test-results/results.json) and the specs.
//
//   node tools/coverage.mjs           list them; always succeeds
//   node tools/coverage.mjs --strict  fail unless every V1 step passed
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
let missing = 0;
console.log("Step   | V1 | Result  | Board");
for (const s of steps) {
  const result = passed.has(s.id) ? "passed" : failed.has(s.id) ? "FAILED" : "no test";
  if (s.v1 && result !== "passed") missing += 1;
  console.log(`${s.id.padEnd(6)} | ${s.v1 ? "V1" : "  "} | ${result.padEnd(7)} | ${s.board}`);
}
const v1 = steps.filter((s) => s.v1).length;
console.log(`\n${v1 - missing} of ${v1} V1 steps pass.`);
if (process.argv.includes("--strict") && missing > 0) process.exit(1);
