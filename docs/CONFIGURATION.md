# Configuration — where to enter your details

ReviewGraph AI is **generic**: the same application reviews code from **any GitHub or GitLab repository** and persists to **any Neo4j database** that speaks Bolt. You configure everything in **one file**: `.env` at the project root (copy from [`.env.example`](../.env.example)).

There is no separate “agent credentials UI” in the React app for Neo4j or VCS — those are **server-side** environment variables loaded at startup.

---

## Quick reference

| What you want | Where to configure | Variables |
| --- | --- | --- |
| **Review a GitHub repo** | `.env` | `GITHUB_REPO`, `GITHUB_TOKEN` (optional `GITHUB_PR`, `GITHUB_MAX_PRS`, `GITHUB_API`) |
| **Review a GitLab project** | `.env` | `GITLAB_PROJECT`, `GITLAB_TOKEN`, `GITLAB_API` (self-hosted), `GITLAB_MR`, `GITLAB_MAX_MRS` |
| **Use built-in demo** | `.env` | Leave `GITHUB_*` and `GITLAB_*` unset, or `SOURCE=demo` |
| **Any Neo4j database** | `.env` | `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, optional `NEO4J_DATABASE` |
| **Hosted Qwen3 coding LLM** | Server `.env` | `SS_TOKEN`, optional `QWEN_MODEL`, `QWEN_API_URL`, `QWEN_AGENT_MODE`, `QWEN_TIMEOUT_MS` |
| **Architecture rules for your repo** | **In the target repository** | `.reviewgraph.json` at repo root ([example](reviewgraph-config.example.json)) |
| **CODEOWNERS / ownership** | **In the target repository** | `CODEOWNERS`, `.github/CODEOWNERS`, or `.gitlab/CODEOWNERS` |
| **Hosted Neo4j Aura Agent** | Optional alternative | Leave `AURA_AGENT_MODE=off` when using Qwen3 |
| **API port** | `.env` | `PORT` (default `4000`) |

---

## 1. `.env` — application credentials

Create `.env` from the template:

```bash
cp .env.example .env
```

### Data source selection

| Mode | Configuration |
| --- | --- |
| **Auto** | Omit `SOURCE`. Uses GitLab if `GITLAB_PROJECT` is set; else GitHub if `GITHUB_REPO` is set; else **demo**. |
| **Explicit** | `SOURCE=demo` \| `SOURCE=github` \| `SOURCE=gitlab` |

### GitHub

```env
SOURCE=github
GITHUB_REPO=myorg/my-service
GITHUB_TOKEN=ghp_xxxxxxxx
GITHUB_PR=512
GITHUB_MAX_PRS=15
GITHUB_API=https://api.github.com
```

- **Public repos:** token optional (rate limits apply).
- **Private repos / Enterprise:** token required; set `GITHUB_API` for GitHub Enterprise Server.

### GitLab (organizations & self-hosted)

```env
SOURCE=gitlab
GITLAB_PROJECT=mygroup/subgroup/my-service
GITLAB_TOKEN=glpat-xxxxxxxx
GITLAB_API=https://gitlab.mycompany.com/api/v4
GITLAB_MR=42
GITLAB_MAX_MRS=15
```

- **GitLab.com:** default `GITLAB_API` is `https://gitlab.com/api/v4`.
- **Self-managed:** use your instance’s API base URL (must end with `/api/v4`).

### Neo4j (any Bolt-compatible database)

```env
NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

Works with:

- **Neo4j Aura** (`neo4j+s://…`)
- **Neo4j Desktop** (`bolt://localhost:7687`)
- **Docker / self-hosted** Neo4j 5.x

If **Neo4j vars are unset**, the app still runs using an **in-memory graph** (demo / ingested data in RAM). `/api/health` reports `neo4j: "fallback"`.

After changing `.env`, restart the server:

```bash
npm run dev
npm run seed    # write current graph into Neo4j
```

### Hosted Qwen3 coding model

Use **Neo4j + Qwen3** through the OpenAI-compatible chat-completions endpoint. No Ollama installation or additional npm dependency is needed.

```env
SS_TOKEN=your-private-token
QWEN_AGENT_MODE=primary
QWEN_API_URL=https://continue.ovh.di-ai.soprasteria.com/v1/chat/completions
QWEN_MODEL=Qwen3-Coder-30B-A3B-Instruct
QWEN_TIMEOUT_MS=300000
AURA_AGENT_MODE=off
```

`POST /api/ask` routes the question to the canonical Cypher templates, runs those rows against Neo4j when configured, and sends the question, local answer, graph rows, and deterministic assessment to Qwen3. Only the server sends `Authorization: Bearer <SS_TOKEN>`. Check repository data-sharing requirements before using the hosted endpoint.

If the token is missing or Qwen3 fails, the API returns the local graph-router answer with a sanitized `qwenError`. Set `QWEN_AGENT_MODE=off` to disable Qwen3; old `OLLAMA_*` settings are no longer used. Restart the server after editing `.env`.

Health and metadata do not invoke paid chat requests. They report `not_checked` until the first request, then the most recent success or failure (not a continuous connectivity probe). The UI shows **Configured** before the first request and **Live** after success.

---

## 2. In the UI — what you enter

The React UI (`http://127.0.0.1:5173`) does **not** store Neo4j or Git tokens. You interact with:

| UI area | What you do |
| --- | --- |
| **Sidebar** | Select a pull request / merge request (loaded from demo or live ingest) |
| **Risk Assessment** | View explainable score, evidence, impacts, recommended reviewers |
| **Ask the Graph** | Type natural-language questions; optional entity id in API body |
| **Agent Memory** | View decisions / lessons / incidents; **Commit to memory** persists assessment |

The header shows **data source** (`github`, `gitlab`, `demo`) and **repository name** when live ingest succeeded.

---

## 3. Ask the Graph - hosted Qwen3 path

ReviewGraph uses Qwen3 as the default reasoning path, with deterministic local fallback.

### A. Built-in graph router

| Component | Role |
| --- | --- |
| [`domains/codereview/questions.js`](../domains/codereview/questions.js) | Text2Cypher-style routing: NL question → category → canonical Cypher |
| [`domains/codereview/agent.json`](../domains/codereview/agent.json) | Agent definition **as code**: system prompt + tool Cypher templates |
| [`server/index.js`](../server/index.js) `POST /api/ask` | Runs Cypher on Neo4j when connected; returns answer + `rows` + `cypher` |
| [`domains/codereview/assess.js`](../domains/codereview/assess.js) | Explainable risk engine (graph evidence, no external LLM required) |

Flow:

```text
UI "Ask the Graph" → POST /api/ask → questions.js → Neo4j (if configured) → JSON answer
```

### B. Qwen3 Agent **inside the React app**

Set `SS_TOKEN` in the private server `.env`. The server calls `QWEN_API_URL` with `Qwen3-Coder-30B-A3B-Instruct` by default. The model explains the graph-grounded answer; it does **not** receive database credentials or generate arbitrary Cypher.

### C. Optional hosted Aura Agent

Aura is not needed for Qwen3. Keep it disabled unless you specifically want to test the hosted Neo4j Aura Agent path (set `QWEN_AGENT_MODE=off` in that case):

```env
AURA_AGENT_MODE=off
```

If you later enable the hosted path, add to `.env` (see `.env.example`):

| Variable | Where to get it |
| --- | --- |
| `AURA_CLIENT_ID` / `AURA_CLIENT_SECRET` | Aura Console → Account → API Keys |
| `AURA_AGENT_INVOKE_URL` | Agents → your agent → External access → invoke URL |
| `AURA_AGENT_MODE` | `primary` for hosted Aura, `off` when using Qwen3 |

[`server/auraAgent.js`](../server/auraAgent.js) obtains an OAuth token and calls the invoke URL. `POST /api/ask` uses Aura when `QWEN_AGENT_MODE=off` and `AURA_AGENT_MODE=primary`; otherwise Qwen3 takes priority.

### D. Hosted Neo4j Aura Agent (Aura Console UI)

Deploy the same tools to your **Aura tenant**:

1. Seed graph: `npm run seed` (or CSV import via `domains/codereview/import.cypher`).
2. Follow [aura-console-agent-setup.md](aura-console-agent-setup.md) to create **ReviewGraph AI** in Aura Console.
3. Mirror tools from [`agent.json`](../domains/codereview/agent.json) (or push via Aura Agents API v2beta1).
4. Optional: `npm run aura:vectors` for similarity search indexes.

Use **B** for the same LLM experience in this app; use **C** for a standalone Console chat.

See [AURA_LIVE_INTEGRATION.md](AURA_LIVE_INTEGRATION.md) for paths, API shape, and troubleshooting.

---

## 4. Repository-level config (your codebase under review)

Commit in the **repository being reviewed** (not in ReviewGraph AI’s repo):

### `.reviewgraph.json`

Declares ADRs, forbidden dependencies, security path globs. See [reviewgraph-config.example.json](reviewgraph-config.example.json).

### `CODEOWNERS`

Standard GitHub/GitLab ownership file — used for **reviewer recommendation**.

---

## 5. Verify configuration

```bash
# Health: source + Neo4j
curl http://127.0.0.1:4000/api/health

# Meta: repository, dataSource, flagship PR
curl http://127.0.0.1:4000/api/meta

# Aura graph smoke test (Neo4j required)
npm run aura:verify
```

Expected `/api/meta` fields when live:

- `dataSource`: `github` | `gitlab` | `demo`
- `repository`: `{ name, url, language }`
- `flagshipEntityId`: e.g. `PR-512` or first ingested MR
