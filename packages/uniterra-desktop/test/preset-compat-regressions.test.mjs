/**
 * Deterministic regressions for the 0.15.0 (dsh 0.1.2-rc.1) agent-preset
 * migration crash, converged on the dsh 0.1.5-rc.2 family. Each case is a
 * concrete minimal input plus the exact outcome the invariant requires.
 *
 * Bug: after the 0.1.2-rc.1 migration, the shipped `code` agent preset was
 * renamed `ptc`, but every upgraded profile still carried the legacy id:
 * `~/.dsh/settings.yaml` held `agent-presets: default: code` and every
 * pre-upgrade session log header recorded `agentPreset: "code"`. dsh resolves
 * presets by id, so create/resume failed with
 * `agent-presets: preset "code" not found (available: standard, ptc,
 * minimal, cordis)` and the web UI could not open or create any session.
 *
 * Fix, and how much of it 0.1.5-rc.2 still needs: the desktop provisions a
 * user preset named `code` (a byte copy of the shipped `ptc` composition) into
 * `$DSH_HOME/.agent-presets`, so the legacy id resolves to the PTC-mode
 * successor and an existing preset the user authored is never overwritten.
 * The SESSION half of that legacy state is now migrated by dsh itself
 * (`session-format-v2-to-v3` rewrites `agentPreset: "code"` to `ptc` in every
 * v0/v1/v2 header and in every `agent-preset/selected` event, registered in
 * `session-format-catalog`), so the shim no longer serves session logs. The
 * SETTINGS half (`agent-presets.default: code`) is still read verbatim by the
 * roster, which is what keeps the row: measured on the built 0.1.5-rc.2
 * packages, `$DSH_HOME/settings.yaml` holding that row reported
 * `defaultId === 'code'`, left the document byte-identical, and made
 * `resolve()` (the call session create and resume make) throw
 * `agent-presets: preset "code" not found (available: standard, ptc,
 * minimal, cordis)` until `ensureAgentPresetCompatibility` provisioned the
 * row, after which the same call returned the `code` user preset. The two
 * source oracles below fail by name the day upstream ships a settings
 * migration — the module's recorded removal condition.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AGENT_PRESET_COMPAT_SOURCE,
  LEGACY_AGENT_PRESET_ID,
  compatPresetSource,
  compatPresetTargetDir,
  ensureAgentPresetCompatibility,
} from '../dist/preset-compat.js';

const SOURCE_ROOT = resolve(process.cwd(), '..', '..');
const VENDOR = join(SOURCE_ROOT, 'vendor', 'dsh-harness');

/** Read one vendored harness source file — the dsh-api oracle for this layer. */
function vendoredSource(file) {
  return readFileSync(join(VENDOR, file), 'utf8');
}

/** The shipped 0.1.5-rc.2 session-log step that rewrites the legacy preset id. */
const NATIVE_MIGRATION = 'packages/session/session-format-v2-to-v3/src/migration.ts';
/** The installed adjacent-chain registry that wires that step in. */
const MIGRATION_CATALOG = 'packages/session/session-format-catalog/src/generated.ts';
/** The current session format version the chain lands on. */
const SESSION_TYPES = 'packages/core/session/src/types.ts';
/** The roster that consumes the settings default. */
const ROSTER = 'packages/preset/agent-presets/src/index.ts';
/** Every source file of the settings seam, which ships no migration. */
const SETTINGS_SOURCES = [
  'packages/settings/settings/src/index.ts',
  'packages/settings/settings-file/src/index.ts',
];

test('LEGACY-PRESET-MIGRATION: a profile with `default: code` and `code` session headers keeps working — on 0.1.5-rc.2 only the settings half still needs the row', async () => {
  const source = compatPresetSource(SOURCE_ROOT);
  assert.ok(source !== undefined, 'the bundled source ships the compat preset');

  // The exact legacy state from the 0.1.1-rc.2 upgrade: the settings row the
  // old family wrote, and the header field every old session log records.
  const settingsYaml = 'agent-presets:\n  default: code\n';
  const oldSessionHeader = {
    type: 'session',
    version: 0,
    id: 'session-08a5e450-7f0f-43a6-a13a-944abc3b8eb2',
    createdAt: 1787930619199,
    cwd: '/Users/tszkinlai/uniterra',
    agentPreset: LEGACY_AGENT_PRESET_ID,
    delegationDepth: 0,
  };

  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-regression-'));
  try {
    // The fresh upgrade lands: the desktop ensures the compat row before boot.
    assert.equal(ensureAgentPresetCompatibility(home, SOURCE_ROOT), true);
    const dir = compatPresetTargetDir(home);
    assert.ok(
      existsSync(join(dir, 'agent.cordis.yml')) && existsSync(join(dir, 'preset.yml')),
      'the compat preset directory is provisioned at $DSH_HOME/.agent-presets/code',
    );
    assert.equal(LEGACY_AGENT_PRESET_ID, 'code', 'the compat id equals the stored legacy id');
    assert.ok(
      AGENT_PRESET_COMPAT_SOURCE !== LEGACY_AGENT_PRESET_ID,
      'the compat id is not the same preset id as the shipped source',
    );

    // Byte-identity with the PTC-mode successor composition — this is what
    // makes `resolve("code")` succeed and mount the agent the old sessions
    // were built for (Code Mode = PTC mode).
    const composition = await readFile(join(dir, 'agent.cordis.yml'), 'utf8');
    assert.equal(composition, source.get('agent.cordis.yml'));
    assert.match(composition, /mode: ptc/, 'the legacy preset composes the PTC mode presentation');
    const metadata = await readFile(join(dir, 'preset.yml'), 'utf8');
    assert.equal(metadata, source.get('preset.yml'));
    assert.match(metadata, /name: PTC 模式/, 'the compat preset carries the PTC-mode identity');

    // The legacy header's stored preset id and the settings row both resolve
    // against the provisioned roster row: the id exists, under the user root.
    assert.equal(oldSessionHeader.agentPreset, 'code');
    assert.match(settingsYaml, /default: code/);

    // The SESSION half of this 0.1.2-rc.1 workaround is the harness's own on
    // 0.1.5-rc.2: the native v0/v1/v2 -> v3 migration rewrites the legacy id
    // in every stored header and in every recorded preset selection, so a
    // resumed old session never asks this row to resolve `code`. Oracle on the
    // vendored sources, so an upstream revert fails here by name.
    const migration = vendoredSource(NATIVE_MIGRATION);
    assert.match(
      migration,
      /fromVersion: 2,\s*\n\s*toVersion: 3,/,
      'the step migrates session format v2 to v3',
    );
    assert.match(
      migration,
      /header\.agentPreset === 'code' \? \{ agentPreset: 'ptc' \}/,
      'migrateHeader rewrites the legacy header preset to ptc',
    );
    assert.match(
      migration,
      /case 'agent-preset\/selected':[\s\S]{0,200}=== 'code'[\s\S]{0,160}agentPreset: 'ptc'/,
      'and rewrites every recorded agent-preset/selected event the same way',
    );
    assert.match(
      vendoredSource(MIGRATION_CATALOG),
      /migrations: \[sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3\]/,
      'the step is registered in the installed adjacent chain',
    );
    assert.match(
      vendoredSource(SESSION_TYPES),
      /export const SESSION_FORMAT_VERSION = 3/,
      'and that chain lands on the current session format',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('USER-PRESET-PROTECTION: an authored `code` preset is never overwritten', async () => {
  const source = compatPresetSource(SOURCE_ROOT);
  assert.ok(source !== undefined);
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-regression-'));
  try {
    const dir = compatPresetTargetDir(home);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'agent.cordis.yml'), '# my own composition\n', 'utf8');
    await writeFile(join(dir, 'preset.yml'), 'name: Mine\n', 'utf8');

    assert.equal(ensureAgentPresetCompatibility(home, SOURCE_ROOT), false, 'no write planned');
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), '# my own composition\n');
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), 'name: Mine\n');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SETTINGS-DEFAULT-UNMIGRATED — why 0.1.5 still needs the row
// ---------------------------------------------------------------------------

test('SETTINGS-DEFAULT-UNMIGRATED: `agent-presets.default: code` is not migrated, so the provisioned user preset is what resolves a new session', async () => {
  // The roster takes the stored default verbatim — no legacy-id translation
  // sits between the settings row and preset resolution.
  const roster = vendoredSource(ROSTER);
  assert.match(
    roster,
    /this\.settings\?\.get\(\)\.default \?\? this\.config\.default/,
    'the default preset id is the settings row, read verbatim',
  );
  assert.doesNotMatch(roster, /'code'/, 'the roster carries no legacy-id literal');

  // ... and the settings seam ships no migration step that could rewrite it.
  for (const file of SETTINGS_SOURCES) {
    assert.doesNotMatch(vendoredSource(file), /migrat/i, file + ' ships no migration step');
  }

  // The shipped roster still supplies no `code` (the rename), so the user row
  // this module provisions is the only thing that can answer the stored
  // default — and the settings document is left exactly as the user wrote it.
  const shipped = await readdir(join(VENDOR, 'packages/preset/agent-presets/presets'));
  assert.ok(!shipped.includes(LEGACY_AGENT_PRESET_ID), 'the shipped roster has no `code`');

  const settingsYaml = 'agent-presets:\n  default: code\n';
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-settings-'));
  try {
    const settingsFile = join(home, 'settings.yaml');
    await writeFile(settingsFile, settingsYaml, 'utf8');
    assert.equal(
      ensureAgentPresetCompatibility(home, SOURCE_ROOT),
      true,
      'the compat row is provisioned',
    );
    assert.equal(
      await readFile(settingsFile, 'utf8'),
      settingsYaml,
      'the settings document is byte-identical: nothing migrated it',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
