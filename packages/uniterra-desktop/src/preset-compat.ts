/**
 * Agent-preset compatibility layer for the dsh 0.1.2-rc.1 family rename.
 *
 * The 0.1.2-rc.1 family renamed the shipped `code` agent preset (Code Mode,
 * the PTC-style TypeScript-program presentation) to `ptc`. dsh resolves
 * agent presets BY ID, so a profile that carries legacy state — the
 * `agent-presets: default: code` settings row, or a pre-upgrade session log
 * whose header records `agentPreset: "code"` — cannot resolve any preset:
 * session create/resume fails with
 * `agent-presets: preset "code" not found (available: standard, ptc,
 * minimal, cordis)`, and the web UI reports every session as unusable
 * ("session not found" / resume failed).
 *
 * That legacy state has two halves, and 0.1.5-rc.2 serves only one of them.
 *
 * SESSION HEADERS are migrated natively, so this module no longer serves
 * them. The installed session-format chain rewrites the legacy id while
 * migrating every older log: `migrateHeader` returns
 * `{ ...header, version: 3, ...(header.agentPreset === 'code' ?
 * { agentPreset: 'ptc' } : {}) }` and every `agent-preset/selected` event is
 * rewritten the same way
 * (`packages/session/session-format-v2-to-v3/src/migration.ts:16-18,140-144`),
 * registered in the adjacent chain
 * `[sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3]`
 * (`packages/session/session-format-catalog/src/generated.ts:18`) whose
 * current version is 3 (`packages/core/session/src/types.ts:88`). A native v3
 * header is deliberately left alone, so that id can still name a preset of
 * the user's own.
 *
 * The SETTINGS DEFAULT is NOT migrated, so the shim stays. `agent-presets.
 * default: code` is a settings-document row rather than a session log, and no
 * 0.1.5-rc.2 code path rewrites it: `packages/settings/` holds no migration,
 * and the roster reads the row verbatim as its default preset id
 * (`packages/preset/agent-presets/src/index.ts:240-242`,
 * `this.settings?.get().default ?? this.config.default`). Measured against the
 * built 0.1.5-rc.2 packages with `$DSH_HOME/settings.yaml` holding
 * `agent-presets: { default: code }`: the roster reports a `defaultId` of
 * `code`, and `resolve()` — the call session create and resume make for a
 * session that names no preset — throws
 * `agent-presets: preset "code" not found (available: standard, ptc,
 * minimal, cordis)`. Provisioning the row below makes that same call return
 * the `code` user preset, byte-identical to the shipped `ptc` composition
 * (command and output recorded in docs/modules/uniterra-desktop.md).
 *
 * This module therefore provisions a USER preset named `code` into the
 * harness-home user root (`$DSH_HOME/.agent-presets` — the writable root
 * `dsh-agent-presets` scans by default) whose composition is a byte copy of
 * the shipped `ptc` preset, so the legacy default resolves to the PTC-mode
 * successor. Provisioning is idempotent and never overwrites an existing
 * file: a preset the user authored (or later edits) is preserved.
 *
 * Removal condition — delete this module when both hold: (a) the stored
 * `agent-presets.default` no longer names `code`, migrated by a release or by
 * uniterra itself; and (b) no session header and no `agent-preset/selected`
 * event in the profile still records `code`, which the native migration does
 * not clear for sessions it already wrote as v3.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** The legacy preset id the pre-0.1.2-rc.1 family shipped (Code Mode). */
export const LEGACY_AGENT_PRESET_ID = 'code';

/** The preset id that took over `code` in the 0.1.2-rc.1 family (PTC mode). */
export const AGENT_PRESET_COMPAT_SOURCE = 'ptc';

/** Harness-home writable preset root (`dsh-agent-presets`' `USER_PRESET_DIR`). */
export const AGENT_PRESET_USER_ROOT = '.agent-presets';

/** The two files that make up one preset's on-disk identity. */
export const AGENT_PRESET_FILES = ['agent.cordis.yml', 'preset.yml'] as const;

/**
 * The bundled source directory holding the compat source preset (`ptc`).
 * The vendored harness tree ships at `vendor/dsh-harness` under the source
 * root the desktop resolves (dev: monorepo root; packaged: Resources/src).
 */
export function compatPresetSourceDir(sourceRoot: string): string {
  return path.join(
    sourceRoot,
    'vendor',
    'dsh-harness',
    'packages',
    'preset',
    'agent-presets',
    'presets',
    AGENT_PRESET_COMPAT_SOURCE,
  );
}

/** Read the compat files from the bundled source as a fileName → content map. */
export function compatPresetSource(sourceRoot: string): Map<string, string> | undefined {
  const dir = compatPresetSourceDir(sourceRoot);
  if (!existsSync(dir)) {
    return undefined;
  }
  const files = new Map<string, string>();
  for (const file of AGENT_PRESET_FILES) {
    const target = path.join(dir, file);
    if (!existsSync(target)) {
      return undefined;
    }
    files.set(file, readFileSync(target, 'utf8'));
  }
  return files;
}

/**
 * Pure write plan: a file is written exactly when it is absent; an existing
 * file — matching or not — is never overwritten (user content is sacred).
 *
 * @param existing - fileName → current content; an absent key means the file
 * does not exist.
 * @returns per-file write decisions, stable across calls and independent of
 * caller-provided source content.
 */
export function compatPresetWritePlan(
  existing: ReadonlyMap<string, string>,
): ReadonlyArray<{ readonly file: string; readonly write: boolean }> {
  return AGENT_PRESET_FILES.map((file) => ({
    file,
    write: !existing.has(file),
  }));
}

/** The target directory for the compat preset under one harness home. */
export function compatPresetTargetDir(dshHome: string): string {
  return path.join(dshHome, AGENT_PRESET_USER_ROOT, LEGACY_AGENT_PRESET_ID);
}

/**
 * Provision the legacy `code` compat preset into the harness home.
 *
 * Creates `$DSH_HOME/.agent-presets/code/` (agent.cordis.yml + preset.yml,
 * byte copies of the shipped `ptc` preset) when the files are absent. An
 * existing file is never overwritten; a pre-existing `code` directory is
 * left exactly as the user wrote it — it is the user's own preset then, and
 * dsh can still resolve it.
 *
 * Serves the one stored consumer the native session-format migration does not
 * reach: the `agent-presets.default: code` settings row, which dsh reads
 * verbatim as the preset new sessions compose from (module header).
 *
 * @param dshHome - the harness home the run uses (packaged: the default
 * `~/.dsh`; dev: the mirrored test home).
 * @param sourceRoot - the bundled source tree root.
 * @returns true when any file was written.
 */
export function ensureAgentPresetCompatibility(dshHome: string, sourceRoot: string): boolean {
  const source = compatPresetSource(sourceRoot);
  if (source === undefined) {
    return false;
  }
  const existing = new Map<string, string>();
  const dir = compatPresetTargetDir(dshHome);
  for (const file of AGENT_PRESET_FILES) {
    const target = path.join(dir, file);
    if (existsSync(target)) {
      existing.set(file, readFileSync(target, 'utf8'));
    }
  }
  const plan = compatPresetWritePlan(existing);
  if (plan.every((entry) => !entry.write)) {
    return false;
  }
  mkdirSync(dir, { recursive: true });
  let changed = false;
  for (const entry of plan) {
    if (!entry.write) {
      continue;
    }
    writeFileSync(path.join(dir, entry.file), source.get(entry.file) ?? '', 'utf8');
    changed = true;
  }
  return changed;
}
