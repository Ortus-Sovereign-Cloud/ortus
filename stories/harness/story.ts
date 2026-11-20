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

/** One installation for every step of a story file. */
export const test = base.extend<{ ortus: Installation }, { installation: Installation }>({
  installation: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const installation = await startOrtus();
      await use(installation);
      await installation.stop();
    },
    { scope: "worker" },
  ],
  ortus: async ({ installation }, use, info) => {
    await use(installation);
    if (info.status !== info.expectedStatus) {
      await info.attach("ortus.log", { body: installation.log.join(""), contentType: "text/plain" });
    }
  },
  baseURL: async ({ installation }, use) => use(installation.url),
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
