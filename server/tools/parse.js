/**
 * Parse <tool_call>...</tool_call> from buffered assistant text.
 * Uses indexOf (no single regex) to avoid nested tags and partial buffer issues.
 * Enforces max buffer size to prevent memory blow-up.
 */

const OPEN_TAG = "<tool_call>";
const OPEN_TAG_ALT = "tool_call>"; // malformed: missing leading <
const CLOSE_TAG = "</tool_call>";
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024; // 2 MB

function findToolCallStart(buffer, searchStart) {
  const a = buffer.indexOf(OPEN_TAG, searchStart);
  const b = buffer.indexOf(OPEN_TAG_ALT, searchStart);
  if (a === -1 && b === -1) return { index: -1, tagLength: OPEN_TAG.length };
  if (a === -1) return { index: b, tagLength: OPEN_TAG_ALT.length };
  if (b === -1) return { index: a, tagLength: OPEN_TAG.length };
  return a <= b ? { index: a, tagLength: OPEN_TAG.length } : { index: b, tagLength: OPEN_TAG_ALT.length };
}

/**
 * @param {string} buffer - Full assistant message string (accumulated from stream)
 * @param {{ maxBufferBytes?: number }} [opts]
 * @returns {{ textBefore: string, toolCalls: Array<{ id?: string, name: string, arguments: Record<string, unknown> }>, remainder: string, bufferExceeded?: boolean }}
 *   remainder: Everything after the last consumed </tool_call> (including any trailing incomplete tags or text).
 *   Must not be shown to the user; use only as carry-forward buffer for the next round.
 */
export function parseToolCalls(buffer, opts = {}) {
  const maxBytes = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const encoder = new TextEncoder();

  if (encoder.encode(buffer).length > maxBytes) {
    return {
      textBefore: buffer,
      toolCalls: [],
      remainder: "",
      bufferExceeded: true,
    };
  }

  const toolCalls = [];
  let searchStart = 0;
  let textBefore = "";
  let remainder = buffer;

  while (true) {
    const { index: startIndex, tagLength } = findToolCallStart(buffer, searchStart);
    if (startIndex === -1) {
      if (toolCalls.length === 0) {
        textBefore = buffer;
        remainder = "";
      } else {
        remainder = buffer.slice(searchStart);
      }
      break;
    }

    const endIndex = buffer.indexOf(CLOSE_TAG, startIndex);
    if (endIndex === -1) {
      if (toolCalls.length === 0) {
        textBefore = buffer;
        remainder = "";
      } else {
        remainder = buffer.slice(searchStart);
      }
      break;
    }

    if (toolCalls.length === 0) {
      textBefore = buffer.slice(0, startIndex);
    }

    const inner = buffer.slice(startIndex + tagLength, endIndex).trim();
    try {
      const parsed = JSON.parse(inner);
      const name = typeof parsed?.name === "string" ? parsed.name : "";
      const args = parsed && typeof parsed.arguments === "object" && parsed.arguments !== null
        ? parsed.arguments
        : {};
      const id = typeof parsed?.id === "string" ? parsed.id : undefined;
      if (name) {
        toolCalls.push({ id, name, arguments: args });
      }
    } catch (_) {
      // Invalid JSON: treat as text, don't add to toolCalls
    }

    searchStart = endIndex + CLOSE_TAG.length;
  }

  return { textBefore, toolCalls, remainder };
}

/**
 * True if buffer looks like tag-based tool protocol (strict: actual tags + JSON-like content).
 * Normal prose mentioning "tool_call" should not trigger.
 * @param {string} buffer
 * @returns {boolean}
 */
export function looksLikeToolProtocol(buffer) {
  if (!buffer || typeof buffer !== "string") return false;
  const s = buffer.trim();
  const hasTag = (s.includes("<tool_call>") || s.includes("tool_call>")) && s.includes("</tool_call>");
  if (!hasTag) return false;
  return s.includes('"name"') && s.includes("arguments");
}

/**
 * True if buffer looks like model-roleplayed tool_results (fabricated echo).
 * @param {string} buffer
 * @returns {boolean}
 */
export function looksLikeFabricatedToolResults(buffer) {
  if (!buffer || typeof buffer !== "string") return false;
  const s = buffer.trim();
  return s.includes('"type"') && s.includes("tool_results") && s.includes('"results"');
}

/**
 * Remove tool_results echoes from buffer so they are never shown to the user.
 * Strips JSON objects that look like {"type":"tool_results","results":[...]} and lines starting with TOOL_RESULTS:
 * @param {string} buffer
 * @returns {string}
 */
export function stripToolResultsEchoes(buffer) {
  if (!buffer || typeof buffer !== "string") return buffer;
  let out = buffer;
  const marker = '"type":"tool_results"';
  let idx;
  while ((idx = out.indexOf(marker)) !== -1) {
    const start = out.lastIndexOf("{", idx);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    out = (out.slice(0, start) + out.slice(end)).replace(/\n{3,}/g, "\n\n").trim();
  }
  out = out.replace(/TOOL_RESULTS:\s*[\s\S]*?(?=\n\n|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Check if buffer contains at least one complete <tool_call>...</tool_call>.
 * @param {string} buffer
 * @returns {boolean}
 */
export function hasCompleteToolCall(buffer) {
  const { index: start } = findToolCallStart(buffer, 0);
  if (start === -1) return false;
  return buffer.indexOf(CLOSE_TAG, start) !== -1;
}
