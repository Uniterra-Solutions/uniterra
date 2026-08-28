#!/usr/bin/env node
/**
 * Scaffold a subagent task brief under the implement run directory.
 *
 * Usage:
 *   node init_task.mjs <project-name> <task-id> <task-name> [timestamp]
 *
 * Creates <cwd>/.dsh/<timestamp>/<project-name>/<task-name>.md (the full brief a
 * subagent reads via `promptFile`) and maintains
 * `<.dsh/<timestamp>/<project-name>/task.json>` — the `{ tasks: [...] }` argument
 * for `run_workflow('implement', ...)`. The manifest lives INSIDE the project
 * directory (one per project), so several projects sharing one timestamp
 * directory never overwrite each other's task.json.
 *
 * Run in the repo root (your cwd), e.g.:
 *   node "<skill_base>/scripts/init_task.mjs" user-auth T1 "token issuance"
 *
 * Example layout after scaffolding multiple tasks:
 *   .dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md * n
 *   .dsh/<YYYYMMDD-HHmmss>/<project-name>/task.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default sortable run timestamp with minutes + seconds (`<YYYYMMDD-HHmmss>`),
 * so two implementations run in the same day still get distinct run
 * directories. */
export function defaultTimestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

/** Filesystem-safe directory slug for a project/task name (keeps it readable). */
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

/** Absolute repo-relative brief path (repo root is the subagent's cwd). */
export function promptFileFor({ timestamp, project, taskName }) {
  return path.join('.dsh', timestamp, slugify(project), `${slugify(taskName)}.md`);
}

/**
 * Create the task brief + update the project-level task.json manifest.
 * Returns { promptFile, taskJson, manifestPath }.
 */
export function generateTask({ cwd, timestamp, project, id, name }) {
  const projectDir = path.join(cwd, '.dsh', timestamp, slugify(project));
  mkdirSync(projectDir, { recursive: true });

  const promptFile = promptFileFor({ timestamp, project, taskName: name });
  writeFileSync(path.join(cwd, promptFile), taskTemplate({ id, name }), 'utf8');

  // One manifest PER PROJECT (`.dsh/<timestamp>/<project>/task.json`) so
  // multiple projects under the same timestamp never overwrite each other:
  // { "tasks": [{ id, name, promptFile }, ...] }
  const manifestPath = path.join(projectDir, 'task.json');
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
  const [project, id, name, ts] = argv;
  if (!project || !id || !name) {
    console.error('Usage: node init_task.mjs <project-name> <task-id> <task-name> [timestamp]');
    process.exit(1);
  }
  const timestamp = ts || defaultTimestamp();
  const { promptFile, taskJson, manifestPath } = generateTask({
    cwd: process.cwd(),
    timestamp,
    project,
    id,
    name,
  });
  console.log(`task doc written to ${promptFile}`);
  console.log(`dispatch entry: ${JSON.stringify(taskJson)}`);
  console.log(`project manifest: ${path.relative(process.cwd(), manifestPath)}`);
  console.log(
    `run_workflow('implement', { tasks: <entries from ${path.relative(process.cwd(), manifestPath)}> })`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
