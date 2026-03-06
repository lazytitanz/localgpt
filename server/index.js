import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { Readable } from "stream";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  getEnabled,
  buildToolSystemPrompt,
  parseToolCalls,
  runToolCalls,
  looksLikeToolProtocol,
  stripToolResultsEchoes,
} from "./tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from project root so it works whether you run from root or server/
dotenv.config({ path: join(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 3001;
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://192.168.1.207:11434").replace(/\/$/, "");

const BROWSE_WEB_INSTRUCTIONS = `Do NOT ask for confirmation between each step of multi-stage user requests. However, for ambiguous requests, you may ask for clarification (but do so sparingly).

You must browse the web for any query that could benefit from up-to-date or niche information, unless the user explicitly asks you not to browse the web. Example topics include but are not limited to politics, current events, weather, sports, scientific developments, cultural trends, recent media or entertainment developments, general news, esoteric topics, deep research questions, or many many other types of questions. It's absolutely critical that you browse, using the web tool, any time you are remotely uncertain if your knowledge is up-to-date and complete. If the user asks about the 'latest' anything, you should likely be browsing. If the user makes any request that requires information after your knowledge cutoff, that requires browsing. Incorrect or out-of-date information can be very frustrating (or even harmful) to users!

Further, you must also browse for high-level, generic queries about topics that might plausibly be in the news (e.g. 'Apple', 'large language models', etc.) as well as navigational queries (e.g. 'YouTube', 'Walmart site'); in both cases, you should respond with a detailed description with good and correct markdown styling and formatting (but you should NOT add a markdown title at the beginning of the response), appropriate citations after each paragraph, and any recent news, etc.

Use the image_query tool and show an image carousel when images clearly add value. For places, countries, regions, or travel destinations—e.g. "What is Germany like?", "How is Tokyo?"—you MUST use image_query; the user does not need to say "travel" or "what does it look like." For animals, historical events, or when the user asks what something or someone looks like (or for a photo), use image_query. For a simple "Who is [person]?" biographical question, use the web tool for the answer and do NOT call image_query unless the user also asks for a photo or what they look like. If you use multiple images, show them in an inline carousel. When you use image_query, the interface will display the returned images in that carousel automatically. Do NOT embed those image URLs in your reply as markdown images (do not use ![](url) or paste image URLs in your message). You may describe the images in words; the images will appear in the carousel above your text.

If you are asked to do something that requires up-to-date knowledge as an intermediate step, it's also CRUCIAL you browse in this case. For example, if the user asks who the current head of state is or what they look like, you must browse with the web tool to check who that is; your knowledge is very likely out of date for this and many other cases!

Remember, you MUST browse (using the web tool) if the query relates to current events in politics, sports, scientific or cultural developments, or ANY other dynamic topics. Err on the side of over-browsing, unless the user tells you not to browse.

When you use information from the web tool, cite the source at the end of each paragraph that used that source. Use this exact markdown format: a space, then [Source: Short Name](url) where url is the exact URL from the web results and Short Name is the site or publication name (e.g. PlayStation, Reddit). Put one such citation at the end of each paragraph that draws from that source.`;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const dbPath = join(__dirname, "localgpt.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    model TEXT NOT NULL DEFAULT 'llama3.2',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
`);

function now() {
  return new Date().toISOString();
}

app.get("/api/conversations", (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    let stmt;
    if (q) {
      stmt = db.prepare(`
        SELECT id, title, model, created_at, updated_at
        FROM conversations
        WHERE title IS NOT NULL AND title != '' AND title LIKE ?
        ORDER BY updated_at DESC
      `);
      const rows = stmt.all(`%${q}%`);
      return res.json(rows);
    }
    stmt = db.prepare(`
      SELECT id, title, model, created_at, updated_at
      FROM conversations
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/conversations/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const conv = db.prepare("SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ?").get(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const messages = db.prepare(
      "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    ).all(id);
    res.json({ ...conv, messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/conversations", (req, res) => {
  try {
    const model = (req.body.model || "llama3.2").trim() || "llama3.2";
    const ts = now();
    const stmt = db.prepare(
      "INSERT INTO conversations (title, model, created_at, updated_at) VALUES (?, ?, ?, ?)"
    );
    const result = stmt.run(null, model, ts, ts);
    const id = result.lastInsertRowid;
    const row = db.prepare("SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ?").get(id);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/conversations/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/conversations/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { title, model } = req.body;
    const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const updates = [];
    const params = [];
    if (typeof title === "string") {
      updates.push("title = ?");
      params.push(title.trim() || null);
    }
    if (typeof model === "string" && model.trim()) {
      updates.push("model = ?");
      params.push(model.trim());
    }
    if (updates.length === 0) return res.json(conv);
    updates.push("updated_at = ?");
    params.push(now());
    params.push(id);
    db.prepare(`UPDATE conversations SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    const row = db.prepare("SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ?").get(id);
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/conversations/:id/messages", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { role, content } = req.body;
    if (!role || !content || !["user", "assistant"].includes(role)) {
      return res.status(400).json({ error: "role must be 'user' or 'assistant' and content is required" });
    }
    const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const ts = now();
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(id, role, String(content), ts);
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, id);
    const row = db.prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1").get(id);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/models", async (req, res) => {
  const url = `${OLLAMA_BASE}/api/tags`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text();
      console.error("Ollama /api/tags failed:", r.status, text?.slice(0, 200));
      return res.json([]);
    }
    const data = await r.json();
    const raw = data.models || data.model || [];
    const list = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const models = list.map((m) => {
      const name = m.name ?? m.model ?? String(m);
      return { id: name, name };
    }).filter((m) => m.name);
    res.json(models);
  } catch (e) {
    console.error("Ollama models fetch failed:", e.message, "\nURL:", url);
    res.json([]);
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { model, messages } = req.body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "model and messages array required" });
    }
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t || "Ollama chat failed" });
    }
    const data = await r.json();
    const content = data.message?.content ?? "";
    res.json({ content });
  } catch (e) {
    console.error("Ollama chat failed:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  try {
    const { model, messages } = req.body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "model and messages array required" });
    }
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t || "Ollama chat stream failed" });
    }
    if (!r.body) {
      return res.status(502).json({ error: "No response body" });
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const nodeReadable = Readable.fromWeb(r.body);
    nodeReadable.pipe(res);
    nodeReadable.on("error", (e) => {
      console.error("Ollama stream error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
  } catch (e) {
    console.error("Ollama chat stream failed:", e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// --- Tool framework constants ---
const MAX_TOOL_ROUNDS = 10;
const TOOL_CALL_BUDGET_PER_ROUND = 8;
const OLLAMA_ROUND_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function sendNdjson(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

function contentFromChunk(obj) {
  const raw =
    obj?.response ??
    obj?.message?.content ??
    obj?.content ??
    (typeof obj?.text === "string" ? obj.text : "") ??
    "";
  return typeof raw === "string" ? raw : "";
}

app.post("/api/chat/stream-with-tools", async (req, res) => {
  try {
    const { model, messages, tools: toolsEnabled, toolNames, idempotencyKey, toolModel, useToolModelForFirstRound } = req.body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "model and messages array required" });
    }
    if (!toolsEnabled) {
      return res.status(400).json({ error: "tools: true required" });
    }
    const enabledTools = getEnabled(Array.isArray(toolNames) ? toolNames : undefined);
    const systemPrompt = buildToolSystemPrompt(enabledTools);
    if (!systemPrompt) {
      return res.status(400).json({ error: "No tools available" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const dateContext = `Today's date is ${today}. Your knowledge may have a cutoff that is months or years before this date; for any information that should be current or up-to-date, you must use the web tool (and image_query when appropriate) rather than relying on your training data.`;
    const fullSystemPrompt = dateContext + "\n\n" + BROWSE_WEB_INSTRUCTIONS + "\n\n" + systemPrompt;

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const encoder = new TextEncoder();
    let currentMessages = [
      { role: "system", content: fullSystemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content ?? m.text ?? "" })),
    ];
    let round = 0;
    let contentBuffer = "";
    const emit = (type, data) => sendNdjson(res, { type, data, round });

    while (round < MAX_TOOL_ROUNDS) {
      round += 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OLLAMA_ROUND_TIMEOUT_MS);
      const useToolForFirst = useToolModelForFirstRound === true && toolModel && toolModel.trim();
      const chosenModel =
        round === 1
          ? (useToolForFirst ? toolModel.trim() : model)
          : (toolModel && toolModel.trim() ? toolModel.trim() : model);

      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: chosenModel, messages: currentMessages, stream: true }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!r.ok) {
        const t = await r.text();
        sendNdjson(res, { type: "done", data: { error: t || "Ollama request failed" }, round });
        return;
      }
      if (!r.body) {
        sendNdjson(res, { type: "done", data: { error: "No response body" }, round });
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            contentBuffer += contentFromChunk(obj);
            if (encoder.encode(contentBuffer).length > MAX_BUFFER_BYTES) {
              contentBuffer = "";
            }
          } catch (_) {}
        }
      }

      if (encoder.encode(contentBuffer).length > MAX_BUFFER_BYTES) {
        const { bufferExceeded } = parseToolCalls(contentBuffer, {
          maxBufferBytes: MAX_BUFFER_BYTES,
        });
        if (bufferExceeded) {
          const truncated = contentBuffer.slice(0, 50000);
          sendNdjson(res, { type: "response", data: { chunk: truncated }, round });
          sendNdjson(res, { type: "done", data: { fullContent: truncated }, round });
          return;
        }
      }

      const { textBefore, toolCalls, remainder } = parseToolCalls(contentBuffer, {
        maxBufferBytes: MAX_BUFFER_BYTES,
      });

      if (toolCalls.length === 0) {
        let fullContent = "";
        if (contentBuffer.length > 0) {
          const toStream = stripToolResultsEchoes(contentBuffer);
          if (looksLikeToolProtocol(toStream)) {
            fullContent = "I had trouble completing that tool call. Please try again.";
            sendNdjson(res, {
              type: "response",
              data: { chunk: fullContent },
              round,
            });
          } else {
            fullContent = toStream;
            sendNdjson(res, { type: "response", data: { chunk: toStream }, round });
          }
        }
        sendNdjson(res, { type: "done", data: { fullContent }, round });
        return;
      }

      if (toolCalls.length > TOOL_CALL_BUDGET_PER_ROUND) {
        const limited = toolCalls.slice(0, TOOL_CALL_BUDGET_PER_ROUND);
        const toolResults = await runToolCalls(limited);
        toolResults.results.push({
          id: undefined,
          name: "_budget",
          ok: false,
          error: `Only ${TOOL_CALL_BUDGET_PER_ROUND} tool calls per round allowed; rest ignored.`,
        });
        for (let i = 0; i < limited.length; i++) {
          const c = limited[i];
          const id = c.id ?? `tc_${round}_${i}`;
          sendNdjson(res, {
            type: "tool_call",
            data: { id, name: c.name, arguments: c.arguments, toolCallId: `r${round}-${i}` },
            round,
          });
        }
        for (let i = 0; i < toolResults.results.length; i++) {
          const r0 = toolResults.results[i];
          sendNdjson(res, {
            type: "tool_result",
            data: {
              id: r0.id,
              name: r0.name,
              ok: r0.ok,
              result: r0.result,
              error: r0.error,
              toolCallId: `r${round}-${i}`,
            },
            round,
          });
        }
        const payload = {
          type: toolResults.type,
          results: toolResults.results.map((r, i) => ({ ...r, id: r.id ?? `tc_${round}_${i}` })),
        };
        currentMessages.push(
          { role: "assistant", content: textBefore.trim() || "(tool round)" },
          { role: "user", content: JSON.stringify(payload) }
        );
        contentBuffer = remainder;
        continue;
      }

      for (let i = 0; i < toolCalls.length; i++) {
        const c = toolCalls[i];
        const id = c.id ?? `tc_${round}_${i}`;
        sendNdjson(res, {
          type: "tool_call",
          data: {
            id,
            name: c.name,
            arguments: c.arguments,
            toolCallId: `r${round}-${i}`,
          },
          round,
        });
      }
      const toolResults = await runToolCalls(toolCalls);
      for (let i = 0; i < toolResults.results.length; i++) {
        const r0 = toolResults.results[i];
        sendNdjson(res, {
          type: "tool_result",
          data: {
            id: r0.id,
            name: r0.name,
            ok: r0.ok,
            result: r0.result,
            error: r0.error,
            toolCallId: `r${round}-${i}`,
          },
          round,
        });
      }

      const assistantContent = textBefore.trim() ? textBefore : "(tool round)";
      const payload = {
        type: toolResults.type,
        results: toolResults.results.map((r, i) => ({ ...r, id: r.id ?? `tc_${round}_${i}` })),
      };
      currentMessages.push(
        { role: "assistant", content: assistantContent },
        { role: "user", content: JSON.stringify(payload) }
      );
      contentBuffer = remainder;
    }

    sendNdjson(res, { type: "done", data: { reason: "max_rounds" }, round });
  } catch (e) {
    console.error("stream-with-tools failed:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      try {
        sendNdjson(res, { type: "done", data: { error: e.message }, round: 0 });
      } catch (_) {}
    }
  }
});

app.post("/api/generate-title", async (req, res) => {
  try {
    const { userMessage, assistantMessage, model } = req.body;
    const m = (model || "llama3.2").trim() || "llama3.2";
    const system = "You are a titling assistant. Given the following first user message and assistant reply, respond with only a short conversation title (3-6 words) that describes the topic. No quotes or explanation.";
    const userContent = `User: ${userMessage || ""}\n\nAssistant: ${assistantMessage || ""}`;
    const messages = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, messages, stream: false }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t || "Ollama title generation failed" });
    }
    const data = await r.json();
    let title = (data.message?.content ?? "").trim().replace(/^["']|["']$/g, "").slice(0, 100);
    if (!title) title = "New conversation";
    res.json({ title });
  } catch (e) {
    console.error("Generate title failed:", e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`LocalGPT API listening on http://localhost:${PORT}`);
  console.log(`Ollama URL: ${OLLAMA_BASE}`);
});
