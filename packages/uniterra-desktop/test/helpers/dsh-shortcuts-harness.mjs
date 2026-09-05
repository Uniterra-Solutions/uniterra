/**
 * dsh-shortcuts test harness: evaluates the vendored client bundle
 * (vendor/dsh-plugins/dsh-shortcuts/lib/client.js) in a browser-shaped
 * sandbox, exposes its closure internals through an appended test face, and
 * ships fixtures modelled on the pinned dsh family (dsh-v0.1.2-rc.1,
 * see vendor/dsh-harness) so contract tests can drive every feature against
 * the real service shapes.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

export const SHORTCUTS_CLIENT_PATH = REPO_ROOT + '/vendor/dsh-plugins/dsh-shortcuts/lib/client.js';

export const SHORTCUTS_HOST_PATH = REPO_ROOT + '/vendor/dsh-plugins/dsh-shortcuts/lib/index.js';

export const TEST_FACE = '__test';

/** Append an internals face to the factory body (end of the closure). */
function exposeInternals(code) {
  const anchor = '\texports.apply = apply;';
  const marker = '\texports.inject = inject;';
  if (!code.includes(anchor) || !code.includes(marker)) {
    throw new Error('dsh-shortcuts harness: cannot locate factory export tail');
  }
  const face = `
	exports.__test = {
		FEATURES, FEATURE_BY_ID,
		defaults, normalize, loadSettings, saveSettings, patchSettings,
		parseCombo, comboFromEvent, matchCombo, keyFromEvent, normalizeKey, formatCombo,
		runAction, selectModelAt, selectEffortAt, cyclePermissionRun,
		modelNameAt, effortNameAt, diagnosticInfo, isEditable, flatModelList,
		sessionsBinding, modelDirectoryOf, copyText, permTone, showToast,
		logKey, formatLogKey, getState, subscribe, installKeydown,
		ShortcutsPage, ToastHost, Palette, Cheatsheet, ShortcutButton,
		get settings() { return settings; },
		set settings(v) { settings = v; },
		get currentSessionId() { return currentSessionId; },
		set currentSessionId(v) { currentSessionId = v; },
		get tabHeld() { return tabHeld; },
		get keyLog() { return keyLog; },
		get toastMsg() { return toastMsg; },
		get lastPermResult() { return lastPermResult; },
		get paletteOpen() { return paletteOpen; },
		get cheatsheetOpen() { return cheatsheetOpen; },
		get recordingAction() { return recordingAction; },
		get listeners() { return listeners; },
		get pluginCtx() { return pluginCtx; },
		get memoryStore() { return memoryStore; },
	};
`;
  return code.replace(marker, marker + face);
}

/**
 * Minimal React shim: enough hooks + createElement for the plugin's
 * components (useState/useEffect/useRef/createElement) plus a tiny
 * synchronous re-render loop for one component instance.
 */
export function createMiniReact() {
  const state = { instance: null, lastInst: null, cursor: null, rerender: false, iterations: 0 };

  const useEffect = (fn, deps) => {
    const inst = state.instance;
    const hook = (inst.hooks[state.cursor.index++] ??= {
      kind: 'effect',
      deps: undefined,
      cleanup: undefined,
    });
    const changed = hook.deps === undefined || !depsEqual(hook.deps, deps);
    hook.deps = deps;
    inst.effects.push({ hook, fn, changed });
  };

  const useState = (initial) => {
    const inst = state.instance;
    const hook = (inst.hooks[state.cursor.index++] ??= {
      kind: 'state',
      initialized: false,
      value: undefined,
    });
    if (!hook.initialized) {
      hook.value = typeof initial === 'function' ? initial() : initial;
      hook.initialized = true;
    }
    return [
      hook.value,
      (value) => {
        if (typeof value === 'function') hook.value = value(hook.value);
        else hook.value = value;
        state.rerender = true;
      },
    ];
  };

  const useRef = (initial) => {
    const inst = state.instance;
    const hook = (inst.hooks[state.cursor.index++] ??= {
      kind: 'ref',
      value: { current: initial },
    });
    return hook.value;
  };

  const createElement = (type, props, ...children) => {
    const p = { ...(props ?? {}) };
    if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
    return { type, props: p };
  };

  const pass = (inst) => {
    state.cursor = { index: 0 };
    state.rerender = false;
    inst.renders += 1;
    const tree = inst.component(inst.props);
    const effects = inst.effects;
    inst.effects = [];
    for (const { hook, fn, changed } of effects) {
      if (!changed) continue;
      if (typeof hook.cleanup === 'function') hook.cleanup();
      const result = fn();
      hook.cleanup = typeof result === 'function' ? result : undefined;
    }
    return tree;
  };

  const render = (component, props) => {
    const inst = {
      component,
      props,
      hooks: [],
      effects: [],
      renders: 0,
    };
    state.instance = inst;
    state.lastInst = inst;
    state.iterations = 0;
    let tree = pass(inst);
    while (state.rerender) {
      tree = pass(inst);
      state.iterations += 1;
      if (state.iterations > 50) {
        throw new Error('dsh-shortcuts harness: mini-react render loop did not settle');
      }
    }
    return tree;
  };

  // Event-driven re-render: a subscribed emit()/setState outside of render
  // marks the instance dirty; flush() settles it (mimics React scheduling).
  const flush = () => {
    const inst = state.lastInst;
    if (!inst) return;
    state.iterations = 0;
    let tree;
    while (state.rerender) {
      tree = pass(inst);
      state.iterations += 1;
      if (state.iterations > 50) {
        throw new Error('dsh-shortcuts harness: mini-react flush loop did not settle');
      }
    }
    return tree;
  };

  return {
    React: { createElement, useState, useEffect, useRef },
    render,
    flush,
  };
}

function depsEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** In-memory localStorage. */
export function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
  };
}

/** Browser fixture modelled on the pinned dsh family's actual DOM surfaces. */
export function makeBrowserFixture() {
  const events = new Map();
  const selectors = new Map();
  const selectorLists = new Map();
  const usage = { dom: [], dispatchEvent: [] };

  const mkElement = (spec = {}) => ({
    tagName: spec.tagName ?? 'DIV',
    isContentEditable: spec.isContentEditable ?? false,
    attrs: spec.attrs ?? {},
    focused: false,
    clicked: 0,
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    focus() {
      this.focused = true;
    },
    select() {},
    click() {
      this.clicked += 1;
    },
  });

  // Pinned dsh family DOM (dsh-v0.1.2-rc.1):
  // composer = contentEditable div with role textbox (ComposerContentEditable);
  // NO <textarea> exists in the conversation package.
  const composer = mkElement({
    tagName: 'DIV',
    isContentEditable: true,
    attrs: { role: 'textbox' },
  });
  // settings trigger button (ui-settings-general SettingsRoot).
  const settingsTrigger = mkElement({
    tagName: 'BUTTON',
    attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  // sidebar workspace search: type=text + localized placeholder (WorkspaceBrowser).
  const searchInput = mkElement({
    tagName: 'INPUT',
    attrs: { type: 'text', placeholder: '搜索会话…' },
  });

  selectors.set('textarea', null);
  selectors.set('[role="textbox"]', composer);
  selectors.set('button[aria-haspopup="dialog"]', settingsTrigger);
  selectorLists.set(
    'input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]',
    [searchInput],
  );

  const document = {
    querySelector(sel) {
      usage.dom.push('querySelector(' + JSON.stringify(sel) + ')');
      return selectors.get(sel) ?? null;
    },
    querySelectorAll(sel) {
      usage.dom.push('querySelectorAll(' + JSON.stringify(sel) + ')');
      return selectorLists.get(sel) ?? [];
    },
    createElement() {
      return mkElement({ tagName: 'STYLE' });
    },
    head: { append: () => {} },
    dispatchEvent(event) {
      usage.dispatchEvent.push(event);
    },
    exitFullscreen: async () => {
      usage.dom.push('exitFullscreen()');
    },
    get fullscreenElement() {
      return null;
    },
    documentElement: {
      requestFullscreen: async () => {
        usage.dom.push('requestFullscreen()');
      },
      scrollHeight: 0,
    },
    body: { scrollHeight: 0 },
  };

  const window = {
    events,
    localStorage: makeLocalStorage(),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout,
    scrollToCall: null,
    scrollTo(...args) {
      window.scrollToCall = args;
      usage.dom.push('scrollTo(' + args.length + ')');
    },
    addEventListener(type, fn, capture) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push({ fn, capture: capture === true });
    },
    removeEventListener(type, fn, capture) {
      const list = events.get(type);
      if (!list) return;
      const index = list.findIndex((e) => e.fn === fn && e.capture === (capture === true));
      if (index >= 0) list.splice(index, 1);
    },
  };

  const navigator = {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh)',
    clipboard: {
      written: [],
      async writeText(text) {
        navigator.clipboard.written.push(text);
      },
    },
  };

  return {
    document,
    window,
    navigator,
    usage,
    selectors,
    selectorLists,
    composer,
    settingsTrigger,
    searchInput,
  };
}

/** Dispatch one event to the window's listeners for a type. */
export function dispatch(harness, type, eventInit, target) {
  const { window } = harness.browser;
  const event = {
    ...{ key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false },
    ...eventInit,
    target: target ?? { tagName: 'BODY' },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  for (const entry of [...(window.events.get(type) ?? [])]) {
    entry.fn.call(window, event);
  }
  return event;
}

/** The pinned-dsh session facing (see dsh-shortcuts-dsh-api test for the oracle). */
export function makePinnedSessionsFixture({
  projections,
  listState,
  onBinding,
  onScope,
  usage,
  eventWindow,
} = {}) {
  const defaults = {
    ids: ['s1'],
    byId: {
      s1: {
        displayTitle: 'Demo session',
        cwd: '/work/uniterra',
        running: false,
        origin: undefined,
      },
    },
    current: 's1',
    phase: 'ready',
  };
  const listeners = new Set();
  const list = {
    getSnapshot: () => listState ?? defaults,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit: () => {
      for (const fn of [...listeners]) fn();
    },
  };
  const projectionStore = projections ?? {};
  const faceOf = (key) => {
    if (usage) usage.projections.push({ sessionId: 's1', key });
    return {
      getSnapshot: () => (key in projectionStore ? projectionStore[key] : undefined),
      subscribe: () => () => {},
    };
  };
  const sessionFace = {
    sessionId: 's1',
    projections: { faceOf },
    getSnapshot: () => ({ pendingSubmissions: [] }),
    cancel: async () => ({ ok: true }),
  };
  const conversationCalls = [];
  // Mutable event window the binding exposes (the pinned conversation carrier);
  // tests replace .entries to drive copy-last-message.
  const windowState = eventWindow ?? {
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
  };
  const binding = (id) => {
    if (onBinding) onBinding(id);
    return {
      sessionId: id,
      session: sessionFace,
      eventSource: {
        getSnapshot: () => windowState,
        subscribe: () => () => {},
      },
      ctx: {},
    };
  };
  const scope = (id) => {
    if (onScope) onScope(id);
    return {
      get: (name) =>
        name === 'conversation'
          ? {
              cancel: async () => {
                conversationCalls.push('cancel');
              },
            }
          : undefined,
    };
  };
  const createCalls = [];
  const fixture = {
    list,
    binding,
    scope,
    searchResultLimit: 50,
    conversationCalls,
    projectionStore,
    faceOf,
    sessionFace,
    eventWindow: windowState,
    open: (id) => {
      binding.openLast = id;
    },
    createCalls,
    async create(opts) {
      createCalls.push(opts ?? {});
      return 's1';
    },
  };
  binding.openLast = undefined;
  return fixture;
}

/**
 * The pinned-dsh workspaces face (IWorkspaces): archive via archiveSession;
 * session creation lives on ISessions.create — there is NO startSession.
 */
export function makePinnedWorkspacesFixture({ archiveSession, usage } = {}) {
  return {
    list: { getSnapshot: () => ({ rows: [] }), subscribe: () => () => {} },
    create: async () => ({}),
    rename: async () => ({}),
    delete: async () => {},
    insertBefore: async () => {},
    archiveSession: async (sessionId) => {
      if (archiveSession) archiveSession(sessionId);
    },
    insertSessionBefore: async () => ({}),
  };
}

/** Recorded plugin surface: every interesting call the plugin makes. */
export function createUsageRecorder() {
  return {
    calls: [],
    projections: [],
    slots: [],
    slotsRegisters: [],
    fetches: [],
    commandExecutes: 0,
    dom: [],
  };
}

/**
 * Deep recording proxy: every function call on a service object (and on the
 * objects it returns) lands in usage.calls as { svc, method, args }; a
 * missing property records a MISSING attempt and throws (the real dsh
 * contract's failure mode) so contract tests can detect dead seams.
 */
export function recordWrap(usage, name, value) {
  const cache = new Map();
  const wrap = (v, svcPath) => {
    if (v === null || typeof v !== 'object') return v;
    // Arrays are data, not service surfaces: their methods are iteration
    // helpers, never recorded dsh seams.
    if (Array.isArray(v)) return v;
    const cached = cache.get(v);
    if (cached) return cached;
    const proxy = new Proxy(v, {
      get(target, prop) {
        if (typeof prop === 'symbol') return target[prop];
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return (...args) => target[prop].apply(target, args);
        }
        const val = target[prop];
        if (typeof val === 'function') {
          return (...args) => {
            usage.calls.push({ svc: svcPath, method: String(prop), args, missing: false });
            const result = val.apply(target, args);
            return wrap(result, svcPath + '.' + String(prop));
          };
        }
        if (val !== null && typeof val === 'object') return wrap(val, svcPath + '.' + String(prop));
        if (val === undefined) {
          return function missingMember() {
            usage.calls.push({ svc: svcPath, method: String(prop), args: [], missing: true });
            throw new TypeError('fixture: ' + svcPath + '.' + String(prop) + ' is not a function');
          };
        }
        return val;
      },
    });
    cache.set(v, proxy);
    return proxy;
  };
  return wrap(value, name);
}

/** Assemble the full pinned fixture context used to apply() the plugin. */
export function makePinnedContext({ recorder } = {}) {
  const usage = recorder ?? createUsageRecorder();
  const projections = {
    permissions: {
      options: [
        { value: 'read-only', name: '只读' },
        { value: 'custom', name: 'Custom' },
        { value: 'workspace-write', name: '工作区写入' },
      ],
      currentValue: 'read-only',
    },
  };
  const sessions = makePinnedSessionsFixture({ projections, usage });
  const workspaces = makePinnedWorkspacesFixture({ usage });

  const slots = {
    inject(name, callback) {
      usage.slots.push(name);
      const disposer = callback();
      if (typeof disposer === 'function') return disposer;
      return () => {};
    },
    register(options, component) {
      usage.slotsRegisters.push({ ...options, component });
      return () => {};
    },
  };

  const themeState = {
    active: { id: 'dark', colorScheme: 'dark', tokens: {} },
    preference: 'dark',
    themes: [
      { id: 'light', colorScheme: 'light', tokens: {} },
      { id: 'dark', colorScheme: 'dark', tokens: {} },
    ],
    revision: 1,
  };
  const theme = {
    getTheme: () => themeState,
    setTheme: (id) => {
      themeState.preference = id;
      const found = themeState.themes.find((t) => t.id === id);
      if (found) themeState.active = found;
    },
  };

  const MODEL_GROUPS = [
    {
      id: 'g1',
      name: 'Grp One',
      models: [
        {
          id: 'm1',
          name: 'Model One',
          reasoning: {
            efforts: [
              { id: 'low', name: '低' },
              { id: 'medium', name: '中' },
              { id: 'high', name: '高' },
              { id: 'max', name: '最大' },
              { id: 'extreme', name: '极限' },
            ],
            defaultEffort: 'low',
          },
        },
        { id: 'm2', name: 'Model Two' },
      ],
    },
  ];
  const directory = {
    catalog: MODEL_GROUPS,
    store: {
      snap: {
        current: { provider: 'g1', model: 'm1', reasoningEffort: 'low' },
        routable: true,
        groups: MODEL_GROUPS,
        failures: [],
        status: 'ready',
        error: null,
      },
      getSnapshot() {
        return this.snap;
      },
      subscribe: () => () => {},
    },
    async load() {
      const state = this.store.getSnapshot();
      if (state.groups.length > 0) return state;
      return { ...state, groups: directory.catalog };
    },
    async select(selection) {
      directory.lastSelection = selection;
    },
  };
  const modelDirectories = { directoryFor: () => directory };

  const localeState = {
    active: 'zh',
    locales: [
      { id: 'zh', label: '中文' },
      { id: 'en', label: 'English' },
    ],
    revision: 1,
  };
  const locale = {
    getSnapshot: () => localeState,
    setLocale: (id) => {
      localeState.active = id;
    },
  };

  const layout = {
    calls: [],
    toggleSidebar() {
      layout.calls.push('toggleSidebar');
    },
    openDetails() {
      layout.calls.push('openDetails');
    },
    closeDetails() {
      layout.calls.push('closeDetails');
    },
  };

  const remote = {
    commands: {
      execute: () => {
        usage.commandExecutes += 1;
        return Promise.resolve({});
      },
    },
  };

  const convCancelCalls = [];
  const services = { sessions, workspaces, layout, theme, locale, modelDirectories, remote, slots };
  services.conversation = {
    cancel: async () => {
      convCancelCalls.push('cancel');
    },
  };

  const timerQueue = [];
  const ctx = {
    get: (name) =>
      recordWrap(
        usage,
        name,
        name === 'remote.commands' ? services.remote.commands : services[name],
      ),
    effect: (fn) => {
      const disposal = fn();
      return typeof disposal === 'function' ? disposal : () => {};
    },
    timeout: (fn, ms) => {
      const t = { fn, ms, active: true };
      timerQueue.push(t);
      return () => {
        t.active = false;
      };
    },
  };

  return {
    ctx,
    services,
    usage,
    timerQueue,
    directory,
    themeState,
    localeState,
    slots,
    sessions,
    workspaces,
    convCancelCalls,
    projections,
  };
}

/** Evaluate the vendored client bundle and return { plugin, browser, React }. */
export function loadShortcutsPlugin() {
  const code = exposeInternals(readFileSync(SHORTCUTS_CLIENT_PATH, 'utf8'));
  const browser = makeBrowserFixture();
  const miniReact = createMiniReact();
  const { React } = miniReact;

  let registration = null;
  const sandbox = {
    window: browser.window,
    document: browser.document,
    navigator: browser.navigator,
    console,
    KeyboardEvent: class KeyboardEvent {
      constructor(type, init) {
        this.type = type;
        this.bubbles = init && init.bubbles;
        this.key = init && init.key;
      }
    },
    fetch: async (url) => {
      browser.usage.fetches ??= [];
      browser.usage.fetches.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  browser.window.__ModuleLoader__ = {
    load(reg) {
      registration = reg;
    },
  };
  vm.runInNewContext(code, sandbox, { filename: SHORTCUTS_CLIENT_PATH });
  if (!registration) throw new Error('dsh-shortcuts harness: bundle never registered');

  const exported = registration.factory((specifier) => {
    if (specifier === 'react') return React;
    throw new Error('dsh-shortcuts harness: unexpected require("' + specifier + '")');
  });
  const plugin = {
    apply: exported.apply,
    inject: exported.inject,
    internals: exported[TEST_FACE],
  };
  if (typeof plugin.apply !== 'function') throw new Error('dsh-shortcuts harness: no apply export');
  return { plugin, browser, React: miniReact, sandbox };
}

/** Run apply() with fresh pinned fixtures. */
export function applyShortcutsPlugin() {
  const loaded = loadShortcutsPlugin();
  const pinned = makePinnedContext();
  loaded.plugin.apply(pinned.ctx);
  return { ...loaded, ...pinned };
}
