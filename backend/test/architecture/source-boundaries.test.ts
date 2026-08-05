import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = resolve(backendRoot, "src");

const boundaryRules: Record<string, string[]> = {
  modules: ["api", "connectors", "database"],
  connectors: ["api", "database", "modules"],
  protocol: ["api", "connectors", "database", "modules"],
};

describe("source boundaries", () => {
  for (const [boundary, forbiddenTargets] of Object.entries(boundaryRules)) {
    it(`${boundary} does not import forbidden runtime layers`, async () => {
      const violations: string[] = [];
      for (const file of await typeScriptFiles(resolve(sourceRoot, boundary))) {
        const source = await readFile(file, "utf8");
        for (const specifier of relativeImports(source)) {
          const target = relative(
            sourceRoot,
            resolve(dirname(file), specifier),
          ).replaceAll("\\", "/");
          if (forbiddenTargets.some((layer) => target.startsWith(`${layer}/`))) {
            violations.push(
              `${relative(sourceRoot, file).replaceAll("\\", "/")} -> ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

async function typeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return typeScriptFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

function relativeImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)(["'])(\.[^"']+)\1/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2]) {
      imports.push(match[2]);
    }
  }
  return imports;
}
