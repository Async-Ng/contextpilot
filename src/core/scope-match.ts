import fg from "fast-glob";

export interface StaleScope {
  id: string;
  scope: string;
}

/**
 * Whether a scope glob matches at least one real file under the project root.
 * Shared by decision-scope and rule-scope staleness checks so both agree on
 * what counts as "this scope no longer points at anything real".
 */
export function globHasMatches(projectRoot: string, glob: string): boolean {
  return fg.sync(glob, { cwd: projectRoot }).length > 0;
}
