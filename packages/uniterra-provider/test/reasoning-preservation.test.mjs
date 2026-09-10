/**
 * Reasoning-preservation regression + property tests for the dual-protocol
 * translators. The business invariant: NO content the wire emits may be
 * silently dropped — every non-empty reasoning/text/tool-call fragment must
 * reach the harness, for every wire shape real OpenAI-compatible gateways use.
 *
 * Reasoning wire shapes covered (verified against the OpenAI API reference and
 * the openai-node / litellm type definitions):
 *  - Chat Completions: `delta.reasoning_content` (DeepSeek/Qwen/GLM style),
 *    `delta.reasoning` (OpenRouter/aggregator style), and the final-chunk
 *    `message.reasoning_content` full-text replay (DashScope compatible mode).
 *  - Responses API: `response.reasoning_text.delta`/`done`,
 *    `response.reasoning_summary_text.delta`/`done` (OpenAI o-series),
 *    `response.output_item.added`/`done` with a `reasoning` item
 *    (`content`/`summary` parts), `response.content_part.added`/`done` with
 *    `reasoning_text` parts, and the authoritative `response.output` array on
 *    `response.completed`.
 *
 * The seeded property tests generate arbitrary interleavings of those shapes
 * and assert the translated blocks equal exactly the wire content (no loss, no
 * duplication). The deterministic cases pin each concrete real-world shape.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  serializeChatRequest,
  serializeResponsesRequest,
  translateChat,
  translateResponses,
} from '../lib/index.js';

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

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/** Concatenate every block-end text of one block type, in emission order. */
function blockTexts(chunks, type) {
  return chunks
    .filter((chunk) => chunk.type === 'block-end' && chunk.block.type === type)
    .map((chunk) => chunk.block.text);
}

// ── Deterministic regression cases (one per wire shape) ────────────────────

test('chat: delta.reasoning (OpenRouter/aggregator style) is preserved', async () => {
  const chunks = await collect(
    translateChat(
      (async function* () {
        yield JSON.stringify({ choices: [{ delta: { reasoning: 'think ' } }] });
        yield JSON.stringify({ choices: [{ delta: { reasoning: 'hard' } }] });
        yield JSON.stringify({ choices: [{ delta: { content: 'answer' } }] });
        yield '[DONE]';
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['think hard']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['answer']);
});

test('chat: final-chunk message.reasoning_content (DashScope style) is preserved', async () => {
  const chunks = await collect(
    translateChat(
      (async function* () {
        yield JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] });
        yield JSON.stringify({ choices: [{ delta: { content: 'the answer' } }] });
        yield JSON.stringify({
          choices: [
            { delta: {}, finish_reason: 'stop', message: { reasoning_content: 'full think' } },
          ],
        });
        yield '[DONE]';
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['full think']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['the answer']);
});

test('responses: reasoning_summary_text.delta (OpenAI o-series style) is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'rs_1', summary: [] },
        });
        yield JSON.stringify({
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_1',
          output_index: 0,
          summary_index: 0,
          delta: 'summar',
        });
        yield JSON.stringify({
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_1',
          output_index: 0,
          summary_index: 0,
          delta: 'ized',
        });
        yield JSON.stringify({
          type: 'response.output_text.delta',
          item_id: 'm1',
          output_index: 1,
          delta: 'answer',
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['summarized']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['answer']);
});

test('responses: complete reasoning output item without deltas is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'partial' }],
          },
        });
        yield JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'reasoning',
            id: 'rs_1',
            content: [{ type: 'reasoning_text', text: 'deep think ' }],
            summary: [{ type: 'summary_text', text: 'summary here' }],
          },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['deep think summary here']);
});

test('responses: content_part reasoning_text parts are preserved', async () => {
  // Real gateways send the complete part on `added` and repeat it on `done`;
  // the translator must keep the part without duplicating it…
  const streamed = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.content_part.added',
          item_id: 'rs_1',
          output_index: 0,
          part: { type: 'reasoning_text', text: 'part one' },
        });
        yield JSON.stringify({
          type: 'response.content_part.done',
          item_id: 'rs_1',
          output_index: 0,
          part: { type: 'reasoning_text', reasoning: 'part one' },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(streamed, 'reasoning'), ['part one']);

  // …and a done-only part (no added event) still surfaces its full text.
  const doneOnly = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.content_part.done',
          item_id: 'rs_2',
          output_index: 0,
          part: { type: 'reasoning_text', reasoning: 'only done' },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(doneOnly, 'reasoning'), ['only done']);
});

test('responses: reasoning_text.done with full text and no deltas is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.reasoning_text.done',
          item_id: 'rs_1',
          output_index: 0,
          text: 'whole think',
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['whole think']);
});

test('responses: reasoning carried only in response.completed output is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'r1',
            status: 'completed',
            output: [
              {
                type: 'reasoning',
                id: 'rs_1',
                summary: [{ type: 'summary_text', text: 'only at the end' }],
              },
              {
                type: 'message',
                id: 'm1',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'final answer' }],
              },
            ],
          },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['only at the end']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['final answer']);
});

test('responses: streamed deltas are not duplicated by the done/completed replay', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.reasoning_text.delta',
          item_id: 'rs_1',
          output_index: 0,
          delta: 'one ',
        });
        yield JSON.stringify({
          type: 'response.reasoning_text.delta',
          item_id: 'rs_1',
          output_index: 0,
          delta: 'two',
        });
        yield JSON.stringify({
          type: 'response.reasoning_text.done',
          item_id: 'rs_1',
          output_index: 0,
          text: 'one two',
        });
        yield JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'reasoning',
            id: 'rs_1',
            content: [{ type: 'reasoning_text', text: 'one two' }],
            summary: [{ type: 'summary_text', text: 'dup' }],
          },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'r1',
            status: 'completed',
            output: [
              {
                type: 'reasoning',
                id: 'rs_1',
                content: [{ type: 'reasoning_text', text: 'one two' }],
                summary: [{ type: 'summary_text', text: 'dup' }],
              },
            ],
          },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['one two']);
});

test('chat: final-chunk message.content replay (buffered gateway) is preserved', async () => {
  const chunks = await collect(
    translateChat(
      (async function* () {
        yield JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] });
        yield JSON.stringify({
          choices: [
            {
              delta: {},
              finish_reason: 'stop',
              message: { content: 'buffered answer' },
            },
          ],
        });
        yield '[DONE]';
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'text'), ['buffered answer']);
});

test('chat: final-chunk message.tool_calls replay (buffered gateway) is preserved', async () => {
  const chunks = await collect(
    translateChat(
      (async function* () {
        yield JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] });
        yield JSON.stringify({
          choices: [
            {
              delta: {},
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [
                  { index: 0, id: 't9', function: { name: 'f1', arguments: '{"a":1}' } },
                ],
              },
            },
          ],
        });
        yield '[DONE]';
      })(),
    ),
  );
  const toolBlock = chunks.find(
    (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
  );
  assert.equal(toolBlock.block.id, 't9');
  assert.equal(toolBlock.block.name, 'f1');
  assert.equal(toolBlock.block.arguments, '{"a":1}');
});

test('chat: streamed deltas are not duplicated by a final message replay', async () => {
  const chunks = await collect(
    translateChat(
      (async function* () {
        yield JSON.stringify({ choices: [{ delta: { reasoning_content: 'think' } }] });
        yield JSON.stringify({ choices: [{ delta: { content: 'streamed' } }] });
        yield JSON.stringify({
          choices: [
            {
              delta: {},
              finish_reason: 'stop',
              message: { reasoning_content: 'think', content: 'streamed' },
            },
          ],
        });
        yield '[DONE]';
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['think']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['streamed']);
});

test('responses: reasoning_summary_part.done with full text and no deltas is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.reasoning_summary_part.done',
          item_id: 'rs_1',
          output_index: 0,
          summary_index: 0,
          part: { type: 'summary_text', text: 'part summary' },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['part summary']);
});

test('responses: content_part.done output_text part with no deltas is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.content_part.done',
          item_id: 'm1',
          output_index: 0,
          part: { type: 'output_text', text: 'whole part' },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'text'), ['whole part']);
});

test('responses: incomplete response still materializes its buffered output', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.incomplete',
          response: {
            incomplete_details: { reason: 'max_output_tokens' },
            output: [
              {
                type: 'reasoning',
                id: 'rs_1',
                summary: [{ type: 'summary_text', text: 'half think' }],
              },
              {
                type: 'message',
                id: 'm1',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'half answer' }],
              },
            ],
          },
        });
      })(),
    ),
  );
  assert.deepEqual(blockTexts(chunks, 'reasoning'), ['half think']);
  assert.deepEqual(blockTexts(chunks, 'text'), ['half answer']);
  const finish = chunks.find((chunk) => chunk.type === 'finish');
  assert.equal(finish.reason.kind, 'error');
});

test('responses: buffered function_call arriving only in response.completed is preserved', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'r1',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'get_weather',
                arguments: '{"city":"x"}',
              },
            ],
          },
        });
      })(),
    ),
  );
  const toolBlock = chunks.find(
    (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
  );
  assert.equal(toolBlock.block.id, 'call_1');
  assert.equal(toolBlock.block.name, 'get_weather');
  assert.equal(toolBlock.block.arguments, '{"city":"x"}');
});

test('agent-loop: Responses translation adopts the upstream call_id as the tool-call id', async () => {
  // The replayed function_call.call_id must be the id the gateway minted — its
  // own ids ride thinking-mode continuations alone, while a foreign id (the
  // per-response item UUID) forces a reasoning passback; the item id is only
  // the fallback for gateways that omit `call_id`.
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.output_item.added',
          output_index: 2,
          item: {
            type: 'function_call',
            id: 'fc_item_1',
            status: 'in_progress',
            call_id: 'call_00_TEST1234567890',
            name: 'f',
            arguments: '',
          },
        });
        yield JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_item_1',
          output_index: 2,
          delta: '{"a":',
        });
        yield JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_item_1',
          output_index: 2,
          delta: '1}',
        });
        yield JSON.stringify({
          type: 'response.function_call_arguments.done',
          item_id: 'fc_item_1',
          output_index: 2,
          arguments: '{"a":1}',
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  assert.deepEqual(
    chunks.filter((chunk) => chunk.type === 'tool-call-delta').map((chunk) => chunk.id),
    ['call_00_TEST1234567890', 'call_00_TEST1234567890'],
  );
  const toolBlock = chunks.find(
    (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
  );
  assert.equal(toolBlock.block.id, 'call_00_TEST1234567890');
  assert.equal(toolBlock.block.name, 'f');
  assert.equal(toolBlock.block.arguments, '{"a":1}');
});

test('agent-loop: Responses translation falls back to the item id when call_id is absent', async () => {
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_item_2',
          output_index: 0,
          delta: '{}',
        });
        yield JSON.stringify({
          type: 'response.function_call_arguments.done',
          item_id: 'fc_item_2',
          output_index: 0,
          arguments: '{}',
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  const toolBlock = chunks.find(
    (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
  );
  assert.equal(toolBlock.block.id, 'fc_item_2');
});

test('agent-loop: Responses tool-call ids survive the translate → serialize round trip', async () => {
  // The production chain: the gateway streams a function_call whose item id is
  // a per-response UUID and whose call_id is what the gateway mints; the
  // harness stores the translated block and replays it on the next request.
  // The replayed function_call/function_call_output must carry the gateway's
  // own call_id — a foreign id demands a reasoning passback instead.
  const chunks = await collect(
    translateResponses(
      (async function* () {
        yield JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'function_call',
            id: 'fc_item_3',
            status: 'in_progress',
            call_id: 'call_00_ROUNDTRIP',
            name: 'f',
            arguments: '',
          },
        });
        yield JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_item_3',
          output_index: 0,
          delta: '{}',
        });
        yield JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'function_call',
            id: 'fc_item_3',
            status: 'completed',
            call_id: 'call_00_ROUNDTRIP',
            name: 'f',
            arguments: '{}',
          },
        });
        yield JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [] },
        });
      })(),
    ),
  );
  const block = chunks.find(
    (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
  ).block;
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'assistant', content: [block] },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: block.id, content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    {
      type: 'reasoning',
      id: 'reasoning_0',
      content: [{ type: 'reasoning_text', text: ' ' }],
      summary: [{ type: 'summary_text', text: ' ' }],
    },
    { type: 'function_call', call_id: 'call_00_ROUNDTRIP', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_00_ROUNDTRIP', output: 'ok' },
  ]);
});

// ── Agent-loop round-trip: history serialization ───────────────────────────
//
// The harness keeps reasoning blocks in the assistant history verbatim (see
// dsh-session's deriveEventMessage); the adapter must replay them on the wire
// so gateways that mandate it (DeepSeek chat tool-call turns) or benefit from
// it (Responses API conversation state) never see a truncated transcript.

test('agent-loop: Responses serialization round-trips assistant reasoning as a reasoning item', () => {
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'solve' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think step 1' },
          { type: 'text', text: 'the answer' },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'solve' }] },
    {
      type: 'reasoning',
      id: 'reasoning_1',
      content: [{ type: 'reasoning_text', text: 'think step 1' }],
      summary: [{ type: 'summary_text', text: 'think step 1' }],
    },
    { role: 'assistant', content: [{ type: 'output_text', text: 'the answer' }] },
  ]);
});

test('agent-loop: Chat serialization replays reasoning_content on tool-call turns', () => {
  const wire = serializeChatRequest({
    model: 'm1',
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  const assistant = wire.messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.reasoning_content, 'think');
  assert.deepEqual(assistant.tool_calls, [
    { id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } },
  ]);
});

test('agent-loop: Chat serialization sends an empty reasoning marker on later tool-call turns', () => {
  // DeepSeek thinking mode is all-or-nothing: once any assistant message
  // carries reasoning_content, every later tool-call message must carry the
  // field too — a turn the model answered without reasoning (reasoning_tokens
  // 0) must round-trip as the empty marker, or the next request fails with
  // "The `reasoning_content` … must be passed back to the API".
  const wire = serializeChatRequest({
    model: 'm1',
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c2', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  const assistants = wire.messages.filter((message) => message.role === 'assistant');
  assert.equal(assistants[0].reasoning_content, 'think');
  assert.equal(assistants[1].reasoning_content, '');
});

test('agent-loop: Chat serialization keeps reasoning on plain turns once thinking is active', () => {
  const wire = serializeChatRequest({
    model: 'm1',
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'first answer' },
        ],
      },
    ],
  });
  const assistant = wire.messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.reasoning_content, 'think');
  assert.equal(assistant.content, 'first answer');
});

test('agent-loop: Responses serialization replays reasoning on tool-call turns', () => {
  // DeepSeek's Responses API in thinking mode rejects a multi-turn tool-call
  // continuation with "The `reasoning_text` … must be passed back to the API"
  // unless the prior turn's chain-of-thought is replayed as a `reasoning`
  // input item BEFORE the function_call items. The adapter must not drop it.
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'solve' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'solve' }] },
    {
      type: 'reasoning',
      id: 'reasoning_1',
      content: [{ type: 'reasoning_text', text: 'think' }],
      summary: [{ type: 'summary_text', text: 'think' }],
    },
    { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: 'ok' },
  ]);
});

test('agent-loop: Responses serialization carries reasoning forward on reasoningless tool-call turns', () => {
  // DeepSeek's Responses API in thinking mode rejects the continuation of any
  // tool-call turn that lacks reasoning_text — including a turn the model
  // answered with zero reasoning (empty reasoning items are rejected too).
  // The serializer must carry the conversation's most recent real chain of
  // thought forward onto such turns.
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'solve' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c2', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '' },
          { type: 'tool-call', id: 'c3', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c3', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'solve' }] },
    {
      type: 'reasoning',
      id: 'reasoning_1',
      content: [{ type: 'reasoning_text', text: 'think' }],
      summary: [{ type: 'summary_text', text: 'think' }],
    },
    { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: 'ok' },
    {
      type: 'reasoning',
      id: 'reasoning_4',
      content: [{ type: 'reasoning_text', text: 'think' }],
      summary: [{ type: 'summary_text', text: 'think' }],
    },
    { type: 'function_call', call_id: 'c2', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c2', output: 'ok' },
    {
      type: 'reasoning',
      id: 'reasoning_7',
      content: [{ type: 'reasoning_text', text: 'think' }],
      summary: [{ type: 'summary_text', text: 'think' }],
    },
    { type: 'function_call', call_id: 'c3', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c3', output: 'ok' },
  ]);
});

test('agent-loop: Responses serialization carries a placeholder chain of thought onto a tool-call turn before any reasoning', () => {
  // A first-turn tool call whose answer produced no reasoning still needs a
  // non-empty reasoning item: DeepSeek's Responses API rejects the
  // continuation of any tool-call turn without reasoning_text, and when no
  // chain of thought exists yet the placeholder keeps the continuation valid.
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'solve' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'starting' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'solve' }] },
    {
      type: 'reasoning',
      id: 'reasoning_1',
      content: [{ type: 'reasoning_text', text: ' ' }],
      summary: [{ type: 'summary_text', text: ' ' }],
    },
    { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: 'ok' },
  ]);
});

test('agent-loop: Chat serialization carries the empty reasoning marker on a tool-call turn before any reasoning', () => {
  // DeepSeek's chat thinking mode rejects the continuation of a tool-call turn
  // whose replayed call id it cannot recognize without `reasoning_content` —
  // the empty marker satisfies it (and other gateways ignore the field).
  const wire = serializeChatRequest({
    model: 'm1',
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'starting' },
          { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.messages, [
    {
      role: 'assistant',
      content: 'starting',
      reasoning_content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
  ]);
});

test('agent-loop: Responses serialization carries a reasoning item onto every tool-call turn of a run that produced no reasoning yet', () => {
  // The f2e8-class counterexample: several tool-call turns before the model's
  // first chain of thought. The gateway rejects a continuation whose replayed
  // call id it did not mint without reasoning_text, so EVERY early turn needs
  // its own reasoning item — the placeholder until a real one exists.
  const wire = serializeResponsesRequest({
    model: 'm1',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'solve' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c2', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'solve' }] },
    {
      type: 'reasoning',
      id: 'reasoning_1',
      content: [{ type: 'reasoning_text', text: ' ' }],
      summary: [{ type: 'summary_text', text: ' ' }],
    },
    { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: 'ok' },
    {
      type: 'reasoning',
      id: 'reasoning_4',
      content: [{ type: 'reasoning_text', text: ' ' }],
      summary: [{ type: 'summary_text', text: ' ' }],
    },
    { type: 'function_call', call_id: 'c2', name: 'f', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c2', output: 'ok' },
  ]);
});

test('agent-loop: Chat serialization carries the empty reasoning marker on every tool-call turn of a run that produced no reasoning yet', () => {
  const wire = serializeChatRequest({
    model: 'm1',
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c2', name: 'f', arguments: '{}' }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
  });
  assert.deepEqual(wire.messages, [
    {
      role: 'assistant',
      content: '',
      reasoning_content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    {
      role: 'assistant',
      content: '',
      reasoning_content: '',
      tool_calls: [{ id: 'c2', type: 'function', function: { name: 'f', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c2', content: 'ok' },
  ]);
});

test('property: Responses serialization never drops assistant reasoning', () => {
  const rand = mulberry32(0x5eed);
  const pick = (items) => items[Math.floor(rand() * items.length)];

  for (let run = 0; run < 300; run += 1) {
    const messages = [];
    const expectedReasoning = [];
    const turnCount = 1 + Math.floor(rand() * 6);
    let lastReasoning = '';
    for (let turn = 0; turn < turnCount; turn += 1) {
      const content = [];
      if (rand() < 0.7) {
        const text = pick(['r1', 'r2', 'r3', 'r4', '']);
        content.push({ type: 'reasoning', text });
        if (text.length > 0) lastReasoning = text;
      }
      if (rand() < 0.4) content.push({ type: 'text', text: pick(['a1', 'a2']) });
      const toolCall = rand() < 0.6;
      if (toolCall) content.push({ type: 'tool-call', id: `c${turn}`, name: 'f', arguments: '{}' });
      const hasReasoning = content.some((block) => block.type === 'reasoning');
      const ownReasoning = content
        .filter((block) => block.type === 'reasoning')
        .map((block) => block.text)
        .join('');
      // Every tool-call turn replays a reasoning item; a reasoningless turn
      // carries the conversation's most recent real chain of thought forward,
      // else the single-space placeholder.
      const mustReplay = hasReasoning || toolCall;
      if (mustReplay) {
        const text =
          ownReasoning.length > 0 ? ownReasoning : lastReasoning.length > 0 ? lastReasoning : ' ';
        expectedReasoning.push(text);
      }
      messages.push({ role: 'assistant', content });
      if (toolCall) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: `c${turn}`,
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
        });
      }
    }

    const wire = serializeResponsesRequest({ model: 'm1', messages });
    const wireReasoning = wire.input
      .filter((item) => item.type === 'reasoning')
      .flatMap((item) => item.content.map((part) => part.text));

    assert.deepEqual(
      wireReasoning,
      expectedReasoning,
      `run ${run}: assistant reasoning lost, duplicated, or not carried forward across a tool-call turn`,
    );
    // Every reasoning item must be adjacent to the items it annotates: its
    // content rides immediately before function_call items or a message item.
    for (let at = 0; at < wire.input.length; at += 1) {
      if (wire.input[at].type !== 'reasoning') continue;
      const next = wire.input[at + 1];
      assert.ok(
        next !== undefined && (next.type === 'function_call' || next.role === 'assistant'),
        `run ${run}: reasoning item at ${at} is not adjacent to a function_call or assistant message`,
      );
    }
    // Every run of function_call items must be introduced by a reasoning
    // item: the gateway rejects a tool-call continuation without
    // reasoning_text — a replayed call id it did not mint demands it even on
    // a turn whose answer produced no reasoning.
    for (let at = 0; at < wire.input.length; at += 1) {
      if (wire.input[at].type !== 'function_call') continue;
      if (wire.input[at - 1]?.type === 'function_call') continue;
      assert.equal(
        wire.input[at - 1]?.type,
        'reasoning',
        `run ${run}: function_call at ${at} is not introduced by a reasoning item`,
      );
    }
  }
});

test('property: Chat serialization never leaves a tool-call turn without a reasoning marker', () => {
  const rand = mulberry32(0xca11d);
  const pick = (items) => items[Math.floor(rand() * items.length)];

  for (let run = 0; run < 300; run += 1) {
    const messages = [];
    const expected = [];
    const turnCount = 1 + Math.floor(rand() * 6);
    for (let turn = 0; turn < turnCount; turn += 1) {
      const content = [];
      if (rand() < 0.7) {
        content.push({ type: 'reasoning', text: pick(['r1', 'r2', 'r3', 'r4', '']) });
      }
      if (rand() < 0.4) content.push({ type: 'text', text: pick(['a1', 'a2']) });
      const toolCall = rand() < 0.6;
      if (toolCall) content.push({ type: 'tool-call', id: `c${turn}`, name: 'f', arguments: '{}' });
      const hasReasoning = content.some((block) => block.type === 'reasoning');
      const ownReasoning = content
        .filter((block) => block.type === 'reasoning')
        .map((block) => block.text)
        .join('');
      // Every tool-call turn carries the marker (the gateway rejects its
      // continuation without the field when the call id is foreign or thinking
      // is already active); a reasoningless turn carries the empty marker.
      const mustReplay = hasReasoning || toolCall;
      expected.push(mustReplay ? ownReasoning : undefined);
      messages.push({ role: 'assistant', content });
      if (toolCall) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: `c${turn}`,
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
        });
      }
    }

    const wire = serializeChatRequest({ model: 'm1', messages });
    const assistants = wire.messages.filter((message) => message.role === 'assistant');
    for (let at = 0; at < assistants.length; at += 1) {
      const want = expected[at];
      const has = 'reasoning_content' in assistants[at];
      assert.equal(has, want !== undefined, `run ${run}: assistant ${at} marker presence`);
      if (want !== undefined) {
        assert.equal(
          assistants[at].reasoning_content,
          want,
          `run ${run}: assistant ${at} marker text`,
        );
      }
    }
  }
});

// ── Seeded randomized properties ───────────────────────────────────────────

test('property: chat translation never drops or duplicates wire content', async () => {
  const rand = mulberry32(0xca4d0);
  const pick = (items) => items[Math.floor(rand() * items.length)];

  for (let run = 0; run < 300; run += 1) {
    const expectedReasoning = [];
    const expectedText = [];
    const expectedArgs = new Map();
    const payloads = [];
    let sawDeltaReasoning = false;
    const messageReasoning = [];
    const chunkCount = 2 + Math.floor(rand() * 15);
    let toolId = undefined;

    for (let at = 0; at < chunkCount; at += 1) {
      const choices = [];
      const choiceCount = 1 + (rand() < 0.2 ? 1 : 0);
      for (let c = 0; c < choiceCount; c += 1) {
        const delta = {};
        if (rand() < 0.5) {
          const fragment = pick(['r1', 'r2', 'r3', 'r4']);
          delta.reasoning_content = fragment;
          expectedReasoning.push(fragment);
          sawDeltaReasoning = true;
        }
        if (rand() < 0.5) {
          const fragment = pick(['t1', 't2', 't3']);
          delta.reasoning = fragment;
          expectedReasoning.push(fragment);
          sawDeltaReasoning = true;
        }
        if (rand() < 0.5) {
          const fragment = pick(['c1', 'c2', 'c3', 'c4']);
          delta.content = fragment;
          expectedText.push(fragment);
        }
        if (rand() < 0.35) {
          if (toolId === undefined) toolId = pick(['call-a', 'call-b']);
          const fragment = pick(['{"a":', '"x"}', '{"b":', '1}']);
          delta.tool_calls = [
            {
              index: 0,
              ...(rand() < 0.5 ? { id: toolId } : {}),
              function: { arguments: fragment },
            },
          ];
          expectedArgs.set(toolId, (expectedArgs.get(toolId) ?? '') + fragment);
        }
        choices.push(Object.keys(delta).length > 0 ? { delta } : { delta: { role: 'assistant' } });
      }
      const chunk = { choices };
      if (at === chunkCount - 1) {
        chunk.choices[0].finish_reason = 'stop';
        if (!sawDeltaReasoning && rand() < 0.7) {
          const fragment = pick(['full1', 'full2', 'full3']);
          chunk.choices[0].message =
            rand() < 0.5 ? { reasoning_content: fragment } : { reasoning: fragment };
          messageReasoning.push(fragment);
        }
      }
      payloads.push(JSON.stringify(chunk));
    }
    if (!sawDeltaReasoning) expectedReasoning.push(...messageReasoning);
    payloads.push(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } }), '[DONE]');

    const chunks = await collect(
      translateChat(
        (async function* () {
          for (const payload of payloads) yield payload;
        })(),
      ),
    );

    assert.equal(
      blockTexts(chunks, 'reasoning').join(''),
      expectedReasoning.join(''),
      `run ${run}: reasoning lost or duplicated`,
    );
    assert.equal(
      blockTexts(chunks, 'text').join(''),
      expectedText.join(''),
      `run ${run}: text lost or duplicated`,
    );
    if (toolId !== undefined) {
      const toolBlock = chunks.find(
        (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
      );
      assert.equal(
        toolBlock.block.arguments,
        expectedArgs.get(toolId),
        `run ${run}: tool arguments lost or duplicated`,
      );
    }
  }
});

test('property: responses translation never drops or duplicates wire content', async () => {
  const rand = mulberry32(0x4e5);
  const pick = (items) => items[Math.floor(rand() * items.length)];

  for (let run = 0; run < 300; run += 1) {
    const expectedReasoning = [];
    const expectedText = [];
    const streamedReasoning = new Set();
    const streamedText = new Set();
    const payloads = [];
    const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [] };
    const reasoningDoneItem = {
      type: 'reasoning',
      id: 'rs_1',
      content: [{ type: 'reasoning_text', text: 'deep ' }],
      summary: [{ type: 'summary_text', text: 'summ' }],
    };
    const reasoningDoneExpected = ['deep ', 'summ'];
    const messageDoneItem = {
      type: 'message',
      id: 'm1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'msg' }],
    };
    const messageDoneExpected = ['msg'];
    const eventCount = 3 + Math.floor(rand() * 20);

    for (let at = 0; at < eventCount; at += 1) {
      const kind = pick([
        'reasoning-delta',
        'summary-delta',
        'reasoning-done',
        'summary-done',
        'text-delta',
        'text-done',
        'content-part-added',
        'content-part-done',
        'reasoning-item-done',
        'completed',
      ]);
      switch (kind) {
        case 'reasoning-delta': {
          const delta = pick(['a', 'b', 'c']);
          expectedReasoning.push(delta);
          streamedReasoning.add('rs_1');
          payloads.push(
            JSON.stringify({
              type: 'response.reasoning_text.delta',
              item_id: 'rs_1',
              output_index: 0,
              delta,
            }),
          );
          break;
        }
        case 'summary-delta': {
          const delta = pick(['s1', 's2', 's3']);
          expectedReasoning.push(delta);
          streamedReasoning.add('rs_1');
          payloads.push(
            JSON.stringify({
              type: 'response.reasoning_summary_text.delta',
              item_id: 'rs_1',
              output_index: 0,
              summary_index: 0,
              delta,
            }),
          );
          break;
        }
        case 'reasoning-done': {
          payloads.push(
            JSON.stringify({
              type: 'response.reasoning_text.done',
              item_id: 'rs_1',
              output_index: 0,
              text: 'whole',
            }),
          );
          if (!streamedReasoning.has('rs_1')) {
            expectedReasoning.push('whole');
            streamedReasoning.add('rs_1');
          }
          break;
        }
        case 'summary-done': {
          payloads.push(
            JSON.stringify({
              type: 'response.reasoning_summary_text.done',
              item_id: 'rs_1',
              output_index: 0,
              summary_index: 0,
              text: 'sumdone',
            }),
          );
          if (!streamedReasoning.has('rs_1')) {
            expectedReasoning.push('sumdone');
            streamedReasoning.add('rs_1');
          }
          break;
        }
        case 'text-delta': {
          const delta = pick(['t1', 't2', 't3']);
          expectedText.push(delta);
          streamedText.add('m1');
          payloads.push(
            JSON.stringify({
              type: 'response.output_text.delta',
              item_id: 'm1',
              output_index: 1,
              delta,
            }),
          );
          break;
        }
        case 'text-done': {
          payloads.push(
            JSON.stringify({
              type: 'response.output_text.done',
              item_id: 'm1',
              output_index: 1,
              text: 'textdone',
            }),
          );
          if (!streamedText.has('m1')) {
            expectedText.push('textdone');
            streamedText.add('m1');
          }
          break;
        }
        case 'content-part-added': {
          const text = pick(['p1', 'p2']);
          expectedReasoning.push(text);
          streamedReasoning.add('rs_1');
          payloads.push(
            JSON.stringify({
              type: 'response.content_part.added',
              item_id: 'rs_1',
              output_index: 0,
              part: { type: 'reasoning_text', text },
            }),
          );
          break;
        }
        case 'content-part-done': {
          payloads.push(
            JSON.stringify({
              type: 'response.content_part.done',
              item_id: 'rs_1',
              output_index: 0,
              part: { type: 'reasoning_text', reasoning: 'partdone' },
            }),
          );
          if (!streamedReasoning.has('rs_1')) {
            expectedReasoning.push('partdone');
            streamedReasoning.add('rs_1');
          }
          break;
        }
        case 'reasoning-item-done': {
          payloads.push(
            JSON.stringify({
              type: 'response.output_item.done',
              output_index: 0,
              item: reasoningDoneItem,
            }),
          );
          if (!streamedReasoning.has('rs_1')) {
            expectedReasoning.push(...reasoningDoneExpected);
            streamedReasoning.add('rs_1');
          }
          break;
        }
        case 'completed': {
          const output = [];
          if (rand() < 0.5) output.push(reasoningDoneItem);
          if (rand() < 0.5) output.push(messageDoneItem);
          payloads.push(
            JSON.stringify({
              type: 'response.completed',
              response: { id: 'r1', status: 'completed', output },
            }),
          );
          if (output.includes(reasoningDoneItem) && !streamedReasoning.has('rs_1')) {
            expectedReasoning.push(...reasoningDoneExpected);
            streamedReasoning.add('rs_1');
          }
          if (output.includes(messageDoneItem) && !streamedText.has('m1')) {
            expectedText.push(...messageDoneExpected);
            streamedText.add('m1');
          }
          break;
        }
      }
    }
    // A terminal event is required for a complete stream; append one.
    payloads.push(
      JSON.stringify({
        type: 'response.completed',
        response: { id: 'r1', status: 'completed', output: [] },
      }),
    );

    const chunks = await collect(
      translateResponses(
        (async function* () {
          for (const payload of payloads) yield payload;
        })(),
      ),
    );

    assert.equal(
      blockTexts(chunks, 'reasoning').join(''),
      expectedReasoning.join(''),
      `run ${run}: reasoning lost or duplicated`,
    );
    assert.equal(
      blockTexts(chunks, 'text').join(''),
      expectedText.join(''),
      `run ${run}: text lost or duplicated`,
    );
  }
});

test('property: Responses translation preserves the upstream call_id across stream shapes', async () => {
  const rand = mulberry32(0xca11d5);

  for (let run = 0; run < 120; run += 1) {
    const suffix = Math.floor(rand() * 1e9).toString(36);
    const callId = `call_00_${suffix}`;
    const itemId = `fc_${suffix}`;
    const item = {
      type: 'function_call',
      id: itemId,
      status: 'completed',
      call_id: callId,
      name: 'f',
      arguments: '{}',
    };
    const shape = Math.floor(rand() * 3);
    const payloads = [];
    if (shape === 0) {
      // added → deltas → done (the live gateway's streamed shape)
      payloads.push(
        JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', arguments: '' },
        }),
        JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: itemId,
          output_index: 0,
          delta: '{}',
        }),
        JSON.stringify({ type: 'response.output_item.done', output_index: 0, item }),
      );
    } else if (shape === 1) {
      // deltas first; the call id arrives only on the done item
      payloads.push(
        JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: itemId,
          output_index: 0,
          delta: '{}',
        }),
        JSON.stringify({ type: 'response.output_item.done', output_index: 0, item }),
      );
    } else {
      // buffered: only the terminal output array carries the item
      payloads.push(
        JSON.stringify({
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', output: [item] },
        }),
      );
    }
    payloads.push(
      JSON.stringify({
        type: 'response.completed',
        response: { id: 'r1', status: 'completed', output: [] },
      }),
    );

    const chunks = await collect(
      translateResponses(
        (async function* () {
          for (const payload of payloads) yield payload;
        })(),
      ),
    );
    const toolBlock = chunks.find(
      (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
    );
    assert.equal(
      toolBlock.block.id,
      callId,
      `run ${run}: upstream call_id not preserved (shape ${shape})`,
    );
  }
});
