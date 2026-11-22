/** Who works at the sample organisation: name, local part, role. */
export const PEOPLE: [string, string, string][];

/** Fills the fresh installation at `base`; answers the owner's sign-in. */
export function fill(
  base: string,
  setupToken: string,
  domain: string,
  log?: (line: string) => void,
): Promise<{ email: string; password: string; secret: string }>;
