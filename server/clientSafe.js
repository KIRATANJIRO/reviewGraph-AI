// Sanitize data before sending to the browser. Secrets stay in process.env only.

const SECRET_PATTERNS = [
  /ghp_[\w-]+/gi,
  /glpat-[\w-]+/gi,
  /Bearer\s+[\w.-]+/gi,
  /Basic\s+[\w+/=.-]+/gi,
  /neo4j\+s?:\/\/[^\s"']+/gi,
  /bolt\+s?:\/\/[^\s"']+/gi,
  /AURA_CLIENT_SECRET[=:\s]*[\w-]+/gi,
  /AURA_CLIENT_ID[=:\s]*[\w-]+/gi,
  /NEO4J_PASSWORD[=:\s]*[^\s"']+/gi,
  /SS_TOKEN\s*[=:]\s*["']?[^\s"']+/gi,
  /access_token["']?\s*[:=]\s*["']?[\w.-]+/gi
];

/** Remove secrets and infra URLs from strings returned to the client. */
export function sanitizeClientText(value) {
  if (value == null) return value;
  let text = String(value);
  const ssToken = process.env.SS_TOKEN?.trim();
  if (ssToken) text = text.replaceAll(ssToken, "[redacted]");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  // Aura invoke URLs expose org/agent ids — never send to the UI
  text = text.replace(/https:\/\/api\.neo4j\.io\/v2beta1\/[^\s"']+/gi, "[aura-endpoint]");
  return text;
}

export function sanitizeClientError(message) {
  const text = sanitizeClientText(message);
  if (!text) return "Request failed";
  // Avoid leaking OAuth/HTML bodies
  if (text.length > 180) return `${text.slice(0, 180)}…`;
  return text;
}

/** Public Aura status — no invoke URL, client id, or tokens. */
export function publicAuraAgentStatus({ configured, mode, ready, reason }) {
  const enabled = !!(configured && mode === "primary");
  const publicReason =
    reason === "not_configured" || reason === "disabled"
      ? reason
      : ready
        ? undefined
        : reason === "authentication_failed"
          ? "authentication_failed"
          : "unavailable";

  return {
    enabled,
    mode: configured ? mode : "off",
    ready: !!ready,
    ...(publicReason ? { reason: publicReason } : {})
  };
}

/** Public Qwen3 status - no endpoint or bearer token. */
export function publicQwenAgentStatus({ configured, mode, ready, reason, model }) {
  const enabled = mode === "primary";
  const publicReason =
    ["disabled", "not_configured", "not_checked", "authentication_failed"].includes(reason)
      ? reason
      : ready
        ? undefined
        : "unavailable";

  return {
    enabled,
    configured: !!configured,
    mode,
    ready: !!ready,
    model: enabled ? model : undefined,
    ...(publicReason ? { reason: publicReason } : {})
  };
}

/** Strip fields that must not leave the server. */
export function sanitizeAskResponse(body) {
  if (!body || typeof body !== "object") return body;
  const { rawContent, invokeUrl, ...rest } = body;
  const out = { ...rest };
  if (out.auraError) out.auraError = sanitizeClientError(out.auraError);
  if (out.qwenError) out.qwenError = sanitizeClientError(out.qwenError);
  if (out.detail) out.detail = sanitizeClientError(out.detail);
  if (out.reasoning) out.reasoning = out.reasoning.map((s) => sanitizeClientText(s));
  if (out.evidence) out.evidence = out.evidence.map((s) => sanitizeClientText(s));
  if (out.answer) out.answer = sanitizeClientText(out.answer);
  return out;
}

export function publicMeta(meta) {
  const { sourceError, ...safe } = { ...meta };
  const out = { ...safe, auraAgent: undefined };
  if (sourceError) {
    out.sourceWarning = String(sourceError).slice(0, 200);
  }
  if (meta.neo4jSync && !meta.neo4jSync.synced && meta.neo4jSync.reason !== "neo4j_not_configured") {
    out.neo4jSyncWarning = "Graph not synced to Neo4j — run npm run seed or check credentials.";
  }
  return out;
}
