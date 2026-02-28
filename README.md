# LocalGPT

A local chat app that uses [Ollama](https://ollama.com/) for LLM responses. The backend stores conversations in SQLite and can optionally use [Tavily](https://tavily.com/) for web search and image search.

## Overview

- **Frontend**: React + Vite. Chat UI with conversation sidebar, markdown and code rendering, and streaming responses.
- **Backend**: Node (Express) API that talks to Ollama, persists conversations in `server/localgpt.db`, and can call Tavily for up-to-date web and image results when configured.
- **Run locally**: No cloud LLM required; everything runs on your machine (plus optional Tavily API).

## Prerequisites

- **Node.js** (v18 or later)
- **Ollama** installed and running (e.g. `ollama serve`), with at least one model pulled (e.g. `ollama pull llama3.2`)
- **Tavily** (optional): API key from [Tavily](https://app.tavily.com) for web/search and image tools

## Getting started

1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd localgpt
   ```

2. **Environment**
   - Copy the example env file and edit as needed:
     ```bash
     cp .env.example .env
     ```
   - In `.env`:
     - Set `OLLAMA_BASE_URL` to your Ollama URL (default `http://localhost:11434` if Ollama runs on the same machine).
     - Leave `TAVILY_API_KEY` empty to skip web/image search, or set it (e.g. `tvly-...`) to enable those tools.
     - For local dev you can leave `VITE_API_URL=http://localhost:3001`; the Vite dev server proxies `/api` to the backend.

3. **Install dependencies**
   - From the project root:
     ```bash
     npm install
     cd server && npm install && cd ..
     ```

4. **Run the app**
   - Terminal 1 – backend:
     ```bash
     npm run server
     ```
   - Terminal 2 – frontend:
     ```bash
     npm run dev
     ```
   - Open the URL Vite prints (e.g. `http://localhost:5173`). The UI will use the proxied `/api` so the frontend talks to your local backend.

## Scripts

| Script       | Description                    |
|-------------|--------------------------------|
| `npm run dev`     | Start Vite dev server (frontend) |
| `npm run server`  | Start Node API server (backend)   |
| `npm run build`   | Build frontend for production     |
| `npm run preview` | Preview production build          |
| `npm run lint`    | Run ESLint                        |

## Configuration

| Variable         | Purpose |
|------------------|--------|
| `API_PORT`       | Port for the backend (default 3001) |
| `OLLAMA_BASE_URL`| Ollama server URL (e.g. `http://localhost:11434`) |
| `TAVILY_API_KEY` | Optional; enables web and image search tools |
| `VITE_API_URL`   | Base URL for API from the browser (use `http://localhost:3001` or leave as-is when using Vite proxy) |

The SQLite database is created automatically at `server/localgpt.db` on first run; it is not committed (see `.gitignore`).

## Plans / roadmap

**Tool calling and model behavior**  
Tool use (web search, image search, etc.) is driven by the same model you chat with. Some models handle the tool-call protocol reliably; others miss the format, drop content after calling tools, or emit invalid JSON. If you see “(No response)” or broken behavior when tools are enabled, try another model or disable tools for that conversation. In the future we may tighten requirements so that tool-capable flows use a model known to handle tool calls well.

**Possible future: router + executor**  
A longer-term direction is to split roles instead of asking one model to do everything:

- **Conversational model** – The one you “talk to”: strong at reasoning, coding, tone, and long context. Handles the dialogue and decides when to delegate to tools.
- **Tool-call specialist** – A smaller or dedicated model that is tuned (or constrained) to emit valid, schema-correct tool calls. Used only for the tool step, so it doesn’t need to be best-in-class at general chat.
- **Validator / repair step** (optional) – A pass that parses and fixes malformed tool calls before execution, so minor format slips don’t break the flow.

That design would make tool use more reliable across a wider set of base models while keeping the main chat experience on the model you prefer.
