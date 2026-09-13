/**
 * PBT suite for the provisioning pass over an EXISTING profile (issue #27,
 * `src/builtin.ts` compiled dist): the heal that gives an already-provisioned
 * profile its new built-ins.
 *
 * Business invariants locked here:
 *  - PROVISION-HEAL-IDEMPOTENT: one pass converges — the skill market's bundle
 *    row and its `node_modules` copy appear — and every later pass changes
 *    nothing at all (no rewrite, no re-copy), whether the profile started
 *    without the row, without the copy, with a drifted copy or with an
 *    illegible one.
 *  - PROVISION-FOREIGN-UNTOUCHED: bundle rows, dependencies and `node_modules`
 *    copies that do NOT belong to the built-in registry survive every pass
 *    byte-identically (including a user-installed third-party skill manager).
 *  - STALE-CONTENT-DRIFT: freshness is content identity, not the version
 *    string — a same-version copy whose bytes differ is stale, and only an
 *    exact copy is fresh.
 *
 * Every fixture lives in a `mkdtemp` directory; the user's real `~/.dsh` is
 * never addressed, read or written by this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { copyBuiltins, copyBuiltinsStale, ensureCopiedBuiltins } from '../dist/builtin.js';

const VENDOR = copyBuiltins('vendor');
const WORKSPACE = copyBuiltins('workspace');
const ALL_COPIES = [
  ...VENDOR.map((entry) => ({ ...entry, root: 'vendor' })),
  ...WORKSPACE.map((entry) => ({ ...entry, root: 'source' })),
];
/** The built-in this issue adds — the one that has to grow into old profiles. */
const SKILL_MARKET = 'dsh-skill-market';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const vendorPluginsRoot = join(repoRoot, 'vendor', 'dsh-plugins');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Every file under `dir`, as sorted relative paths. */
function walkFiles(dir, base = dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push(relative(base, full));
    }
  }
  return out.sort();
}

/** The full byte content of a tree, keyed by relative path. */
function snapshot(dir) {
  const out = {};
  for (const rel of walkFiles(dir)) {
    out[rel] = readFileSync(join(dir, rel), 'utf8');
  }
  return out;
}

/** Write one built-in source copy under its kind's root. */
async function writeSource(root, dir, version, body) {
  const dest = join(root, dir);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'package.json'), `${JSON.stringify({ name: dir, version })}\n`);
  await writeFile(join(dest, 'index.js'), body ?? `export const v = '${version}'\n`);
}

/** Write one installed copy into the profile's node_modules. */
async function writeInstalled(profile, pkgName, version, body) {
  const dest = join(profile, 'node_modules', ...pkgName.split('/'));
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'package.json'), `${JSON.stringify({ name: pkgName, version })}\n`);
  await writeFile(join(dest, 'index.js'), body ?? `export const v = '${version}'\n`);
}

/**
 * An already-provisioned profile fixture: the manifest and every built-in copy
 * are present EXCEPT whatever the scenario varies for the skill market.
 *
 * @param {{ rowPresent: boolean, copyState: string, foreign: string[] }} scenario
 */
async function provisionFixture(scenario) {
  const root = await mkdtemp(join(tmpdir(), 'uniterra-provision-'));
  const vendor = join(root, 'vendor');
  const source = join(root, 'source');
  const profile = join(root, 'profiles', 'web');
  await mkdir(profile, { recursive: true });

  for (const entry of ALL_COPIES) {
    const rootDir = entry.root === 'vendor' ? vendor : source;
    const version = entry.dir === SKILL_MARKET ? '0.1.0' : '1.0.0';
    await writeSource(rootDir, entry.dir, version);
  }

  const bundles = [];
  const dependencies = {};
  for (const entry of ALL_COPIES) {
    if (entry.dir === SKILL_MARKET) {
      if (scenario.rowPresent) {
        bundles.push(entry.package);
      }
      continue;
    }
    bundles.push(entry.package);
    dependencies[entry.package] = '1.0.0';
    await writeInstalled(profile, entry.package, '1.0.0');
  }

  // Foreign rows/deps/copies: user-installed plugins the registry does not own.
  for (const name of scenario.foreign) {
    bundles.push(name);
    dependencies[name] = '^0.1.25';
    await writeInstalled(profile, name, '0.1.25', `export const foreign = '${name}'\n`);
  }

  await writeFile(
    join(profile, 'package.json'),
    `${JSON.stringify({ name: 'web', dependencies, dsh: { profile: { bundles } } }, null, 2)}\n`,
  );

  const marketDest = join(profile, 'node_modules', SKILL_MARKET);
  if (scenario.copyState === 'faithful') {
    await writeInstalled(profile, SKILL_MARKET, '0.1.0');
  } else if (scenario.copyState === 'drifted') {
    await writeInstalled(profile, SKILL_MARKET, '0.1.0', 'export const v = "locally edited"\n');
  } else if (scenario.copyState === 'illegible') {
    await mkdir(marketDest, { recursive: true });
    await writeFile(join(marketDest, 'package.json'), 'not json at all');
  }

  return { root, vendor, source, profile, bundles };
}

/** The manifest's bundle rows and dependency names. */
function readManifest(profile) {
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
  return {
    bundles: manifest.dsh?.profile?.bundles ?? [],
    dependencies: Object.keys(manifest.dependencies ?? {}),
  };
}

async function withFixture(scenario, body) {
  const fixture = await provisionFixture(scenario);
  try {
    return await body(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const foreignNameArb = fc.oneof(
  fc.constant('@michengai/dsh-skills-manager'),
  fc.constant('dsh-skill-market-extras'),
  fc.constant('@third-party/skill-market'),
  fc.stringMatching(/^[a-z]{1,8}$/u).map((name) => `foreign-${name}`),
);

const scenarioArb = fc.record({
  rowPresent: fc.boolean(),
  copyState: fc.constantFrom('absent', 'faithful', 'drifted', 'illegible'),
  foreign: fc.uniqueArray(foreignNameArb, { maxLength: 3 }),
  passes: fc.integer({ min: 1, max: 3 }),
});

// ---------------------------------------------------------------------------
// PROVISION-HEAL-IDEMPOTENT
// ---------------------------------------------------------------------------

test('PROVISION-HEAL-IDEMPOTENT: an existing profile converges in one pass and stays put', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      await withFixture(scenario, async ({ vendor, source, profile, bundles }) => {
        const first = ensureCopiedBuiltins(profile, vendor, source);
        // The verdict reports a CHANGE: a profile that already carries the row
        // and a faithful copy is left alone and says so.
        const alreadyConverged = scenario.rowPresent && scenario.copyState === 'faithful';
        assert.equal(
          first,
          !alreadyConverged,
          'the first pass reports a change exactly when it had to heal something',
        );

        const manifest = readManifest(profile);
        assert.ok(
          manifest.bundles.includes(SKILL_MARKET),
          `the skill market bundle row exists after one pass, got ${JSON.stringify(manifest.bundles)}`,
        );
        const dest = join(profile, 'node_modules', SKILL_MARKET);
        assert.ok(existsSync(join(dest, 'package.json')), 'the copy exists after one pass');
        assert.equal(
          readFileSync(join(dest, 'index.js'), 'utf8'),
          readFileSync(join(vendor, SKILL_MARKET, 'index.js'), 'utf8'),
          'the copy is the source bytes, not a placeholder',
        );

        // Foreign rows survive verbatim, including their order.
        for (const name of bundles) {
          if (name !== SKILL_MARKET) {
            assert.ok(manifest.bundles.includes(name), `${name} keeps its row`);
          }
        }

        // Every later pass is a strict no-op, on disk and in the verdict.
        const settled = snapshot(profile);
        for (let pass = 2; pass <= scenario.passes + 1; pass += 1) {
          assert.equal(
            ensureCopiedBuiltins(profile, vendor, source),
            false,
            `pass ${String(pass)} changes nothing`,
          );
          assert.deepEqual(snapshot(profile), settled, `pass ${String(pass)} rewrites nothing`);
        }
      });
    }),
    { numRuns: 20 },
  );
});

// ---------------------------------------------------------------------------
// PROVISION-FOREIGN-UNTOUCHED
// ---------------------------------------------------------------------------

test('PROVISION-FOREIGN-UNTOUCHED: unrelated rows, deps and copies survive every pass', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      await withFixture(scenario, async ({ vendor, source, profile, bundles }) => {
        const foreignBundles = bundles.filter((name) => name !== SKILL_MARKET);
        const before = snapshot(profile);

        for (let pass = 1; pass <= scenario.passes; pass += 1) {
          ensureCopiedBuiltins(profile, vendor, source);
          const manifest = readManifest(profile);
          for (const name of foreignBundles) {
            assert.ok(manifest.bundles.includes(name), `${name} keeps its bundle row`);
          }
          assert.ok(
            manifest.dependencies.includes('@michengai/dsh-skills-manager') ===
              scenario.foreign.includes('@michengai/dsh-skills-manager'),
            'the third-party skill manager dependency is neither added nor removed',
          );
          const after = snapshot(profile);
          for (const [path, content] of Object.entries(before)) {
            const isOwned =
              path.startsWith(`node_modules/${SKILL_MARKET}/`) || path === 'package.json';
            if (!isOwned) {
              assert.equal(after[path], content, `${path} is byte-identical after the pass`);
            }
          }
        }

        const manifest = readManifest(profile);
        assert.deepEqual(
          manifest.dependencies.sort(),
          [
            ...ALL_COPIES.filter((entry) => entry.dir !== SKILL_MARKET).map(
              (entry) => entry.package,
            ),
            ...scenario.foreign,
          ].sort(),
          'the dependency set is unchanged by the heal',
        );
        // The pass is not a no-op: it DOES install the built-in it owns. Without
        // this the "nothing else was touched" claim would hold vacuously.
        assert.ok(
          manifest.bundles.includes(SKILL_MARKET),
          'the heal installed the skill market while leaving the foreign entries alone',
        );
        assert.ok(
          existsSync(join(profile, 'node_modules', SKILL_MARKET, 'package.json')),
          'and copied it into the profile',
        );
      });
    }),
    { numRuns: 20 },
  );
});

// ---------------------------------------------------------------------------
// STALE-CONTENT-DRIFT
// ---------------------------------------------------------------------------

/** Content pairs: what the source ships vs what the profile carries. */
const bodyArb = fc.constantFrom(
  'export const v = "1.0.0"\n',
  'export const v = "1.0.0"\n// locally edited\n',
  '',
);

test('STALE-CONTENT-DRIFT: a same-version, different-content copy is stale', async () => {
  await fc.assert(
    fc.asyncProperty(
      bodyArb,
      bodyArb,
      fc.boolean(),
      fc.boolean(),
      async (sourceBody, installedBody, versionDiffers, copyMissing) => {
        const scenario = { rowPresent: true, copyState: 'drifted', foreign: [] };
        await withFixture(scenario, async ({ vendor, source, profile }) => {
          // Start from a converged profile, then impose the generated pair.
          ensureCopiedBuiltins(profile, vendor, source);
          await writeSource(vendor, SKILL_MARKET, '0.1.0', sourceBody);
          const version = versionDiffers ? '0.1.1' : '0.1.0';
          if (copyMissing) {
            await rm(join(profile, 'node_modules', SKILL_MARKET), {
              recursive: true,
              force: true,
            });
          } else {
            await writeInstalled(profile, SKILL_MARKET, version, installedBody);
          }

          const expectedStale = copyMissing || versionDiffers || sourceBody !== installedBody;
          assert.equal(
            copyBuiltinsStale(profile, vendor, source),
            expectedStale,
            `source=${JSON.stringify(sourceBody)} installed=${JSON.stringify(installedBody)} versionDiffers=${String(versionDiffers)} missing=${String(copyMissing)}`,
          );

          if (expectedStale) {
            ensureCopiedBuiltins(profile, vendor, source);
            assert.equal(
              copyBuiltinsStale(profile, vendor, source),
              false,
              'the heal copies the source bytes over the drifted copy',
            );
            assert.equal(
              readFileSync(join(profile, 'node_modules', SKILL_MARKET, 'index.js'), 'utf8'),
              sourceBody,
            );
          }
        });
      },
    ),
    { numRuns: 25 },
  );
});

// ---------------------------------------------------------------------------
// The real vendored tree is what a fixture-free pass would copy
// ---------------------------------------------------------------------------

test('PROVISION-HEAL-IDEMPOTENT regression: the real skill-market source is copyable as shipped', async () => {
  const entries = VENDOR.filter((entry) => entry.dir === SKILL_MARKET);
  assert.equal(entries.length, 1, 'the vendored skill market is registered');
  const sourceDir = join(vendorPluginsRoot, SKILL_MARKET);
  assert.ok(existsSync(sourceDir), 'the vendored source directory exists');
  assert.ok(
    existsSync(join(sourceDir, 'package.json')),
    'the copy mechanism reads its version from package.json',
  );
  const parsed = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
  assert.equal(parsed.name, entries[0].package, 'the package name matches the registry entry');
});
