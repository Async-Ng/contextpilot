export interface HashEntry {
  hash: string;
  recordedAt: string;
}

export type DriftKind = "new" | "stale" | "missing";

export interface DriftEntry {
  path: string;
  kind: DriftKind;
}

/**
 * Compares a map of last-recorded hashes against a map of current hashes and
 * reports what changed. Shared by every "is X still in sync with what we last
 * wrote/ingested" check (generated files, SRS source files, rule files) so
 * each one doesn't reimplement the same comparison with a slightly different
 * shape.
 */
export function diffHashes(
  known: Record<string, HashEntry>,
  current: Record<string, string | undefined>,
  options?: { includeMissing?: boolean },
): DriftEntry[] {
  const drift: DriftEntry[] = [];
  const paths = new Set([...Object.keys(known), ...Object.keys(current)]);

  for (const path of paths) {
    const currentHash = current[path];
    const knownEntry = known[path];

    if (currentHash === undefined) {
      if (knownEntry && options?.includeMissing) {
        drift.push({ path, kind: "missing" });
      }
      continue;
    }

    if (!knownEntry) {
      drift.push({ path, kind: "new" });
    } else if (knownEntry.hash !== currentHash) {
      drift.push({ path, kind: "stale" });
    }
  }

  return drift;
}
