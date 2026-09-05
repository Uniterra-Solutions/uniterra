/**
 * dsh-api conformance: the other half of the dsh-shortcuts contract. The
 * plugin-side surface table (helpers/dsh-shortcuts-surface-table.mjs) is
 * verified against the PINNED dsh family (vendor/dsh-harness, dsh-v0.1.2-rc.1)
 * so every service / method / projection key / slot / protocol fact the
 * plugin relies on either exists (green) or is reported by name (red).
 * A change to dsh that renames or removes a seam fails here first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from './helpers/dsh-shortcuts-harness.mjs';
import { FEATURE_USAGE } from './helpers/dsh-shortcuts-surface-table.mjs';

function rel(file) {
  return REPO_ROOT + '/vendor/dsh-harness/' + file;
}
function has(file, pattern) {
  try {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return readFileSync(rel(file), 'utf8').match(re) !== null;
  } catch {
    return false;
  }
}
function present(file, pattern, label) {
  assert.ok(has(file, pattern), label + ': expected ' + pattern + ' in ' + file);
}
function absent(file, pattern, label) {
  assert.ok(!has(file, pattern), label + ': found ' + pattern + ' in ' + file);
}

test('every client service the plugin declares/reads is provided by the pinned web composition', () => {
  present(
    'packages/api/session-controller/src/client/sessions/service.ts',
    "reflect\\.provide\\('sessions'",
    'client sessions service',
  );
  present(
    'packages/api/workspace-controller/src/client/service.ts',
    "super\\(ctx, 'workspaces'\\).*",
    'client workspaces service',
  );
  present(
    'packages/client/ui-layout/src/client/index.ts',
    'import[^\\n]*ILayout',
    'client layout service',
  );
  present(
    'packages/client/ui-theme/src/client/index.ts',
    'theme: ThemeRuntime',
    'client theme service',
  );
  present(
    'packages/client/locale/src/client/index.ts',
    'locale: LocaleRuntime',
    'client locale service',
  );
  present(
    'packages/client/ui-model-selection/src/client/service.ts',
    "super\\(ctx, 'modelDirectories'\\).*",
    'client modelDirectories service',
  );
  present(
    'packages/api/gateway/src/client/index.ts',
    "super\\(ctx, 'remote'\\).*",
    'client remote service',
  );
  present(
    'packages/client/ui-renderer/src/client/registry.ts',
    "super\\(ctx, 'slots'\\).*",
    'client slots service',
  );
  present(
    'packages/extensions/cordis-client-runner/src/client/timer.ts',
    "super\\(ctx, 'timer'\\).*",
    'client timer service',
  );
  present(
    'packages/bundle/web-app/cordis.patch.yml',
    'dsh-cordis-client-runner',
    'timer provider mounted in the standard web app',
  );
  present(
    'packages/client/ui-conversation/src/client/service.ts',
    "super\\(ctx, 'conversation'\\).*",
    'client conversation service',
  );
  present(
    'packages/client/ui-commands/src/client/index.ts',
    'remote\\.commands',
    'nested remote.commands face',
  );
});

test('every method the plugin calls exists in the pinned client contracts', () => {
  present(
    'packages/api/workspace-controller/src/client/service.ts',
    'archiveSession\\(sessionId: SessionId\\): Promise<void>',
    'workspaces.archiveSession',
  );
  present(
    'packages/api/session-controller/src/client/contract/sessions.ts',
    'readonly list: ObservableSnapshot<SessionListState>',
    'sessions.list',
  );
  present(
    'packages/api/session-controller/src/client/contract/sessions.ts',
    'open\\(id: SessionId\\): void',
    'sessions.open',
  );
  present(
    'packages/api/session-controller/src/client/contract/sessions.ts',
    'scope\\(id: SessionId\\): AgentContext \\| undefined',
    'sessions.scope',
  );
  present(
    'packages/api/session-controller/src/client/contract/sessions.ts',
    'binding\\(id: SessionId\\): SessionBinding \\| undefined',
    'sessions.binding',
  );
  present(
    'packages/client/ui-conversation/src/client/service.ts',
    'cancel\\(\\): Promise<void>',
    'conversation.cancel',
  );
  present(
    'packages/client/ui-layout/src/client/service.ts',
    'toggleSidebar\\(\\): void',
    'layout.toggleSidebar',
  );
  present(
    'packages/client/ui-layout/src/client/service.ts',
    'openDetails\\(\\): void',
    'layout.openDetails',
  );
  present(
    'packages/client/ui-layout/src/client/service.ts',
    'closeDetails\\(\\): void',
    'layout.closeDetails',
  );
  present(
    'packages/client/ui-theme/src/client/index.ts',
    'getTheme\\(\\): ThemeSnapshot',
    'theme.getTheme',
  );
  present(
    'packages/client/ui-theme/src/client/index.ts',
    'setTheme\\(id: string\\): void',
    'theme.setTheme',
  );
  present(
    'packages/client/locale/src/client/index.ts',
    'getSnapshot\\(\\): LocaleSnapshot',
    'locale.getSnapshot',
  );
  present(
    'packages/client/locale/src/client/index.ts',
    'setLocale\\(id: string\\): void',
    'locale.setLocale',
  );
  present(
    'packages/client/ui-model-selection/src/client/service.ts',
    'directoryFor\\(sessionId: SessionId\\): ModelDirectory',
    'modelDirectories.directoryFor',
  );
  present(
    'packages/client/ui-model-selection/src/client/directory.ts',
    'readonly store: SnapshotStore<ModelDirectoryState>',
    'ModelDirectory.store',
  );
  present(
    'packages/client/ui-model-selection/src/client/directory.ts',
    'async load\\(\\): Promise<ModelDirectoryState>',
    'ModelDirectory.load',
  );
  present(
    'packages/client/ui-model-selection/src/client/directory.ts',
    'async select\\(selection: ModelSelection\\): Promise<void>',
    'ModelDirectory.select',
  );
  // Copy-last-message rides the binding's event window (no conversation projection).
  present(
    'packages/api/session-controller/src/client/sessions/service.ts',
    'readonly eventSource: SessionEventSource',
    'binding.eventSource',
  );
  present(
    'packages/api/session-controller/src/client/contract/events.ts',
    'export interface SessionEventWindow',
    'SessionEventWindow',
  );
  present(
    'packages/core/session/src/types.ts',
    "'assistant/message':",
    'assistant/message event (assembled assistant content)',
  );
  present(
    'packages/api/session-controller/src/types.ts',
    'chunkrow/',
    'chunkrow text runs reach the client window',
  );
  // Theme toggle sees the full registry, not a fixed light/dark pair.
  present(
    'packages/client/ui-theme/src/client/index.ts',
    'themes: readonly ThemeDefinition\\[\\]',
    'registered themes on the theme snapshot',
  );
  // Focus-composer targets the pinned composer seat: the only role=textbox element.
  present(
    'packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx',
    'role="textbox"',
    'composer seat role=textbox (no textarea in ui-conversation)',
  );
});

test('the session-start channel used by the plugin exists in the pinned sessions face', () => {
  present(
    'packages/api/session-controller/src/client/contract/sessions.ts',
    'create\\(opts',
    'sessions.create is the pinned session-start channel; the plugin creates then opens',
  );
  absent(
    'packages/api/workspace-controller/src/client/service.ts',
    'startSession',
    'IWorkspaces exposes no startSession (create/rename/delete/insertBefore/archiveSession/insertSessionBefore only)',
  );
});

test('the dsh family host seams the host half relies on exist', () => {
  present(
    'packages/host/webserver/src/index.ts',
    "'exact' \\| 'prefix'",
    'webServer route kinds (prefix registration)',
  );
  present(
    'packages/interaction/permission-presets/src/index.ts',
    'set\\(session: Session, name: string\\): void',
    'permissionPresets.set',
  );
  present(
    'packages/core/session/src/index.ts',
    "super\\(ctx, 'sessions'\\).*",
    'host sessions service',
  );
  present(
    'packages/api/session-controller/src/agent.ts',
    'ctx\\.sessions\\.get\\(sessionId\\)',
    'host sessions.get(sessionId)',
  );
});

test('every projection key the plugin reads is provided by the pinned session projection registry', () => {
  const fixture = readFileSync(rel('packages/client/connection/src/client/fixture.ts'), 'utf8');
  const keys = new Set();
  for (const m of fixture.matchAll(/values\['([a-zA-Z0-9]+)'\]/g)) keys.add(m[1]);
  for (const m of fixture.matchAll(/key: '([a-zA-Z0-9]+)'/g)) keys.add(m[1]);
  const used = new Set();
  for (const rows of Object.values(FEATURE_USAGE)) {
    for (const row of rows) if (row.method === 'faceOf') used.add(row.args[0]);
  }
  for (const key of used) {
    assert.ok(
      keys.has(key),
      'projection ' +
        key +
        ' is not a provided session projection in the pinned family (keys: ' +
        [...keys].sort().join(', ') +
        ')',
    );
  }
  present(
    'packages/interaction/permission-presets/src/types.ts',
    'currentValue: string',
    'PermissionSelect.currentValue shape',
  );
  present(
    'packages/interaction/permission-presets/src/types.ts',
    'options: PresetOption\\[\\]',
    'PermissionSelect.options shape',
  );
});

test('every slot name / list option shape the plugin registers exists in the pinned SlotMap', () => {
  present(
    'packages/client/ui-settings/src/client/contract/slots.ts',
    "'settings\\.section': \\{ kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps \\}",
    'settings.section declaration',
  );
  present(
    'packages/client/ui-layout/src/client/index.ts',
    "'shell\\.overlay': \\{ kind: 'list'; scope: 'root' \\}",
    'shell.overlay declaration',
  );
  present(
    'packages/client/ui-sidebar/src/client/contract/slots.ts',
    "'sidebar\\.footer\\.action': \\{ kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps \\}",
    'sidebar.footer.action declaration',
  );
  present(
    'packages/client/ui-sidebar/src/client/contract/slots.ts',
    'wide: boolean',
    'sidebar.footer.action owner wide prop',
  );
});

test('the static client-row loading protocol the bundle relies on exists in the pinned family', () => {
  present(
    'packages/client/web/src/platform.ts',
    "'react'",
    'module-table seed react (PLATFORM_MODULES)',
  );
  present('packages/client/modules/src/index.ts', "platform !== 'web'", 'dsh.client platform gate');
  present(
    'packages/client/modules/src/index.ts',
    'graphRow\\(packageName,',
    'graph row id is the package name',
  );
  present('packages/client/web/src/boot.ts', 'prefetchImmediateTier', 'immediately tier prefetch');
  present(
    'packages/client/web/src/boot.ts',
    'did not activate',
    'web boot hard gate (pending entry fails the page)',
  );
  present(
    'packages/client/modules/src/client/system.ts',
    'row\\.inject',
    'informational inject arrival edges',
  );
  present(
    'packages/bundle/web-app/cordis.patch.yml',
    'dsh-client-locale',
    'dsh.client.inject edge: locale row ships',
  );
  present(
    'packages/bundle/web-app/cordis.patch.yml',
    'dsh-client-ui-theme',
    'dsh.client.inject edge: ui-theme row ships',
  );
});
