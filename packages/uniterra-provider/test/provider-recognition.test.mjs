/**
 * Provider-recognition properties: the two faces dsh's settings page resolves
 * our provider through — the configurable-provider directory entry that carries
 * `settingsNs`, and the live `llm-uniterra` settings section the page renders.
 *
 * dsh mounts the settings provider and third-party plugins in an order this
 * plugin does not control, so both faces must exist no matter which mounts
 * first. The property sweeps every order; the deterministic cases pin the
 * exact boot order that used to drop the section. All tests run on the built
 * `lib/` (the test script builds first).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context, Service } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SettingsProvider from '@deepseek-ai/dsh-settings';
import * as plugin from '../lib/index.js';

/** In-memory settings provider: the smallest real SettingsProvider subclass. */
class MemorySettings extends SettingsProvider {
  doc = {};

  constructor(ctx, options) {
    super(ctx);
    this.doc = structuredClone(options?.doc ?? {});
  }

  get writable() {
    return true;
  }

  load() {
    return Promise.resolve(structuredClone(this.doc));
  }

  async persist(ns, section) {
    this.doc[ns] = structuredClone(section);
  }
}

/** Minimal credentials service: resolve() only, from an in-memory store. */
class FakeCredentials extends Service {
  constructor(ctx, store) {
    super(ctx, 'credentials');
    this.store = store;
  }

  resolve(ref) {
    return Promise.resolve(
      this.store[ref] === undefined ? undefined : { value: this.store[ref], source: 'store' },
    );
  }
}

async function mountPlugin(ctx, config = {}) {
  return ctx.plugin(
    {
      name: plugin.name,
      inject: plugin.inject,
      Config: plugin.Config,
      apply: plugin.apply,
    },
    config,
  );
}

/** Stub fetch to answer a models listing and record the request. */
function stubModelsListing() {
  const originalFetch = globalThis.fetch;
  const asked = { url: '', auth: '' };
  globalThis.fetch = async (url, init) => {
    asked.url = String(url);
    asked.auth = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(
      JSON.stringify({ object: 'list', data: [{ id: 'deepseek-chat' }, { id: 'gemini-2.5-pro' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return {
    asked,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/** A macrotask turn: cordis flushes deferred inject callbacks off the stack. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const NS = 'llm-uniterra';

/** The orders dsh can boot in: the settings provider attaches first or last. */
const MOUNT_ORDERS = ['settings-before-plugin', 'settings-after-plugin'];

test('property: the section and the directory entry exist under every mount order', async () => {
  for (const order of MOUNT_ORDERS) {
    for (let run = 0; run < 6; run += 1) {
      const label = `${order} run ${String(run)}`;
      const stored =
        run % 2 === 0 ? { baseURL: `http://stored-${String(run)}.local:9000/v1` } : undefined;
      const ctx = new Context();
      await ctx.plugin(LlmRuntime);
      if (order === 'settings-before-plugin') {
        await ctx.plugin(MemorySettings, stored === undefined ? {} : { doc: { [NS]: stored } });
      }
      await ctx.plugin(FakeCredentials, { uniterra: `key-${order}-${String(run)}` });
      await mountPlugin(ctx);
      if (order === 'settings-after-plugin') {
        await ctx.plugin(MemorySettings, stored === undefined ? {} : { doc: { [NS]: stored } });
      }
      await settle();

      const directory = ctx.llm.listConfigurableProviders();
      assert.equal(directory.length, 1, `${label}: exactly our provider is declared`);
      assert.deepEqual(
        {
          provider: directory[0].provider,
          settingsNs: directory[0].settingsNs,
          declared: directory[0].declared,
        },
        { provider: 'uniterra', settingsNs: NS, declared: true },
        `${label}: the directory entry is what the settings page resolves`,
      );

      const sections = ctx.settings.describe();
      assert.deepEqual(
        sections.map((section) => section.ns),
        [NS],
        `${label}: the section must register for the settings page to render it`,
      );
      if (stored !== undefined) {
        assert.equal(
          sections[0].value.baseURL,
          stored.baseURL,
          `${label}: a stored user section must win over the composition base`,
        );
      }

      const baseURL = `http://live-${order}-${String(run)}.local:9000/v1`;
      await ctx.settings.update(NS, { baseURL });
      const listing = stubModelsListing();
      try {
        await ctx.llm.discoverModels(NS, { provider: 'uniterra' });
      } finally {
        listing.restore();
      }
      assert.equal(
        listing.asked.url,
        `${baseURL}/models`,
        `${label}: the section value must reach the adapter`,
      );
    }
  }
});

test('property: losing the settings provider falls back to the composition config', async () => {
  for (let run = 0; run < 4; run += 1) {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    const settingsFiber = ctx.plugin(MemorySettings, {});
    await settingsFiber;
    await ctx.plugin(FakeCredentials, { uniterra: 'fallback-key' });
    const modelId = `catalog-${String(run)}`;
    await mountPlugin(ctx, {
      models: [{ id: modelId, name: 'Catalog Model', contextWindow: 8192 }],
    });
    await settle();
    await settingsFiber.dispose();
    await settle();

    const ids = (await ctx.llm.listModels('uniterra')).map((model) => model.id);
    assert.deepEqual(
      ids,
      [modelId],
      `run ${String(run)}: the composition catalog must keep serving`,
    );
  }
});

test('regression: the llm-uniterra section registers when the settings provider mounts after the plugin', async () => {
  // The real dsh boot order: the plugin applies first, the settings provider
  // arrives later. An apply-time ctx.get('settings') saw undefined here and the
  // namespace was never registered, so the settings page had no section to load.
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(FakeCredentials, { uniterra: 'late-settings-key' });
  await mountPlugin(ctx);
  await ctx.plugin(MemorySettings, { doc: { [NS]: { baseURL: 'http://stored.local:9000/v1' } } });
  await settle();

  assert.deepEqual(
    ctx.settings.describe().map((section) => section.ns),
    [NS],
  );
  await ctx.settings.update(NS, { baseURL: 'http://written.local:9000/v1' });
  const listing = stubModelsListing();
  try {
    await ctx.llm.discoverModels(NS, { provider: 'uniterra' });
  } finally {
    listing.restore();
  }
  assert.equal(listing.asked.url, 'http://written.local:9000/v1/models');
});

test('regression: the directory entry declares llm-uniterra with the settings provider mounted late', async () => {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await mountPlugin(ctx);
  await ctx.plugin(MemorySettings, {});
  await settle();

  assert.deepEqual(
    ctx.llm
      .listConfigurableProviders()
      .map((entry) => ({ provider: entry.provider, settingsNs: entry.settingsNs })),
    [{ provider: 'uniterra', settingsNs: NS }],
  );
});
