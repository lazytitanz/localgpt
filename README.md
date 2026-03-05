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
Tool use (web search, image search, etc.) uses a split-model design:

- **Conversational model** – The one you pick in the main topbar: handles the first reply and general dialogue. Strong at reasoning, coding, tone, and long context; decides when to delegate to tools.
- **Tool-call specialist** – Optional. In **Settings** (gear icon, top right), you can choose a separate “Model for tool calls” from your Ollama list. That model is used for tool steps (rounds after the first reply). If you leave it as “Same as conversation”, the conversational model is used for every round. The choice is saved in the browser.
- **Use tool model for first reply** – When a tool-call model is set, a checkbox in Settings lets you use that model for the first reply too when tools are enabled, so one model handles the whole tool flow.
- **Validator / repair step** – The server tries to repair minor JSON issues in tool calls (e.g. trailing commas) before execution, so small format slips are less likely to break the flow.

If you still see “(No response)” or broken behavior when tools are on, try a different conversational or tool-call model, or disable tools for that chat.
