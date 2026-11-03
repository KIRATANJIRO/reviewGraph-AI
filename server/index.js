// ReviewGraph AI - API server.
//
// Domain-agnostic: it loads the active domain pack (DOMAIN env, default
// codereview) and exposes the same endpoints for every domain. The pack
// supplies the data, the explainable assessments, the question routing, and
// the agent memory.

import "./loadEnv.js";
import cors from "cors";
import express from "express";
import { runCypher, getDriver } from "./neo4j.js";
import { loadDomainPack, ACTIVE_DOMAIN } from "./domain/loader.js";
import { recordAssessment, memorySnapshot } from "./memoryStore.js";
import {
  isAuraAgentEnabled,
  invokeAuraAgent,
  getAuraAgentStatus,
  formatAssessmentBrief
} from "./auraAgent.js";
import {
  isQwenAgentEnabled,
  invokeQwenAgent,
  getQwenAgentStatus
} from "./qwenAgent.js";
import {
  publicAuraAgentStatus,
  publicQwenAgentStatus,
  publicMeta,
  sanitizeAskResponse,
  sanitizeClientError
} from "./clientSafe.js";

const pack = await loadDomainPack();
let initResult = {};
if (typeof pack.init === "function") {
  initResult = await pack.init();
  const syncNote = initResult.neo4jSync?.synced
    ? `, neo4j synced (${initResult.neo4jSync.statements} statements)`
    : initResult.neo4jSync?.reason
      ? `, neo4j sync skipped (${initResult.neo4jSync.reason})`
      : "";
  console.log(
    `[ReviewGraph] source=${initResult.source} entities=${initResult.entities}${initResult.repo ? ` repo=${initResult.repo}` : ""}${initResult.project ? ` project=${initResult.project}` : ""}${syncNote}`
  );
  if (initResult.entities === 0 && initResult.error) {
    console.warn(`[ReviewGraph] Ingest produced no entities. Fix .env and restart. ${initResult.error}`);
  }
}

function auraContext() {
  return {
    repository: pack.meta.repository?.name || initResult.repo || initResult.project,
    dataSource: pack.meta.dataSource
  };
}
const app = express();
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "127.0.0.1";
const corsOrigins = (process.env.CORS_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Dev: allow localhost / 127.0.0.1 on any port (Vite may use 5173, 5174, etc.)
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS not allowed"));
    }
  })
);
app.use(express.json({ limit: "64kb" }));

const asyncRoute = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error("[ReviewGraph]", error);
    res.status(500).json({ error: "Internal error", detail: sanitizeClientError(error.message) });
  });
};

function sendAsk(res, payload) {
  res.json(sanitizeAskResponse(payload));
}

function mergeAuraWithLocalAssessment(auraAnswer, assessment) {
  if (!assessment?.evidence?.length) return auraAnswer;
  const graphBlock = [
    "### ReviewGraph engine (in-memory graph)",
    assessment.summary,
    "",
    `**Risk score:** ${assessment.score} (${assessment.level})`,
    "",
    "**Evidence:**",
    ...assessment.evidence.map((e) => `- **${e.title}:** ${e.detail}`)
  ].join("\n");
  const answer = `${graphBlock}\n\n---\n\n### Aura Agent\n\n${auraAnswer.answer || ""}`;
  const evidence = [
    ...assessment.evidence.flatMap((e) => (e.cites || []).map((c) => `${c.kind}: ${c.label}`)),
    ...(auraAnswer.evidence || [])
  ];
  return { ...auraAnswer, answer, evidence, localRiskScore: assessment.score, localRiskLevel: assessment.level };
}

app.get("/api/meta", asyncRoute(async (_req, res) => {
  const auraInternal = await getAuraAgentStatus();
  const qwenInternal = await getQwenAgentStatus();
  res.json({
    ...publicMeta(pack.meta),
    domain: ACTIVE_DOMAIN,
    auraAgent: publicAuraAgentStatus(auraInternal),
    qwenAgent: publicQwenAgentStatus(qwenInternal)
  });
}));

app.get("/api/health", asyncRoute(async (_req, res) => {
  const auraInternal = await getAuraAgentStatus();
  const qwenInternal = await getQwenAgentStatus();
  let neo4j = "fallback";
  if (getDriver()) {
    try {
      await runCypher("RETURN 1 AS ok");
      neo4j = "connected";
    } catch {
      neo4j = "fallback";
    }
  }
  res.json({
    ok: true,
    neo4j,
    auraAgent: publicAuraAgentStatus(auraInternal),
    qwenAgent: publicQwenAgentStatus(qwenInternal),
    domain: ACTIVE_DOMAIN
  });
}));

/** Re-run ingest + Neo4j sync after changing GITHUB_REPO / tokens in .env. */
app.post("/api/reload", asyncRoute(async (_req, res) => {
  if (typeof pack.init !== "function") {
    res.status(501).json({ error: "Domain pack does not support reload" });
    return;
  }
  initResult = await pack.init();
  const entitySummaries = pack.listEntities().map((e) => ({
    id: e.id,
    score: e.score,
    level: e.level,
    evidenceCount: e.evidenceCount
  }));
  res.json({
    ok: true,
    source: initResult.source,
    entities: initResult.entities,
    entitySummaries,
    neo4jSync: initResult.neo4jSync,
    meta: publicMeta(pack.meta),
    ...(initResult.error ? { error: sanitizeClientError(initResult.error) } : {})
  });
}));

app.get("/api/entities", (_req, res) => {
  res.json(pack.listEntities());
});

app.get("/api/entities/:id", (req, res) => {
  const detail = pack.getEntity(req.params.id);
  if (!detail) {
    res.status(404).json({ error: `Unknown entity ${req.params.id}` });
    return;
  }
  res.json(detail);
});

async function enrichWithLocalCypher(answer, entityId, body) {
  if (!getDriver() || !answer.cypher || answer.cypher.startsWith("// Aura")) {
    return { ...answer, neo4j: getDriver() ? "connected" : "fallback", rows: [] };
  }
  try {
    const rows = await runCypher(answer.cypher, {
      entityId,
      prId: entityId,
      start_date: body.start_date,
      end_date: body.end_date
    });
    return { ...answer, neo4j: "connected", rows };
  } catch (error) {
    return { ...answer, neo4j: "fallback", rows: [], detail: sanitizeClientError(error.message) };
  }
}

app.post("/api/ask", asyncRoute(async (req, res) => {
  const { question = pack.meta.sampleQuestions?.[0] || "", entityId = pack.meta.flagshipEntityId } = req.body;
  const localAssessment = pack.assess(entityId);
  const local = pack.ask(question, entityId);
  const enriched = await enrichWithLocalCypher({ ...local, source: "local" }, entityId, req.body);

  if (isQwenAgentEnabled()) {
    try {
      const qwenAnswer = await invokeQwenAgent({
        question,
        entityId,
        localAnswer: enriched,
        assessment: localAssessment,
        rows: enriched.rows,
        agentContext: auraContext(entityId)
      });
      sendAsk(res, { ...qwenAnswer, source: "qwen_agent", neo4j: enriched.neo4j, rows: enriched.rows, generatedAt: new Date().toISOString() });
      return;
    } catch (error) {
      console.error(`[ReviewGraph] Qwen3 Agent failed (${error.message}); falling back to local router.`);
      sendAsk(res, { ...enriched, qwenError: error.message, generatedAt: new Date().toISOString() });
      return;
    }
  }

  if (isAuraAgentEnabled()) {
    try {
      const auraAnswer = await invokeAuraAgent(question, entityId, auraContext(entityId));
      const enriched = await enrichWithLocalCypher(auraAnswer, entityId, req.body);
      const merged = mergeAuraWithLocalAssessment(enriched, localAssessment);
      sendAsk(res, { ...merged, source: "aura_agent", generatedAt: new Date().toISOString() });
      return;
    } catch (error) {
      console.error(`[ReviewGraph] Aura Agent failed (${error.message}); falling back to local router.`);
      const local = pack.ask(question, entityId);
      const enriched = await enrichWithLocalCypher(
        { ...local, source: "local", auraError: error.message },
        entityId,
        req.body
      );
      sendAsk(res, { ...enriched, generatedAt: new Date().toISOString() });
      return;
    }
  }

  sendAsk(res, { ...enriched, generatedAt: new Date().toISOString() });
}));

app.post("/api/assess", asyncRoute(async (req, res) => {
  const { entityId = pack.meta.flagshipEntityId } = req.body;
  const assessment = pack.assess(entityId);
  if (!assessment) {
    res.status(404).json({ error: `Unknown entity ${entityId}` });
    return;
  }
  const memory = await recordAssessment(pack, assessment);
  res.json({
    assessment,
    persisted: memory.persisted,
    detail: memory.detail ? sanitizeClientError(memory.detail) : undefined
  });
}));

app.get("/api/memory", (_req, res) => res.json(memorySnapshot(pack)));

// Raw Cypher is disabled by default — arbitrary queries against your DB are a high risk.
app.post("/api/cypher", asyncRoute(async (req, res) => {
  if (process.env.ENABLE_DEV_CYPHER !== "true") {
    res.status(404).json({ error: "Not available" });
    return;
  }
  const { query, params = {} } = req.body;
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  try {
    const rows = await runCypher(query, params);
    res.json({ rows });
  } catch (error) {
    res.status(503).json({ error: "Neo4j query failed", detail: sanitizeClientError(error.message) });
  }
}));

app.listen(port, host, async () => {
  const src = pack.meta?.dataSource || "demo";
  const repo = pack.meta?.repository?.name;
  const aura = await getAuraAgentStatus();
  const qwen = await getQwenAgentStatus();
  const auraNote = aura.configured ? `, aura=${aura.mode}${aura.ready ? "" : " (auth pending)"}` : "";
  const qwenNote = qwen.mode === "primary" ? `, qwen=${qwen.model}${qwen.configured ? " (configured)" : " (SS_TOKEN missing)"}` : "";
  console.log(`ReviewGraph AI [domain=${ACTIVE_DOMAIN}, source=${src}${repo ? `, repo=${repo}` : ""}${auraNote}${qwenNote}] http://${host}:${port}`);
});
