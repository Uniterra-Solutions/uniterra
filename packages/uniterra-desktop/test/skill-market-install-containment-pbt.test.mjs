/**
 * Environment-mock PBT for the vendored Skill Market installer (issue #27,
 * `vendor/dsh-plugins/dsh-skill-market/index.js`).
 *
 * SKILL-INSTALL-CONTAINMENT: installing a repository puts INTO the dsh user
 * skill root only bytes the repository itself ships. GitHub is mocked to its
 * contract (the repo metadata, the tree listing and the codeload tarball), the
 * tarball is a real generated archive, and the host half's own HTTP handler is
 * driven through its real route — so the property covers the whole
 * download → extract → copy flow, and a repository that ships an entry pointing
 * outside itself must not turn the installer into a reader of local files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
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

/** A minimal stand-in for the schema library the host half imports at module
 * scope; only the installer's HTTP behaviour is under test. */
const SCHEMA_STUB = `const chain = () => {
  const node = {};
  node.default = (value) => { node.__default = value; return node; };
  node.description = () => node;
  return node;
};
export default {
  object: (shape) => Object.assign(chain(), { __shape: shape }),
  string: () => chain(),
  number: () => chain(),
  boolean: () => chain(),
  array: () => chain(),
  dict: () => chain(),
  union: () => chain(),
};
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

/** Every file under `dir`, as [relative path, bytes] pairs. */
async function walkFiles(dir, base = dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else {
      out.push([relative(base, full), await readFile(full, 'utf8')]);
    }
  }
  return out;
}

/** The smallest request/response pair the host half's handler reads. */
function makeRequest(method, url, body, headers) {
  const emitter = new EventEmitter();
  emitter.method = method;
  emitter.url = url;
  emitter.headers = headers;
  setImmediate(() => {
    if (body !== undefined) {
      emitter.emit('data', Buffer.from(body, 'utf8'));
    }
    emitter.emit('end');
  });
  return emitter;
}

function makeResponse() {
  let settle;
  const done = new Promise((resolveDone) => {
    settle = resolveDone;
  });
  const response = {
    statusCode: null,
    body: '',
    writeHead(code) {
      response.statusCode = code;
    },
    end(data) {
      response.body = data === undefined ? '' : data.toString('utf8');
      settle();
    },
  };
  return { response, done };
}

const NAME_RE = /^[a-z0-9-]{1,10}$/u;

test('SKILL-INSTALL-CONTAINMENT: an installed skill carries only bytes the repository ships', async () => {
  const { module, cleanup } = await loadHostHalf();
  const realFetch = globalThis.fetch;
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.stringMatching(NAME_RE),
            fc.string({ minLength: 4, maxLength: 40 }).filter((value) => value.trim().length > 0),
          ),
          { minLength: 1, maxLength: 3 },
        ),
        async (entries) => {
          const root = await mkdtemp(join(tmpdir(), 'uniterra-skill-install-'));
          try {
            const repository = join(root, 'stage', 'evilrepo-main');
            await mkdir(repository, { recursive: true });
            await writeFile(
              join(repository, 'SKILL.md'),
              '---\nname: evil\ndescription: a repository from the market\n---\n',
            );
            const leaks = [];
            for (const [index, [name, content]] of entries.entries()) {
              const outside = join(root, `outside-${String(index)}-${name}.txt`);
              await writeFile(outside, content);
              await symlink(outside, join(repository, `leak-${String(index)}`));
              leaks.push(content);
            }
            const tarball = join(root, 'evilrepo.tar.gz');
            execFileSync('tar', ['-czf', tarball, '-C', join(root, 'stage'), 'evilrepo-main']);
            const tarballBytes = await readFile(tarball);

            globalThis.fetch = async (url) => {
              const request = String(url);
              if (request.includes('/git/trees/')) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({ tree: [{ path: 'SKILL.md' }] }),
                };
              }
              if (request.includes('api.github.com/repos/')) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({ default_branch: 'main', description: 'evil' }),
                };
              }
              if (request.includes('codeload.github.com')) {
                return {
                  ok: true,
                  status: 200,
                  arrayBuffer: async () =>
                    tarballBytes.buffer.slice(
                      tarballBytes.byteOffset,
                      tarballBytes.byteOffset + tarballBytes.byteLength,
                    ),
                };
              }
              return { ok: false, status: 404, text: async () => 'not mocked' };
            };

            const skills = join(root, 'dshhome', 'skills');
            await mkdir(skills, { recursive: true });
            const routes = [];
            module.apply(
              {
                effect: (body) => body(),
                webServer: { register: (route) => routes.push(route) },
                logger: { info: () => undefined },
              },
              { installDir: skills },
            );
            const { response, done } = makeResponse();
            routes[0].handler(
              makeRequest(
                'POST',
                '/skill-market/api/install',
                JSON.stringify({ owner: 'evil', repo: 'evilrepo', ref: 'main' }),
                { origin: 'http://localhost:34567', host: 'localhost:34567' },
              ),
              response,
            );
            await done;

            assert.equal(response.statusCode, 200, response.body);
            const installed = join(skills, 'evilrepo');
            assert.ok(existsSync(installed), 'the skill was installed');
            const installedFiles = await walkFiles(installed);
            assert.ok(installedFiles.length > 0, 'the skill carries files');
            const shipped = new Set((await walkFiles(repository)).map(([, content]) => content));
            for (const [name, content] of installedFiles) {
              assert.ok(
                shipped.has(content),
                `an installed skill file carries bytes the repository does not ship: ${name}`,
              );
            }
            for (const content of leaks) {
              assert.ok(
                !installedFiles.some(([, installed]) => installed === content),
                'a file from outside the repository was copied into the skill root',
              );
            }
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 5 },
    );
  } finally {
    globalThis.fetch = realFetch;
    await cleanup();
  }
});

test('SKILL-INSTALL-CONTAINMENT regression: a symlink pointing outside the repository is never followed', async () => {
  // The shrunk counterexample: one link entry whose target is a file outside
  // the downloaded repository. Upstream's copyTree followed it (statSync +
  // copyFileSync), so a one-click install copied that file's bytes into the
  // model-readable skill root. The probe content is private-key shaped so a
  // leak is unmistakable.
  const SECRET =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nnot a real key, but shaped like one\n-----END OPENSSH PRIVATE KEY-----\n';
  const { module, cleanup } = await loadHostHalf();
  const realFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), 'uniterra-skill-install-'));
  try {
    const repository = join(root, 'stage', 'evilrepo-main');
    await mkdir(repository, { recursive: true });
    await writeFile(
      join(repository, 'SKILL.md'),
      '---\nname: evil\ndescription: a repository from the market\n---\n',
    );
    const outsideFile = join(root, 'outside-a.txt');
    await writeFile(outsideFile, SECRET);
    const outsideDir = join(root, 'outside-dir');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.txt'), SECRET);
    await symlink(outsideFile, join(repository, 'leak-file'));
    await symlink(outsideDir, join(repository, 'leak-dir'));

    const tarball = join(root, 'evilrepo.tar.gz');
    execFileSync('tar', ['-czf', tarball, '-C', join(root, 'stage'), 'evilrepo-main']);
    const tarballBytes = await readFile(tarball);

    globalThis.fetch = async (url) => {
      const request = String(url);
      if (request.includes('/git/trees/')) {
        return { ok: true, status: 200, json: async () => ({ tree: [{ path: 'SKILL.md' }] }) };
      }
      if (request.includes('api.github.com/repos/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main', description: 'evil' }),
        };
      }
      if (request.includes('codeload.github.com')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            tarballBytes.buffer.slice(
              tarballBytes.byteOffset,
              tarballBytes.byteOffset + tarballBytes.byteLength,
            ),
        };
      }
      return { ok: false, status: 404, text: async () => 'not mocked' };
    };

    const skills = join(root, 'dshhome', 'skills');
    await mkdir(skills, { recursive: true });
    const routes = [];
    module.apply(
      {
        effect: (body) => body(),
        webServer: { register: (route) => routes.push(route) },
        logger: { info: () => undefined },
      },
      { installDir: skills },
    );
    const { response, done } = makeResponse();
    routes[0].handler(
      makeRequest(
        'POST',
        '/skill-market/api/install',
        JSON.stringify({ owner: 'evil', repo: 'evilrepo', ref: 'main' }),
        {
          origin: 'http://localhost:34567',
          host: 'localhost:34567',
        },
      ),
      response,
    );
    await done;

    assert.equal(response.statusCode, 200, response.body);
    const installed = join(skills, 'evilrepo');
    assert.ok(existsSync(installed), 'the skill was installed');
    assert.deepEqual(
      (await readdir(installed)).sort(),
      ['SKILL.md'],
      "the installed skill carries the repository's own files only",
    );
    const installedFiles = await walkFiles(installed);
    for (const [name, content] of installedFiles) {
      assert.ok(
        !content.includes('PRIVATE KEY'),
        `${name} carries bytes from outside the repository`,
      );
    }
    assert.ok(
      !installedFiles.some(([name]) => name.startsWith('leak-')),
      'a link entry is skipped, not copied',
    );
  } finally {
    globalThis.fetch = realFetch;
    await cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
