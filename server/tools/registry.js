/**
 * Tool registry: register tools, get by name or enabled set, build system prompt.
 * Tool shape: { name, description, parameters, handler, requiresUserConsent?, scope? }
 */

const tools = new Map();

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {Record<string, string>} parameters - property name -> short description or type
 * @property {(args: Record<string, unknown>) => Promise<string | object>} handler
 * @property {boolean} [requiresUserConsent]
 * @property {string} [scope] - e.g. "filesystem" | "network" | "db"
 */

/**
 * @param {ToolDef} tool
 */
export function register(tool) {
  if (!tool?.name || typeof tool.handler !== "function") {
    throw new Error("Tool must have name and handler");
  }
  tools.set(tool.name, {
    name: tool.name,
    description: tool.description || "",
    parameters: tool.parameters || {},
    handler: tool.handler,
    requiresUserConsent: Boolean(tool.requiresUserConsent),
    scope: tool.scope,
  });
}

/**
 * @returns {ToolDef[]}
 */
export function getAll() {
  return Array.from(tools.values());
}

/**
 * @param {string} name
 * @returns {ToolDef | undefined}
 */
export function getByName(name) {
  return tools.get(name);
}

/**
 * @param {string[]} [toolNames] - If provided, return only these tools; otherwise all.
 * @returns {ToolDef[]}
 */
export function getEnabled(toolNames) {
  const all = getAll();
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return all;
  }
  const set = new Set(toolNames);
  return all.filter((t) => set.has(t.name));
}

export function clear() {
  tools.clear();
}

const PROMPT_CONTRACT = `
When you need to call a tool, output ONLY one or more tool calls using this exact format. Do not output any other text before or between tool calls—only after all tool calls are done may you output your final answer.

You MUST use the exact tag with the opening angle bracket: <tool_call>...</tool_call>
Format (no extra text inside the tag, only valid JSON):
<tool_call>{"name":"toolName","arguments":{...}}</tool_call>

Rules:
- Tool calls must NOT appear inside code fences (e.g. no \`\`\` ... <tool_call> ... \`\`\`).
- The content inside <tool_call>...</tool_call> must be exactly one JSON object with "name" (string) and "arguments" (object). No extra text.
- Arguments must be JSON-serializable (no functions, no undefined).
- If you need multiple tools, output multiple <tool_call>...</tool_call> tags, one after another.
- After you receive tool results, you may respond with your final answer. Do not output user-facing prose before you have finished all tool calls for this turn.
- You cannot execute tools yourself. You can only REQUEST a tool by outputting <tool_call>...</tool_call>.
- Do not claim you "called" a tool or include tool results unless you received them in a TOOL_RESULTS message.
- Never repeat or echo TOOL_RESULTS content in your reply.

Example (copy this format exactly, including the angle brackets):
<tool_call>{"name":"echo","arguments":{"message":"Hello"}}</tool_call>
For web search: <tool_call>{"name":"web","arguments":{"query":"your search query here"}}</tool_call>
For image search: <tool_call>{"name":"image_query","arguments":{"query":"your image search query"}}</tool_call>
`;

/**
 * Build system prompt fragment describing available tools and the contract.
 * @param {ToolDef[]} toolsList
 * @returns {string}
 */
export function buildToolSystemPrompt(toolsList) {
  if (!toolsList.length) {
    return "";
  }
  const lines = [
    "You have access to the following tools. Use them when needed.",
    PROMPT_CONTRACT.trim(),
    "Available tools:",
  ];
  for (const t of toolsList) {
    const paramsDesc = Object.entries(t.parameters || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`- ${t.name}: ${t.description}${paramsDesc ? ` (${paramsDesc})` : ""}`);
  }
  return lines.join("\n");
}
