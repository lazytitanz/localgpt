/**
 * File attachment tools: list, metadata, search, read chunk.
 * Require context.attachmentIds and context.db from runToolCalls.
 */

import { register } from "./registry.js";

function allowedIds(context) {
  const ids = context?.attachmentIds;
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.map((id) => (typeof id === "number" ? id : parseInt(id, 10))).filter(Number.isInteger));
}

register({
  name: "list_attached_files",
  description: "List the files attached to the current message. Use this to see which file_id values you can pass to other file tools.",
  parameters: {},
  handler: async (args, context) => {
    const allowed = allowedIds(context);
    const db = context?.db;
    if (!db) return { error: "File tools are not available." };
    if (allowed.size === 0) return { files: [], note: "No files are attached to this message." };
    const placeholders = Array.from(allowed).map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, filename, line_count, size_bytes FROM attachments WHERE id IN (${placeholders}) ORDER BY id`
    ).all(...allowed);
    return {
      files: rows.map((r) => ({
        file_id: r.id,
        filename: r.filename,
        line_count: r.line_count,
        size_bytes: r.size_bytes,
      })),
    };
  },
});

register({
  name: "get_file_metadata",
  description: "Get metadata for one attached file (filename, line count, size).",
  parameters: { file_id: "attachment id from list_attached_files" },
  handler: async (args, context) => {
    const allowed = allowedIds(context);
    const db = context?.db;
    if (!db) return { error: "File tools are not available." };
    const fileId = typeof args?.file_id === "number" ? args.file_id : parseInt(args?.file_id, 10);
    if (!Number.isInteger(fileId) || !allowed.has(fileId)) {
      return { error: "Unknown or not allowed file_id. Use list_attached_files to see valid ids." };
    }
    const row = db.prepare("SELECT id, filename, line_count, size_bytes, mime_type FROM attachments WHERE id = ?").get(fileId);
    if (!row) return { error: "File not found." };
    return {
      file_id: row.id,
      filename: row.filename,
      line_count: row.line_count,
      size_bytes: row.size_bytes,
      mime_type: row.mime_type ?? undefined,
    };
  },
});

register({
  name: "read_file_chunk",
  description: "Read a range of lines from an attached file. Lines are 1-based. Use get_file_metadata to know line_count.",
  parameters: {
    file_id: "attachment id",
    start_line: "first line (1-based)",
    end_line: "last line (1-based, inclusive)",
  },
  handler: async (args, context) => {
    const allowed = allowedIds(context);
    const db = context?.db;
    if (!db) return { error: "File tools are not available." };
    const fileId = typeof args?.file_id === "number" ? args.file_id : parseInt(args?.file_id, 10);
    if (!Number.isInteger(fileId) || !allowed.has(fileId)) {
      return { error: "Unknown or not allowed file_id." };
    }
    const meta = db.prepare("SELECT filename, line_count FROM attachments WHERE id = ?").get(fileId);
    if (!meta) return { error: "File not found." };
    let start = typeof args?.start_line === "number" ? args.start_line : parseInt(args?.start_line, 10);
    let end = typeof args?.end_line === "number" ? args.end_line : parseInt(args?.end_line, 10);
    if (!Number.isInteger(start)) start = 1;
    if (!Number.isInteger(end)) end = meta.line_count;
    start = Math.max(1, Math.min(start, meta.line_count));
    end = Math.max(1, Math.min(end, meta.line_count));
    if (start > end) [start, end] = [end, start];
    const chunks = db.prepare(
      "SELECT start_line, end_line, content FROM attachment_chunks WHERE attachment_id = ? AND end_line >= ? AND start_line <= ? ORDER BY chunk_index"
    ).all(fileId, start, end);
    const lines = [];
    for (const ch of chunks) {
      const chunkLines = ch.content.split(/\r?\n/);
      const chunkStart = ch.start_line;
      for (let i = 0; i < chunkLines.length; i++) {
        const lineNum = chunkStart + i;
        if (lineNum >= start && lineNum <= end) lines.push({ line: lineNum, text: chunkLines[i] });
      }
    }
    const content = lines.map((l) => l.text).join("\n");
    return {
      file: meta.filename,
      file_id: fileId,
      start_line: start,
      end_line: end,
      content: `[TOOL RESULT: read_file_chunk]\nfile: ${meta.filename}\nlines: ${start}-${end}\n\n${content}`,
    };
  },
});

register({
  name: "search_file",
  description: "Search for a keyword or phrase in an attached file. Returns matching line numbers and excerpts.",
  parameters: {
    file_id: "attachment id",
    query: "search string (case-insensitive)",
    top_k: "max number of matches to return (default 10)",
  },
  handler: async (args, context) => {
    const allowed = allowedIds(context);
    const db = context?.db;
    if (!db) return { error: "File tools are not available." };
    const fileId = typeof args?.file_id === "number" ? args.file_id : parseInt(args?.file_id, 10);
    if (!Number.isInteger(fileId) || !allowed.has(fileId)) {
      return { error: "Unknown or not allowed file_id." };
    }
    const query = (args?.query != null && String(args.query).trim()) ? String(args.query).trim() : "";
    if (!query) return { error: "Missing required argument: query" };
    let topK = 10;
    if (args?.top_k != null) {
      const n = parseInt(args.top_k, 10);
      if (Number.isInteger(n)) topK = Math.min(50, Math.max(1, n));
    }
    const meta = db.prepare("SELECT filename FROM attachments WHERE id = ?").get(fileId);
    if (!meta) return { error: "File not found." };
    const chunks = db.prepare("SELECT start_line, end_line, content FROM attachment_chunks WHERE attachment_id = ? ORDER BY chunk_index").all(fileId);
    const lowerQuery = query.toLowerCase();
    const matches = [];
    for (const ch of chunks) {
      const lines = ch.content.split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < topK; i++) {
        const lineNum = ch.start_line + i;
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          const before = Math.max(0, i - 2);
          const after = Math.min(lines.length - 1, i + 2);
          const excerpt = lines.slice(before, after + 1).join("\n");
          matches.push({
            line: lineNum,
            excerpt: `[TOOL RESULT: search_file] file: ${meta.filename} line: ${lineNum}\n${excerpt}`,
          });
        }
      }
    }
    return {
      file: meta.filename,
      file_id: fileId,
      query,
      matches: matches.slice(0, topK),
    };
  },
});
