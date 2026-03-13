/**
 * Tool framework: registry, parse, and optional example tool.
 */

import "./fileTools.js";
import { register, getEnabled, getByName } from "./registry.js";
import { parseToolCalls, hasCompleteToolCall, looksLikeToolProtocol, looksLikeFabricatedToolResults, stripToolResultsEchoes } from "./parse.js";

export { register, getAll, getByName, getEnabled, clear, buildToolSystemPrompt } from "./registry.js";
export {
  parseToolCalls,
  hasCompleteToolCall,
  looksLikeToolProtocol,
  looksLikeFabricatedToolResults,
  stripToolResultsEchoes,
} from "./parse.js";

// Optional no-op example tool so the framework is testable without adding real tools
register({
  name: "echo",
  description: "Echo back a message. Use for testing.",
  parameters: { message: "string to echo" },
  handler: async (args) => {
    const msg = args?.message != null ? String(args.message) : "";
    return { echoed: msg };
  },
});

// Web search via Tavily (requires TAVILY_API_KEY in env)
register({
  name: "web",
  description: "Search the web for current information. Use when the user asks about recent events, facts, or anything that might need up-to-date results.",
  parameters: {
    query: "search query string",
    max_results: "number of results to return (1-20, default 5)",
  },
  scope: "network",
  handler: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { error: "Web search is not configured. TAVILY_API_KEY is not set." };
    }
    const query = args?.query != null ? String(args.query).trim() : "";
    if (!query) {
      return { error: "Missing required argument: query" };
    }
    let maxResults = 5;
    if (args?.max_results != null) {
      const n = Number(args.max_results);
      if (Number.isFinite(n)) {
        maxResults = Math.min(20, Math.max(1, Math.floor(n)));
      }
    }
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: maxResults,
          include_favicon: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.detail?.error ?? data?.error ?? res.statusText;
        return { error: `Tavily error: ${msg}` };
      }
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        query: data.query ?? query,
        results: results.map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: r.content ?? "",
          score: r.score,
          favicon: r.favicon ?? "",
        })),
      };
    } catch (e) {
      return { error: `Web search failed: ${(e && e.message) || String(e)}` };
    }
  },
});

// Image search via Tavily (requires TAVILY_API_KEY in env)
register({
  name: "image_query",
  description: "Search the web for images. Use for persons, animals, locations, travel destinations, historical events, or when images would help the user.",
  parameters: { query: "search query for images" },
  scope: "network",
  handler: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { error: "Image search is not configured. TAVILY_API_KEY is not set." };
    }
    const query = args?.query != null ? String(args.query).trim() : "";
    if (!query) {
      return { error: "Missing required argument: query" };
    }
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
          include_images: true,
          include_image_descriptions: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.detail?.error ?? data?.error ?? res.statusText;
        return { error: `Tavily error: ${msg}` };
      }
      const images = Array.isArray(data.images) ? data.images : [];
      return {
        query: data.query ?? query,
        images: images.map((img) => ({
          url: img.url ?? "",
          description: img.description ?? "",
        })),
      };
    } catch (e) {
      return { error: `Image search failed: ${(e && e.message) || String(e)}` };
    }
  },
});

/**
 * Run a list of tool calls and return structured tool_results (section 3b of plan).
 * result is kept as-is (string or object); stringify only when embedding into a message.
 * @param {Array<{ id?: string, name: string, arguments: Record<string, unknown> }>} toolCalls
 * @param {(name: string) => import("./registry.js").ToolDef | undefined} getTool
 * @param {{ attachmentIds?: number[], db?: import("better-sqlite3").Database }} [context]
 * @returns {{ type: "tool_results", results: Array<{ id?: string, name: string, ok: boolean, result?: string | object, error?: string }> }}
 */
export async function runToolCalls(toolCalls, getTool = getByName, context = {}) {
  const results = [];
  for (const call of toolCalls) {
    const tool = getTool(call.name);
    if (!tool) {
      results.push({ id: call.id, name: call.name, ok: false, error: `Unknown tool: ${call.name}` });
      continue;
    }
    try {
      const raw = await tool.handler(call.arguments || {}, context);
      results.push({ id: call.id, name: call.name, ok: true, result: raw });
    } catch (e) {
      results.push({ id: call.id, name: call.name, ok: false, error: (e && e.message) || String(e) });
    }
  }
  return { type: "tool_results", results };
}
