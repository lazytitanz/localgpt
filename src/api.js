const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request(path, options = {}) {
  const url = BASE ? `${BASE}${path}` : path;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export async function getConversations(q = "") {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return request(`/api/conversations${query}`);
}

export async function getConversation(id) {
  return request(`/api/conversations/${id}`);
}

export async function createConversation(model = "llama3.2") {
  return request("/api/conversations", { method: "POST", body: JSON.stringify({ model }) });
}

export async function updateConversation(id, data) {
  return request(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteConversation(id) {
  const url = BASE ? `${BASE}/api/conversations/${id}` : `/api/conversations/${id}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status !== 204 && res.headers.get("content-type")?.includes("application/json")) {
    return res.json();
  }
}

export async function addMessage(conversationId, role, content) {
  return request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role, content }),
  });
}

export async function getModels() {
  return request("/api/models");
}

export async function chat(model, messages) {
  return request("/api/chat", { method: "POST", body: JSON.stringify({ model, messages }) });
}

/**
 * Stream chat response from POST /api/chat/stream (NDJSON).
 * Calls onChunk(chunk) for each "response" fragment, then onDone(fullContent) when done.
 * If stream is unavailable or fails, calls onDone(null) so caller can fall back to api.chat().
 */
export async function chatStream(model, messages, onChunk, onDone) {
  const url = BASE ? `${BASE}/api/chat/stream` : "/api/chat/stream";
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
    });
  } catch (e) {
    onDone(null);
    return;
  }
  if (!res.ok || !res.body) {
    onDone(null);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const chunk = obj.response ?? obj.message?.content ?? "";
          if (chunk !== "") {
            fullContent += chunk;
            onChunk(chunk);
          }
          if (obj.done) {
            onDone(fullContent);
            return;
          }
        } catch (_) {
          // skip malformed line
        }
      }
    }
    onDone(fullContent);
  } catch (e) {
    console.error("chatStream error:", e);
    onDone(null);
  }
}

/**
 * Stream chat with tools from POST /api/chat/stream-with-tools (NDJSON).
 * Dispatches on type: response -> onChunk(data.chunk), tool_call -> onToolCall(data),
 * tool_result -> onToolResult(data), done -> onDone(data).
 */
export async function chatStreamWithTools(
  model,
  messages,
  { onChunk, onToolCall, onToolResult, onDone },
  options = {}
) {
  const { toolNames, idempotencyKey, toolModel, useToolModelForFirstRound } = options;
  const url = BASE ? `${BASE}/api/chat/stream-with-tools` : "/api/chat/stream-with-tools";
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: true,
        ...(Array.isArray(toolNames) && toolNames.length > 0 ? { toolNames } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(toolModel != null && toolModel !== "" ? { toolModel } : {}),
        ...(useToolModelForFirstRound === true ? { useToolModelForFirstRound: true } : {}),
      }),
    });
  } catch (e) {
    onDone?.(null);
    return;
  }
  if (!res.ok || !res.body) {
    onDone?.(null);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          switch (obj.type) {
            case "response":
              if (obj.data?.chunk != null) {
                fullContent += obj.data.chunk;
                onChunk?.(obj.data.chunk);
              }
              break;
            case "tool_call":
              onToolCall?.(obj.data);
              break;
            case "tool_result":
              onToolResult?.(obj.data);
              break;
            case "done":
              onDone?.({
                ...(obj.data || {}),
                fullContent: obj.data?.fullContent !== undefined ? obj.data.fullContent : fullContent,
              });
              return;
            default:
              break;
          }
        } catch (_) {}
      }
    }
    onDone?.({ fullContent });
  } catch (e) {
    console.error("chatStreamWithTools error:", e);
    onDone?.(null);
  }
}

export async function generateTitle(userMessage, assistantMessage, model) {
  return request("/api/generate-title", {
    method: "POST",
    body: JSON.stringify({ userMessage, assistantMessage, model }),
  });
}
