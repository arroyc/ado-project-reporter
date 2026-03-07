/**
 * Version helper — reads the package version from the nearest package.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Read the package version from the nearest package.json. */
export function getPackageVersion(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(thisDir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
