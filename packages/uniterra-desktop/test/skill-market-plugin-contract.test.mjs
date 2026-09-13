/**
 * Vendored-plugin contract suite for the Skill Market built-in (issue #27):
 * `vendor/dsh-plugins/dsh-skill-market`, its pin ledger row and the repo's
 * dependency surface.
 *
 * Business invariants locked here:
 *  - VENDOR-PIN: the vendored tree is EXACTLY the pinned runtime file set —
 *    no upstream `.gitignore`, no dropped `LICENSE`/`client.js` — and its
 *    provenance (upstream + pinned commit) is readable from the ledger.
 *  - VENDOR-LEDGER: the ledger row carries all four required elements (pin,
 *    trim scope, the LOCAL PATCH pending-upstream note, and a removal
 *    condition), and the docs table has its counterpart row.
 *  - NO-AUTHOR-PATH: no line of the vendored tree names the author's
 *    environment (`/root/…`, `/opt/dsh-work/…`); the documented
 *    `~/.dsh/skills` default must NOT be flagged.
 *  - INJECT-ROWS: every `dsh.client.inject` entry and every scoped peer names
 *    a package the PINNED dsh family actually ships — read out of
 *    `vendor/dsh-harness`, so a family bump that drops one fails by name.
 *  - NO-NEW-REPO-DEP: the dependency key sets of every repo manifest are
 *    unchanged — issue #27 adds no dependency to this repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const pluginDir = join(repoRoot, 'vendor', 'dsh-plugins', 'dsh-skill-market');
const ledgerPath = join(repoRoot, 'vendor', 'dsh-plugins', 'VENDOR.md');
const docsPath = join(repoRoot, 'docs', 'modules', 'vendor-plugins.md');
const harnessPackagesDir = join(repoRoot, 'vendor', 'dsh-harness', 'packages');

/** The pin this built-in is vendored at (issue #27 / `ISSUE-REFS.md` V-19). */
const PIN = '8fa51ed574c10f978df85798cc48fbebc8d5d406';
const UPSTREAM = 'QQ-M/dsh-skill-market';
/** The trimmed runtime set: exactly the upstream files that ship. */
const ALLOWED_FILES = [
  'LICENSE',
  'README.md',
  'README.zh.md',
  'client.js',
  'cordis.patch.yml',
  'index.js',
  'package.json',
];

/** Every file under `dir`, as sorted repo-relative-to-`dir` paths; a missing
 * directory is an EMPTY tree (the assertions then fail loudly, never with an
 * ENOENT). */
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

/** Read one file of the vendored tree; a missing file is the empty string. */
function treeFile(name) {
  const path = join(pluginDir, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Whether a file-name set is exactly the pinned runtime set. */
function matchesPinnedSet(names) {
  const sorted = [...names].sort();
  return (
    sorted.length === ALLOWED_FILES.length &&
    sorted.every((name, index) => name === ALLOWED_FILES[index])
  );
}

// ---------------------------------------------------------------------------
// VENDOR-PIN
// ---------------------------------------------------------------------------

test('VENDOR-PIN: the vendored tree is exactly the pinned runtime set', () => {
  const files = walkFiles(pluginDir);
  assert.ok(files.length > 0, 'the vendored skill market exists');
  assert.deepEqual(
    files,
    ALLOWED_FILES,
    `the tree is the pinned runtime set, got ${JSON.stringify(files)}`,
  );
  assert.ok(!files.includes('.gitignore'), 'the upstream .gitignore is not vendored');

  // The copy is the real plugin, not a placeholder.
  const index = treeFile('index.js');
  const client = treeFile('client.js');
  assert.match(index, /export const name = 'dsh-skill-market'/u);
  assert.match(index, /export function apply\(/u);
  assert.match(index, /skill-market\/api/u, 'the host half serves its own API routes');
  assert.ok(client.length > 1000, 'the client half ships its real bundle');

  // Provenance: the tree is traceable to the pinned upstream commit.
  const ledger = readFileSync(ledgerPath, 'utf8');
  assert.ok(ledger.includes('dsh-skill-market'), 'the ledger names the vendored dir');
  assert.ok(ledger.includes(UPSTREAM), 'the ledger names the upstream repository');
  assert.ok(ledger.includes(PIN), 'the ledger records the pinned commit');

  // The matcher above is not vacuous: an extra, a missing or a renamed file is
  // never "the pinned set".
  const fileNamesArb = fc.oneof(
    fc.constantFrom(...ALLOWED_FILES),
    fc.constantFrom('.gitignore', 'src/index.ts', 'install.sh', 'client.js.map', ''),
  );
  fc.assert(
    fc.property(
      fc.array(fileNamesArb, { maxLength: 10 }),
      fc.boolean(),
      fc.integer({ min: 0, max: ALLOWED_FILES.length - 1 }),
      (generated, dropOne, dropIndex) => {
        assert.equal(matchesPinnedSet(ALLOWED_FILES), true, 'the pinned set matches itself');
        if (dropOne) {
          const dropped = ALLOWED_FILES.filter((_, index) => index !== dropIndex);
          assert.equal(matchesPinnedSet(dropped), false, 'a missing file is not the pinned set');
        }
        const candidate = [...ALLOWED_FILES, ...generated];
        const exact = new Set(candidate).size === ALLOWED_FILES.length && generated.length === 0;
        assert.equal(matchesPinnedSet(candidate), exact, JSON.stringify(candidate));
      },
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// VENDOR-LEDGER
// ---------------------------------------------------------------------------

const LEDGER_ELEMENTS = [
  ['pin', new RegExp(PIN, 'u')],
  ['trim', /trim(med)?\b/iu],
  ['local patch', /LOCAL PATCH/u],
  ['pending upstream', /pending[- ]upstream/iu],
  ['removal condition', /REMOVAL CONDITION/u],
];

/** Which of the four required elements a ledger row text carries. */
function ledgerRowVerdict(row) {
  return LEDGER_ELEMENTS.filter(([, pattern]) => pattern.test(row)).map(([name]) => name);
}

test('VENDOR-LEDGER: the skill-market row carries pin, trim, pending-upstream and a removal condition', () => {
  const ledger = readFileSync(ledgerPath, 'utf8');
  const rows = ledger
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes('dsh-skill-market'));
  assert.equal(rows.length, 1, 'exactly one ledger row for the skill market');
  const row = rows[0];
  assert.deepEqual(
    ledgerRowVerdict(row),
    LEDGER_ELEMENTS.map(([name]) => name),
    'the row carries every required element',
  );
  assert.ok(row.includes(UPSTREAM), 'the row names the upstream repository');

  const docs = readFileSync(docsPath, 'utf8');
  const docsRow = docs
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes('dsh-skill-market'));
  assert.equal(docsRow.length, 1, 'the vendored docs table gains its row');
  assert.ok(docsRow[0].includes(PIN.slice(0, 8)), 'the docs row names the pinned commit');

  // The verdict above is not vacuous: each element missing is judged red.
  fc.assert(
    fc.property(fc.subset(fc.constantFrom(...LEDGER_ELEMENTS.map(([name]) => name))), (kept) => {
      const synthetic = LEDGER_ELEMENTS.filter(([name]) => kept.includes(name))
        .map(([, pattern]) => pattern.source)
        .join(' ');
      const verdict = ledgerRowVerdict(synthetic);
      assert.deepEqual([...verdict].sort(), [...kept].sort());
      assert.equal(
        verdict.length === LEDGER_ELEMENTS.length,
        kept.length === LEDGER_ELEMENTS.length,
      );
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// NO-AUTHOR-PATH
// ---------------------------------------------------------------------------

/** Paths that only exist in the upstream author's environment. */
const AUTHOR_PATH = /\/root\/|\/opt\/dsh-work/u;

test('NO-AUTHOR-PATH: no author-environment path survives in the vendored tree', () => {
  const files = walkFiles(pluginDir);
  assert.ok(files.length > 0, 'there is a tree to scan');
  for (const file of files) {
    const lines = treeFile(file).split('\n');
    lines.forEach((line, index) => {
      assert.ok(
        !AUTHOR_PATH.test(line),
        `${file}:${String(index + 1)} still carries an author-environment path: ${line.trim()}`,
      );
    });
  }

  // The matcher's semantics: the author paths are red, the documented default
  // (`~/.dsh/skills`) is not.
  const cases = [
    ['        installDir: /root/.dsh/skills', true],
    ['        githubTokenFile: /opt/dsh-work/gh-token', true],
    ['  defaults to ~/.dsh/skills when omitted', false],
    ['  installDir: <DSH_HOME>/skills', false],
    ['  // Search GitHub and install skills into ~/.dsh/skills', false],
    ['  const root = join(homedir(), ".dsh", "skills")', false],
  ];
  fc.assert(
    fc.property(fc.constantFrom(...cases), ([line, isAuthor]) => {
      assert.equal(AUTHOR_PATH.test(line), isAuthor, line);
    }),
  );
});

// ---------------------------------------------------------------------------
// INJECT-ROWS — the pinned family decides what may be injected
// ---------------------------------------------------------------------------

/** Every package name the pinned dsh family ships, read out of the vendored
 * harness source (the oracle: a family bump that drops one fails here by name). */
function pinnedFamilyNames() {
  const names = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === 'package.json') {
        try {
          const parsed = JSON.parse(readFileSync(full, 'utf8'));
          if (typeof parsed.name === 'string') {
            names.add(parsed.name);
          }
        } catch {
          // a fixture manifest without a name contributes nothing
        }
      }
    }
  };
  walk(harnessPackagesDir);
  return names;
}

/** `@deepseek-ai/cordis` is the host runtime every plugin peers on: it is an
 * external dependency of the family, not a workspace package. */
const HOST_RUNTIME = '@deepseek-ai/cordis';

test('INJECT-ROWS: only packages the pinned family ships may be injected', () => {
  const family = pinnedFamilyNames();
  assert.ok(family.size > 10, 'the oracle read the vendored harness packages');
  assert.ok(family.has('@deepseek-ai/dsh-client-locale'));
  assert.ok(family.has('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(
    !family.has('@deepseek-ai/dsh-client-runtime'),
    'the removed client runtime is NOT in the pinned family',
  );
  assert.ok(
    family.has('@deepseek-ai/dsh-client-test-runtime'),
    'a same-prefix test-support package IS: the oracle must match names exactly, not by prefix',
  );

  const manifest = JSON.parse(treeFile('package.json'));
  const inject = manifest.dsh?.client?.inject ?? [];
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const allowed = (name) => family.has(name) || name === HOST_RUNTIME;

  assert.deepEqual(inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
  ]);
  for (const name of inject) {
    assert.ok(allowed(name), `inject row ${name} exists in the pinned family`);
  }
  for (const name of peers) {
    if (name.startsWith('@deepseek-ai/')) {
      assert.ok(allowed(name), `peer ${name} exists in the pinned family`);
    }
  }
  assert.ok(
    !peers.includes('@deepseek-ai/dsh-client-runtime'),
    'the LOCAL PATCH drops the peer on the removed client runtime',
  );

  // The oracle is not vacuous: a generated name is allowed iff the family (or
  // the host runtime) actually ships it.
  const nameArb = fc.oneof(
    fc.constantFrom(...[...family], HOST_RUNTIME, '@deepseek-ai/dsh-client-runtime', '@scope/nope'),
    fc.string({ minLength: 1, maxLength: 20 }),
  );
  fc.assert(
    fc.property(fc.array(nameArb, { maxLength: 6 }), (generated) => {
      for (const name of generated) {
        assert.equal(allowed(name), family.has(name) || name === HOST_RUNTIME, name);
      }
      const offending = generated.filter((name) => !allowed(name));
      if (offending.includes('@deepseek-ai/dsh-client-runtime')) {
        assert.ok(offending.length > 0, 'the removed client runtime is always offending');
      }
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// NO-NEW-REPO-DEP
// ---------------------------------------------------------------------------

/** The dependency key sets of this repository as of the #27 change — a golden:
 * a new dependency anywhere in these manifests fails the suite. */
const REPO_DEPENDENCY_KEYS = {
  'package.json': {
    dependencies: [],
    devDependencies: [
      '@eslint/js',
      '@types/node',
      'eslint',
      'husky',
      'lint-staged',
      'prettier',
      'typescript',
      'typescript-eslint',
    ],
    peerDependencies: [],
  },
  'packages/uniterra-cli/package.json': {
    dependencies: [],
    devDependencies: ['@types/node', 'fast-check'],
    peerDependencies: [],
  },
  'packages/uniterra-desktop/package.json': {
    dependencies: ['@uniterra-solutions/uniterra-updater'],
    devDependencies: [
      '@deepseek-ai/dsh',
      '@types/node',
      'electron',
      'electron-builder',
      'fast-check',
    ],
    peerDependencies: [],
  },
  'packages/uniterra-provider/package.json': {
    dependencies: ['eventsource-parser', 'undici'],
    devDependencies: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/schemastery',
      '@types/node',
      '@types/react',
      'esbuild',
      'react',
    ],
    peerDependencies: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/schemastery',
      'react',
    ],
  },
  'packages/uniterra-skills/package.json': {
    dependencies: [],
    devDependencies: ['@types/node'],
    peerDependencies: [],
  },
  'packages/uniterra-updater/package.json': {
    dependencies: [],
    devDependencies: ['@types/node', 'fast-check'],
    peerDependencies: [],
  },
};

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

/** The dependency key sets of one manifest, sorted per field. */
function dependencyKeys(manifest) {
  const out = {};
  for (const field of DEPENDENCY_FIELDS) {
    out[field] = Object.keys(manifest[field] ?? {}).sort();
  }
  return out;
}

test('NO-NEW-REPO-DEP: the repo dependency key sets are unchanged', () => {
  for (const [path, expected] of Object.entries(REPO_DEPENDENCY_KEYS)) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
    assert.deepEqual(
      dependencyKeys(manifest),
      expected,
      `${path} must not gain or lose a dependency for issue #27`,
    );
  }

  // The comparison detects every shape of change (added / removed / renamed).
  const keysArb = fc.array(fc.constantFrom(...DEPENDENCY_FIELDS, 'lodash', 'left-pad'), {
    maxLength: 6,
  });
  fc.assert(
    fc.property(keysArb, keysArb, (a, b) => {
      // Key SETS, not lists: a manifest can only carry each name once.
      const unique = (names) => [...new Set(names)].sort().join('\u0000');
      const same = unique(a) === unique(b);
      const asManifest = (names) => ({
        dependencies: Object.fromEntries(names.map((n) => [n, '1.0.0'])),
      });
      assert.equal(
        JSON.stringify(dependencyKeys(asManifest(a))) ===
          JSON.stringify(dependencyKeys(asManifest(b))),
        same,
        `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      );
    }),
    { numRuns: 200 },
  );
});
