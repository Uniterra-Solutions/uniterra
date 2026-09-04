/**
 * dsh CLI resolution — where the runtime entry (`lib/bin.js`) is found.
 *
 * Packaged: the npm `@deepseek-ai/dsh` package inside the embedded source
 * tree (`Contents/Resources/src` on macOS, `resources/src` on Windows — both
 * `process.resourcesPath`). In the pnpm workspace `@deepseek-ai/dsh` is a
 * devDependency of the uniterra-desktop package, so pnpm links it under
 * `packages/uniterra-desktop/node_modules` (never the workspace root) — dev
 * and packaged both resolve it there, with one exception: the installer's
 * Windows path embeds the tree with robocopy, which MATERIALIZES pnpm
 * junctions, so the junction path cannot resolve dsh's own dependencies
 * (ERR_MODULE_NOT_FOUND on boot). Windows resolves the physical `.pnpm`
 * store location instead, where every dependency is a materialized sibling.
 *
 * Dev: when the vendored DeepSeek Harness source (`vendor/dsh-harness`) has
 * been built with `pnpm run build:vendored-dsh`, the app runs THAT CLI — a
 * source edit under `vendor/dsh-harness` takes effect on the next dev boot.
 * Without a vendored build it falls back to the npm-linked package exactly
 * like the packaged app. See `vendor/dsh-harness/VENDOR.md`.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

export interface DshCliResolutionInput {
  /** The app is packaged and the source tree lives inside the app resources. */
  readonly packaged: boolean;
  /** Source root: `process.resourcesPath/src` when packaged, the repo root in dev. */
  readonly sourceRoot: string;
  /** Platform to resolve for (`win32` changes the fallback). */
  readonly platform: NodeJS.Platform;
}

const NPM_JUNCTION_RELATIVE = path.join(
  'packages',
  'uniterra-desktop',
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js',
);

const VENDORED_RELATIVE = path.join('vendor', 'dsh-harness', 'apps', 'cli', 'lib', 'bin.js');

function npmJunctionCli(sourceRoot: string): string {
  return path.join(sourceRoot, NPM_JUNCTION_RELATIVE);
}

/** Windows defense-in-depth: the physical `.pnpm` store location. */
function windowsStoreCli(
  sourceRoot: string,
  exists: (candidate: string) => boolean,
  readdir: (dir: string) => string[],
): string | undefined {
  const storeRoot = path.join(sourceRoot, 'node_modules', '.pnpm');
  let entries: string[];
  try {
    entries = readdir(storeRoot);
  } catch {
    return undefined; // no .pnpm store — the caller falls back to the junction path
  }
  return entries
    .filter((name) => name.startsWith('@deepseek-ai+dsh@'))
    .map((name) =>
      path.join(storeRoot, name, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    )
    .find((candidate) => exists(candidate));
}

/**
 * Resolve the dsh CLI entry (`lib/bin.js`) for the given environment.
 *
 * @param input - the environment to resolve for.
 * @param exists - existence probe (injected for tests).
 * @param readdir - directory listing (injected for tests).
 * @returns the absolute CLI path.
 */
export function resolveDshCliPath(
  input: DshCliResolutionInput,
  exists: (candidate: string) => boolean = existsSync,
  readdir: (dir: string) => string[] = (dir) => readdirSync(dir),
): string {
  // Dev runs the vendored harness source first — it IS the development loop;
  // packaged builds always use the npm package inside the embedded tree.
  if (!input.packaged) {
    const vendoredCli = path.join(input.sourceRoot, VENDORED_RELATIVE);
    if (exists(vendoredCli)) {
      return vendoredCli;
    }
  }
  const junction = npmJunctionCli(input.sourceRoot);
  if (input.platform !== 'win32') {
    return junction;
  }
  return windowsStoreCli(input.sourceRoot, exists, readdir) ?? junction;
}
