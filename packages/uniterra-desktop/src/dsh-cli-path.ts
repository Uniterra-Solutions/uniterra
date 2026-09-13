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

/** A `.pnpm` store directory name for dsh: `@deepseek-ai+dsh@<version>_<peers>`. */
const STORE_ENTRY_PREFIX = '@deepseek-ai+dsh@';

/** The dsh version encoded in a store entry name, without its peer hash. */
function storeEntryVersion(entry: string): string {
  const rest = entry.slice(STORE_ENTRY_PREFIX.length);
  const hash = rest.indexOf('_');
  return hash === -1 ? rest : rest.slice(0, hash);
}

/**
 * Order two dsh versions: numeric release segments first, a release above its
 * own prereleases, then prerelease segments (numeric when both are numeric).
 * Enough for the `x.y.z` / `x.y.z-rc.n` family names dsh publishes.
 */
function compareDshVersions(a: string, b: string): number {
  const [aCore = '', aPre] = a.split('-', 2);
  const [bCore = '', bPre] = b.split('-', 2);
  const core = compareSegments(aCore, bCore);
  if (core !== 0) {
    return core;
  }
  if (aPre === undefined || bPre === undefined) {
    return aPre === bPre ? 0 : aPre === undefined ? 1 : -1;
  }
  return compareSegments(aPre, bPre);
}

function compareSegments(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    const segment = Number.isNaN(ln) || Number.isNaN(rn) ? l.localeCompare(r) : Math.sign(ln - rn);
    if (segment !== 0) return segment;
  }
  return 0;
}

/**
 * Windows defense-in-depth: the physical `.pnpm` store location.
 *
 * The store keeps every dsh family it ever installed — bumping the pinned
 * family leaves the previous `@deepseek-ai+dsh@<old-version>_<hash>` shard
 * behind — so the NEWEST version wins, and ties break on the entry name. A
 * `readdir` order pick would boot the stale family beside a current one.
 */
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
  let best: { readonly entry: string; readonly version: string; readonly cli: string } | undefined;
  for (const entry of entries) {
    if (!entry.startsWith(STORE_ENTRY_PREFIX)) {
      continue;
    }
    const cli = path.join(storeRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!exists(cli)) {
      continue;
    }
    const version = storeEntryVersion(entry);
    if (
      best === undefined ||
      compareDshVersions(version, best.version) > 0 ||
      (compareDshVersions(version, best.version) === 0 && entry > best.entry)
    ) {
      best = { entry, version, cli };
    }
  }
  return best?.cli;
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
