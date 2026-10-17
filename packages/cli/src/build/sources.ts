import { glob } from "node:fs/promises";
import { join, sep } from "node:path";

export const componentRoots = [
  "components",
  "src/components",
  "app/components",
];

export interface Source {
  fileName: string;
  /** Path relative to the component root without extension (e.g. `ui/button`). */
  route: string;
}

export async function scanSources(): Promise<Source[]> {
  const sources: Source[] = [];

  for (const root of componentRoots) {
    const absoluteRoot = join(process.cwd(), root);

    const entries: string[] = [];
    for await (const entry of glob("**/*.{tsx,jsx}", {
      cwd: absoluteRoot,
      exclude: ["**/*.{test,spec,stories}.*"],
    }))
      entries.push(entry);

    entries.sort();
    for (const entry of entries)
      sources.push({
        fileName: join(absoluteRoot, entry),
        route: entry
          .replace(/\.[jt]sx$/, "")
          .split(sep)
          .join("/"),
      });
  }

  return sources;
}
