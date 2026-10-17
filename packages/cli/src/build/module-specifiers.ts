import { relative, resolve, sep } from "node:path";
import { Project } from "typescript/unstable/async";

/** Returns a relative module specifier like `../../components/ui/button`. */
export function getRelativeSpecifier(
  fromDir: string,
  fileName: string,
): string {
  const specifier = toPosix(
    relative(fromDir, fileName.replace(/\.[cm]?[jt]sx?$/, "")),
  );
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

/** Returns a module specifier using the `@/*` alias (e.g. `@/components/ui/button`), or a module specifier relative to the cwd. */
export function getDisplaySpecifier(
  project: Project,
  fileName: string,
): string {
  const { compilerOptions } = project;
  const target = compilerOptions.paths?.["@/*"]?.[0];
  if (target) {
    const root = resolve(
      // Internal option for the directory of the tsconfig declaring `paths`, which may come from `extends`.
      (compilerOptions as { pathsBasePath: string }).pathsBasePath,
      target.replace("*", ""),
    );
    const specifier = toPosix(
      relative(root, fileName.replace(/\.[cm]?[jt]sx?$/, "")),
    ).replace(/(^|\/)index$/, "");
    if (!specifier.startsWith("..")) return `@/${specifier}`;
  }

  return getRelativeSpecifier(process.cwd(), fileName);
}

function toPosix(value: string): string {
  return value.split(sep).join("/");
}
