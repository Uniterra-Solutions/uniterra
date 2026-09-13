/**
 * Uniterra built-ins: the company plugins and skills that ship with the app and
 * are ensured in the profile the user actually runs (dev → the mirrored test
 * home, packaged → ~/.dsh's `web` profile).
 *
 * A built-in is declared ONCE, through {@link registerBuiltinPlugin}, under one
 * of the four mechanisms — npm, vendored, workspace, or optional (shipped but
 * not forced; see reconcileOptionalPlugins) — or flagged retired. Every
 * consumer (expected bundles, the provisioning loops, stale detection, and the
 * retirement heal) derives from that single registry, so adding a built-in
 * never means wiring a second code path.
 *
 * Idempotent: a profile that already carries every built-in is left alone, so
 * user-installed extras and edits are never touched.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

/** One npm-published built-in, pinned exact, as a `dsh plugin add` spec. */
export interface NpmBuiltin {
  readonly kind: 'npm';
  readonly spec: string;
}

/** One copy-based built-in: vendored (third-party, under `vendor/dsh-plugins`),
 * in-house workspace (`packages/*`, this repo's own), or optional (a vendored
 * plugin shipped but NOT forced — installed only when the profile's
 * `.uniterra.json` toggle enables it). Copied into the profile's node_modules
 * under its package name (not pnpm-installed) because some declare peers that
 * only exist in the dsh source workspace and pnpm would fail fetching them.
 * The package name can differ from the repo dir. */
export interface CopyBuiltin {
  readonly kind: 'vendor' | 'workspace' | 'optional';
  readonly dir: string;
  readonly package: string;
}

/** A built-in dropped from the profile (or folded into another). Declared in
 * the SAME registry with a `retired` flag so the heal and the expected-bundle
 * computation derive from one source of truth instead of a separate
 * RETIRED_BUILTINS list. The heal removes exactly this package name. */
export interface RetiredBuiltin {
  readonly retired: true;
  readonly package: string;
  /** Why it was dropped / what replaced it, for the record. */
  readonly comment?: string;
}

/** One registry entry: active (npm / vendor / workspace) or retired. */
export type BuiltinPlugin = NpmBuiltin | CopyBuiltin | RetiredBuiltin;

/** A non-retired registry entry. */
export type ActiveBuiltin = NpmBuiltin | CopyBuiltin;

/** The single registry every built-in is declared through. */
const registry: BuiltinPlugin[] = [];

/**
 * Declare one built-in. This is the ONLY place a built-in is wired: adding a
 * plugin is a single call here, and every derived consumer picks it up.
 */
export function registerBuiltinPlugin(plugin: BuiltinPlugin): void {
  registry.push(plugin);
}

function isRetired(entry: BuiltinPlugin): entry is RetiredBuiltin {
  return (entry as { retired?: unknown }).retired === true;
}

// ---------------------------------------------------------------------------
// Registry declarations — the full built-in set, one entry per plugin.
// ---------------------------------------------------------------------------

registerBuiltinPlugin({ kind: 'npm', spec: 'dshmarket@1.41.0' });
// Sidebar enhancement, 0.19.0 — the release built for the dsh 0.1.5 family:
// every @deepseek-ai/* peer moves to ^0.1.5-rc.1 and the integration is
// re-planted on the NEW native right-sidebar services
// (ctx.inject(['sidebarRightTabs'], …) + ctx.get('sidebarRight')), which only
// exist in the 0.1.5 family; 0.18.0 peers on the 0.1.2-rc.1 family and drives
// the seams that family removed.
registerBuiltinPlugin({ kind: 'npm', spec: 'dsh-better-sidebar@0.19.0' });
registerBuiltinPlugin({ kind: 'npm', spec: 'dsh-find-plugin@0.3.7' });
registerBuiltinPlugin({ kind: 'npm', spec: 'dsh-tool-git@0.1.3' });
registerBuiltinPlugin({ kind: 'npm', spec: 'dsh-computer-use@0.2.0' });
// Git worktree session targets (wloops/dsh-git-worktree v0.7.4): isolated
// sessions per worktree with review checkpoints, human-confirmed delivery, and
// safe recovery. npm-published, peers target the older dsh 0.1.2-rc.1 family
// exactly (@deepseek-ai/cordis ^4.0.2, dsh-agent/dsh-tools/dsh-session/… ^0.1.2-rc.1),
// so it rides the same `dsh plugin add` path as the other npm built-ins (the
// profile's pnpm reports the peer mismatch as a warning, not an install error).
registerBuiltinPlugin({ kind: 'npm', spec: 'dsh-git-worktree@0.7.4' });

// The skin is the `dsh-deep-whale` standalone distribution (`maid-atelier`
// package) — self-inserting, host is a no-op, art embedded. The earlier
// `deep-whale-day-night-theme` builtin-row distribution was retired: it
// augmented a base row only shipped by `dsh-client-ui-theme-plugins` (absent
// on the pinned rc.6 family), so its patch silently no-oped and the skin
// never loaded. See `vendor/dsh-plugins/VENDOR.md`.
//
// The skin is OPTIONAL: a cosmetic theme, installed for a user only when
// their profile's `.uniterra.json` toggle enables it — never forced on fresh
// installs, never removed from existing ones (see reconcileOptionalPlugins).
// Licence model at the pinned v0.1.2 tag: MIT for the CODE (`LICENSE`) plus
// CC BY-NC-SA 4.0 for the ARTWORK (`LICENSE-ARTWORK`, non-commercial) — the
// earlier v0.1.1 copy shipped one whole-project CC BY-NC-SA 4.0 `LICENSE`.
// See vendor/dsh-plugins/VENDOR.md for the pin ledger.
registerBuiltinPlugin({
  kind: 'optional',
  dir: 'dsh-deep-whale',
  package: '@dsh-external/dsh-client-ui-skin-maid-atelier',
});
registerBuiltinPlugin({ kind: 'vendor', dir: 'dsh-shortcuts', package: 'dsh-shortcuts' });

// The dynamic workflow layer (@dsh-external/workflow): a KodaX-parity
// multi-agent workflow engine that persists workflows as `.workflow.json`
// capsules and exposes workflow_list / run_workflow / workflow_manage, so the
// bundled review skill invokes a workflow by NAME (run_workflow('review', args))
// instead of the model copying a large JS block into the native workflow tool —
// the copy-failure failure mode. Vendored at the v0.1.4 tag (see
// vendor/dsh-plugins/VENDOR.md); its peer ranges (^0.1.3-alpha.1) are reported
// unsatisfied (warn) against the pinned dsh 0.1.5-rc.2 pre-release family, so
// it ships as a copy-based built-in (no pnpm install) and loads via
// ctx.subagents + ctx.tools. The review capsule is provisioned from the skills
// package into the profile's workflow dir by ensureWorkflowCapsules — which also
// removes the retired pipeline capsules from an already-provisioned profile.
registerBuiltinPlugin({
  kind: 'vendor',
  dir: 'dsh-workflow',
  package: '@dsh-external/workflow',
});

// The ego-browser plugin (Fisfzy/dsh-ego-browser @ 6133edfb…, v0.8.3, MIT):
// structured browser automation — 32 ego_* tools driving a VENDORED ego-lite
// Chromium runtime through ctx.subprocess, plus a realtime watch panel in the
// web shell. This is the deliberate, documented exception to AGENTS.md's
// "vendor a plugin only to customize it" rule (issue #35): npm only ever
// published dsh-ego-browser@0.8.0, whose peers target
// @deepseek-ai/dsh-client-runtime — a package the pinned dsh family no longer
// ships — so an npm import cannot resolve, while the pinned copy declares
// dsh.engines.dsh ">=0.1.2-rc.1" and self-inserts its "ego-browser" Loader row
// under its own package name (cordis.patch.yml), i.e. it works as shipped.
// The copy is upstream VERBATIM — no local patch (see
// vendor/dsh-plugins/VENDOR.md for the pin, the trimmed scope and the licence).
//
// Its one runtime dependency is a BARE "schemastery" (NOT the scoped
// @deepseek-ai/schemastery the dsh family ships), imported statically at the
// top of lib/index.js and used to build the Config schema at module scope, so
// the profile cannot load the plugin without it — hence PROFILE_RUNTIME_DEPS.
registerBuiltinPlugin({
  kind: 'vendor',
  dir: 'ego-browser',
  package: 'dsh-ego-browser',
});

// In-house workspace built-ins ship built — the workspace build must have run
// before provisioning — and their host bundles are self-contained (runtime
// deps inlined), so copying the package dir is enough: the profile gets
// `package.json` + `lib/` + `cordis.patch.yml` with no pnpm install.
registerBuiltinPlugin({
  kind: 'workspace',
  dir: 'packages/uniterra-provider',
  package: '@uniterra-solutions/uniterra-provider',
});

registerBuiltinPlugin({
  retired: true,
  package: 'dsh-hotkeys',
  comment: 'Keyboard hotkeys: overlapped by the vendored dsh-shortcuts.',
});
registerBuiltinPlugin({
  retired: true,
  package: '@leetoners/dsh-ui-subagent-monitor',
  comment: 'Live subagent monitor: covered by dsh-better-sidebar Tasks page.',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-git-graph',
  comment: 'Embedded git graph: covered by dsh-better-sidebar Git panel.',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-thinking-effort',
  comment:
    'Third-party reasoning-effort editor: the provider declares reasoningEfforts from models.dev.',
});
registerBuiltinPlugin({
  retired: true,
  package: '@cardo/cardo-provider',
  comment: 'Pre-rename workspace built-in: now shipped as @uniterra-solutions/uniterra-provider.',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-notifier',
  comment:
    'Standalone desktop notifier: its notifications overlap with dsh-better-sidebar Tasks and other dsh notification plugins; no longer bundled (user-installed copies preserved).',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-browser-playwright',
  comment:
    'Browser automation: replaced by the vendored dsh-ego-browser built-in above (32 ego_* tools over a vendored ego-lite Chromium runtime).',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-file-upload',
  comment:
    'File upload: @deepseek-ai/dsh-web-app@0.1.5-rc.2 ships its own client Loader row `id: file-upload` (@deepseek-ai/dsh-client-file-upload) and this npm plugin inserts the SAME loader id, so a freshly provisioned 0.1.5 profile FAILED TO BOOT with "failed to apply loader entry include (cordis:include): duplicate loader entry id: file-upload"; retiring it is the fix, and the web app row keeps the capability.',
});
registerBuiltinPlugin({
  retired: true,
  package: 'dsh-subagent-model-picker',
  comment:
    'Per-subagent model selection: covered natively by the subagent tool (provider + model parameters).',
});

/** Non-bundle npm dependencies a copy-based built-in needs at runtime but that
 * the copy mechanism cannot auto-install (the vendored @dsh-external/workflow
 * plugin runs workflows in a QuickJS sandbox and depends on
 * `quickjs-emscripten`, which is not part of the dsh profile; the vendored
 * dsh-ego-browser plugin statically imports a BARE `schemastery` — the scoped
 * `@deepseek-ai/schemastery` the dsh family ships is a different package name —
 * and builds its Config schema with it at module scope, so the profile cannot
 * even evaluate the plugin without it). Installed with `dsh plugin add` (a
 * plain dependency, not a profile layer), pinned exact like every other dep. */
const PROFILE_RUNTIME_DEPS: readonly string[] = ['quickjs-emscripten@0.32.0', 'schemastery@3.18.0'];

/**
 * The pnpm settings every profile needs for plugin installs. Settings keys are
 * camelCase (pnpm 11's pnpm-workspace.yaml accepts only those; kebab-case
 * names are silently ignored). autoInstallPeers is OFF: a plugin whose peer
 * ranges target an older dsh pre-release family (e.g. `^0.1.0-rc.6`) cannot
 * co-resolve with the pinned 0.1.5-rc.2 family in one tree — pnpm 11 reports
 * "No matching version found" for a satisfiable range
 * when auto-installing disjoint pre-release families. The dsh family is
 * already present from the profile's base bundles, so peers resolve at
 * runtime; the pnpm warning ("Issues with peer dependencies found") is the
 * expected signal for a stale plugin.
 */
const PROFILE_PNPM_WORKSPACE = [
  'allowBuilds:',
  '  node-pty: true',
  '  sharp: true',
  '  protobufjs: true',
  '  fsevents: true',
  '  tesseract.js: true',
  'minimumReleaseAge: 0',
  'autoInstallPeers: false',
  '',
].join('\n');

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** The profile directory under one dsh home. */
function profileDir(dshHome: string, profile: string): string {
  return path.join(dshHome, 'profiles', profile);
}

/** Extract the package name from an npm spec `<name>@<version>`. The name may
 * itself be scoped (`@scope/name`), so the version split is on the LAST `@`. */
export function builtinPackageName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at <= 0 ? spec : spec.slice(0, at);
}

/** Every declared registry entry, in declaration order (a snapshot copy). */
export function builtinPlugins(): readonly BuiltinPlugin[] {
  return [...registry];
}

/** Active (non-retired) registry entries, in declaration order. */
function activeBuiltins(): readonly ActiveBuiltin[] {
  return registry.filter((entry): entry is ActiveBuiltin => !isRetired(entry));
}

/** The npm built-in specs, in declaration order. */
export function npmBuiltinSpecs(): readonly string[] {
  return activeBuiltins()
    .filter((entry): entry is NpmBuiltin => entry.kind === 'npm')
    .map((entry) => entry.spec);
}

/** The copy-based built-ins of one kind, in declaration order. */
export function copyBuiltins(kind: CopyBuiltin['kind']): readonly CopyBuiltin[] {
  return activeBuiltins().filter((entry): entry is CopyBuiltin => entry.kind === kind);
}

/** The package names of every retired built-in, in declaration order. */
export function retiredBuiltinNames(): readonly string[] {
  return registry.filter(isRetired).map((entry) => entry.package);
}

/** The expected bundle rows of a fully provisioned uniterra profile: the
 * official dsh bundles plus every active built-in plugin's package name. */
export function expectedBuiltinBundles(): string[] {
  return [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    ...npmBuiltinSpecs().map(builtinPackageName),
    ...copyBuiltins('vendor').map((entry) => entry.package),
    ...copyBuiltins('workspace').map((entry) => entry.package),
  ];
}

/** Whether the profile's bundle list already carries every built-in. */
export function hasAllBuiltins(profileDirPath: string): boolean {
  try {
    const manifest = readJson(path.join(profileDirPath, 'package.json')) as {
      dsh?: { profile?: { bundles?: unknown } };
    };
    const raw = manifest.dsh?.profile?.bundles;
    const bundles = new Set(Array.isArray(raw) ? (raw as unknown[]) : []);
    return expectedBuiltinBundles().every((name) => bundles.has(name));
  } catch {
    return false;
  }
}

/** A deterministic content fingerprint of the given implementation files under
 * `baseDir`, over each file's bytes in sorted path order. Used only as a
 * staleness oracle: two copies that ship the same bytes for the same paths
 * yield the same digest. Files solely on one side are excluded by the caller. */
function contentFingerprint(relPaths: string[], baseDir: string): string {
  const hash = createHash('sha256');
  for (const rel of relPaths) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(path.join(baseDir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The relative implementation paths present in BOTH dirs, sorted (excluding
 * `package.json`, `node_modules`, `.git`). Comparing only shared files keeps
 * the oracle honest: `package.json` is handled by the explicit version check
 * (its `name` legitimately equals the package name on both sides), and a file
 * on ONLY one side is not a staleness signal — the installed copy is a
 * faithful copy in practice, but a profile may legitimately differ in either
 * direction (a partial fixture, a plugin-generated file), while a customized
 * built-in is hand-edited in files that exist on BOTH sides (e.g.
 * `lib/engine.js`). */
function sharedFiles(sourceDir: string, destDir: string): string[] {
  const files: string[] = [];
  const walk = (current: string, rel: string): void => {
    for (const name of readdirSync(current)) {
      if (name === 'node_modules' || name === '.git' || name === 'package.json') {
        continue;
      }
      const absolute = path.join(current, name);
      const relative = rel === '' ? name : path.join(rel, name);
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relative);
      } else {
        const dest = path.join(destDir, relative);
        if (existsSync(dest) && statSync(dest).isFile()) {
          files.push(relative);
        }
      }
    }
  };
  walk(sourceDir, '');
  return files.sort();
}

/** Whether the installed copy under `dest` matches the source package dir.
 * Staleness is content identity: the `package.json` `version` field is the
 * bundle-level signal (a fixed distribution can ship under the SAME package
 * name, so a bundle list can never tell staleness), AND the bytes of the
 * implementation files shared by both sides — so a customized (locally
 * patched) copy that changed under the SAME version is caught, otherwise a
 * hand edit to the source would never propagate to an already-provisioned
 * profile. A missing or illegible copy on either side is stale. */
function copyEntryStale(sourceDir: string, destDir: string): boolean {
  try {
    const sourceVersion = (readJson(path.join(sourceDir, 'package.json')) as { version?: string })
      .version;
    const installedVersion = (readJson(path.join(destDir, 'package.json')) as { version?: string })
      .version;
    if (sourceVersion !== installedVersion) {
      return true;
    }
    const shared = sharedFiles(sourceDir, destDir);
    return contentFingerprint(shared, sourceDir) !== contentFingerprint(shared, destDir);
  } catch {
    return true;
  }
}

/** Whether any copy-based built-in's installed copy in the profile has drifted
 * from the current source. Optional entries are EXEMPT: their freshness is
 * owned by reconcileOptionalPlugins (a disabled optional has no copy at all,
 * and must not force a re-provision on every boot). Returns false only when
 * every checked installed copy matches. */
export function copyBuiltinsStale(
  profileDirPath: string,
  vendorRoot: string,
  sourceRoot: string,
): boolean {
  for (const entry of activeBuiltins()) {
    if (entry.kind === 'npm' || entry.kind === 'optional') {
      continue;
    }
    const root = entry.kind === 'vendor' ? vendorRoot : sourceRoot;
    const dest = path.join(profileDirPath, 'node_modules', ...entry.package.split('/'));
    if (copyEntryStale(path.join(root, entry.dir), dest)) {
      return true;
    }
  }
  return false;
}

/**
 * Remove retired built-ins from one profile: their bundle rows, their
 * `dependencies` entries, and their installed copies under node_modules.
 * Idempotent and cheap; runs before the provisioning gate so already-full
 * profiles heal by removal instead of early-returning.
 *
 * @returns true when anything was removed or rewritten.
 */
export function removeRetiredBuiltins(profileDirPath: string): boolean {
  const retired = retiredBuiltinNames();
  let changed = false;
  for (const name of retired) {
    const dest = path.join(profileDirPath, 'node_modules', ...name.split('/'));
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      changed = true;
    }
  }
  const manifestPath = path.join(profileDirPath, 'package.json');
  try {
    const manifest = readJson(manifestPath) as {
      dependencies?: Record<string, string>;
      dsh?: { profile?: { bundles?: unknown } };
    };
    let manifestChanged = false;
    const profile = manifest.dsh?.profile;
    if (profile !== undefined && Array.isArray(profile.bundles)) {
      const kept = (profile.bundles as unknown[]).filter(
        (name) => typeof name !== 'string' || !retired.includes(name),
      );
      if (kept.length !== profile.bundles.length) {
        profile.bundles = kept;
        manifestChanged = true;
      }
    }
    if (manifest.dependencies !== undefined) {
      const keptDeps: Record<string, string> = {};
      for (const [name, version] of Object.entries(manifest.dependencies)) {
        if (!retired.includes(name)) {
          keptDeps[name] = version;
        }
      }
      if (Object.keys(keptDeps).length !== Object.keys(manifest.dependencies).length) {
        manifest.dependencies = keptDeps;
        manifestChanged = true;
      }
    }
    if (manifestChanged) {
      writeJson(manifestPath, manifest);
      changed = true;
    }
  } catch {
    // No legible manifest — nothing to clean there; node_modules removal
    // above has already run.
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Optional plugins — shipped but not forced. The per-profile `.uniterra.json`
// toggle file is the source of truth; a missing file migrates from bundle
// rows (existing installs are preserved, never deleted).
// ---------------------------------------------------------------------------

/** The per-profile optional-plugin toggle file the desktop reads at boot. */
export const OPTIONAL_PLUGINS_FILE = '.uniterra.json';

/** Parsed state of the toggle file. `legible` is false when the file exists
 * but cannot be parsed — migration semantics apply and the file is never
 * overwritten (least destructive). */
interface OptionalPluginState {
  /** Package names explicitly enabled (`optionalPlugins.<name> === true`). */
  readonly enabled: ReadonlySet<string>;
  readonly filePresent: boolean;
  readonly legible: boolean;
}

function readOptionalState(profileDirPath: string): OptionalPluginState {
  const statePath = path.join(profileDirPath, OPTIONAL_PLUGINS_FILE);
  if (!existsSync(statePath)) {
    return { enabled: new Set(), filePresent: false, legible: true };
  }
  try {
    const parsed: unknown = readJson(statePath);
    const optionalPlugins =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as { optionalPlugins?: unknown }).optionalPlugins
        : undefined;
    const enabled = new Set<string>();
    if (optionalPlugins !== null && typeof optionalPlugins === 'object') {
      for (const [name, value] of Object.entries(optionalPlugins as Record<string, unknown>)) {
        if (value === true) {
          enabled.add(name);
        }
      }
    }
    return { enabled, filePresent: true, legible: true };
  } catch {
    return { enabled: new Set(), filePresent: true, legible: false };
  }
}

function writeOptionalState(profileDirPath: string, enabled: ReadonlySet<string>): void {
  const optionalPlugins: Record<string, boolean> = {};
  for (const name of Array.from(enabled)) {
    optionalPlugins[name] = true;
  }
  writeFileSync(
    path.join(profileDirPath, OPTIONAL_PLUGINS_FILE),
    `${JSON.stringify({ version: 1, optionalPlugins }, null, 2)}\n`,
    'utf8',
  );
}

/** Copy one plugin package dir into the profile's node_modules under its
 * package name, replacing whatever is there (a previous copy, or a pnpm
 * link left by `dsh plugin add`). */
function copyPluginDir(profileDirPath: string, pkgName: string, sourceDir: string): void {
  const dest = path.join(profileDirPath, 'node_modules', ...pkgName.split('/'));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(sourceDir, dest, { recursive: true });
}

/**
 * Reconcile the optional plugins against the profile's `.uniterra.json`
 * toggle. Runs BEFORE the provisioning gate so an already-full profile still
 * gets its optional state enforced (same pattern as removeRetiredBuiltins).
 *
 * - Legible toggle file: authoritative. Enabled ⇒ bundle row + fresh copy
 *   ensured (copy, not pnpm link — survives app moves); disabled ⇒ row and
 *   installed copy removed, idempotently.
 * - Missing toggle file: migrate from the bundle rows — an existing row is
 *   kept and persisted as enabled, an absent one stays absent. The file is
 *   written either way so the state becomes explicit.
 * - Illegible toggle file: derived from the rows like a missing file, but
 *   never persisted and never destructive — the user's file is left alone.
 *
 * @returns true when the profile (manifest, node_modules, or toggle file)
 *   was changed.
 */
export function reconcileOptionalPlugins(profileDirPath: string, vendorRoot: string): boolean {
  const optional = copyBuiltins('optional');
  if (optional.length === 0) {
    return false;
  }
  const state = readOptionalState(profileDirPath);
  const manifestPath = path.join(profileDirPath, 'package.json');
  let manifest: { dsh?: { profile?: { bundles?: string[] } } };
  try {
    manifest = readJson(manifestPath) as { dsh?: { profile?: { bundles?: string[] } } };
  } catch {
    return false; // no legible manifest — nothing to reconcile
  }
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const bundleSet = new Set(bundles);

  // The effective enabled set: the legible file wins; a missing or illegible
  // file migrates from the bundle rows (presence decides).
  const fileIsAuthoritative = state.filePresent && state.legible;
  const enabled = new Set<string>();
  for (const entry of optional) {
    if (fileIsAuthoritative ? state.enabled.has(entry.package) : bundleSet.has(entry.package)) {
      enabled.add(entry.package);
    }
  }

  let changed = false;
  const nextBundles = [...bundles];
  for (const entry of optional) {
    const pkg = entry.package;
    const dest = path.join(profileDirPath, 'node_modules', ...pkg.split('/'));
    if (enabled.has(pkg)) {
      if (!bundleSet.has(pkg)) {
        nextBundles.push(pkg);
        changed = true;
      }
      if (copyEntryStale(path.join(vendorRoot, entry.dir), dest)) {
        copyPluginDir(profileDirPath, pkg, path.join(vendorRoot, entry.dir));
        changed = true;
      }
    } else {
      const rowIndex = nextBundles.indexOf(pkg);
      if (rowIndex !== -1) {
        nextBundles.splice(rowIndex, 1);
        changed = true;
      }
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true });
        changed = true;
      }
    }
  }

  if (changed) {
    manifest.dsh ??= {};
    manifest.dsh.profile ??= {};
    manifest.dsh.profile.bundles = nextBundles;
    writeJson(manifestPath, manifest);
  }
  if (!state.filePresent) {
    writeOptionalState(profileDirPath, enabled);
  }
  return changed || !state.filePresent;
}

/**
 * Let the CLI create a missing profile from its shipped template, so the
 * provisioning pass below has a manifest to enrich.
 *
 * The app never writes that manifest itself: the CLI's own first boot
 * initializes a missing `$DSH_HOME/profiles/<name>` from the shipped template
 * (`@deepseek-ai/dsh-base` + the app bundle for the profile), and a manifest
 * scaffolded here would shadow that template with an empty bundle list. A
 * boot-free `--dump-config` runs the same `prepareProfile` initialization and
 * exits, so no runtime is started and no port is bound.
 *
 * Fail-soft: a bootstrap that fails leaves the home as it was and returns
 * false, so the boot continues exactly as it did before this pass existed —
 * `startDsh` then surfaces the underlying cause with the child's own stderr.
 *
 * @param dshHome the home the running dsh uses (dev test home or ~/.dsh).
 * @param profile the profile name (`web`).
 * @param dshCli absolute path to the bundled dsh CLI (lib/bin.js).
 * @param nodeExec the node executable to run the CLI with.
 * @returns true when this call created the profile manifest.
 */
export function ensureProfileInitialized(
  dshHome: string,
  profile: string,
  dshCli: string,
  nodeExec: string,
): boolean {
  const dir = profileDir(dshHome, profile);
  const manifestPath = path.join(dir, 'package.json');
  if (existsSync(manifestPath)) {
    return false;
  }
  try {
    execFileSync(nodeExec, [dshCli, '--profile', profile, '--dump-config'], {
      env: { ...process.env, DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
      // The composed tree is diagnostic output; only its initialization side
      // effect is wanted here, so stdout is discarded and stderr is captured
      // for the failure diagnostic.
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    // execFileSync's message already carries the CLI's stderr, which is the
    // diagnosis worth keeping; the raw error object would also dump its buffers.
    console.warn(
      '[uniterra] profile bootstrap failed; booting anyway:',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
  return existsSync(manifestPath);
}

/**
 * Ensure the built-in plugins are installed into `dshHome`'s profile.
 *
 * @param dshHome the home the running dsh uses (dev test home or ~/.dsh).
 * @param profile the profile name (`web`).
 * @param dshCli absolute path to the bundled dsh CLI (lib/bin.js).
 * @param nodeExec the node executable to run the CLI with.
 * @param vendorRoot the vendored plugin sources (app resources or monorepo).
 * @param sourceRoot the source root the workspace built-ins live under
 *   (dev → the monorepo root, packaged → `Contents/Resources/src`).
 */
export function ensureBuiltinPlugins(
  dshHome: string,
  profile: string,
  dshCli: string,
  nodeExec: string,
  vendorRoot: string,
  sourceRoot: string,
): void {
  const dir = profileDir(dshHome, profile);
  if (!existsSync(dir)) {
    return; // no profile yet — nothing to ensure
  }
  // Heal retired built-ins first: an already-full profile early-returns
  // below, so this is the only pass that can remove them.
  removeRetiredBuiltins(dir);
  // Enforce the optional-plugin toggle next, for the same reason — a full
  // profile must still honour `.uniterra.json` (install / remove / migrate).
  reconcileOptionalPlugins(dir, vendorRoot);
  if (hasAllBuiltins(dir) && !copyBuiltinsStale(dir, vendorRoot, sourceRoot)) {
    return;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), PROFILE_PNPM_WORKSPACE, 'utf8');

  const env = { ...process.env, DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1' };
  for (const spec of npmBuiltinSpecs()) {
    execFileSync(nodeExec, [dshCli, 'plugin', '--profile', profile, 'add', spec], {
      env,
      stdio: 'inherit',
    });
  }
  // Non-bundle runtime deps for the copy-based built-ins (e.g. the vendored
  // workflow plugin's quickjs-emscripten). These resolve from the profile's
  // top-level node_modules so the copied plugin can import them.
  for (const spec of PROFILE_RUNTIME_DEPS) {
    execFileSync(nodeExec, [dshCli, 'plugin', '--profile', profile, 'add', spec], {
      env,
      stdio: 'inherit',
    });
  }

  // Copy-based built-ins (vendor + workspace): copy under their package name
  // and append the bundle rows to the profile manifest (dsh plugin add can't
  // be used — these packages declare peers that are not on npm). Optional
  // entries are NOT copied here — reconcileOptionalPlugins owns them.
  const manifestPath = path.join(dir, 'package.json');
  const manifest = readJson(manifestPath) as {
    name?: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    dsh?: { profile?: { bundles?: string[] } };
  };
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles ??= [];
  const bundles = manifest.dsh.profile.bundles;

  // Copy one built-in package dir into the profile's node_modules and make
  // sure its Loader bundle row is present in the manifest.
  const copyBuiltin = (sourceDir: string, pkgName: string): void => {
    if (!bundles.includes(pkgName)) {
      bundles.push(pkgName);
    }
    const dest = path.join(dir, 'node_modules', ...pkgName.split('/'));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(sourceDir, dest, { recursive: true });
  };

  for (const entry of [...copyBuiltins('vendor'), ...copyBuiltins('workspace')]) {
    const root = entry.kind === 'vendor' ? vendorRoot : sourceRoot;
    copyBuiltin(path.join(root, entry.dir), entry.package);
  }
  writeJson(manifestPath, manifest);
}

/** The bundled skills dir (rank-600 bundled provider): dev → monorepo
 * packages/uniterra-skills/src/skills, packaged → resources/skills. */
export function builtinSkillsDir(
  dev: boolean,
  resourcesPath: string,
  monorepoRoot: string,
): string | undefined {
  const candidate = dev
    ? path.join(monorepoRoot, 'packages', 'uniterra-skills', 'src', 'skills')
    : path.join(resourcesPath, 'skills');
  return existsSync(candidate) ? candidate : undefined;
}

/** Retired workflow capsules: capsule files uniterra itself provisioned into a
 * profile whose skill has since left the bundle (symmetric with
 * RETIRED_SKILL_NAMES). They are uniterra's own replaced artifacts, not user
 * files, so a same-named file is removed on every boot instead of lingering as a
 * runnable workflow. */
export const RETIRED_WORKFLOW_CAPSULES = [
  'implement.workflow.json',
  'simplify.workflow.json',
] as const;

const retiredWorkflowCapsules: ReadonlySet<string> = new Set(RETIRED_WORKFLOW_CAPSULES);

/**
 * Provision the persisted `review` workflow capsule into the profile's
 * dsh_workflow personal directory (`$DSH_HOME/workflows`, the
 * `personalDirectory` the @dsh-external/workflow plugin scans). The capsule
 * rides the bundled skills package
 * (`<skillsDir>/<skill>/workflows/*.workflow.json`); the desktop copies it so a
 * fresh profile can `run_workflow('review', args)` it by name.
 *
 * Post-conditions:
 *  - no RETIRED_WORKFLOW_CAPSULES name exists in the target dir afterwards —
 *    the removal runs unconditionally, before the `skillsDir` check, so a
 *    profile heals even when the bundle no longer resolves;
 *  - every bundled, non-retired capsule is present byte-identically;
 *  - every other file in the target dir is left untouched;
 *  - re-running against unchanged sources is a no-op returning false.
 *
 * Idempotent: a target capsule is only (over)written when missing or when its
 * content differs from the bundled source — a user's own edit to a same-named
 * workflow is never clobbered.
 *
 * @returns true when any capsule was written or any retired capsule was removed.
 */
export function ensureWorkflowCapsules(dshHome: string, skillsDir: string | undefined): boolean {
  let changed = false;
  const targetDir = path.join(dshHome, 'workflows');

  // Retired capsules are uniterra's own replaced artifacts, not user files:
  // remove them unconditionally, BEFORE the skillsDir check, so a profile whose
  // bundle no longer resolves still heals.
  for (const file of RETIRED_WORKFLOW_CAPSULES) {
    try {
      const retired = path.join(targetDir, file);
      if (existsSync(retired)) {
        rmSync(retired, { force: true });
        changed = true;
      }
    } catch {
      // a locked file must not fail provisioning
    }
  }

  if (skillsDir === undefined || !existsSync(skillsDir)) {
    return changed;
  }

  const skills = readdirSync(skillsDir);
  for (const skill of skills) {
    const workflowsDir = path.join(skillsDir, skill, 'workflows');
    if (!existsSync(workflowsDir)) {
      continue;
    }
    const entries = readdirSync(workflowsDir).filter(
      (file) => file.endsWith('.workflow.json') && !retiredWorkflowCapsules.has(file),
    );
    if (entries.length === 0) {
      continue;
    }
    mkdirSync(targetDir, { recursive: true });
    for (const file of entries) {
      const source = readFileSync(path.join(workflowsDir, file), 'utf8');
      const dest = path.join(targetDir, file);
      if (!existsSync(dest) || readFileSync(dest, 'utf8') !== source) {
        writeFileSync(dest, source, 'utf8');
        changed = true;
      }
    }
  }
  return changed;
}
