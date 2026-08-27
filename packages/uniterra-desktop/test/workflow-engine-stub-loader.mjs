/**
 * ESM module-resolution stub for the vendored `@dsh-external/workflow` engine.
 *
 * The repo's test packages do not install the `@deepseek-ai/*` runtime deps the
 * vendored plugin's `lib/engine.js` statically imports (`dsh-llm`,
 * `dsh-workflow`, `dsh-tools`) nor `quickjs-emscripten` (via `lib/runtime.js`).
 * This loader maps every such bare specifier to an inert module so the real
 * vendored engine can be imported in isolation and its pure decision logic
 * (`needsApproval`) driven under arbitrary inputs.
 *
 * Only the symbols the loaded engine module graph actually references are
 * needed; the rest are harmless no-ops.
 */
const STUB = `export const createUserMessage = () => ({ content: [], source: { kind: 'user' } });
export const WorkflowRunId = (id) => id;
export const assertObjectJsonSchema = () => {};
export const validateJsonSchemaValue = () => {};
export const Context = class {};
export const Service = class {};
export const defineTool = () => {};
export const getQuickJS = () => ({ newContext: () => ({ evalCode: () => ({ value: undefined, error: undefined }), dispose: () => {} }) });
export const z = { object: () => ({ default: (v) => v }) };
`;
const stubUrl = 'data:text/javascript;base64,' + Buffer.from(STUB).toString('base64');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/') || specifier === 'quickjs-emscripten') {
    return { url: stubUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
