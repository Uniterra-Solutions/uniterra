/**
 * Behaviour suite for the vendored Skill Market host half (issue #27,
 * `vendor/dsh-plugins/dsh-skill-market/index.js`).
 *
 * Business invariants locked here:
 *  - SKILLROOT-DEFAULT: the effective install directory is dsh's USER SKILL
 *    ROOT — `<DSH_HOME>/skills` with `DSH_HOME` defaulting to `<home>/.dsh` —
 *    always an absolute path, never the author's hardcoded `/root/.dsh/skills`,
 *    and an EXPLICIT configuration always wins.
 *  - SKILLROOT-DEFAULT (wiring): `apply()` reaches the same resolution and
 *    reads no GitHub token unless one was configured (the upstream default
 *    pointed at a file in the author's environment).
 *
 * The host half statically imports the schema library, so it is loaded the way
 * the profile loads it: the real vendored file, imported through real ESM
 * resolution, with a throwaway `node_modules` supplying the one dependency the
 * repo tree does not carry. Nothing here touches the user's `~/.dsh`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginDir = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'vendor',
  'dsh-plugins',
  'dsh-skill-market',
);

/** A minimal stand-in for the schema library: the host half only builds a
 * config schema with it, and only `resolveSkillRoot`/`apply` are under test. */
const SCHEMA_STUB = `const chain = () => {
  const node = {};
  node.default = (value) => { node.__default = value; return node; };
  node.description = () => node;
  node.required = () => node;
  node.min = () => node;
  node.max = () => node;
  node.role = () => node;
  return node;
};
const Schema = {
  object: (shape) => Object.assign(chain(), { __shape: shape }),
  string: () => chain(),
  number: () => chain(),
  boolean: () => chain(),
  array: () => chain(),
  dict: () => chain(),
  union: () => chain(),
};
export default Schema;
`;

/** Copy the vendored plugin into a throwaway tree whose `node_modules` carries
 * the schema dependency, then import the REAL file through ESM resolution. */
async function loadHostHalf() {
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-skill-market-'));
  const stubDir = join(dir, 'node_modules', 'schemastery');
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    join(stubDir, 'package.json'),
    `${JSON.stringify({ name: 'schemastery', version: '3.18.0', type: 'module', main: './index.js', exports: { '.': './index.js' } })}\n`,
  );
  await writeFile(join(stubDir, 'index.js'), SCHEMA_STUB);
  const target = join(dir, 'dsh-skill-market');
  await cp(pluginDir, target, { recursive: true });
  const module = await import(pathToFileURL(join(target, 'index.js')).href);
  return { module, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const homeArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant('/Users/someone') },
  { weight: 1, arbitrary: fc.constant('/root') },
  { weight: 1, arbitrary: fc.constant('relative/home') },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('/tmp/üniçode 首頁/') },
);

const dshHomeArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant('') },
  { weight: 2, arbitrary: fc.constant('/Users/someone/.dsh') },
  { weight: 1, arbitrary: fc.constant('/tmp/home with spaces/.dsh/') },
  { weight: 1, arbitrary: fc.constant('relative/.dsh') },
  { weight: 1, arbitrary: fc.constant('C:\\\\Users\\\\someone\\\\.dsh') },
);

const explicitArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('/root/.dsh/skills') },
  { weight: 1, arbitrary: fc.constant('/Users/someone/.dsh/skills') },
  { weight: 1, arbitrary: fc.constant('~/skills') },
);

test('SKILLROOT-DEFAULT: the effective install dir is the dsh user skill root', async () => {
  const { module, cleanup } = await loadHostHalf();
  try {
    assert.equal(typeof module.resolveSkillRoot, 'function', 'the resolution is exported');
    fc.assert(
      fc.property(homeArb, dshHomeArb, explicitArb, (home, dshHome, explicit) => {
        const result = module.resolveSkillRoot({ home, dshHome, explicit });
        assert.ok(isAbsolute(result), `the install dir is absolute, got ${result}`);
        const configured = explicit.trim();
        if (configured.length > 0) {
          assert.equal(result, resolve(configured), 'an explicit configuration always wins');
          return;
        }
        if (dshHome.trim().length > 0) {
          assert.equal(result, resolve(dshHome, 'skills'), 'the default is <DSH_HOME>/skills');
          return;
        }
        assert.equal(result, resolve(home, '.dsh', 'skills'), 'and <home>/.dsh/skills without it');
        // The author's environment must not leak into the default.
        assert.ok(
          !result.startsWith('/root/') || home.startsWith('/root'),
          `the default never hardcodes the author's home: ${result}`,
        );
      }),
      { numRuns: 300 },
    );

    // Degenerate inputs stay total.
    for (const options of [{}, { home: '' }, { home: '', dshHome: '', explicit: '' }]) {
      const result = module.resolveSkillRoot(options);
      assert.ok(isAbsolute(result) && result.endsWith('/skills'), JSON.stringify(options));
    }
  } finally {
    await cleanup();
  }
});

test('SKILLROOT-DEFAULT: apply() resolves the same root and reads no token by default', async () => {
  const { module, cleanup } = await loadHostHalf();
  const dshHome = await mkdtemp(join(tmpdir(), 'uniterra-dsh-home-'));
  const previousHome = process.env.DSH_HOME;
  const previousToken = process.env.GITHUB_TOKEN;
  try {
    process.env.DSH_HOME = dshHome;
    delete process.env.GITHUB_TOKEN;
    const logs = [];
    const routes = [];
    const ctx = {
      effect: (body) => {
        body();
      },
      webServer: {
        register: (route) => {
          routes.push(route);
        },
      },
      logger: { info: (message) => logs.push(message) },
    };
    module.apply(ctx, {});
    assert.equal(routes.length, 1, 'the API route is registered exactly once');
    assert.equal(routes[0].path, '/skill-market');
    const line = logs.find((message) => message.includes('installDir='));
    assert.ok(line !== undefined, `apply logs the resolved install dir: ${logs.join(' | ')}`);
    assert.ok(
      line.includes(`installDir=${join(dshHome, 'skills')}`),
      `apply installs into <DSH_HOME>/skills, got: ${line}`,
    );
    assert.ok(
      !line.includes('token: yes'),
      'no GitHub token is read when none was configured (the author token file is gone)',
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    if (previousToken !== undefined) {
      process.env.GITHUB_TOKEN = previousToken;
    }
    await rm(dshHome, { recursive: true, force: true });
    await cleanup();
  }
});
