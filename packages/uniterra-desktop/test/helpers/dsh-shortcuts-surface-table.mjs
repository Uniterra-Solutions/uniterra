/**
 * The dsh-shortcuts surface table: the exact dsh-facing calls every feature
 * makes, captured against the pinned dsh faces. Owned here so the plugin-side
 * contract test and the dsh-api conformance test verify one table.
 */

export const FEATURE_USAGE = {
  newSession: [
    { svc: 'sessions.list', method: 'getSnapshot' },
    { svc: 'workspaces.list', method: 'getSnapshot' },
    { svc: 'sessions', method: 'create', args: [{}] },
    { svc: 'sessions', method: 'open', args: ['s1'] },
  ],
  quickSwitcher: [],
  archiveSession: [{ svc: 'workspaces', method: 'archiveSession', args: ['s1'] }],
  focusComposer: [],
  stopTask: [
    { svc: 'sessions', method: 'scope', args: ['s1'] },
    { svc: 'sessions.scope', method: 'get', args: ['conversation'] },
    { svc: 'sessions.scope.get', method: 'cancel' },
  ],
  toggleSidebar: [{ svc: 'layout', method: 'toggleSidebar' }],
  toggleDetails: [{ svc: 'layout', method: 'openDetails' }],
  toggleTheme: [
    { svc: 'theme', method: 'getTheme' },
    { svc: 'theme', method: 'setTheme', args: ['light'] },
  ],
  toggleFullscreen: [],
  scrollToTop: [],
  scrollToBottom: [],
  focusSidebarSearch: [],
  copyLastMessage: [
    { svc: 'sessions', method: 'binding', args: ['s1'] },
    { svc: 'sessions.binding.eventSource', method: 'getSnapshot' },
  ],
  copySessionTitle: [{ svc: 'sessions.list', method: 'getSnapshot' }],
  copySessionId: [],
  cycleEffort: [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm1', reasoningEffort: 'medium' }],
    },
  ],
  selectModel1: [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm1', reasoningEffort: 'low' }],
    },
  ],
  selectModel2: [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm2' }],
    },
  ],
  selectEffort1: [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm1', reasoningEffort: 'low' }],
    },
  ],
  selectEffort2: [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm1', reasoningEffort: 'medium' }],
    },
  ],
  cyclePermission: [
    { svc: 'sessions', method: 'binding', args: ['s1'] },
    { svc: 'sessions.binding.session.projections', method: 'faceOf', args: ['permissions'] },
    { svc: 'sessions.binding.session.projections.faceOf', method: 'getSnapshot' },
  ],
  openSettings: [],
  showCheatsheet: [],
  cycleLocale: [
    { svc: 'locale', method: 'getSnapshot' },
    { svc: 'locale', method: 'setLocale', args: ['en'] },
  ],
};
for (let i = 3; i <= 9; i += 1) {
  FEATURE_USAGE['selectModel' + i] = [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
  ];
}
const EFFORT_IDS = ['low', 'medium', 'high', 'max', 'extreme'];
for (let i = 3; i <= 5; i += 1) {
  FEATURE_USAGE['selectEffort' + i] = [
    { svc: 'modelDirectories', method: 'directoryFor', args: ['s1'] },
    { svc: 'modelDirectories.directoryFor.store', method: 'getSnapshot' },
    {
      svc: 'modelDirectories.directoryFor',
      method: 'select',
      args: [{ provider: 'g1', model: 'm1', reasoningEffort: EFFORT_IDS[i - 1] }],
    },
  ];
}

export const EXPECTED_DOM = {
  focusComposer: ['querySelector("[role=\\"textbox\\"]")'],
  focusSidebarSearch: [
    'querySelectorAll(\"input[type=\\\"search\\\"], input[placeholder*=\\\"搜索\\\"], input[placeholder*=\\\"Search\\\"]\")',
  ],
  openSettings: ['querySelector(\"button[aria-haspopup=\\\"dialog\\\"]\")'],
  scrollToTop: ['scrollTo(1)'],
  scrollToBottom: ['scrollTo(1)'],
  toggleFullscreen: ['requestFullscreen()'],
};
