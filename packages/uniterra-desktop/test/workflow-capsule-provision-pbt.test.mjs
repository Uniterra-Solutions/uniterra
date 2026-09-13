/**
 * PBT suite for `ensureWorkflowCapsules` (compiled dist) — the dynamic-workflow
 * capsule provisioner.
 *
 * The single-scenario case (copy → idempotent → refreshed-on-change → missing
 * dir is a no-op) is already pinned in `builtin-pbt.test.mjs`. This adds the
 * GENERATED invariants the review cares about, driven by fast-check:
 *
 *  - PROVISION-NO-THROW: for arbitrary skills / workflow directory contents
 *    (nested dirs, non-`.workflow.json` files, empty dirs, weird names), the
 *    provisioner never throws.
 *  - DATA-RIGHTS: after a provision, every bundled `.workflow.json` capsule in
 *    the source tree that is NOT a retired capsule name is present in the
 *    profile's `workflows/` dir with byte-identical content, every RETIRED
 *    capsule name is ABSENT, and files that are neither are never written,
 *    deleted, or modified (a user's own workflows survive). The generator can
 *    produce `implement.workflow.json` — its name is 9 chars, inside
 *    `safeName(5, 16)` — so the retired half of the expectation is load-bearing.
 *  - IDEMPOTENT: a second provision with identical sources writes nothing
 *    (returns false), for any reachable target state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWorkflowCapsules, RETIRED_WORKFLOW_CAPSULES } from '../dist/builtin.js';

/** A safe filename alphabet (no path separators, so an entry is a single dir entry). */
const nameChar = fc.constantFrom('a', 'b', 'c', '1', '2', '3', '_', '-', '.', 'w', 'm', 'j');
const safeName = (min, max) =>
  fc.array(nameChar, { minLength: min, maxLength: max }).map((a) => a.join(''));

const fileSpec = fc
  .array(
    fc.record({
      name: fc.oneof(
        safeName(5, 16).map((n) => `${n}.workflow.json`),
        safeName(3, 10),
      ),
      content: fc.string({ minLength: 0, maxLength: 40 }),
    }),
    { maxLength: 3 },
  )
  .map((files) => files);

const treeSpec = fc.array(
  fc.record({
    skill: safeName(3, 10),
    files: fileSpec,
    hasWorkflows: fc.boolean(),
  }),
  { maxLength: 4 },
);

/** Materialize one generated source-tree spec under a tmp skills root. Returns
 * the `skill/workflows/<name>` relative path of every bundled `.workflow.json`. */
async function materializeSource(root, spec) {
  const capsuleFiles = [];
  for (const s of spec) {
    const dir = join(root, s.skill);
    await mkdir(dir, { recursive: true });
    if (s.hasWorkflows) {
      const wf = join(dir, 'workflows');
      await mkdir(wf, { recursive: true });
      for (const f of s.files) {
        await writeFile(join(wf, f.name), f.content, 'utf8');
        if (f.name.endsWith('.workflow.json')) {
          capsuleFiles.push(`${s.skill}/workflows/${f.name}`);
        }
      }
    }
  }
  return capsuleFiles;
}

test('PROVISION: never throws and ships every bundled non-retired capsule byte-identically', async () => {
  await fc.assert(
    fc.asyncProperty(treeSpec, async (spec) => {
      const skills = await mkdtemp(join(tmpdir(), 'uwf-sk-'));
      const home = await mkdtemp(join(tmpdir(), 'uwf-hm-'));
      try {
        const capsuleFiles = await materializeSource(skills, spec);
        let changed;
        await assert.doesNotReject(async () => {
          changed = ensureWorkflowCapsules(home, skills);
        });
        assert.equal(typeof changed, 'boolean');
        const targetDir = join(home, 'workflows');
        const retired = new Set(RETIRED_WORKFLOW_CAPSULES);
        let activeCount = 0;
        for (const file of capsuleFiles) {
          // `file` is relative to a skill/workflows dir; the dest is flat under targetDir.
          const base = file.split('/').pop();
          const targetPath = join(targetDir, base);
          if (retired.has(base)) {
            assert.equal(existsSync(targetPath), false, `${file} must never be provisioned`);
            continue;
          }
          activeCount += 1;
          const source = await readFile(join(skills, file), 'utf8');
          assert.equal(existsSync(targetPath), true, `${file} must be provisioned`);
          assert.equal(await readFile(targetPath, 'utf8'), source, `${file} byte-identical`);
        }
        assert.equal(
          changed,
          activeCount > 0,
          activeCount > 0
            ? 'a fresh provision writes every bundled non-retired capsule'
            : 'a retired-only source writes nothing',
        );
      } finally {
        await rm(skills, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    }),
    { numRuns: 4000 },
  );
});

test('PROVISION: is byte-idempotent — a second provision with unchanged sources writes nothing', async () => {
  await fc.assert(
    fc.asyncProperty(treeSpec, async (spec) => {
      const skills = await mkdtemp(join(tmpdir(), 'uwf-sk-'));
      const home = await mkdtemp(join(tmpdir(), 'uwf-hm-'));
      try {
        await materializeSource(skills, spec);
        ensureWorkflowCapsules(home, skills);
        // Snapshot the target dir (names + bytes).
        const targetDir = join(home, 'workflows');
        const before = existsSync(targetDir) ? await snapshotDir(targetDir) : new Map();
        const second = ensureWorkflowCapsules(home, skills);
        assert.equal(second, false, 'a second provision with unchanged sources is a no-op');
        const after = existsSync(targetDir) ? await snapshotDir(targetDir) : new Map();
        assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
        for (const [k, v] of after) assert.equal(v, before.get(k), `target file ${k} unchanged`);
      } finally {
        await rm(skills, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    }),
    { numRuns: 4000 },
  );
});

test('PROVISION: files in the target that are not bundled capsules are never touched', async () => {
  await fc.assert(
    fc.asyncProperty(treeSpec, safeName(3, 8), async (spec, stale) => {
      const skills = await mkdtemp(join(tmpdir(), 'uwf-sk-'));
      const home = await mkdtemp(join(tmpdir(), 'uwf-hm-'));
      try {
        const capsuleFiles = await materializeSource(skills, spec);
        const targetDir = join(home, 'workflows');
        await mkdir(targetDir, { recursive: true });
        const retired = new Set(RETIRED_WORKFLOW_CAPSULES);
        const bundledNames = new Set(
          capsuleFiles.map((f) => f.split('/').pop()).filter((name) => !retired.has(name)),
        );
        // Pre-seed target with a user file that is NOT a bundled capsule name.
        const userFile = `${stale}-user.workflow.json`;
        await writeFile(join(targetDir, userFile), 'user custom workflow', 'utf8');
        ensureWorkflowCapsules(home, skills);
        // The user file must survive byte-identically.
        assert.equal(existsSync(join(targetDir, userFile)), true);
        assert.equal(await readFile(join(targetDir, userFile), 'utf8'), 'user custom workflow');
        // Bundled capsules are provisioned; the user file is not one of them.
        for (const base of bundledNames) {
          assert.equal(existsSync(join(targetDir, base)), true);
        }
      } finally {
        await rm(skills, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    }),
    { numRuns: 4000 },
  );
});

test('PROVISION: retired capsules are removed even without a skills dir, and user files survive', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uwf-hm-'));
  const skills = await mkdtemp(join(tmpdir(), 'uwf-sk-'));
  try {
    const targetDir = join(home, 'workflows');
    const userFile = join(targetDir, 'my-own.workflow.json');
    const seedRetired = async () => {
      await mkdir(targetDir, { recursive: true });
      for (const file of RETIRED_WORKFLOW_CAPSULES) {
        await writeFile(join(targetDir, file), 'retired capsule', 'utf8');
      }
      await writeFile(userFile, 'user custom workflow', 'utf8');
    };
    const assertHealed = async (label) => {
      for (const file of RETIRED_WORKFLOW_CAPSULES) {
        assert.equal(existsSync(join(targetDir, file)), false, `${label}: ${file} removed`);
      }
      assert.equal(
        await readFile(userFile, 'utf8'),
        'user custom workflow',
        `${label}: the user's own workflow is untouched`,
      );
    };

    // A real bundled source: the retired names are gone, the live capsule lands.
    await mkdir(join(skills, 'uniterra-review', 'workflows'), { recursive: true });
    await writeFile(
      join(skills, 'uniterra-review', 'workflows', 'review.workflow.json'),
      'live capsule',
      'utf8',
    );

    await seedRetired();
    assert.equal(ensureWorkflowCapsules(home, skills), true, 'the heal and the copy both report');
    await assertHealed('with a bundle');
    assert.equal(await readFile(join(targetDir, 'review.workflow.json'), 'utf8'), 'live capsule');

    // Re-running is a no-op.
    assert.equal(ensureWorkflowCapsules(home, skills), false, 'second run changes nothing');

    // skillsDir undefined → the retired files still go and the return value says so.
    await seedRetired();
    assert.equal(ensureWorkflowCapsules(home, undefined), true, 'removal alone reports a change');
    await assertHealed('without a skills dir');
    assert.equal(ensureWorkflowCapsules(home, undefined), false, 'nothing left to remove');

    // A skills dir that does not exist behaves the same way — and never throws.
    await seedRetired();
    assert.equal(ensureWorkflowCapsules(home, join(home, 'no-such-skills')), true);
    await assertHealed('without an existing bundle dir');
    assert.equal(ensureWorkflowCapsules(home, join(home, 'no-such-skills')), false);
  } finally {
    await rm(skills, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

/** Read a directory into a name→content map (byte snapshot). */
async function snapshotDir(dir) {
  const map = new Map();
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if (existsSync(p)) {
      map.set(name, await readFile(p, 'utf8'));
    }
  }
  return map;
}
