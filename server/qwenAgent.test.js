import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { getQwenAgentConfig, getQwenAgentStatus, invokeQwenAgent, isQwenAgentEnabled } from "./qwenAgent.js";
import { publicQwenAgentStatus, sanitizeAskResponse } from "./clientSafe.js";

const originalFetch = globalThis.fetch;
const envNames = ["SS_TOKEN", "QWEN_API_URL", "QWEN_MODEL", "QWEN_AGENT_MODE", "QWEN_TIMEOUT_MS"];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const input = {
  question: "What needs review?",
  entityId: "PR-1",
  localAnswer: { answer: "Review the changed service", evidence: ["file: service.js"], cypher: "RETURN 1" },
  assessment: { score: 70, level: "high", evidence: [{ title: "Dependency", detail: "Shared service", cites: [] }] },
  rows: [{ file: "service.js" }]
};

beforeEach(() => {
  for (const name of envNames) delete process.env[name];
  process.env.SS_TOKEN = "mock-token";
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test("sends authenticated chat completions and preserves graph evidence", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://continue.ovh.di-ai.soprasteria.com/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer mock-token");
    assert.equal(options.redirect, "error");
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "Qwen3-Coder-30B-A3B-Instruct");
    assert.equal(payload.stream, false);
    assert.equal(payload.temperature, 0.1);
    assert.equal(payload.options, undefined);
    assert.equal(payload.messages[0].role, "system");
    assert.match(payload.messages[1].content, /service\.js/);
    assert.match(payload.messages[1].content, /Shared service/);
    assert.ok(!options.body.includes("mock-token"));
    return new Response(JSON.stringify({ choices: [{ message: { content: " Review dependencies. " } }], usage: { total_tokens: 42 } }));
  };
  const answer = await invokeQwenAgent(input);
  assert.equal(answer.type, "qwen_agent");
  assert.equal(answer.answer, "Review dependencies.");
  assert.deepEqual(answer.evidence, input.localAnswer.evidence);
  assert.equal(answer.cypher, "RETURN 1");
  assert.equal(answer.localRiskScore, 70);
  assert.equal(answer.qwen.usage.total_tokens, 42);
  const status = await getQwenAgentStatus();
  assert.equal(status.ready, true);
  assert.ok(!JSON.stringify(status).includes("mock-token"));
  assert.ok(!JSON.stringify(getQwenAgentConfig()).includes("mock-token"));
});

test("reports missing credentials and disabled mode without network calls", async () => {
  delete process.env.SS_TOKEN;
  assert.equal(isQwenAgentEnabled(), true);
  assert.equal((await getQwenAgentStatus()).reason, "not_configured");
  await assert.rejects(invokeQwenAgent(input), /SS_TOKEN/);
  process.env.QWEN_AGENT_MODE = "off";
  assert.equal(isQwenAgentEnabled(), false);
  assert.equal((await getQwenAgentStatus()).reason, "disabled");
  await assert.rejects(invokeQwenAgent(input), /disabled/);
});

test("honors model and endpoint overrides without probing chat for health", async () => {
  process.env.QWEN_MODEL = "custom-model";
  process.env.QWEN_API_URL = "https://example.test/v1/chat/completions";
  assert.equal((await getQwenAgentStatus()).reason, "not_checked");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, process.env.QWEN_API_URL);
    assert.equal(JSON.parse(options.body).model, "custom-model");
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
  };
  await invokeQwenAgent(input);
});

test("rejects insecure endpoints before sending credentials", async () => {
  process.env.QWEN_API_URL = "http://example.test/v1/chat/completions";
  await assert.rejects(invokeQwenAgent(input), /HTTPS/);
});

test("does not expose upstream error bodies", async () => {
  globalThis.fetch = async () => new Response("private upstream details mock-token", { status: 401 });
  await assert.rejects(invokeQwenAgent(input), { message: "Qwen3 chat request failed (HTTP 401)" });
  assert.equal((await getQwenAgentStatus()).reason, "authentication_failed");
});

test("rejects invalid JSON and empty answers", async () => {
  globalThis.fetch = async () => new Response("not JSON");
  await assert.rejects(invokeQwenAgent(input), /invalid JSON/);
  assert.equal((await getQwenAgentStatus()).reason, "unavailable");
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: " " } }] }));
  await assert.rejects(invokeQwenAgent(input), /message.content/);
});

test("times out stalled requests", async () => {
  process.env.QWEN_TIMEOUT_MS = "10";
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(invokeQwenAgent(input), /timed out/);
});

test("public status and fallback errors do not expose server credentials", async () => {
  const status = publicQwenAgentStatus({ ...(await getQwenAgentStatus()), token: "mock-token", apiUrl: "https://private.test" });
  assert.ok(!JSON.stringify(status).includes("mock-token"));
  assert.ok(!JSON.stringify(status).includes("private.test"));
  const response = sanitizeAskResponse({ source: "local", qwenError: "Bearer mock-token", answer: "mock-token" });
  assert.ok(!JSON.stringify(response).includes("mock-token"));
  delete process.env.SS_TOKEN;
  assert.equal(publicQwenAgentStatus(await getQwenAgentStatus()).reason, "not_configured");
  assert.equal(sanitizeAskResponse({ qwenError: "SS_TOKEN is not configured on the server" }).qwenError, "SS_TOKEN is not configured on the server");
  assert.ok(!sanitizeAskResponse({ qwenError: "SS_TOKEN=private-value" }).qwenError.includes("private-value"));
});