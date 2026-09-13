/**
 * PBT suite for the agent-preset compatibility provisioning (compiled dist).
 *
 * Context: dsh 0.1.2-rc.1 renamed the shipped `code` agent preset (Code Mode)
 * to `ptc`; stored state (`agent-presets.default: code` in settings, and every
 * pre-upgrade session header) still names `code`, so without a row behind that
 * id every session create/resume fails. The desktop provisions a user preset
 * `code` whose composition is a byte copy of the shipped `ptc` preset.
 *
 * Business invariants locked here:
 *  - WRITE: the pure write plan writes EXACTLY the absent files (write iff
 *    the file does not already exist), for arbitrary existing-file subsets.
 *  - NEVER-CLOBBER: the filesystem ensure never overwrites an existing file,
 *    whatever its content (matching, stale, or user-authored).
 *  - IDEMPOTENT: a second run with unchanged state writes nothing.
 *  - BYTE-IDENTITY: newly provisioned files are byte-identical to the bundled
 *    `ptc` source composition and metadata.
 *  - FAIL-SOFT: a source root without the vendored harness tree provisions
 *    nothing and reports no change.
 *  - SCOPE: provisioning writes only the compat row. The settings document
 *    and any session log are left byte-identical — the settings row is the one
 *    consumer the dsh 0.1.5-rc.2 native migration does not reach (module
 *    header), and session logs are the migration's job, not the shim's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AGENT_PRESET_FILES,
  AGENT_PRESET_USER_ROOT,
  compatPresetSource,
  compatPresetWritePlan,
  compatPresetTargetDir,
  ensureAgentPresetCompatibility,
} from '../dist/preset-compat.js';

const SOURCE_ROOT = resolve(process.cwd(), '..', '..');
const SOURCE = compatPresetSource(SOURCE_ROOT);
assert.ok(SOURCE !== undefined, 'the vendored harness tree ships the compat source preset');

// ---------------------------------------------------------------------------
// WRITE — pure plan writes exactly the absent files
// ---------------------------------------------------------------------------

test('WRITE: plan writes exactly the absent files (arbitrary subsets)', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...AGENT_PRESET_FILES), { maxLength: AGENT_PRESET_FILES.length }),
      (existingSubset) => {
        const existing = new Map(existingSubset.map((file) => [file, 'any content']));
        const plan = compatPresetWritePlan(existing);
        const written = plan
          .filter((entry) => entry.write)
          .map((entry) => entry.file)
          .sort();
        const absent = AGENT_PRESET_FILES.filter((file) => !existingSubset.includes(file)).sort();
        assert.deepEqual(written, absent, 'writes exactly the complement of existing files');
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// NEVER-CLOBBER / IDEMPOTENT / BYTE-IDENTITY — filesystem ensure
// ---------------------------------------------------------------------------

test('NEVER-CLOBBER: an existing file is never overwritten, whatever its content', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom(...AGENT_PRESET_FILES), { maxLength: AGENT_PRESET_FILES.length }),
      fc.string({ maxLength: 128 }),
      async (existingSubset, userBytes) => {
        const home = await mkdtemp(join(tmpdir(), 'dsh-preset-compat-'));
        try {
          const dir = compatPresetTargetDir(home);
          await mkdir(dir, { recursive: true });
          for (const file of existingSubset) {
            await writeFile(join(dir, file), userBytes, 'utf8');
          }
          ensureAgentPresetCompatibility(home, SOURCE_ROOT);
          for (const file of existingSubset) {
            assert.equal(
              await readFile(join(dir, file), 'utf8'),
              userBytes,
              `existing ${file} survived the ensure unchanged`,
            );
          }
        } finally {
          await rm(home, { recursive: true, force: true });
        }
      },
    ),
  );
});

test('BYTE-IDENTITY + IDEMPOTENT: a missing pair is provisioned once, byte-identical, then untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-compat-'));
  try {
    const dir = compatPresetTargetDir(home);
    assert.equal(existsSync(dir), false, 'nothing exists before the ensure');
    const changedFirst = ensureAgentPresetCompatibility(home, SOURCE_ROOT);
    assert.equal(changedFirst, true, 'first run provisions the compat preset');
    for (const file of AGENT_PRESET_FILES) {
      assert.equal(
        await readFile(join(dir, file), 'utf8'),
        SOURCE.get(file),
        `${file} is byte-identical to the bundled ${file} source`,
      );
    }
    const changedSecond = ensureAgentPresetCompatibility(home, SOURCE_ROOT);
    assert.equal(changedSecond, false, 'second run is a no-op');
    for (const file of AGENT_PRESET_FILES) {
      assert.equal(
        await readFile(join(dir, file), 'utf8'),
        SOURCE.get(file),
        `${file} still matches the source after the idempotent second run`,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('FAIL-SOFT: a source root without the vendored harness tree provisions nothing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-compat-'));
  try {
    const emptyRoot = join(home, 'no-such-source-root');
    assert.equal(compatPresetSource(emptyRoot), undefined);
    assert.equal(ensureAgentPresetCompatibility(home, emptyRoot), false);
    assert.equal(existsSync(compatPresetTargetDir(home)), false, 'nothing was written');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SCOPE — provisioning touches nothing but the compat row
// ---------------------------------------------------------------------------

test('SCOPE: provisioning writes only the compat row, never the settings document or a session log', async () => {
  const settingsYaml = 'agent-presets:\n  default: code\n';
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 128 }), async (sessionBytes) => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-preset-compat-'));
      try {
        // The two stored consumers of the legacy id: the settings row that
        // still needs the shim, and a session log the native migration owns.
        const settingsFile = join(home, 'settings.yaml');
        const sessionDir = join(home, 'sessions');
        const sessionFile = join(sessionDir, 'session-legacy.jsonl');
        await mkdir(sessionDir, { recursive: true });
        await writeFile(settingsFile, settingsYaml, 'utf8');
        await writeFile(sessionFile, sessionBytes, 'utf8');

        assert.equal(ensureAgentPresetCompatibility(home, SOURCE_ROOT), true);

        assert.equal(
          await readFile(settingsFile, 'utf8'),
          settingsYaml,
          'the settings document survived the provisioning byte-identical',
        );
        assert.equal(
          await readFile(sessionFile, 'utf8'),
          sessionBytes,
          'the session log survived the provisioning byte-identical',
        );
        assert.deepEqual(
          (await readdir(home)).sort(),
          ['sessions', 'settings.yaml', AGENT_PRESET_USER_ROOT].sort(),
          'the compat preset root is the only entry provisioning added',
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    }),
  );
});

test('ROSTER: the compat id does not collide with the shipped roster', async () => {
  const shipped = join(
    SOURCE_ROOT,
    'vendor',
    'dsh-harness',
    'packages',
    'preset',
    'agent-presets',
    'presets',
  );
  const ids = await readdir(shipped);
  assert.ok(!ids.includes('code'), 'the 0.1.2-rc.1 shipped roster has no `code` (the rename)');
  assert.ok(ids.includes('ptc'), 'the compat source preset exists in the shipped roster');
});
