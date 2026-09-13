---
name: dsh-skill-creator
description: >
  Create a dsh skill: freeze a reusable process into a SKILL.md the dsh registry
  discovers and loads on trigger — where the file belongs (project / user /
  bundled roots, duplicate-name precedence), the naming and frontmatter
  contract, a body that changes behaviour, and how to verify it. LOAD when:
  - User asks to create a dsh skill (建立技能 / 技能創建 / 新增 skill)
  - A repeated workflow should become a skill
  NOT for: executor prompts (use dsh-prompt-writer).
---

# dsh Skill Creator

A dsh skill is a markdown instruction bundle the dsh skill registry discovers
and hands to the model on demand. The model-facing catalog carries only the
skill name and its description; the body is loaded by the `skill` tool when
the description matches the task at hand. A skill exists to make the agent's
process predictable — create one when a workflow must run the same way every
time, never to store notes or documentation.

The facts below come from the dsh skill subsystem; when the harness source is
at hand (`vendor/dsh-harness/docs/subsystems/skills.md` in the Uniterra repo),
prefer it over this summary.

## When to use

- The user asks to create or add a dsh skill, or to freeze a repeated process
  into one (create a dsh skill / 建立技能 / 技能創建 / 新增 skill).
- A workflow you just ran by hand should run the same way next time.

Not for: writing an executor prompt or work order (use `dsh-prompt-writer`);
editing the prose of an existing skill (edit that file directly).

## 1. Decide where the skill lives

The local provider scans roots in rank order, and the LOWEST rank wins a
duplicate name. Write the skill into the narrowest root that matches who needs
it.

| Rank | Source           | Root                           | Use it for                                                                             |
| ---- | ---------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| 100  | `project-dsh`    | `<projectRoot>/.dsh/skills`    | A skill that only serves this repository                                               |
| 200  | `project-agents` | `<projectRoot>/.agents/skills` | The same, when the repo already keeps agent files under `.agents/`                     |
| 300  | `custom`         | the `customSkillDirs` config   | A deployment-supplied extra root                                                       |
| 400  | `user-dsh`       | `<dshHome>/skills`             | A skill that follows the user across projects (packaged Uniterra app: `~/.dsh/skills`) |
| 500  | `user-agents`    | `<agentsHome>/skills`          | The same, for the shared agents home (`DSH_AGENTS_HOME`, default `~/.agents`)          |
| 600  | `bundled`        | `DSH_BUNDLED_SKILL_DIR`        | The app's built-in set — READ-ONLY, never author here                                  |

`<projectRoot>` is the nearest ancestor containing `.git`; without one, the
current working directory is used. The user root skips its `.system` child.

Choosing:

- Only this repository → a project root, preferring `.dsh/skills`.
- The user wants it in every project → `<dshHome>/skills`.
- The bundled root ships with the application: a skill written there is
  overwritten by the next app update and is not the user's to create.

## 2. Name it and lay it out

- Name: kebab-case matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` — lowercase letters,
  digits and single hyphens. Anything else is rejected and the skill never
  appears.
- Layout, exactly one of:
  - a directory bundle: `<root>/<name>/SKILL.md`, with optional
    `references/`, `scripts/` and `assets/` beside it — preferred once the
    skill carries resources;
  - a flat file: `<root>/<name>.md` — fine for one short skill.
- Nested discovery is NOT supported: `<root>/<category>/<name>/SKILL.md` is
  never scanned, so do not invent category folders.

The frontmatter `name` must be the skill's registry name; a definition whose
name no longer matches its candidate is rejected.

## 3. Frontmatter

```yaml
---
name: my-skill-name
description: >
  What the skill does, plus the trigger words that make the model load it.
  LOAD when:
  - User asks to ...
whenToUse: Optional extra routing guidance.
disable-model-invocation: false
user-invocable: true
---
```

- `name` and `description` are required non-empty strings; a file missing
  either one is ignored.
- `whenToUse` is optional extra routing guidance for human-facing catalogs.
- `disable-model-invocation` and `user-invocable` are optional booleans, both
  defaulting to `true`. Only the exact kebab-case keys are accepted — the
  legacy camelCase spellings (`disableModelInvocation`, `modelInvocable`,
  `userInvocable`) are rejected outright and the whole skill is ignored.
- Unknown keys are tolerated, but stay inside the contract.

The four visibility combinations:

| `disable-model-invocation` | `user-invocable` | Result                                                        |
| -------------------------- | ---------------- | ------------------------------------------------------------- |
| false (default)            | true (default)   | A normal skill: in the model catalog and in user catalogs     |
| true                       | true             | User-only: a human invokes it, the model catalog omits it     |
| false                      | false            | Model-only: the model loads it, user catalogs omit it         |
| true                       | false            | Neither catalog; only trusted registry callers can resolve it |

The model catalog renders `name` plus the XML-escaped `description` and
nothing else, bounded by `catalogDescriptionMaxLength` (default 500
characters). Put the capability and the trigger words INSIDE that window: the
body may be long, the description may not.

## 4. Write a body that changes behaviour

- Optimize for process predictability. If a line does not change what the agent
  does, delete it.
- Front-load routing: a short intro (what it does, what it does not), then
  numbered steps.
- End each step with a checkable completion criterion ("every acceptance line
  maps to at least one test") rather than an exhortation ("be thorough").
- Co-locate a rule with the concept it governs instead of gathering all rules
  in a final section.
- Prefer strong leading words ("red baseline", "frozen tests", "root cause")
  over repeated explanation.
- Name this runtime's real tools — `read`, `write`, `edit`, `glob`, `grep`,
  `bash`, `skill`, `ask_user_question`, `run_workflow`, `subagent` — never a shell
  utility the agent already has wrapped (`cat`, `find`, `sed`).
- Write paths repo-relative or skill-relative (`references/x.md`). A
  machine-local absolute path is broken for every other user.
- Keep heavy material out of SKILL.md: a long checklist, a template or a domain
  table belongs in `references/` and is pointed to by relative path. Target
  roughly 100 lines for a simple skill and 200 for a complex one.

## 5. Ship resources next to the skill

Relative resources (`references/`, `scripts/`, `assets/`) are resolved against the
skill's own directory and loaded only when the body asks for them; a skill does
not enumerate its directory. Reference them by relative path and say WHEN to
read each one, so the agent pays for the file only when it needs it. A script
belongs beside the skill when its logic must be exact and repeatable; keep it
runnable with the runtime's own interpreter and documented by one usage line.

## 6. Verify discovery

1. Write the file at the chosen root.
2. Load it by name with the `skill` tool. A `<skill_content ...>` result proves
   the registry found the candidate, parsed the frontmatter and read the body.
3. Trigger it in natural language WITHOUT naming the skill: phrase a request
   with the trigger words from the description and confirm the load happens.
4. Check the catalog. The session catalog lists every model-invocable skill by
   name and description; a discovery change appends a replacement catalog to
   the session, and a session that started before the file existed may need a
   fresh step to see it.
5. When the skill never appears, check in this order: frontmatter parses with
   both `name` and `description` non-empty; the name is kebab-case; the file
   sits at a scanned depth; the root directory actually exists; no legacy
   camelCase invocation key is present.

The registry watches existing roots, so adding or editing a direct entry is
picked up without restarting dsh. A brand-new root that does not exist yet is
followed from its nearest existing ancestor — an outright typo in the path is
never discovered.

## 7. Pitfalls

1. **Nested layout.** `<root>/<category>/<name>/SKILL.md` is never discovered.
2. **A non-kebab-case name** (underscores, uppercase, dots, spaces) → the
   candidate is rejected.
3. **Writing into the bundled root.** It is the app's own shipped set; the
   change is lost on the next update and never belonged to the user.
4. **A description whose trigger words fall past the catalog cap.** The model
   sees a truncated sentence and never loads the skill.
5. **Legacy frontmatter keys.** `modelInvocable` and friends do not degrade
   gracefully; they invalidate the whole definition.
6. **Confusing model visibility with user visibility.** `user-invocable` has
   nothing to do with how the MODEL finds the skill.
7. **Duplicating the body in the description.** The description is paid for on
   every turn; the body only when loaded.
