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
 *    the source tree is present in the profile's `workflows/` dir with
 *    byte-identical content — and files that are NOT bundled capsules are
 *    never written, deleted, or modified (a user's own workflows survive).
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
import { ensureWorkflowCapsules } from '../dist/builtin.js';

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

test('PROVISION: never throws and ships every bundled capsule byte-identically', async () => {
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
        if (capsuleFiles.length > 0) {
          assert.equal(changed, true, 'a fresh provision writes every bundled capsule');
        }
        for (const file of capsuleFiles) {
          const source = await readFile(join(skills, file), 'utf8');
          // `file` is relative to a skill/workflows dir; the dest is flat under targetDir.
          const base = file.split('/').pop();
          const targetPath = join(targetDir, base);
          assert.equal(existsSync(targetPath), true, `${file} must be provisioned`);
          assert.equal(await readFile(targetPath, 'utf8'), source, `${file} byte-identical`);
        }
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
        const bundledNames = new Set(capsuleFiles.map((f) => f.split('/').pop()));
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
