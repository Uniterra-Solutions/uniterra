#!/usr/bin/env node
/**
 * Scaffold the plan run directory and its two plan document templates.
 *
 * Usage:
 *   node init_plan.mjs <plan-name> [timestamp]
 *
 * Creates <cwd>/.plan/<timestamp>/<plan-name>/ with prd.md and acceptance.md
 * templates, then prints the created directory. The agent fills in the
 * placeholders. The plan is a requirements list plus its acceptance criteria —
 * there is no design document.
 *
 * Run in the repo root (your cwd), e.g.:
 *   node "<skill_base>/scripts/init_plan.mjs" "user auth"
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default sortable run timestamp (matches the `.plan/<YYYYMMDD>/` convention). */
export function defaultTimestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Filesystem-safe directory slug for the plan/task name (keeps it readable). */
export function slugify(name) {
  return String(name)
    .replace(/[\s/\\]+/gu, '-')
    .replace(/[^A-Za-z0-9._-]/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

/** The two plan document templates, keyed by filename. */
export function planTemplates(planName) {
  return {
    'prd.md': `# PRD — ${planName}

> Scaffolding for the plan phase. Fill in every <placeholder>; delete the
> note once the section is complete.

## Background

<One paragraph: what problem this solves, for whom, and why now.>

## Goal

<One sentence: the single outcome this plan delivers.>

## Functional Requirements

- REQ-1: <requirement text — unambiguous and verifiable>
- REQ-2: <requirement text>
- REQ-3: <requirement text>

## Out of Scope

- <explicitly NOT built>

## Assumptions & Constraints

Facts and constraints that cannot be derived from the repo and must hold. Each
one lands as a requirement (REQ-n) or an acceptance row — never as design prose.

- <assumption / constraint the requirements rely on>
`,
    'acceptance.md': `# Acceptance — ${planName}

One entry per requirement (REQ-1, …). Each names an objective, verifiable piece
of evidence (a test, a command output, an observable behavior). Prefer evidence
that already exists in this repo — a real test file or a real command — over a
described one.

| Req | Objective | Verifiable evidence |
|-----|-----------|---------------------|
| REQ-1 | <outcome> | <test / command output / observable behavior> |
| REQ-2 | <outcome> | <...> |
| REQ-3 | <outcome> | <...> |
`,
  };
}

/**
 * Create <cwd>/.plan/<timestamp>/<plan-name-slug>/ with the two templates.
 * Returns the absolute run-dir path.
 */
export function generatePlan({ cwd, planName, timestamp }) {
  const runDir = path.join(cwd, '.plan', timestamp, slugify(planName));
  mkdirSync(runDir, { recursive: true });
  for (const [file, content] of Object.entries(planTemplates(planName))) {
    writeFileSync(path.join(runDir, file), content, 'utf8');
  }
  return runDir;
}

function cli(argv) {
  const [planName, ts] = argv;
  if (!planName) {
    console.error('Usage: node init_plan.mjs <plan-name> [timestamp]');
    process.exit(1);
  }
  const timestamp = ts || defaultTimestamp();
  const runDir = generatePlan({ cwd: process.cwd(), planName, timestamp });
  const rel = path.relative(process.cwd(), runDir);
  console.log(`plan scaffolding written to ${rel}`);
  console.log(`  prd.md\n  acceptance.md`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
