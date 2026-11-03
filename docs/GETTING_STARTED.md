# Getting Started — ReviewGraph AI

The complete, step-by-step guide: run the demo, explore the flagship pull request, ask the graph with Qwen3, connect Neo4j, and generate the presentation decks.

ReviewGraph AI is a **Neo4j + Qwen3 engineering intelligence agent** for reviewing AI-written code. It reasons over three layers — a **Code Intelligence Graph**, a hosted **Qwen3 coding LLM**, and **Agent Memory** — and never gives a verdict without cited graph evidence.

**Generic by design:** point at **any GitHub or GitLab repository** and **any Neo4j database** using only `.env` — no application code changes.

| Guide | When to read |
| --- | --- |
| [CONFIGURATION.md](CONFIGURATION.md) | Where to enter GitHub, GitLab, Neo4j, and Qwen3 details |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture with detailed diagrams |
| [TOKEN_ECONOMICS.md](TOKEN_ECONOMICS.md) | Graph vs frontier agents — LLM token cost model |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Complete list of what is built |
| [adr/](adr/) | Architecture decision records for the platform |

---

## 0. Concept in one picture

```text
 source/diff ──▶ ingest (seed / CSV) ──▶ Neo4j code graph ──▶ Qwen3 + REST API ──▶ React UI
                                                  │
                          Text2Cypher · reviewer recommendation · risk propagation
                          architectural compliance · incident-aware review · agent memory
```

---

## 1. Prerequisites

- **Node.js 20+** and **npm**.
- *(Optional)* A **Neo4j Aura** (free tier) or **Neo4j Desktop** instance. Not required for the demo — it runs on an in-memory graph.
- *(Optional)* **SS_TOKEN** and network access to the hosted Qwen3 endpoint for model explanations in Ask the Graph.

---

## 2. Install and run

```bash
npm install
cp .env.example .env   # optional: point at your repo + Neo4j
npm run dev
```

- API: `http://127.0.0.1:4000`
- UI: `http://127.0.0.1:5173` (use this URL — Vite proxies `/api` to the server)

The header shows the active **data source** (`demo`, `github`, or `gitlab`) and connected repository when configured. Click **Refresh** in the PR list to re-ingest after changing `.env` or opening new PRs on GitHub/GitLab.

Explore the three tabs:

- **Assessment** — explainable risk score with weighted, graph-cited evidence, plus impact chips for affected services, **recommended reviewers**, and **downstream services** (risk propagation).
- **Ask the Graph** — natural-language questions routed to Cypher (Text2Cypher), with the generated query shown.
- **Agent Memory** — decisions, lessons, and incidents, plus the assessments you commit.

---

## 3. Review any repository (GitHub or GitLab)

ReviewGraph AI is **generic across VCS hosts**: the same product reviews any repo you point it at. Configure `.env` only — no fork or code change required.

### Choose a data source

| `SOURCE` | When to use | What to set |
| --- | --- | --- |
| `demo` | Try the product offline | *(nothing — default)* |
| `github` | GitHub.com or GitHub Enterprise | `GITHUB_REPO`, `GITHUB_TOKEN` |
| `gitlab` | GitLab.com or **self-managed GitLab in your org** | `GITLAB_PROJECT`, `GITLAB_TOKEN`, `GITLAB_API` |

If `SOURCE` is omitted, GitLab is chosen when `GITLAB_PROJECT` is set; otherwise GitHub when `GITHUB_REPO` is set; otherwise demo.

### GitHub

```env
GITHUB_REPO=owner/repository
GITHUB_TOKEN=ghp_xxxxxxxx          # required for private repos
GITHUB_PR=512                      # optional: ingest one PR only
GITHUB_MAX_PRS=15
# GITHUB_API=https://github.example.com/api/v3   # Enterprise
```

### GitLab (organizations / self-hosted)

```env
GITLAB_PROJECT=group/subgroup/project   # or numeric project id
GITLAB_TOKEN=glpat-xxxxxxxx             # recommended; required for private projects
GITLAB_MR=42                            # optional: one merge request (IID)
GITLAB_MAX_MRS=15
GITLAB_API=https://gitlab.com/api/v4    # your instance: https://gitlab.company.com/api/v4
```

On startup the server:

1. Fetches open/recent merge requests (or pull requests) and their diffs.
2. Builds **File → Module → Service** structure from paths and import edges in the diff.
3. Loads **CODEOWNERS** (or `.gitlab/CODEOWNERS`) for reviewer recommendation.
4. Loads **`docs/reviewgraph-config.json`** (or `.reviewgraph.json` / `.github/reviewgraph.json`) — full file from the PR **head branch**, not truncated diff patches ([example](reviewgraph-config.example.json)).

Then run `npm run seed` to write the graph into Neo4j (any Bolt-compatible database).

### Neo4j (any instance)

```env
NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io   # Aura
# NEO4J_URI=bolt://localhost:7687             # Desktop / Docker
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
```

### Qwen3 hosted coding LLM

For Neo4j graph evidence with hosted Qwen3 explanations, configure your private `.env`:

```env
SS_TOKEN=your-private-token
QWEN_AGENT_MODE=primary
QWEN_MODEL=Qwen3-Coder-30B-A3B-Instruct
QWEN_API_URL=https://continue.ovh.di-ai.soprasteria.com/v1/chat/completions
QWEN_TIMEOUT_MS=300000
AURA_AGENT_MODE=off
```

Restart the server after editing `.env`. Ask the Graph retrieves evidence using the existing Cypher templates and Neo4j connection, then sends it with your question to Qwen3. Do not commit the token or place it in frontend variables. If Qwen3 fails or the token is missing, the deterministic graph answer is returned. Set `QWEN_AGENT_MODE=off` for local-only operation.

---

## 4. Explore the flagship scenario (demo mode)

Open **`PR-512`**. It reintroduces a `BillingService → AuthService` coupling that was previously reverted in `PR-312` and traced to `Incident-47`. ReviewGraph AI:

- flags it as **high risk** and cites every node behind the verdict,
- recommends the right **reviewers** (service owners + prior reviewers + security),
- shows the **downstream services** that could break, and
- reports that it **violates ADR-7**.

Try these questions in **Ask the Graph**:

| Question | Capability |
| --- | --- |
| *Why is this PR risky?* | evidence-cited risk explanation |
| *Who should review this PR?* | reviewer recommendation |
| *What could break if this merges?* | risk propagation |
| *Does this violate our architecture?* | architectural compliance |
| *Has a similar change caused problems before?* | incident-aware review |

---

## 5. The graph model

| Layer | Nodes | Tells you |
| --- | --- | --- |
| **L1 — Code Intelligence** | `Repository`, `PullRequest`, `File`, `Module`, `Service`, `Dependency`, `ReviewComment`, `IssueType`, `RiskPattern`, `Developer`, `Team` | what the AI changed and how the system is connected |
| **L2 — Operations & org** | `Incident`, `Deployment`, `Release`, `ADR`, `SecurityFinding` | impact, ownership, history, policy |
| **L3 — Agent Memory** | `Decision`, `Lesson`, `RiskAssessment`, `Evidence` | what we learned and decided |

The graph and feature selectors live in [`domains/codereview/model.js`](../domains/codereview/model.js); the explainable engine in [`domains/codereview/assess.js`](../domains/codereview/assess.js); Text2Cypher routing in [`domains/codereview/questions.js`](../domains/codereview/questions.js).

> Golden rule: **no verdict without evidence.** Every assessment's score is the sum of weighted evidence items, each with a severity and graph citations.

---

## 6. Connect to Neo4j Aura (production)

1. **Configure** — copy the env template and fill in credentials:

   ```bash
   cp .env.example .env
   # NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
   # NEO4J_USER / NEO4J_PASSWORD
   ```

2. **Seed directly via Bolt** (fastest):

   ```bash
   npm run seed
   ```

   With Neo4j configured, committing an assessment in the UI persists it to the graph (`(:PullRequest)-[:ASSESSED_AS]->(:RiskAssessment)-[:JUSTIFIED_BY]->(:Evidence)-[:CITES]->(...)`).

3. **Or bulk-import via CSV (`LOAD CSV`)**:

   ```bash
   npm run dataset            # -> data/processed/codereview/*.csv
   ```

   Upload the CSVs to a public raw URL, then in Aura Query set the base URL and run the import script:

   ```cypher
   :param baseUrl => "https://raw.githubusercontent.com/<user>/<repo>/main/data/processed/codereview/";
   ```

   Run [`domains/codereview/import.cypher`](../domains/codereview/import.cypher).

4. **Verify**:

   ```bash
   npm run aura:verify
   npm run aura:vectors    # optional: vector indexes for similarity search
   ```

---

## 7. Deploy the Aura agent (as code)

The agent is defined in [`domains/codereview/agent.json`](../domains/codereview/agent.json) — system prompt plus tools: `explain_pr_risk`, `recommend_reviewers`, `risk_propagation`, `architecture_compliance`, `related_incidents`, `tightly_coupled_modules`, Text2Cypher, and similarity search. Push it to your tenant via the Aura **v2beta1 `/agents`** API, or recreate the tools in the Aura Console. For a Free-tier MVP, the Text2Cypher-only path is documented in [docs/aura-console-agent-setup.md](aura-console-agent-setup.md).

---

## 8. Graph Evidence (UI)

The **Graph Evidence** panel below the assessment tabs shows the explainable subgraph for the selected PR:

- **Columns** — Change → Files → Modules → Services → Policies → Incidents → Lessons.
- **Red highlights** — risk paths (violations, forbidden deps, linked incidents).
- **Zoom & pan** — scroll to zoom, drag empty canvas to pan, toolbar +/- and fit, double-click to reset.
- **Metrics bar** — blast radius, security files, policy violations, evidence count.

---

## 9. Generate the presentation decks

```bash
npm run decks
# If PowerPoint has decks/dist open: DECKS_OUT=decks/dist-latest npm run decks
```

Produces four `.pptx` files in `decks/dist/`:

| File | Content |
| --- | --- |
| `01-business-overview.pptx` | Problem, idea, features, business value |
| `02-technical-overview.pptx` | Layers, schema, workflows, Aura, configuration |
| `03-getting-started.pptx` | Install, deploy, docs map, roadmap |
| `04-how-pr-analysis-works.pptx` | End-to-end PR analysis + 10‑minute demo script |

Slides are generated from the **live** code-review pack (`decks/build.js`), so they stay aligned with the code.

### Live GitHub demo (optional)

With `GITHUB_REPO` and `GITHUB_TOKEN` in `.env`, use **PR-9** (or your highest-risk open PR) for a realistic demo: subtle PR title, **Critical** score, and rich graph evidence when `docs/reviewgraph-config.json` is on the branch.

---

## 10. Where things live

| Path | Purpose |
| --- | --- |
| `server/index.js` | REST API (meta, entities, ask, assess, memory) |
| `server/memoryStore.js` | Agent memory (Neo4j or in-memory) |
| `domains/codereview/model.js` | Code Intelligence Graph + feature selectors |
| `domains/codereview/assess.js` | Explainable risk engine |
| `domains/codereview/questions.js` | Text2Cypher routing |
| `domains/codereview/agent.json` | The Aura agent defined as code |
| `decks/build.js` | `.pptx` generator |
| `docs/product-context.md` | Product vision + 3-layer graph model |

---

## Roadmap

- **Phase 1 — Foundation:** PRs, Files, Modules, Dependencies, Text2Cypher *(done)*
- **Phase 2 — Knowledge:** reviewer knowledge, ADRs, incidents *(done)*
- **Phase 3 — Memory:** agent memory, historical reasoning, learning from reviews *(in progress)*
- **Phase 4 — Autonomy:** autonomous review recommendations, risk scoring, architecture governance

---

## Troubleshooting

- **Port 4000 in use** — stop the other process or set `PORT` in `.env`.
- **UI says API unavailable** — run `npm run dev` (both API and Vite). Open `http://127.0.0.1:5173` (not only `:4000`). Click **Refresh** after the server finishes GitHub ingest (~15s).
- **PR risk score too low on live repo** — ensure `docs/reviewgraph-config.json` exists on the PR branch; click **Refresh** so the server reloads full config (not truncated patch).
- **UI shows "Neo4j fallback"** — expected without `NEO4J_*`; in-memory graph still works. Set Aura credentials and `npm run seed` for live Neo4j.
- **React duplicate key warnings in console** — fixed in latest build (deduplicated graph edges); hard-refresh the browser.
