/**
 * Integration tests for the plan / implement scaffolding CLIs
 * (`scripts/init_plan.mjs`, `scripts/init_task.mjs`). These run the actual
 * scripts with `node` in a temporary cwd and assert the generated run-directory
 * structure + templates, so the "agent runs a script, fills in the template"
 * flow is pinned end-to-end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const planScript = path.resolve(here, '..', 'src', 'skills', 'uniterra-plan', 'scripts', 'init_plan.mjs');
const taskScript = path.resolve(here, '..', 'src', 'skills', 'uniterra-implement', 'scripts', 'init_task.mjs');

function run(cwd: string, script: string, args: string[]): string {
  return execFileSync('node', [script, ...args], { cwd, encoding: 'utf8' });
}

function dirs(root: string, rel: string): string[] {
  const p = path.join(root, rel);
  return existsSync(p) ? readdirSync(p) : [];
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('init_plan.mjs scaffolds .plan/<YYYYMMDD>/<plan-name>/ with prd/design/acceptance', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'uniterra-init-plan-'));
  try {
    run(cwd, planScript, ['User Auth']);
    const runDir = dirs(cwd, '.plan');
    assert.equal(runDir.length, 1, 'one plan run directory');
    const ts = runDir[0];
    const planDirs = dirs(path.join(cwd, '.plan'), ts!);
    assert.equal(planDirs.length, 1, 'one plan-name directory');
    const planDir = path.join(cwd, '.plan', ts!, planDirs[0]!);
    for (const file of ['prd.md', 'design.md', 'acceptance.md']) {
      assert.ok(existsSync(path.join(planDir, file)), `${file} generated`);
    }
    const prd = readFileSync(path.join(planDir, 'prd.md'), 'utf8');
    assert.ok(prd.includes('REQ-1'), 'prd seeds a requirement list');
    assert.ok(readFileSync(path.join(planDir, 'design.md'), 'utf8').includes('## Architecture'));
    const accept = readFileSync(path.join(planDir, 'acceptance.md'), 'utf8');
    assert.ok(accept.includes('Verifiable evidence'), 'acceptance seeds evidence column');
  } finally {
    cleanup(cwd);
  }
});

test('init_plan.mjs honors an explicit timestamp + a filesystem-safe plan-name slug', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'uniterra-init-plan2-'));
  try {
    run(cwd, planScript, ['User Auth', '20261231']);
    assert.ok(existsSync(path.join(cwd, '.plan', '20261231', 'User-Auth', 'prd.md')), 'explicit timestamp + slug used');
  } finally {
    cleanup(cwd);
  }
});

test('init_task.mjs scaffolds .dsh/<YYYYMMDD>/<task>/task.md and keeps a tasks.json manifest', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'uniterra-init-task-'));
  try {
    run(cwd, taskScript, ['T1', 'token issuance']);
    run(cwd, taskScript, ['T2', 'refresh rotation']);

    const runDir = dirs(cwd, '.dsh');
    assert.equal(runDir.length, 1, 'one implement run directory');
    const ts = runDir[0];

    const task1 = path.join(cwd, '.dsh', ts!, 'token-issuance', 'task.md');
    const task2 = path.join(cwd, '.dsh', ts!, 'refresh-rotation', 'task.md');
    assert.ok(existsSync(task1), 'task-1 doc generated');
    assert.ok(existsSync(task2), 'task-2 doc generated');
    for (const t of [task1, task2]) {
      const content = readFileSync(t, 'utf8');
      for (const section of ['## Goal', '## Context', '## Requirements', '## Conventions', '## Constraints']) {
        assert.ok(content.includes(section), `${path.basename(path.dirname(t))} has ${section}`);
      }
    }

    const manifest = JSON.parse(readFileSync(path.join(cwd, '.dsh', ts!, 'tasks.json'), 'utf8')) as {
      tasks: Array<{ id: string; name: string; promptFile: string }>;
    };
    assert.deepEqual(manifest.tasks.map((t) => t.id).sort(), ['T1', 'T2']);
    assert.equal(
      manifest.tasks[0]!.promptFile,
      path.join('.dsh', ts!, 'token-issuance', 'task.md'),
    );
  } finally {
    cleanup(cwd);
  }
});
