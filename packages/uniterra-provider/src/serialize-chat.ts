/**
 * Serialize harness messages into OpenAI Chat Completions. User text is
 * joined; assistant text becomes `content`, tool calls become `tool_calls`,
 * and tool results become separate tool messages. Assistant reasoning is
 * replayed as `reasoning_content` — DeepSeek's thinking mode demands the field
 * on EVERY tool-call message (a replayed call id it did not mint, and any
 * continuation once thinking is active, are rejected without it), so a turn
 * whose model answer had no reasoning round-trips as the empty marker (other
 * OpenAI-compatible upstreams ignore the field). Images ride the standard
 * `image_url` content-part form with a data URL, each preceded by its
 * model-facing handle; an image the request did not prepare is rejected
 * explicitly rather than silently erased, and images lifted out of a tool
 * result follow it on one user message. Unknown declaration-merged block types
 * retain the adapter's documented extension fallback.
 *
 * @module @uniterra-solutions/uniterra-provider/serialize-chat
 */

import { LlmError, requestImageHandleText } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm';
import type {
  ChatMessage,
  ChatRequest,
  ChatTool,
  ChatUserContentPart,
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

/**
 * Serialize one assistant message (text + reasoning + tool calls).
 * @param message - the harness assistant message.
 */
function serializeAssistant(message: Message): ChatMessage {
  const text = flattenText(message.content);
  const reasoningBlocks = message.content.filter((block) => block.type === 'reasoning');
  const reasoning = reasoningBlocks.map((block) => block.text).join('');
  const toolCalls = message.content
    .filter((block) => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }));

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: some
    // gateways reject null outright.
    content: text,
    // Every tool-call turn carries the field: DeepSeek's thinking mode
    // rejects its continuation without `reasoning_content` — once thinking is
    // active, and whenever the replayed call id is not one it minted — and a
    // turn whose model answer had no reasoning round-trips as the empty
    // marker (DeepSeek accepts the empty marker; other gateways ignore the
    // field). Turns with any reasoning replay it verbatim.
    ...(reasoningBlocks.length > 0 || toolCalls.length > 0 ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

/** Resolve one durable image into its model-facing handle plus inline data URL. */
function imageParts(
  ref: UniterraImageRef,
  images: RequestImages | undefined,
): ChatUserContentPart[] {
  const image = images?.get(ref.attachmentId);
  if (image === undefined) {
    throw new LlmError(
      'The uniterra chat-completions adapter cannot send an image the request did not prepare.',
      'UNSUPPORTED_CONTENT',
    );
  }
  return [
    { type: 'text', text: requestImageHandleText(ref, image) },
    {
      type: 'image_url',
      image_url: {
        url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`,
      },
    },
  ];
}

/** Convert user or nested tool-result blocks into ordered wire parts. */
function contentParts(
  blocks: readonly ContentBlock[],
  images: RequestImages | undefined,
): ChatUserContentPart[] {
  const parts: ChatUserContentPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text });
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
        // Other merge-extensible blocks are not chat-completions input vocabulary.
        break;
    }
  }
  return parts;
}

/** Keep text-only user messages on the compact string wire form. */
function userContent(parts: readonly ChatUserContentPart[]): string | ChatUserContentPart[] {
  const text: string[] = [];
  for (const part of parts) {
    if (part.type !== 'text') return [...parts];
    text.push(part.text);
  }
  return text.join('');
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after — with any images lifted
 * out of the results onto one following user message, because a tool message
 * carries text only.
 * @param messages - the harness conversation, in order.
 * @param images - prepared request images keyed by attachment id; absent rejects images.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[], images?: RequestImages): ChatMessage[] {
  const wire: ChatMessage[] = [];
  let pendingToolImages: ChatUserContentPart[] = [];
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return;
    wire.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    });
    pendingToolImages = [];
  };

  for (const message of messages) {
    if (message.role === 'system') {
      flushToolImages();
      wire.push({ role: 'system', content: flattenText(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      flushToolImages();
      wire.push(serializeAssistant(message));
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === 'tool-result');
    const regular = message.content.filter((block) => block.type !== 'tool-result');
    const content = userContent(contentParts(regular, images));
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages();
      wire.push({ role: 'user', content });
    }
    for (const result of toolResults) {
      const parts = contentParts(result.content, images);
      const resultImages = parts.filter((part) => part.type !== 'text');
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: text || '(no output)',
      });
      pendingToolImages.push(...resultImages);
    }
  }
  flushToolImages();
  return wire;
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * upstream defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param images - prepared request images keyed by attachment id.
 * @returns the chat-completions request body.
 */
export function serializeRequest(options: GenerateOptions, images?: RequestImages): ChatRequest {
  const messages: ChatMessage[] = [];
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push(...serializeMessages(options.messages, images));

  const tools: ChatTool[] | undefined = options.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
    // Reasoning effort rides the OpenAI-compatible `reasoning_effort` field
    // (DeepSeek/Qwen/GLM gateways expose the same name); the adapter-owned
    // effort id is passed through verbatim — no re-mapping here.
    ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
  };
}
