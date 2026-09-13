/**
 * PBT for the profile manifest's copy-based provisioning (issue #27,
 * `src/builtin.ts` compiled dist): the pass that heals an existing profile.
 *
 * Business invariants locked here:
 *  - PROVISION-FOREIGN-UNTOUCHED: bundle rows the pass does not own survive it —
 *    including a manifest whose `bundles` value is not a list (a shape other
 *    tools write), where the rows it names must not be silently dropped.
 *  - PROVISION-HEAL-IDEMPOTENT: a manifest the pass cannot read is left alone
 *    and never throws — the documented fail-soft contract of the pass.
 *  - STALE-CONTENT-DRIFT: a copy that lost a file the source ships is stale and
 *    is healed by the pass, so an interrupted copy cannot stay broken forever.
 *
 * Every fixture lives in a `mkdtemp` directory; the user's real `~/.dsh` is
 * never addressed, read or written by this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyBuiltins, copyBuiltinsStale, ensureCopiedBuiltins } from '../dist/builtin.js';

const COPIES = [
  ...copyBuiltins('vendor').map((entry) => ({ ...entry, root: 'vendor' })),
  ...copyBuiltins('workspace').map((entry) => ({ ...entry, root: 'source' })),
];
/** The built-in this issue adds — the one that has to grow into old profiles. */
const SKILL_MARKET = 'dsh-skill-market';

/** Both source roots with a tiny faithful source for every copy-based entry. */
async function writeSources(root) {
  const vendor = join(root, 'vendor');
  const source = join(root, 'source');
  for (const entry of COPIES) {
    const dir = join(entry.root === 'vendor' ? vendor : source, entry.dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: entry.package, version: '1.0.0' })}\n`,
    );
    await writeFile(join(dir, 'index.js'), "export const v = '1.0.0'\n");
  }
  return { vendor, source };
}

let profileCounter = 0;

/** A fresh, empty profile directory under the fixture root. */
async function freshProfile(root) {
  profileCounter += 1;
  const dir = join(root, `profile-${String(profileCounter)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function withTempRoot(body) {
  const root = await mkdtemp(join(tmpdir(), 'uniterra-manifest-'));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Every name a `bundles` value carries, whatever shape the value has: array
 * items and object keys are the two list forms in the wild. */
function namesIn(value) {
  const names = new Set();
  const visit = (node) => {
    if (typeof node === 'string') {
      names.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        names.add(key);
        visit(item);
      }
    }
  };
  visit(value);
  return names;
}

const rowNameArb = fc.constantFrom(
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@michengai/dsh-skills-manager',
  'foreign-plugin',
);

/** The shapes a `bundles` value can come in when something other than this
 * pass wrote it: the list form, a name→flag map, and a nested list. */
const bundlesValueArb = fc.oneof(
  { weight: 2, arbitrary: fc.array(rowNameArb, { minLength: 1, maxLength: 3 }) },
  {
    weight: 2,
    arbitrary: fc
      .array(rowNameArb, { minLength: 1, maxLength: 3 })
      .map((names) => Object.fromEntries(names.map((name) => [name, true]))),
  },
  {
    weight: 1,
    arbitrary: fc
      .array(rowNameArb, { minLength: 1, maxLength: 3 })
      .map((names) => names.map((name) => [name])),
  },
);

test('PROVISION-FOREIGN-UNTOUCHED: a bundle list the pass does not own keeps every row it names', async () => {
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    await fc.assert(
      fc.asyncProperty(bundlesValueArb, async (before) => {
        const profile = await freshProfile(root);
        const manifestPath = join(profile, 'package.json');
        await writeFile(
          manifestPath,
          `${JSON.stringify({ name: 'web', dsh: { profile: { bundles: before } } }, null, 2)}\n`,
        );

        ensureCopiedBuiltins(profile, vendor, source);

        const after = JSON.parse(readFileSync(manifestPath, 'utf8')).dsh.profile.bundles;
        const afterNames = namesIn(after);
        for (const name of namesIn(before)) {
          assert.ok(
            afterNames.has(name),
            `the pass dropped the row ${name} the manifest already named: ${JSON.stringify(after)}`,
          );
        }
        for (const entry of COPIES) {
          assert.ok(
            afterNames.has(entry.package),
            `the pass must own its row ${entry.package}: ${JSON.stringify(after)}`,
          );
        }
      }),
      { numRuns: 12 },
    );
  });
});

test('PROVISION-HEAL-IDEMPOTENT: an unreadable manifest is left alone without throwing', async () => {
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    const bodyArb = fc.oneof(
      fc.constantFrom('null', 'true', '42', '"web"', '[]', '{}', '', 'not json at all', '  '),
      fc.jsonValue().map((value) => JSON.stringify(value)),
      fc.string({ maxLength: 24 }),
    );
    await fc.assert(
      fc.asyncProperty(bodyArb, async (body) => {
        const profile = await freshProfile(root);
        await writeFile(join(profile, 'package.json'), body);
        assert.doesNotThrow(
          () => ensureCopiedBuiltins(profile, vendor, source),
          `a manifest body of ${JSON.stringify(body)} must never throw`,
        );
      }),
      { numRuns: 60 },
    );
  });
});

test('STALE-CONTENT-DRIFT: a copy that lost a runtime file is stale and is healed', async () => {
  const fileNames = ['index.js', 'client.js', 'cordis.patch.yml'];
  /** One runtime file's bytes: identical in the source and in a faithful copy. */
  const runtimeContent = (name) => `content of ${name}\n`;
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    // The real vendored plugin ships more than one runtime file; give the
    // skill-market source the same shape, and leave every other entry's source
    // and copy byte-identical (only the skill-market copy varies).
    for (const name of fileNames) {
      await writeFile(join(vendor, SKILL_MARKET, name), runtimeContent(name));
    }
    await fc.assert(
      fc.asyncProperty(fc.subarray(fileNames), async (present) => {
        const profile = await freshProfile(root);
        const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
        for (const entry of COPIES) {
          const dest = join(profile, 'node_modules', ...entry.package.split('/'));
          await mkdir(dest, { recursive: true });
          await writeFile(
            join(dest, 'package.json'),
            `${JSON.stringify({ name: entry.package, version: '1.0.0' })}\n`,
          );
          if (entry.dir === SKILL_MARKET) {
            for (const name of present) {
              await writeFile(join(dest, name), runtimeContent(name));
            }
          } else {
            await writeFile(join(dest, 'index.js'), "export const v = '1.0.0'\n");
          }
          bundles.push(entry.package);
        }
        await writeFile(
          join(profile, 'package.json'),
          `${JSON.stringify({ name: 'web', dsh: { profile: { bundles } } }, null, 2)}\n`,
        );

        const complete = present.length === fileNames.length;
        assert.equal(
          copyBuiltinsStale(profile, vendor, source),
          !complete,
          `a copy missing ${String(fileNames.length - present.length)} of its runtime files is stale`,
        );

        ensureCopiedBuiltins(profile, vendor, source);
        const dest = join(profile, 'node_modules', SKILL_MARKET);
        for (const name of fileNames) {
          assert.ok(
            existsSync(join(dest, name)),
            `a provisioning pass restores the runtime file ${name} the built-in ships`,
          );
        }
      }),
      { numRuns: 10 },
    );
  });
});

test('PROVISION-FOREIGN-UNTOUCHED regression: a bundles value that is not a list keeps every row it names', async () => {
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    const profile = await freshProfile(root);
    const manifestPath = join(profile, 'package.json');
    // The exact manifest the counterexample shrank to: the name→flag shape
    // other tools write. The old code replaced a non-list value wholesale, so
    // every row the profile named (the official dsh bundles included) was
    // silently dropped.
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        { name: 'web', dsh: { profile: { bundles: { '@deepseek-ai/dsh-base': true } } } },
        null,
        2,
      )}\n`,
    );

    ensureCopiedBuiltins(profile, vendor, source);

    const after = JSON.parse(readFileSync(manifestPath, 'utf8')).dsh.profile.bundles;
    assert.ok(
      namesIn(after).has('@deepseek-ai/dsh-base'),
      `the pass dropped the row the manifest already named: ${JSON.stringify(after)}`,
    );
    for (const entry of COPIES) {
      assert.ok(
        namesIn(after).has(entry.package),
        `the pass must own its row ${entry.package}: ${JSON.stringify(after)}`,
      );
    }
  });
});

test('PROVISION-HEAL-IDEMPOTENT regression: a manifest that is not an object is left alone without throwing', async () => {
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    // The bodies the counterexample shrank to: the null document, 42, true and
    // "web" (all valid JSON, none of them a manifest object), the empty file
    // and the empty list.
    for (const body of ['null', '42', 'true', '"web"', '', '[]']) {
      const profile = await freshProfile(root);
      const manifestPath = join(profile, 'package.json');
      await writeFile(manifestPath, body);
      assert.doesNotThrow(
        () => ensureCopiedBuiltins(profile, vendor, source),
        `a manifest body of ${JSON.stringify(body)} must never throw`,
      );
      assert.equal(
        readFileSync(manifestPath, 'utf8'),
        body,
        'a manifest the pass cannot read is left exactly as it was',
      );
    }
  });
});

test('STALE-CONTENT-DRIFT regression: a copy that lost every runtime file is stale and is healed', async () => {
  const fileNames = ['index.js', 'client.js', 'cordis.patch.yml'];
  await withTempRoot(async (root) => {
    const { vendor, source } = await writeSources(root);
    for (const name of fileNames) {
      await writeFile(join(vendor, SKILL_MARKET, name), `content of ${name}\n`);
    }
    const profile = await freshProfile(root);
    // The shrunk fixture: the skill-market copy keeps package.json at the
    // SAME version and NONE of the source's runtime files — an interrupted
    // copy. With zero shared files both fingerprints were empty, so the copy
    // was judged fresh and stayed incomplete forever.
    const dest = join(profile, 'node_modules', SKILL_MARKET);
    await mkdir(dest, { recursive: true });
    await writeFile(
      join(dest, 'package.json'),
      `${JSON.stringify({ name: SKILL_MARKET, version: '1.0.0' })}\n`,
    );
    for (const entry of COPIES) {
      if (entry.dir === SKILL_MARKET) {
        continue;
      }
      const other = join(profile, 'node_modules', ...entry.package.split('/'));
      await mkdir(other, { recursive: true });
      await writeFile(
        join(other, 'package.json'),
        `${JSON.stringify({ name: entry.package, version: '1.0.0' })}\n`,
      );
      await writeFile(join(other, 'index.js'), "export const v = '1.0.0'\n");
    }
    await writeFile(
      join(profile, 'package.json'),
      `${JSON.stringify({ name: 'web', dsh: { profile: { bundles: [] } } }, null, 2)}\n`,
    );

    assert.equal(
      copyBuiltinsStale(profile, vendor, source),
      true,
      'a copy that lost every runtime file the source ships is stale',
    );

    ensureCopiedBuiltins(profile, vendor, source);
    for (const name of fileNames) {
      assert.ok(existsSync(join(dest, name)), `the heal restores the runtime file ${name}`);
    }
    assert.equal(
      copyBuiltinsStale(profile, vendor, source),
      false,
      'the healed profile is fresh on the next pass',
    );
  });
});
