/**
 * Serialize harness messages into the OpenAI Responses API (`POST
 * {baseURL}/responses`). The Responses protocol restructures the conversation
 * as `input` items: message items carry `content` arrays, prior assistant tool
 * calls become `function_call` items and their results `function_call_output`
 * items. Assistant reasoning rides a `reasoning` item (plain-text `content`
 * plus `summary`) right before its assistant message — OpenAI requires
 * `summary` on reasoning items and DeepSeek merges `content` into the adjacent
 * assistant message, so both consume the same shape.
 *
 * DeepSeek's thinking mode is all-or-nothing: once any assistant turn carried
 * reasoning, every later tool-call turn must pass reasoning_text back — and an
 * EMPTY reasoning item is rejected. A turn whose model answer had no (or
 * empty) reasoning therefore carries the conversation's most recent actual
 * chain of thought forward, so the continuation request stays valid.
 * Images ride `input_image` parts with a data URL, each preceded by its
 * model-facing handle; an image the request did not prepare is rejected
 * explicitly rather than silently erased.
 *
 * @module @uniterra-solutions/uniterra-provider/serialize-response
 */

import { LlmError, requestImageHandleText } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm';
import type {
  ResponsesContent,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesTool,
  UniterraImageRef,
  UniterraRequestImage,
} from './types.ts';

/** Prepared request images, keyed by durable attachment id. */
type RequestImages = ReadonlyMap<string, UniterraRequestImage>;

/** Precedes the images lifted out of a tool result onto a following user message. */
const TOOL_RESULT_IMAGE_TEXT = 'Attached image(s) from tool result:';

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** Wrap plain text as the protocol's `input_text`/`output_text` content. */
function textContent(text: string, kind: 'input_text' | 'output_text'): ResponsesContent[] {
  return text.length > 0 ? [{ type: kind, text }] : [];
}

/** Resolve one durable image into its model-facing handle plus inline image part. */
function imageParts(ref: UniterraImageRef, images: RequestImages | undefined): ResponsesContent[] {
  const image = images?.get(ref.attachmentId);
  if (image === undefined) {
    throw new LlmError(
      'The uniterra responses adapter cannot send an image the request did not prepare.',
      'UNSUPPORTED_CONTENT',
    );
  }
  return [
    { type: 'input_text', text: requestImageHandleText(ref, image) },
    {
      type: 'input_image',
      image_url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`,
    },
  ];
}

/** Convert user or nested tool-result blocks into ordered `input_text`/`input_image` parts. */
function contentParts(
  blocks: readonly ContentBlock[],
  images: RequestImages | undefined,
): ResponsesContent[] {
  const parts: ResponsesContent[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'input_text', text: block.text });
        break;
      case 'image':
        parts.push(...imageParts(block.attachment, images));
        break;
      case 'tool-result':
        parts.push(...contentParts(block.content, images));
        break;
      case 'reasoning':
      case 'tool-call':
        // Assistant-only vocabulary; never user input.
        break;
      default:
        // Other merge-extensible blocks are not Responses input vocabulary.
        break;
    }
  }
  return parts;
}

/**
 * Serialize the conversation into `input` items. Message roles map directly;
 * assistant tool calls and their matching results become function_call /
 * function_call_output item pairs — with any images lifted out of the results
 * onto one following user message, because a function_call_output carries
 * text only.
 * @param messages - the harness conversation, in order.
 * @param images - prepared request images keyed by attachment id; absent rejects images.
 * @returns the ordered input items.
 */
export function serializeInput(messages: Message[], images?: RequestImages): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  let sawReasoning = false;
  let lastReasoning = '';
  let pendingToolImages: ResponsesContent[] = [];
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return;
    input.push({
      role: 'user',
      content: [{ type: 'input_text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    });
    pendingToolImages = [];
  };

  for (const message of messages) {
    if (message.role === 'system') {
      flushToolImages();
      input.push({
        role: 'system',
        content: textContent(flattenText(message.content), 'input_text'),
      });
      continue;
    }
    if (message.role === 'assistant') {
      flushToolImages();
      const reasoningBlocks = message.content.filter((block) => block.type === 'reasoning');
      const reasoning = reasoningBlocks.map((block) => block.text).join('');
      if (reasoning.length > 0) lastReasoning = reasoning;
      if (reasoningBlocks.length > 0) sawReasoning = true;
      const toolCalls = message.content.filter((block) => block.type === 'tool-call');
      const mustReplay = reasoningBlocks.length > 0 || (toolCalls.length > 0 && sawReasoning);
      if (mustReplay) {
        // Round-trip the previous turn's chain of thought. DeepSeek's
        // Responses API in thinking mode rejects a multi-turn tool-call
        // continuation unless the prior turn's reasoning is replayed as a
        // `reasoning` input item BEFORE its function_call items — and rejects
        // EMPTY reasoning items too, so a turn whose answer had no reasoning
        // carries the conversation's most recent actual chain of thought
        // forward (the model's own text; it keeps the thinking context alive).
        // `id` is a locally synthesized unique key: the harness does not
        // persist reasoning item ids, and both OpenAI and DeepSeek only need
        // it unique within the request.
        const text =
          reasoning.length > 0 ? reasoning : lastReasoning.length > 0 ? lastReasoning : ' ';
        input.push({
          type: 'reasoning',
          id: `reasoning_${String(input.length)}`,
          content: [{ type: 'reasoning_text', text }],
          summary: [{ type: 'summary_text', text }],
        });
      }
      if (toolCalls.length > 0) {
        // A tool-call turn: emit one function_call item per call; any text on
        // the same turn is dropped (tool-call turns are text-less in the
        // harness vocabulary).
        for (const call of toolCalls) {
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
        }
      } else {
        input.push({
          role: 'assistant',
          content: textContent(flattenText(message.content), 'output_text'),
        });
      }
      continue;
    }
    // user role: text and images ride the message; tool results become output items.
    const toolResults = message.content.filter((block) => block.type === 'tool-result');
    const regular = message.content.filter((block) => block.type !== 'tool-result');
    const content = contentParts(regular, images);
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages();
      input.push({ role: 'user', content });
    }
    for (const result of toolResults) {
      const parts = contentParts(result.content, images);
      const resultImages = parts.filter((part) => part.type !== 'input_text');
      const text = parts
        .filter((part) => part.type === 'input_text')
        .map((part) => part.text)
        .join('');
      input.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        output: text || '(no output)',
      });
      pendingToolImages.push(...resultImages);
    }
  }
  flushToolImages();
  return input;
}

/**
 * Build the full wire request. Always streaming; optional fields are omitted
 * rather than sent as null, so upstream defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param images - prepared request images keyed by attachment id.
 * @returns the responses request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  images?: RequestImages,
): ResponsesRequest {
  const input: ResponsesInputItem[] = [];
  if (options.system !== undefined && options.system.length > 0) {
    input.push({ role: 'system', content: textContent(options.system, 'input_text') });
  }
  input.push(...serializeInput(options.messages, images));

  const tools: ResponsesTool[] | undefined = options.tools?.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  return {
    model: options.model,
    input,
    stream: true,
    store: false,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens }),
    ...(options.stop !== undefined && options.stop.length > 0 ? { stop: options.stop } : {}),
    // Reasoning effort rides the Responses API's `reasoning.effort` object
    // (OpenAI and DeepSeek both consume this shape); the adapter-owned effort
    // id is passed through verbatim — no re-mapping here.
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: options.reasoningEffort } }),
  };
}
