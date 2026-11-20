// Story steps as tests. A story runs its steps in order on one fresh
// installation; each test is named after the step it proves, as in the
// design: "S2.1 Opens the admin console for the first time ...".
//
//   import { story, step } from "../harness/story.ts";
//   story("Story 2", () => {
//     step("S2.1", async ({ page, ortus }) => { ... });
//   });
import { test as base, expect } from "@playwright/test";
import steps from "../steps.json" with { type: "json" };
import { startOrtus, type Installation } from "./ortus.ts";

export interface Step {
  id: string;
  story: string;
  title: string;
  time: string;
  who: string;
  text: string;
  board: string;
  release: string;
  v1: boolean;
  v1_scope?: string;
}

export const STEPS: Step[] = steps as Step[];

export function findStep(id: string): Step {
  const found = STEPS.find((s) => s.id === id);
  if (!found) throw new Error(`there is no story step ${id} in steps.json`);
  return found;
}

/**
 * One installation for every step of a story file: fresh for each file,
 * even when one worker runs several files.
 */
export const test = base.extend<{ ortus: Installation }, { installations: Map<string, Promise<Installation>> }>({
  installations: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const all = new Map<string, Promise<Installation>>();
      await use(all);
      for (const one of all.values()) await (await one).stop();
    },
    { scope: "worker" },
  ],
  ortus: async ({ installations }, use, info) => {
    // Steps are declared in this file (see step()), so the spec file is
    // the first part of the title path, not info.file.
    const file = info.titlePath[0] ?? info.file;
    let started = installations.get(file);
    if (!started) {
      started = startOrtus();
      installations.set(file, started);
    }
    const installation = await started;
    await use(installation);
    if (info.status !== info.expectedStatus) {
      await info.attach("ortus.log", { body: installation.log.join(""), contentType: "text/plain" });
    }
  },
  baseURL: async ({ ortus }, use) => use(ortus.url),
});

export { expect };

/** A story: its steps run in order and stop at the first failure. */
export function story(name: string, body: () => void): void {
  test.describe(name, () => {
    test.describe.configure({ mode: "serial" });
    body();
  });
}

/** The test for one story step, named by its id and text. */
export function step(id: string, body: Parameters<typeof test>[2]): void {
  const s = findStep(id);
  test(`${s.id} ${s.v1_scope ?? s.text}`, { tag: [`@${s.id}`, s.v1 ? "@v1" : "@later"] }, body);
}
