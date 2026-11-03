import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Code2,
  Copy,
  Layers,
  Loader2,
  Network,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Zap
} from "lucide-react";
import "./styles.css";
import { apiFetch, getApiBase } from "./api.js";
import { GraphCanvas, GraphLegend, GraphMetricsBar } from "./GraphView.jsx";
const levelClass = (level) => (level || "").toLowerCase();

const DEFAULT_META = {
  name: "Graph Agent Blueprint",
  tagline: "Domain-agnostic graph intelligence",
  entityNoun: "Entity",
  entityNounPlural: "Entities",
  scoreNoun: "Risk",
  brandColor: "#1d4ed8",
  sampleQuestions: [],
  knowledgeCategories: []
};

function App() {
  const [meta, setMeta] = useState(DEFAULT_META);
  const [entities, setEntities] = useState([]);
  const [status, setStatus] = useState({ neo4j: "checking" });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("assessment");
  const [memory, setMemory] = useState({ categories: [], assessments: [] });
  const [committing, setCommitting] = useState(false);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadError, setLoadError] = useState(null);

  async function loadWorkspace({ reingest = false } = {}) {
    setLoadingWorkspace(true);
    setLoadError(null);
    try {
      if (reingest) {
        const reloadRes = await apiFetch("/api/reload", { method: "POST" });
        if (!reloadRes.ok) throw new Error("Reload failed — is the API running on port 4000?");
      }
      const [metaRes, healthRes, entitiesRes, memoryRes] = await Promise.allSettled([
        apiFetch("/api/meta"),
        apiFetch("/api/health"),
        apiFetch("/api/entities"),
        apiFetch("/api/memory")
      ]);
      let liveSource = false;
      if (metaRes.status === "fulfilled") {
        const m = await metaRes.value.json();
        liveSource = m.dataSource === "github" || m.dataSource === "gitlab";
        setMeta({ ...DEFAULT_META, ...m });
        setQuestion((q) => q || m.sampleQuestions?.[0] || "");
      }
      if (healthRes.status === "fulfilled") setStatus(await healthRes.value.json());
      if (memoryRes.status === "fulfilled") setMemory(await memoryRes.value.json());
      let count = 0;
      if (entitiesRes.status === "fulfilled") {
        const data = await entitiesRes.value.json();
        count = Array.isArray(data) ? data.length : 0;
        setEntities(data);
        setSelectedId((current) => {
          if (current && data.some((e) => e.id === current)) return current;
          return data[0]?.id || null;
        });
      } else if (entitiesRes.status === "rejected") {
        throw new Error("Could not load pull requests from API");
      }
      return { count, liveSource };
    } catch (error) {
      setLoadError(error.message || "Failed to connect to API");
      return { count: 0, liveSource: false };
    } finally {
      setLoadingWorkspace(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let liveSource = false;
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const result = await loadWorkspace({ reingest: attempt > 0 && liveSource });
        liveSource = result.liveSource;
        if (result.count > 0 || !liveSource) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--brand", meta.brandColor);
    document.title = meta.name;
  }, [meta]);

  useEffect(() => {
    if (!selectedId) return;
    apiFetch(`/api/entities/${selectedId}`)
      .then((res) => res.json())
      .then(setDetail)
      .catch(() => setDetail(null));
    setAnswer(null);
  }, [selectedId]);

  const assessment = detail?.assessment;
  const graph = detail?.graph || { nodes: [], links: [], metrics: null, highlights: { nodes: [], links: [] } };
  const selectedEntity = entities.find((e) => e.id === selectedId);

  async function askQuestion(nextQuestion = question) {
    setQuestion(nextQuestion);
    setAsking(true);
    setTab("ask");
    try {
      const res = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion, entityId: selectedId })
      });
      setAnswer(await res.json());
    } catch {
      setAnswer({ title: "Offline", answer: "The API is unavailable.", evidence: [], cypher: "" });
    } finally {
      setAsking(false);
    }
  }

  async function commitAssessment() {
    if (!selectedId) return;
    setCommitting(true);
    try {
      await apiFetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: selectedId })
      });
      const memoryRes = await apiFetch("/api/memory");
      setMemory(await memoryRes.json());
    } finally {
      setCommitting(false);
    }
  }

  return (
    <main className="app-shell">
      <Header meta={meta} status={status} />
      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-heading">
              <Layers size={18} />
              <h2>{meta.entityNounPlural}</h2>
              <button
                type="button"
                className="ghost-btn refresh-prs-btn"
                title="Re-ingest from GitHub/GitLab and refresh list"
                disabled={loadingWorkspace}
                onClick={() => loadWorkspace({ reingest: true })}
              >
                <RefreshCw size={16} className={loadingWorkspace ? "spin" : ""} />
                Refresh
              </button>
            </div>
            <div className="pr-list">
              {loadError && (
                <p className="hint empty-list-hint" style={{ borderColor: "var(--danger)" }}>
                  {loadError}. Run <code>npm run dev</code> and open{" "}
                  <a href="http://127.0.0.1:5173">127.0.0.1:5173</a> (API proxies to port 4000).
                </p>
              )}
              {loadingWorkspace && entities.length === 0 && !loadError && (
                <p className="hint empty-list-hint">
                  <Loader2 size={16} className="spin" /> Loading from {meta.dataSource || "API"}…
                </p>
              )}
              {entities.length === 0 && !loadingWorkspace && !loadError && (
                <p className="hint empty-list-hint">
                  No pull requests loaded.
                  {meta.dataSource === "github" || meta.dataSource === "gitlab"
                    ? " Click Refresh after opening a PR, or check GITHUB_REPO and token in server .env."
                    : " Set GITHUB_REPO or GITLAB_PROJECT in .env."}
                </p>
              )}
              {entities.map((entity) => (
                <button
                  className={`pr-row ${entity.id === selectedId ? "active" : ""}`}
                  key={entity.id}
                  onClick={() => setSelectedId(entity.id)}
                >
                  <span title={entity.title}>
                    <strong>{entity.id}</strong>
                    <span className="pr-title-line">{entity.title}</span>
                    <small>{entity.subtitle}</small>
                  </span>
                  <em className={`risk-pill ${levelClass(entity.level)}`}>{entity.score}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="panel compact">
            <div className="panel-heading">
              <Sparkles size={18} />
              <h2>Signals</h2>
            </div>
            <SignalList entity={selectedEntity} assessment={assessment} scoreNoun={meta.scoreNoun} />
          </div>
        </aside>

        <section className="main-column">
          <ReviewBand meta={meta} assessment={assessment} entityId={selectedId} />

          <div className="tabs">
            <TabButton id="assessment" active={tab} onClick={setTab} icon={<AlertTriangle size={16} />} label={`${meta.scoreNoun} Assessment`} />
            <TabButton id="ask" active={tab} onClick={setTab} icon={<BrainCircuit size={16} />} label="Ask the Graph" />
            <TabButton id="memory" active={tab} onClick={setTab} icon={<BookOpen size={16} />} label="Agent Memory" />
          </div>

          {tab === "assessment" && (
            <AssessmentTab assessment={assessment} onCommit={commitAssessment} committing={committing} status={status} />
          )}
          {tab === "ask" && (
            <AskTab
              meta={meta}
              status={status}
              selectedId={selectedId}
              question={question}
              setQuestion={setQuestion}
              answer={answer}
              asking={asking}
              onAsk={askQuestion}
            />
          )}
          {tab === "memory" && <MemoryTab memory={memory} meta={meta} />}

          <section className="graph-section">
            <div className="section-heading spread">
              <span className="heading-left">
                <Network size={19} />
                <h2>Graph Evidence</h2>
              </span>
              {graph.metrics && (
                <span className="graph-risk-pill">
                  Blast radius · {graph.metrics.downstreamBlast} downstream · {graph.metrics.evidenceItems} signals
                </span>
              )}
            </div>
            <GraphMetricsBar metrics={graph.metrics} />
            <GraphCanvas graph={graph} selectedId={selectedId} brand={meta.name} />
            <GraphLegend />
          </section>
        </section>
      </section>
    </main>
  );
}

function Header({ meta, status }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <div>
          <strong>{meta.name}</strong>
          <span>{meta.tagline}</span>
        </div>
      </div>
      <div className="topbar-right">
        {meta.dataSource && meta.dataSource !== "demo" && (
          <span className="domain-badge" title={meta.repository?.url || ""}>
            <Layers size={13} /> {meta.dataSource}
            {meta.repository?.name ? ` · ${meta.repository.name}` : ""}
          </span>
        )}
        {meta.neo4jSync?.synced && (
          <span className="domain-badge" title="Graph synced to Neo4j on startup">
            graph synced
          </span>
        )}
        {meta.sourceWarning && (
          <span className="domain-badge" title={meta.sourceWarning} style={{ borderColor: "var(--warn)" }}>
            {meta.dataSource === "demo" ? "source fallback" : "ingest failed"}
          </span>
        )}
        {meta.neo4jSyncWarning && (
          <span className="domain-badge" title={meta.neo4jSyncWarning} style={{ borderColor: "var(--warn)" }}>
            neo4j not synced
          </span>
        )}
        <div className="status-group">
          {status.auraAgent?.enabled && (
            <div
              className={`db-status ${status.auraAgent?.ready ? "connected aura-pill" : "fallback"}`}
              title={status.auraAgent?.reason === "authentication_failed" ? "Check Aura API keys in server .env" : "Hosted Aura Agent"}
            >
              <Zap size={15} />
              Aura {status.auraAgent?.ready ? "Live" : "Pending"}
            </div>
          )}
          {status.qwenAgent?.enabled && (
            <div
              className={`db-status ${status.qwenAgent?.ready ? "connected aura-pill" : "fallback"}`}
              title={status.qwenAgent?.reason === "not_configured" || status.qwenAgent?.reason === "authentication_failed" ? "Check SS_TOKEN in server .env" : status.qwenAgent?.model}
            >
              <Zap size={15} />
              Qwen3 {status.qwenAgent?.ready ? "Live" : status.qwenAgent?.reason === "not_checked" ? "Configured" : "Pending"}
            </div>
          )}
          <div className={`db-status ${status.neo4j === "connected" ? "connected" : "fallback"}`}>
            {status.neo4j === "connected" ? <CheckCircle2 size={16} /> : <CircleDot size={16} />}
            Neo4j {status.neo4j === "connected" ? "Connected" : status.neo4j || "…"}
          </div>
        </div>
      </div>
    </header>
  );
}

function SignalList({ entity, assessment, scoreNoun }) {
  if (!entity) return null;
  return (
    <div className="signals">
      <Signal label={scoreNoun} value={`${entity.score} · ${entity.level}`} />
      <Signal label="Detail" value={entity.subtitle} />
      <Signal label="Tags" value={entity.tags?.join(", ") || "—"} />
      <Signal label="Status" value={entity.badges?.join(", ") || "—"} />
      <Signal label="Evidence items" value={assessment?.evidence?.length ?? entity.evidenceCount ?? 0} />
    </div>
  );
}

function Signal({ label, value }) {
  return (
    <div className="signal">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReviewBand({ meta, assessment, entityId }) {
  return (
    <section className="review-band">
      <div>
        <p className="eyebrow">Explainable {meta.scoreNoun.toLowerCase()} assessment</p>
        {entityId && <span className="pr-id-badge">{entityId}</span>}
        <h1>{assessment?.title || meta.name}</h1>
        <p className="intro">{assessment?.summary || `Select a ${meta.entityNoun.toLowerCase()} to see graph-backed reasoning.`}</p>
      </div>
      <div className={`score-tile ${levelClass(assessment?.level)}`}>
        <span>{meta.scoreNoun}</span>
        <strong>{assessment?.score ?? "—"}</strong>
        <small>{assessment?.level || ""}</small>
      </div>
    </section>
  );
}

function TabButton({ id, active, onClick, icon, label }) {
  return (
    <button className={`tab ${active === id ? "active" : ""}`} onClick={() => onClick(id)}>
      {icon}
      {label}
    </button>
  );
}

function AssessmentTab({ assessment, onCommit, committing, status }) {
  if (!assessment) return <div className="panel">No assessment available.</div>;
  return (
    <section className="result-stack">
      <article className="panel">
        <div className="panel-heading spread">
          <span className="heading-left">
            <Layers size={18} />
            <h2>Impact</h2>
          </span>
          <button className="run-button" onClick={onCommit} disabled={committing}>
            <Save size={16} />
            {committing ? "Saving" : "Commit to memory"}
          </button>
        </div>
        <div className="chip-section">
          {assessment.impacts.filter((g) => g.items.length).map((group) => (
            <div className="chip-group" key={group.group}>
              <span className="chip-label">{group.group}</span>
              <div className="chips">
                {group.items.map((item) => (
                  <span className={`chip ${item.meta === "sensitive" || item.meta === "high" || item.meta === "low" ? "crit-high" : ""}`} key={item.id} title={item.meta || ""}>
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-heading">
          <AlertTriangle size={18} />
          <h2>Evidence ({assessment.evidence.length})</h2>
        </div>
        <div className="evidence-list">
          {assessment.evidence.map((item, i) => (
            <div className={`evidence-card sev-${item.severity}`} key={i}>
              <div className="evidence-top">
                <span className={`sev-badge sev-${item.severity}`}>{item.severity}</span>
                <strong>{item.title}</strong>
                <span className="weight">+{item.weight}</span>
              </div>
              <p>{item.detail}</p>
              <div className="cites">
                {item.cites.map((c, j) => (
                  <span className="cite" key={j} title={c.label}>
                    <em>{c.type}</em> {c.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {status.neo4j !== "connected" && (
          <p className="hint">Running on the in-memory graph. Configure Neo4j and run <code>npm run seed</code> to persist assessments to the database.</p>
        )}
      </article>
    </section>
  );
}

function askSourceLabel(answer, meta) {
  if (answer?.source === "qwen_agent") return "Qwen3 Agent";
  if (answer?.source === "aura_agent") return "Aura Agent";
  if (answer?.qwenError) return "Local fallback";
  if (meta?.auraAgent?.enabled && meta?.auraAgent?.mode === "primary") return "Local fallback";
  return "Local router";
}

const SECTION_HEADER_RE =
  /^(Review Insight|Graph Evidence|Dependency Paths?|Technical Paths?|Affected Files?|Recommendations?|Practical Recommendations?|Tool):?\s*$/i;

function parseAnswerSections(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const sections = [];
  let current = { title: null, lines: [] };

  function flush() {
    const body = current.lines.join("\n").trim();
    if (current.title || body) sections.push({ title: current.title, body });
    current = { title: null, lines: [] };
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (SECTION_HEADER_RE.test(trimmed)) {
      flush();
      current.title = trimmed.replace(/:$/, "");
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: null, body: raw }];
}

function FormattedAnswer({ text, asking }) {
  if (asking) {
    return (
      <div className="answer-loading">
        <Loader2 size={22} className="spin" />
        <p>Querying Neo4j and composing a graph-backed explanation…</p>
      </div>
    );
  }
  const sections = parseAnswerSections(text);
  return (
    <div className="answer-prose">
      {sections.map((sec, i) => (
        <section className={`answer-section ${sec.title ? "has-title" : ""}`} key={i}>
          {sec.title && <h3>{sec.title}</h3>}
          {sec.body.split(/\n+/).filter(Boolean).map((para, j) => (
            <p key={j}>{para}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function AskTab({ meta, status, selectedId, question, setQuestion, answer, asking, onAsk }) {
  const auraPrimary = meta?.auraAgent?.enabled && meta?.auraAgent?.mode === "primary";
  const auraLive = status?.auraAgent?.ready;
  const isAuraAnswer = answer?.source === "aura_agent";

  async function copyAnswer() {
    if (!answer?.answer) return;
    try {
      await navigator.clipboard.writeText(answer.answer);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="result-stack">
      <section className="query-panel">
        <div className="query-panel-top">
          <div>
            <strong className="query-label">Ask the Graph</strong>
            <p className="query-sub">
              {auraLive
                ? "Live Aura Agent · GenAI Text2Cypher + LLM · credentials on server only"
                : auraPrimary
                  ? "Aura configured — waiting for OAuth (check server .env)"
                  : "Local rule-based router · add Aura keys in server .env for LLM answers"}
            </p>
          </div>
          {selectedId && <span className="context-chip">{selectedId}</span>}
        </div>
        <div className="question-row">
          <BrainCircuit size={20} />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !asking && onAsk()}
            placeholder={`Ask about ${selectedId || "this PR"}…`}
            aria-label={`Ask ${meta.name}`}
          />
          <button className="run-button" onClick={() => onAsk()} disabled={asking}>
            {asking ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            {asking ? "Running" : "Ask"}
          </button>
        </div>
        <div className="prompt-grid">
          {(meta.sampleQuestions || []).map((prompt) => (
            <button key={prompt} onClick={() => onAsk(prompt)} disabled={asking}>
              {prompt}
            </button>
          ))}
        </div>
      </section>

      <div className={`result-grid ${isAuraAnswer ? "aura-answer" : ""}`}>
        <article className="panel answer-panel">
          <div className="panel-heading spread">
            <div className="heading-left">
              {isAuraAnswer ? <Zap size={18} /> : <AlertTriangle size={18} />}
              <h2>{asking ? "Analyzing graph" : answer?.title || "Graph insight"}</h2>
            </div>
            <div className="answer-actions">
              {(answer || asking) && (
                <span className={`source-badge ${isAuraAnswer ? "aura" : "local"}`}>
                  {asking ? "…" : askSourceLabel(answer, meta)}
                </span>
              )}
              {answer?.answer && !asking && (
                <button type="button" className="icon-button" onClick={copyAnswer} title="Copy answer">
                  <Copy size={15} />
                </button>
              )}
            </div>
          </div>
          <FormattedAnswer text={answer?.answer} asking={asking} />
          {!asking && !answer?.answer && (
            <p className="answer-empty">Ask a question to query the knowledge graph.</p>
          )}
          {answer?.auraError && (
            <p className="hint warn-hint">Aura Agent unavailable — using local router.</p>
          )}
          {!asking && (answer?.evidence || []).length > 0 && (
            <div className="evidence-block">
              <h4>Graph evidence</h4>
              <div className="evidence-list">
                {answer.evidence.map((item, i) => (
                  <div className="evidence-item" key={i}>
                    <CheckCircle2 size={16} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!asking && (answer?.reasoning || []).length > 0 && (
            <details className="reasoning-panel">
              <summary>Agent reasoning ({answer.reasoning.length} steps)</summary>
              <ol>
                {answer.reasoning.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
          )}
        </article>
        <article className="panel cypher-panel">
          <div className="panel-heading">
            <Code2 size={18} />
            <h2>{isAuraAnswer ? "Agent tools" : "Generated Cypher"}</h2>
          </div>
          <pre>{answer?.cypher || "// Ask a question to generate Cypher"}</pre>
        </article>
      </div>
    </section>
  );
}

function MemoryTab({ memory, meta }) {
  return (
    <section className="memory-grid">
      {(memory.categories || []).map((category) => (
        <MemoryColumn title={category.title} icon={<BookOpen size={16} />} key={category.id}>
          {category.items.map((item) => (
            <div className="memory-card" key={item.id}>
              <strong>{item.title}</strong>
              {item.detail && <p>{item.detail}</p>}
              {item.tag && <span className="tag">{item.tag}</span>}
            </div>
          ))}
        </MemoryColumn>
      ))}
      <MemoryColumn title="Recent Assessments" icon={<Save size={16} />}>
        {(memory.assessments || []).length === 0 && <p className="hint">No assessments committed yet.</p>}
        {(memory.assessments || []).map((a, i) => (
          <div className="memory-card" key={i}>
            <strong>{a.entityId} · {a.level} ({a.score})</strong>
            <p>{a.summary}</p>
            <span className="tag">{a.recordedAt ? new Date(a.recordedAt).toLocaleString() : ""}</span>
          </div>
        ))}
      </MemoryColumn>
    </section>
  );
}

function MemoryColumn({ title, icon, children }) {
  return (
    <div className="panel memory-column">
      <div className="panel-heading">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="memory-list">{children}</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
