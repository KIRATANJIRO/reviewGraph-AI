# ReviewGraph AI

> **A Neo4j + Qwen3 engineering intelligence agent that combines code relationships, architectural knowledge, and persistent memory to deliver explainable code reviews and impact analysis for AI-written code.**

Most AI reviewers only see the **current diff**. ReviewGraph AI reasons over the *context* a senior engineer actually uses:

```text
Current Diff
  + Architecture (services, modules, dependencies, ADRs)
  + History (similar PRs, past reviews)
  + Incidents (what broke before)
  + Team Knowledge (ownership, expertise)
  + Previous Decisions (risk + architecture rulings)
```

Because code review is fundamentally a **context problem**, not a diff problem — and that gap is widening as more code is written by AI.

> **Start here:** [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) (where to enter credentials) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (diagrams) · [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) (what is built) · [docs/adr/](docs/adr/) (ADRs)

**Yes — it is generic:** configure **any GitHub or GitLab repo**, **any Neo4j database**, and the hosted **Qwen3** coding model via `.env` only. See [Generic repo setup](docs/GENERIC_REPO_SETUP.md) and [Configuration](docs/CONFIGURATION.md).

## The three layers

### Layer 1 — Code Intelligence Graph

The core knowledge graph of the engineering system:

```text
Repository · PR · File · Module · Service · Dependency
ReviewComment · IssueType · RiskPattern · Developer · Team
```

### Layer 2 — Agent Reasoning (Qwen3)

Natural-language questions are answered over the graph:

```text
User Question → Text2Cypher → Neo4j Graph Query → Graph Results → Qwen3 LLM Explanation
```

### Layer 3 — Agent Memory

Persistent organizational memory so the agent can answer *"have we seen this before?"*, not only *"what exists now?"*:

```text
Past Reviews · Risk Decisions · Architecture Decisions · Incidents · Reviewer Feedback
```

> **Today:** "AuthModule depends on UserModule."
> **With graph-backed agent memory:** "This dependency pattern appeared in PR-156 and PR-201. Both were later linked to production incidents involving token-validation failures. Security recommended avoiding this coupling in ADR-17."

## Features

| Feature | Question it answers | How the graph answers it |
| --- | --- | --- |
| **Reviewer recommendation** | *Who should review this PR?* | service ownership + prior reviewers of the same files + security sensitivity |
| **Risk propagation** | *What could break if this merges?* | `PR → Files → Modules → Services → Consumers` traversal |
| **Architectural compliance** | *Does this violate our architecture?* | checks introduced dependencies against ADRs / forbidden-dependency decisions |
| **Incident-aware review** | *Has a similar change caused problems before?* | searches incidents, postmortems, and historical PRs |

Every answer follows the same rule: **no verdict without evidence.** Each assessment is built from weighted, graph-cited evidence you can trace back to specific nodes.

## Review any repository (GitHub or GitLab)

No code changes — only credentials in `.env`. ReviewGraph ingests merge/pull requests, changed files, review comments, and CODEOWNERS, then runs the same explainable assessment engine.

| Provider | Required | Optional |
| --- | --- | --- |
| **Demo** (default) | — | built-in `PR-512` scenario |
| **GitHub** | `GITHUB_REPO=owner/name` | `GITHUB_TOKEN`, `GITHUB_PR`, `GITHUB_API` (Enterprise) |
| **GitLab** | `GITLAB_PROJECT=group/project` | `GITLAB_TOKEN`, `GITLAB_MR`, `GITLAB_API` (self-hosted) |

```bash
cp .env.example .env
# GitHub example:
# GITHUB_REPO=myorg/my-service
# GITHUB_TOKEN=ghp_...

# GitLab (GitLab.com or your organization's self-hosted instance):
# GITLAB_PROJECT=mygroup/my-service
# GITLAB_TOKEN=glpat-...
# GITLAB_API=https://gitlab.mycompany.com/api/v4

npm run dev
```

Add org rules in the target repo as `docs/reviewgraph-config.json` (or `.reviewgraph.json` at the root). The ingest layer loads the **full JSON from the PR head branch** (GitHub truncates large config in diff patches). See [`docs/reviewgraph-config.example.json`](docs/reviewgraph-config.example.json).

Point **any Neo4j** database (Aura, Desktop, Docker) with `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD`, then `npm run seed` to persist the ingested graph.

For hosted Qwen3 explanations, set these server-only values in your private `.env`:

```env
SS_TOKEN=your-private-token
QWEN_AGENT_MODE=primary
QWEN_MODEL=Qwen3-Coder-30B-A3B-Instruct
AURA_AGENT_MODE=off
```

The default endpoint is `https://continue.ovh.di-ai.soprasteria.com/v1/chat/completions`. Questions and graph evidence are sent there; database and VCS credentials are not. Never commit `SS_TOKEN` or put it in a `VITE_*` variable. Missing credentials or failed requests return the deterministic local graph answer. Set `QWEN_AGENT_MODE=off` to use only the local router (or the optional Aura agent).

Run the mocked integration checks with `npm test`.

## Quick start

```bash
npm install        # app + deck dependencies
npm run dev        # API on :4000, UI on :5173
```

Without `GITHUB_REPO` or `GITLAB_PROJECT`, the built-in demo opens **`PR-512`**. With a live repo configured, the UI lists that repository's real merge requests. Connect Neo4j Aura when you want to persist memory.

Generate the presentation decks (real `.pptx`):

```bash
npm run decks      # -> decks/dist/*.pptx (four decks; use DECKS_OUT=decks/dist-latest if dist is locked)
```

| Deck | Audience |
| --- | --- |
| `01-business-overview.pptx` | Problem, value, positioning |
| `02-technical-overview.pptx` | Layers, schema, Aura, configuration |
| `03-getting-started.pptx` | Install, deploy, docs map |
| `04-how-pr-analysis-works.pptx` | End-to-end PR analysis + 10‑min demo script |

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/meta` | Product branding + vocabulary |
| GET | `/api/health` | Neo4j connectivity (or in-memory fallback) |
| GET | `/api/entities` | Pull requests with computed risk score/level |
| GET | `/api/entities/:id` | Explainable assessment + graph-evidence view (incl. recommended reviewers + downstream impact) |
| POST | `/api/ask` | Natural-language question → Text2Cypher answer |
| POST | `/api/assess` | Compute and commit an assessment to agent memory |
| POST | `/api/reload` | Re-ingest from GitHub/GitLab and re-sync Neo4j |
| GET | `/api/memory` | Agent memory: decisions, lessons, incidents, recent assessments |
| POST | `/api/cypher` | Raw Cypher — **off by default** (`ENABLE_DEV_CYPHER=true`, dev only) |

## Architecture in code

```text
server/index.js             API: /api/meta, /api/entities, /api/ask, /api/assess, /api/memory
server/memoryStore.js       Agent memory (records assessments to Neo4j or in-memory)
server/seed.js              Seed runner
scripts/prepareDataset.js   CSV exporter -> data/processed/codereview/
src/main.jsx                React UI (explainable assessment + graph evidence + agent chat)
decks/build.js              Generates the .pptx decks

domains/codereview/         ReviewGraph AI: model, assess, questions (Text2Cypher),
                            present, knowledge (memory), seed, ingest, agent.json, import.cypher
```

**Aura Agent** is integrated three ways: (1) **local router** — `POST /api/ask` + [`questions.js`](domains/codereview/questions.js); (2) **hosted in-app** — set `AURA_CLIENT_ID`, `AURA_CLIENT_SECRET`, and `AURA_AGENT_INVOKE_URL` so Ask the Graph calls your Aura Agent via [`server/auraAgent.js`](server/auraAgent.js); (3) **Aura Console** — same tools from [`agent.json`](domains/codereview/agent.json) ([setup](docs/aura-console-agent-setup.md)). See [AURA_LIVE_INTEGRATION.md](docs/AURA_LIVE_INTEGRATION.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [GETTING_STARTED.md](docs/GETTING_STARTED.md) | Install, run, review a live repo |
| [GENERIC_REPO_SETUP.md](docs/GENERIC_REPO_SETUP.md) | Point at any repo with `.env` only |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | `.env`, UI, Aura Console — where to enter details |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture with diagrams |
| [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Full implementation checklist |
| [product-context.md](docs/product-context.md) | Product vision and graph layers |
| [aura-agent.md](docs/aura-agent.md) | Aura agent tools and prompts |
| [AURA_LIVE_INTEGRATION.md](docs/AURA_LIVE_INTEGRATION.md) | Live Neo4j + Text2Cypher: what works in-app vs Aura Console |
| [SECURITY.md](docs/SECURITY.md) | Credentials on server only; API sanitization and endpoint risks |
| [TOKEN_ECONOMICS.md](docs/TOKEN_ECONOMICS.md) | Graph vs frontier agents — when you save LLM tokens (and when you do not) |
| [adr/](docs/adr/) | Architecture decision records |

## Deploy to Neo4j Aura

```bash
cp .env.example .env          # set NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD
npm run seed                  # direct seed via Bolt
npm run dataset               # export CSVs to data/processed/codereview/
# then upload CSVs to a public raw URL and run domains/codereview/import.cypher in Aura
npm run aura:verify
```

## Roadmap

- **Phase 1 — Foundation:** PRs, Files, Modules, Dependencies, Text2Cypher *(done)*
- **Phase 2 — Knowledge:** reviewer knowledge, ADRs, incidents *(done)*
- **Phase 3 — Memory:** agent memory, historical reasoning, learning from reviews *(in progress)*
- **Phase 4 — Autonomy:** autonomous review recommendations, risk scoring, architecture governance

## Example scenario

Open `PR-512`: it reintroduces a `BillingService → AuthService` coupling that was previously reverted in `PR-312` and traced to `Incident-47`. ReviewGraph AI flags it as high risk, **cites all of it**, recommends the right reviewers, and shows which downstream services could break — and that it violates **ADR-7**.
