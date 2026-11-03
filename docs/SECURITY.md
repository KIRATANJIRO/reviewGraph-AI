# Security model

ReviewGraph keeps **all secrets on the server**. The React UI only talks to `http://127.0.0.1:4000` (or your deployed API); it never receives Neo4j passwords, Aura API keys, or GitHub/GitLab tokens.

---

## What stays server-side

| Secret | Location | Used for |
| --- | --- | --- |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | `.env` | Bolt driver in `server/neo4j.js` |
| `AURA_CLIENT_ID`, `AURA_CLIENT_SECRET`, `AURA_AGENT_INVOKE_URL` | `.env` | OAuth + invoke in `server/auraAgent.js` |
| `GITHUB_TOKEN`, `GITLAB_TOKEN` | `.env` | Ingest only (`domains/codereview/sources/`) |
| `SS_TOKEN` | Private server `.env` | Bearer authentication in `server/qwenAgent.js` |

Do not commit `.env`. Do not add `VITE_*` variables for these values — Vite would embed them in the client bundle.

Qwen3 receives the question, repository label, local graph answer, graph rows, and risk assessment at the configured HTTPS endpoint. Database and VCS credentials are not included. Verify that sharing this repository evidence with the endpoint is permitted. Requests do not follow redirects, and upstream error bodies are not returned to the browser or logged.

---

## API responses (sanitized)

`server/clientSafe.js` strips before JSON reaches the browser:

- Aura **invoke URLs** (org/agent paths)
- **`rawContent`** from Aura responses
- **OAuth / HTTP error bodies** (generic messages only)
- Token-like patterns (`ghp_`, `glpat-`, `Bearer …`, Bolt URIs, etc.)
- Detailed **`sourceError`** from ingest (UI gets `sourceWarning` only)

`/api/health` and `/api/meta` expose only:

```json
"auraAgent": { "enabled": true, "mode": "primary", "ready": true }
```

---

## Endpoints and risk

| Endpoint | Risk | Mitigation |
| --- | --- | --- |
| `POST /api/ask` | Runs templated or Aura-mediated graph queries | No user-supplied Cypher; Aura credentials server-only |
| `POST /api/cypher` | **Arbitrary Cypher** if enabled | **Disabled by default**; set `ENABLE_DEV_CYPHER=true` only for local debugging |
| `GET /api/*` | Read model / memory | No secrets in payloads |

---

## Network defaults

- **`HOST=127.0.0.1`** — API not exposed on all interfaces by default.
- **CORS** — Allowed origins from `CORS_ORIGIN` (default Vite dev URLs). Other browser origins are rejected.
- **Body limit** — `64kb` on JSON routes.

For production, put the API behind HTTPS and authentication; this repo is oriented to local/demo use.

---

## Checklist before sharing or deploying

1. `.env` is in `.gitignore` and not in the client build.
2. `ENABLE_DEV_CYPHER` is unset or `false` in shared environments.
3. `HOST` and firewall rules match your exposure needs.
4. Aura API keys are rotated if they were ever logged or committed.

See also [CONFIGURATION.md](CONFIGURATION.md) and [AURA_LIVE_INTEGRATION.md](AURA_LIVE_INTEGRATION.md).
