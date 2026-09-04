/**
 * Deterministic regressions for the 0.15.0 (dsh 0.1.2-rc.1) agent-preset
 * migration crash. Each case is a concrete minimal input plus the exact
 * outcome the invariant requires.
 *
 * Bug: after the 0.1.2-rc.1 migration, the shipped `code` agent preset was
 * renamed `ptc`, but every upgraded profile still carries the legacy id:
 * `~/.dsh/settings.yaml` holds `agent-presets: default: code` and every
 * pre-upgrade session log header records `agentPreset: "code"`. dsh resolves
 * presets by id, so create/resume failed with
 * `agent-presets: preset "code" not found (available: standard, ptc,
 * minimal, cordis)` and the web UI could not open or create any session.
 *
 * Fix: the desktop provisions a user preset named `code` (a byte copy of the
 * shipped `ptc` composition) into `$DSH_HOME/.agent-presets`, so the legacy
 * id resolves to the PTC-mode successor and an existing preset the user
 * authored is never overwritten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

test('LEGACY-PRESET-MIGRATION: a profile with `default: code` and `code` session headers keeps working on 0.1.2-rc.1', async () => {
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
    const { mkdir, writeFile } = await import('node:fs/promises');
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
