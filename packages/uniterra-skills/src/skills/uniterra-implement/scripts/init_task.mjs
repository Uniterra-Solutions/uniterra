#!/usr/bin/env node
/**
 * Scaffold a subagent task document under the implement run directory.
 *
 * Usage:
 *   node init_task.mjs <task-id> <task-name> [timestamp]
 *
 * Creates <cwd>/.dsh/<timestamp>/<task-name>/task.md (the full brief a subagent
 * reads via `promptFile`) and maintains `.dsh/<timestamp>/tasks.json` (the
 * `{ tasks: [...] }` argument for `run_workflow('implement', ...)`). It prints
 * the promptFile path and the ready-to-use task JSON so the agent only fills in
 * the brief and dispatches.
 *
 * Run in the repo root (your cwd), e.g.:
 *   node "<skill_base>/scripts/init_task.mjs" T1 "token issuance"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default sortable run timestamp (matches the `.dsh/<YYYYMMDD>/` convention). */
export function defaultTimestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Filesystem-safe directory slug for the task name (keeps it readable). */
export function slugify(name) {
  return String(name)
    .replace(/[\s/\\]+/gu, '-')
    .replace(/[^A-Za-z0-9._-]/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

/** The subagent task brief template the agent fills in before dispatch. */
export function taskTemplate({ id, name }) {
  return `# Task: ${name}

## Goal

<What this task delivers — one line.>

## Context

- <path> — <description> (read: <symbol / §section>)
- …

## Requirements

- <REQ-id>: <text> — [test: <package/x/test.ts → 'case'>]
- …

## Conventions

- <module-local test command or convention>
- …

## Constraints

- owned_files: <path>, <path>
- forbidden_files: <path>, <path>
`;
}

/** Absolute repo-relative path (repo root is the subagent's cwd). */
export function promptFileFor({ timestamp, taskName }) {
  return path.join('.dsh', timestamp, slugify(taskName), 'task.md');
}

/**
 * Create the task doc + update the run-level tasks.json manifest.
 * Returns { promptFile, taskJson, manifestPath }.
 */
export function generateTask({ cwd, timestamp, id, name }) {
  const taskDir = path.join(cwd, '.dsh', timestamp, slugify(name));
  const runDir = path.join(cwd, '.dsh', timestamp);
  mkdirSync(taskDir, { recursive: true });

  const promptFile = promptFileFor({ timestamp, taskName: name });
  writeFileSync(path.join(taskDir, 'task.md'), taskTemplate({ id, name }), 'utf8');

  // Maintain a run-level manifest so the agent can dispatch without rebuilding
  // the tasks array by hand: {
  //   "tasks": [{ id, name, promptFile }, ...] }
  const manifestPath = path.join(runDir, 'tasks.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { tasks: [] };
  const entry = { id, name, promptFile };
  const existing = manifest.tasks.findIndex((t) => t.id === id);
  if (existing === -1) {
    manifest.tasks.push(entry);
  } else {
    manifest.tasks[existing] = entry;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { promptFile, taskJson: entry, manifestPath };
}

function cli(argv) {
  const [id, name, ts] = argv;
  if (!id || !name) {
    console.error('Usage: node init_task.mjs <task-id> <task-name> [timestamp]');
    process.exit(1);
  }
  const timestamp = ts || defaultTimestamp();
  const { promptFile, taskJson } = generateTask({
    cwd: process.cwd(),
    timestamp,
    id,
    name,
  });
  const relManifest = path.join('.dsh', timestamp, 'tasks.json');
  console.log(`task doc written to ${promptFile}`);
  console.log(`dispatch entry: ${JSON.stringify(taskJson)}`);
  console.log(`run_workflow('implement', { tasks: <entries from ${relManifest}> })`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
