/**
 * Image-modality properties: a catalog row's declared input modalities must
 * survive into the model directory (dsh projects images to text for any model
 * whose modalities exclude image), and a request carrying an image must reach
 * the gateway with the exact stored bytes — for every model, byte length, and
 * protocol the catalog can declare. A text-only row must keep the harness's
 * deterministic text placeholder instead of silently losing the attachment.
 *
 * The sibling attachment modality is the FILE block the 0.1.5 family adds: no
 * provider ever receives file bytes, so a file must ride the wire as the
 * family's deterministic handle text — the projection request assembly applies
 * to every route, and the adapter's own fallback for a block that bypassed that
 * assembly.
 *
 * The property sweeps the catalog and the bytes; the deterministic cases pin
 * the exact wire shapes (chat `image_url` data URL, responses `input_image`,
 * the text-only projection, and the file handle on both protocols). All tests
 * run on the built `lib/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context, Service } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import * as plugin from '../lib/index.js';

/** In-memory credentials service: resolve() only. */
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

/** In-memory attachment service: readImageRequest() over a fixed byte store. */
class FakeAttachments extends Service {
  constructor(ctx, images) {
    super(ctx, 'attachments');
    this.images = images;
    this.reads = [];
  }

  readImageRequest(ref, policy, signal) {
    signal?.throwIfAborted();
    this.reads.push({ ref, policy });
    const entry = this.images.get(ref.attachmentId);
    if (entry === undefined)
      return Promise.reject(new Error(`unknown attachment ${ref.attachmentId}`));
    return Promise.resolve({
      variantId: `variant:${ref.attachmentId}`,
      attachment: ref,
      data: entry,
      mediaType: ref.mediaType,
      bytes: entry.length,
      width: ref.width,
      height: ref.height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: false,
    });
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

/** Deterministic 32-bit PRNG so failing counterexamples are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REF = {
  attachmentId: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  mediaType: 'image/png',
  bytes: 12,
  width: 2,
  height: 2,
  name: 'shot.png',
};
const IMAGE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const DATA_URL = `data:image/png;base64,${Buffer.from(IMAGE_BYTES).toString('base64')}`;

/** The one user message every request in this file carries. */
const USER_MESSAGE = {
  id: 'm1',
  role: 'user',
  source: { kind: 'user' },
  content: [
    { type: 'text', text: 'what is in this image?' },
    { type: 'image', attachment: REF },
  ],
};

/** Stub fetch to capture the outgoing request body and answer a valid SSE stream. */
function stubStreamingFetch(protocol) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const payloads =
      protocol === 'responses'
        ? [
            { type: 'response.output_text.delta', item_id: 'i1', output_index: 0, delta: 'ok' },
            {
              type: 'response.completed',
              response: {
                id: 'resp_1',
                status: 'completed',
                output: [],
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            },
          ]
        : [{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const payload of payloads)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        if (protocol !== 'responses') controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/** Drive one real LLM call end to end and return the captured wire bodies. */
async function drive({
  models,
  model,
  protocol = 'chat-completions',
  images = new Map([[REF.attachmentId, IMAGE_BYTES]]),
  messages = [USER_MESSAGE],
}) {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(FakeCredentials, { uniterra: 'image-key' });
  await ctx.plugin(FakeAttachments, images);
  await mountPlugin(ctx, { baseURL: 'http://gw.local:9000/v1', api: protocol, models });
  const wire = stubStreamingFetch(protocol);
  try {
    for await (const chunk of ctx.llm.stream({
      provider: 'uniterra',
      model,
      messages,
    })) {
      assert.notEqual(chunk.type, 'error', `stream failed: ${JSON.stringify(chunk)}`);
    }
  } finally {
    wire.restore();
  }
  return wire.calls;
}

/** Every image part the chat wire carries, in order. */
const chatImageParts = (body) =>
  (body.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((part) => part.type === 'image_url');

test('property: declared input modalities reach the model directory verbatim', async () => {
  const rand = mulberry32(0x1a9e);
  for (let run = 0; run < 8; run += 1) {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(FakeCredentials, { uniterra: 'directory-key' });
    const models = [];
    const expected = new Map();
    const rows = 1 + Math.floor(rand() * 4);
    for (let index = 0; index < rows; index += 1) {
      const id = `model-${String(run)}-${String(index)}`;
      const declared = rand() < 0.5 ? ['text', 'image'] : ['text'];
      const row = { id, name: `Model ${String(index)}`, contextWindow: 8192 };
      if (rand() < 0.8) row.inputModalities = declared;
      models.push(row);
      expected.set(id, row.inputModalities ?? ['text']);
    }
    await mountPlugin(ctx, { models });

    for (const info of await ctx.llm.listModels('uniterra')) {
      assert.deepEqual(
        info.inputModalities,
        expected.get(info.id),
        `run ${String(run)} model ${info.id}: the directory must report the declared modalities`,
      );
    }
    assert.equal(new Set(models.map((row) => row.id)).size, expected.size);
  }
});

test('property: an image request reaches the wire exactly when the model declares image input', async () => {
  const rand = mulberry32(0x1a9e2);
  for (let run = 0; run < 6; run += 1) {
    const modelId = `vision-${String(run)}`;
    const imageCapable = run % 2 === 0;
    const models = [
      {
        id: modelId,
        name: 'Vision',
        contextWindow: 8192,
        inputModalities: imageCapable ? ['text', 'image'] : ['text'],
      },
    ];
    const bytes = Uint8Array.from(
      { length: 1 + Math.floor(rand() * 8) },
      (_, index) => (index * 37 + run) % 256,
    );
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    const images = new Map([[REF.attachmentId, bytes]]);
    const calls = await drive({ models, model: modelId, images });
    assert.equal(calls.length, 1, `run ${String(run)}: exactly one gateway call`);
    const serialized = JSON.stringify(calls[0].body);

    if (imageCapable) {
      assert.deepEqual(
        chatImageParts(calls[0].body).map((part) => part.image_url.url),
        [dataUrl],
        `run ${String(run)}: the declared image must ride the wire byte-for-byte`,
      );
      assert.ok(
        serialized.includes('what is in this image?'),
        `run ${String(run)}: text must stay`,
      );
      assert.ok(
        !serialized.includes('image omitted'),
        `run ${String(run)}: no projection for a declared model`,
      );
    } else {
      assert.deepEqual(
        chatImageParts(calls[0].body),
        [],
        `run ${String(run)}: a text-only model must not receive image parts`,
      );
      assert.ok(
        serialized.includes(
          '[image omitted because this model accepts text only; attachment sha256:01234567]',
        ),
        `run ${String(run)}: the text-only projection must replace the image`,
      );
    }
  }
});

test('regression: an image-declared model sends the chat image_url data URL with the exact bytes', async () => {
  const calls = await drive({
    models: [
      { id: 'vision', name: 'Vision', contextWindow: 8192, inputModalities: ['text', 'image'] },
    ],
    model: 'vision',
  });
  assert.deepEqual(chatImageParts(calls[0].body), [
    { type: 'image_url', image_url: { url: DATA_URL } },
  ]);
  assert.equal(calls[0].url, 'http://gw.local:9000/v1/chat/completions');
});

test('regression: an image-declared model sends input_image on the responses protocol', async () => {
  const calls = await drive({
    models: [
      { id: 'vision', name: 'Vision', contextWindow: 8192, inputModalities: ['text', 'image'] },
    ],
    model: 'vision',
    protocol: 'responses',
  });
  const parts = (calls[0].body.input ?? []).flatMap((item) =>
    Array.isArray(item.content) ? item.content : [],
  );
  assert.deepEqual(
    parts.filter((part) => part.type === 'input_image').map((part) => part.image_url),
    [DATA_URL],
  );
  assert.ok(
    parts.some((part) => part.type === 'input_text' && part.text === 'what is in this image?'),
  );
});

test('regression: a text-only model receives the harness text placeholder instead of the image', async () => {
  const calls = await drive({
    models: [{ id: 'plain', name: 'Plain', contextWindow: 8192, inputModalities: ['text'] }],
    model: 'plain',
  });
  const serialized = JSON.stringify(calls[0].body);
  assert.deepEqual(chatImageParts(calls[0].body), []);
  assert.ok(
    serialized.includes(
      '[image omitted because this model accepts text only; attachment sha256:01234567]',
    ),
  );
  assert.ok(!serialized.includes('base64'));
});

test('regression: a model absent from the catalog stays text-only', async () => {
  const calls = await drive({ models: [], model: 'undeclared' });
  assert.deepEqual(chatImageParts(calls[0].body), []);
  assert.ok(
    JSON.stringify(calls[0].body).includes('[image omitted because this model accepts text only;'),
  );
});

/** The one durable file the file cases carry; its bytes never leave the harness. */
const FILE_REF = {
  attachmentId: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  name: 'notes.md',
  bytes: 42,
};

/** dsh's handle for a file whose execution-world read path is unresolvable. */
const FILE_HANDLE =
  '[File "notes.md" (42 bytes, sha256:fedcba98) was uploaded, but the current execution ' +
  'environment cannot access a readable path. Report that limitation if its contents are ' +
  'needed; do not claim to have read it.]';

/** A user message whose content mixes text with the durable file reference. */
const FILE_MESSAGE = {
  id: 'm-file',
  role: 'user',
  source: { kind: 'user' },
  content: [
    { type: 'text', text: 'summarize this file' },
    { type: 'file', attachment: FILE_REF },
  ],
};

test('regression: an uploaded file reaches the gateway as the family file handle, not bytes', async () => {
  // Request assembly projects every file block to handle text before any
  // adapter is dispatched; the file the user attached must therefore reach the
  // wire as that text — and never as an image part or encoded bytes.
  const calls = await drive({
    models: [{ id: 'plain', name: 'Plain', contextWindow: 8192 }],
    model: 'plain',
    messages: [FILE_MESSAGE],
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].body.messages.map((message) => message.content),
    [`summarize this file${FILE_HANDLE}`],
  );
  assert.ok(!JSON.stringify(calls[0].body).includes('base64'));
});

test('regression: a file block the request assembly did not project rides as the family handle on both protocols', async () => {
  // The serializers are public API as well: a caller that hands them a raw file
  // block must not lose the user's upload. The adapter has no execution-world
  // path resolver, so it renders the same family handle with the path
  // unresolved.
  const chat = plugin.serializeChatRequest({ model: 'plain', messages: [FILE_MESSAGE] });
  assert.deepEqual(chat.messages, [{ role: 'user', content: `summarize this file${FILE_HANDLE}` }]);

  const responses = plugin.serializeResponsesRequest({ model: 'plain', messages: [FILE_MESSAGE] });
  assert.deepEqual(responses.input, [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'summarize this file' },
        { type: 'input_text', text: FILE_HANDLE },
      ],
    },
  ]);
});
