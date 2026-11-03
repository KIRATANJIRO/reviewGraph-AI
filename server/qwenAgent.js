import "./loadEnv.js";

const DEFAULT_API_URL = "https://continue.ovh.di-ai.soprasteria.com/v1/chat/completions";
const DEFAULT_MODEL = "Qwen3-Coder-30B-A3B-Instruct";
let lastStatus;

function readQwenEnv() {
  const apiUrl = process.env.QWEN_API_URL || DEFAULT_API_URL;
  const model = process.env.QWEN_MODEL || DEFAULT_MODEL;
  const token = process.env.SS_TOKEN?.trim();
  const mode = process.env.QWEN_AGENT_MODE?.toLowerCase() === "off" ? "off" : "primary";
  const timeout = Number(process.env.QWEN_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 300_000;
  return { apiUrl, model, token, mode, timeoutMs };
}

export function getQwenAgentConfig() {
  const { model, token, mode } = readQwenEnv();
  return { configured: mode !== "off" && !!token, mode, model };
}

export function isQwenAgentEnabled() {
  return getQwenAgentConfig().mode === "primary";
}

function truncate(value, max = 8_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

function buildMessages({ question, entityId, localAnswer, assessment, rows, agentContext }) {
  const evidence = assessment?.evidence?.map((item) => ({
    title: item.title,
    detail: item.detail,
    weight: item.weight,
    cites: item.cites
  })) || [];

  return [
    {
      role: "system",
      content: [
        "You are ReviewGraph AI, a graph-grounded code-review assistant.",
        "Use only the supplied Neo4j graph rows, deterministic graph assessment, and local router answer.",
        "Do not invent files, incidents, reviewers, services, dependencies, policies, or vulnerabilities.",
        "Write concise engineering guidance for a senior reviewer of AI-generated code.",
        "If the evidence is thin, say what is missing instead of guessing."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Question: ${question}`,
        `Focus pull request: ${entityId || "not specified"}`,
        `Repository: ${agentContext?.repository || "unknown"}`,
        `Data source: ${agentContext?.dataSource || "unknown"}`,
        "",
        "Deterministic local answer:",
        truncate(localAnswer),
        "",
        "Graph assessment:",
        truncate({
          score: assessment?.score,
          level: assessment?.level,
          summary: assessment?.summary,
          evidence
        }),
        "",
        "Neo4j rows returned by the generated Cypher:",
        truncate(rows?.length ? rows : []),
        "",
        "Return markdown with: direct answer, evidence, review recommendation, and one next check."
      ].join("\n")
    }
  ];
}

export async function invokeQwenAgent({ question, entityId, localAnswer, assessment, rows, agentContext = {} }) {
  const config = readQwenEnv();
  const { apiUrl, model, token, mode, timeoutMs } = config;
  if (mode === "off") throw new Error("Qwen3 agent is disabled");
  if (!token) throw new Error("SS_TOKEN is not configured on the server");
  if (new URL(apiUrl).protocol !== "https:") throw new Error("Qwen3 endpoint must use HTTPS");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let failureReason = "unavailable";

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      redirect: "error",
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.1,
        top_p: 0.9,
        messages: buildMessages({ question, entityId, localAnswer, assessment, rows, agentContext })
      }),
      signal: controller.signal
    });
    console.log("Qwen3 response status:", response.status, response);
    if (!response.ok) {
      failureReason = response.status === 401 || response.status === 403 ? "authentication_failed" : "unavailable";
      throw new Error(`Qwen3 chat request failed (HTTP ${response.status})`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Qwen3 returned an invalid JSON response");
    }
    const content = data?.choices?.[0]?.message?.content;
    const answer = typeof content === "string" ? content.trim() : "";
    if (!answer) throw new Error("Qwen3 response did not include choices[0].message.content");
    lastStatus = { ...config, ready: true };

    return {
      type: "qwen_agent",
      prId: entityId,
      question,
      title: `Qwen3 answer (${model})`,
      answer,
      evidence: localAnswer?.evidence || [],
      reasoning: [],
      cypher: localAnswer?.cypher || "// No Cypher generated",
      localRiskScore: assessment?.score,
      localRiskLevel: assessment?.level,
      qwen: { model, usage: data.usage }
    };
  } catch (error) {
    lastStatus = { ...config, ready: false, reason: failureReason };
    if (controller.signal.aborted) throw new Error("Qwen3 chat request timed out");
    if (error instanceof TypeError) throw new Error("Qwen3 endpoint is unavailable");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getQwenAgentStatus() {
  const config = readQwenEnv();
  const publicConfig = getQwenAgentConfig();
  if (config.mode === "off") return { ...publicConfig, ready: false, reason: "disabled" };
  if (!config.token) return { ...publicConfig, ready: false, reason: "not_configured" };
  const matches = lastStatus?.apiUrl === config.apiUrl && lastStatus?.model === config.model && lastStatus?.token === config.token;
  return { ...publicConfig, ready: matches ? lastStatus.ready : false, reason: matches ? lastStatus.reason : "not_checked" };
}