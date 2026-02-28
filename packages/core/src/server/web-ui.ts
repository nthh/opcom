// Web UI: self-contained HTML dashboard served by the station daemon.
// No build step, no external deps — just inline HTML/CSS/JS.

export function getWebUIHtml(wsPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>opcom</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #1a1a2e;
    --bg-surface: #16213e;
    --bg-card: #1e2a47;
    --bg-hover: #253255;
    --border: #2a3a5e;
    --text: #e0e0e0;
    --text-dim: #8892a8;
    --text-bright: #f0f0f0;
    --accent: #4fc3f7;
    --accent-dim: #2a7aa8;
    --green: #66bb6a;
    --blue: #42a5f5;
    --yellow: #ffa726;
    --red: #ef5350;
    --orange: #ff7043;
    --gray: #78909c;
    --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
  }

  #app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* --- Header --- */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  header .logo {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }
  .breadcrumbs {
    display: flex;
    gap: 4px;
    align-items: center;
    font-size: 13px;
  }
  .breadcrumbs a {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }
  .breadcrumbs a:hover { text-decoration: underline; }
  .breadcrumbs .sep { color: var(--text-dim); }
  .breadcrumbs .current { color: var(--text-bright); }
  .conn-status {
    font-size: 12px;
    font-family: var(--mono);
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--bg-card);
  }
  .conn-status.connected { color: var(--green); }
  .conn-status.disconnected { color: var(--red); }
  .conn-status.connecting { color: var(--yellow); }

  /* --- Main content area --- */
  main {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  /* --- Dashboard --- */
  .dashboard {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    width: 100%;
    overflow: auto;
  }
  @media (max-width: 900px) {
    .dashboard {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
  }

  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    font-size: 13px;
    color: var(--text-bright);
    background: var(--bg-card);
    flex-shrink: 0;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .panel.full-width {
    grid-column: 1 / -1;
  }

  /* --- List items --- */
  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }
  .list-item:last-child { border-bottom: none; }
  .list-item:hover { background: var(--bg-hover); }
  .list-item-main { flex: 1; min-width: 0; }
  .list-item-title {
    font-weight: 500;
    color: var(--text-bright);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .list-item-sub {
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- Badges --- */
  .badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .badge-state-streaming { background: var(--green); color: #000; }
  .badge-state-idle { background: var(--blue); color: #000; }
  .badge-state-waiting { background: var(--yellow); color: #000; }
  .badge-state-error { background: var(--red); color: #fff; }
  .badge-state-stopped { background: var(--gray); color: #fff; }
  .badge-p0 { background: var(--red); color: #fff; }
  .badge-p1 { background: var(--orange); color: #000; }
  .badge-p2 { background: var(--yellow); color: #000; }
  .badge-p3 { background: var(--gray); color: #fff; }
  .badge-status-open { background: var(--green); color: #000; }
  .badge-status-in-progress { background: var(--blue); color: #000; }
  .badge-status-closed { background: var(--gray); color: #fff; }
  .badge-git-clean { color: var(--green); }
  .badge-git-dirty { color: var(--yellow); }

  .work-summary {
    font-size: 11px;
    color: var(--text-dim);
  }

  /* --- Empty state --- */
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-dim);
    font-style: italic;
    font-size: 13px;
  }

  /* --- Project detail --- */
  .detail-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    flex: 1;
    overflow: auto;
  }
  @media (max-width: 900px) {
    .detail-grid {
      grid-template-columns: 1fr;
    }
  }

  .meta-row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 12px;
    font-size: 13px;
  }
  .meta-label { color: var(--text-dim); min-width: 80px; }
  .meta-value { color: var(--text-bright); }

  .stack-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
  }
  .stack-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  /* --- Agent view --- */
  .agent-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .agent-output {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    background: var(--bg);
    position: relative;
  }
  .agent-output .text-chunk { color: var(--text); }
  .agent-output .tool-call {
    margin: 8px 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
  }
  .agent-output .tool-call summary {
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--accent);
    font-family: var(--mono);
  }
  .agent-output .tool-call summary:hover { background: var(--bg-hover); }
  .agent-output .tool-call .tool-body {
    padding: 8px 10px;
    font-size: 12px;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    max-height: 300px;
    overflow-y: auto;
  }
  .agent-output .turn-marker {
    display: block;
    margin: 12px 0;
    padding: 4px 0;
    border-top: 1px dashed var(--border);
    font-size: 11px;
    color: var(--text-dim);
  }
  .agent-output .error-line {
    color: var(--red);
  }
  .agent-output .system-line {
    color: var(--text-dim);
    font-style: italic;
  }

  .scroll-bottom-btn {
    position: absolute;
    bottom: 60px;
    right: 20px;
    background: var(--accent-dim);
    color: var(--text-bright);
    border: none;
    padding: 6px 14px;
    border-radius: 16px;
    font-size: 12px;
    cursor: pointer;
    z-index: 10;
    display: none;
  }
  .scroll-bottom-btn.visible { display: block; }

  .agent-input {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
  }
  .agent-input input {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
  }
  .agent-input input:focus { border-color: var(--accent); }
  .agent-input input::placeholder { color: var(--text-dim); }

  /* --- Buttons --- */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s, border-color 0.1s;
  }
  .btn:hover { background: var(--bg-hover); border-color: var(--accent-dim); }
  .btn-primary { background: var(--accent-dim); border-color: var(--accent-dim); color: #fff; }
  .btn-primary:hover { background: var(--accent); color: #000; }
  .btn-danger { border-color: var(--red); color: var(--red); }
  .btn-danger:hover { background: var(--red); color: #fff; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent-dim); }
</style>
</head>
<body>
<div id="app">
  <header>
    <div style="display:flex;align-items:center;gap:16px">
      <span class="logo">opcom</span>
      <nav class="breadcrumbs" id="breadcrumbs"></nav>
    </div>
    <span class="conn-status connecting" id="conn-status">connecting</span>
  </header>
  <main id="main"></main>
</div>

<script>
// === State ===
const state = {
  connected: false,
  view: "dashboard", // dashboard | project | agent
  viewId: null,
  projects: [],
  agents: [],
  workItems: {},   // projectId -> WorkItem[]
  agentOutput: {}, // sessionId -> [{ type, html }]
  projectDetails: {}, // projectId -> full project config
};

const WS_URL = "ws://localhost:${wsPort}";
let ws = null;
let reconnectTimer = null;
let autoScroll = true;

// === WebSocket ===
function connect() {
  setConnStatus("connecting");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnStatus("connected");
    state.connected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onclose = () => {
    state.connected = false;
    setConnStatus("disconnected");
    scheduleReconnect();
  };

  ws.onerror = () => {
    state.connected = false;
    setConnStatus("disconnected");
  };

  ws.onmessage = (evt) => {
    try {
      const event = JSON.parse(evt.data);
      handleServerEvent(event);
    } catch {}
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function send(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(command));
  }
}

function setConnStatus(status) {
  const el = document.getElementById("conn-status");
  el.textContent = status;
  el.className = "conn-status " + status;
}

// === Event Handler ===
function handleServerEvent(event) {
  switch (event.type) {
    case "ready":
      break;

    case "projects_snapshot":
      state.projects = event.projects || [];
      if (state.view === "dashboard") render();
      break;

    case "agents_snapshot":
      state.agents = event.sessions || [];
      if (state.view === "dashboard" || state.view === "agent") render();
      break;

    case "agent_started":
      if (event.session) {
        const idx = state.agents.findIndex(a => a.id === event.session.id);
        if (idx >= 0) state.agents[idx] = event.session;
        else state.agents.push(event.session);
        state.agentOutput[event.session.id] = state.agentOutput[event.session.id] || [];
      }
      render();
      break;

    case "agent_stopped": {
      const agent = state.agents.find(a => a.id === event.sessionId);
      if (agent) {
        agent.state = "stopped";
        agent.stoppedAt = new Date().toISOString();
      }
      if (state.agentOutput[event.sessionId]) {
        state.agentOutput[event.sessionId].push({
          kind: "system",
          html: '<span class="system-line">--- Agent stopped: ' + esc(event.reason || "stopped") + ' ---</span>'
        });
      }
      render();
      break;
    }

    case "agent_status": {
      const agent = state.agents.find(a => a.id === event.sessionId);
      if (agent) {
        agent.state = event.state;
        if (event.contextUsage != null) agent.contextUsage = event.contextUsage;
      }
      render();
      break;
    }

    case "agent_event":
      handleAgentEvent(event.sessionId, event.event);
      break;

    case "project_status": {
      const proj = state.projects.find(p => p.id === event.projectId);
      if (proj) {
        proj.git = event.git;
        proj.workSummary = event.workSummary;
      }
      if (state.view === "dashboard" || (state.view === "project" && state.viewId === event.projectId)) {
        render();
      }
      break;
    }

    case "agent_message":
      // Could render inter-agent messages in the future
      break;

    case "error":
      console.error("[opcom server]", event.code, event.message);
      break;

    case "pong":
      break;
  }
}

function handleAgentEvent(sessionId, event) {
  if (!state.agentOutput[sessionId]) state.agentOutput[sessionId] = [];
  const out = state.agentOutput[sessionId];
  const data = event.data || {};

  switch (event.type) {
    case "message_delta":
      // Append text to the last text chunk if possible
      if (out.length > 0 && out[out.length - 1].kind === "text") {
        out[out.length - 1].text += (data.text || "");
        out[out.length - 1].html = '<span class="text-chunk">' + esc(out[out.length - 1].text) + '</span>';
      } else {
        out.push({
          kind: "text",
          text: data.text || "",
          html: '<span class="text-chunk">' + esc(data.text || "") + '</span>'
        });
      }
      break;

    case "message_start":
      out.push({
        kind: "text",
        text: "",
        html: '<span class="text-chunk"></span>'
      });
      break;

    case "message_end":
      // Nothing special, just a delimiter
      break;

    case "turn_start":
      out.push({
        kind: "turn",
        html: '<span class="turn-marker">--- Turn Start ---</span>'
      });
      break;

    case "turn_end":
      out.push({
        kind: "turn",
        html: '<span class="turn-marker">--- Turn End ---</span>'
      });
      break;

    case "tool_start":
      out.push({
        kind: "tool",
        toolName: data.toolName || "tool",
        toolInput: data.toolInput || "",
        toolOutput: "",
        done: false,
        id: "tool-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)
      });
      break;

    case "tool_end": {
      // Find the last matching tool_start
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].kind === "tool" && !out[i].done) {
          out[i].done = true;
          out[i].toolOutput = data.toolOutput || "";
          out[i].toolSuccess = data.toolSuccess;
          break;
        }
      }
      break;
    }

    case "error":
      out.push({
        kind: "error",
        html: '<span class="error-line">Error: ' + esc(data.reason || data.text || "unknown error") + '</span>'
      });
      break;

    case "compaction_start":
      out.push({
        kind: "system",
        html: '<span class="system-line">--- Compacting context (' + (data.contextTokens || "?") + ' tokens) ---</span>'
      });
      break;

    case "compaction_end":
      out.push({
        kind: "system",
        html: '<span class="system-line">--- Compaction complete ---</span>'
      });
      break;

    case "agent_start":
      out.push({
        kind: "system",
        html: '<span class="system-line">--- Agent started ---</span>'
      });
      break;

    case "agent_end":
      out.push({
        kind: "system",
        html: '<span class="system-line">--- Agent ended: ' + esc(data.reason || "") + ' ---</span>'
      });
      break;
  }

  // If we're on this agent's view, update the output
  if (state.view === "agent" && state.viewId === sessionId) {
    renderAgentOutput(sessionId);
  }
}

// === Navigation ===
function navigate(view, id) {
  state.view = view;
  state.viewId = id || null;
  autoScroll = true;

  // Fetch additional data if needed
  if (view === "project" && id) {
    fetchProjectDetail(id);
    fetchWorkItems(id);
  }

  render();
}

async function fetchProjectDetail(projectId) {
  try {
    const resp = await fetch("/projects/" + encodeURIComponent(projectId));
    if (resp.ok) {
      state.projectDetails[projectId] = await resp.json();
      if (state.view === "project" && state.viewId === projectId) render();
    }
  } catch {}
}

async function fetchWorkItems(projectId) {
  try {
    const resp = await fetch("/projects/" + encodeURIComponent(projectId) + "/work-items");
    if (resp.ok) {
      state.workItems[projectId] = await resp.json();
      if (state.view === "project" && state.viewId === projectId) render();
    }
  } catch {}
}

// === Rendering ===
function render() {
  renderBreadcrumbs();
  const main = document.getElementById("main");

  switch (state.view) {
    case "dashboard":
      main.innerHTML = renderDashboard();
      break;
    case "project":
      main.innerHTML = renderProjectDetail(state.viewId);
      break;
    case "agent":
      main.innerHTML = renderAgentView(state.viewId);
      setupAgentView(state.viewId);
      break;
  }
}

function renderBreadcrumbs() {
  const el = document.getElementById("breadcrumbs");
  let html = '<a onclick="navigate(\'dashboard\')">Dashboard</a>';

  if (state.view === "project") {
    const proj = state.projects.find(p => p.id === state.viewId);
    html += '<span class="sep">/</span>';
    html += '<span class="current">' + esc(proj ? proj.name : state.viewId) + '</span>';
  } else if (state.view === "agent") {
    const agent = state.agents.find(a => a.id === state.viewId);
    if (agent) {
      const proj = state.projects.find(p => p.id === agent.projectId);
      if (proj) {
        html += '<span class="sep">/</span>';
        html += '<a onclick="navigate(\'project\',\'' + esc(proj.id) + '\')">' + esc(proj.name) + '</a>';
      }
    }
    html += '<span class="sep">/</span>';
    html += '<span class="current">Agent ' + esc(state.viewId ? state.viewId.slice(0, 8) : "") + '</span>';
  }

  el.innerHTML = html;
}

// --- Dashboard ---
function renderDashboard() {
  return '<div class="dashboard">' +
    renderProjectsPanel() +
    renderAgentsPanel() +
    renderWorkQueuePanel() +
    '</div>';
}

function renderProjectsPanel() {
  let body = "";
  if (state.projects.length === 0) {
    body = '<div class="empty">No projects detected</div>';
  } else {
    for (const p of state.projects) {
      const gitBadge = p.git
        ? (p.git.clean
          ? '<span class="badge-git-clean">' + esc(p.git.branch) + '</span>'
          : '<span class="badge-git-dirty">' + esc(p.git.branch) + '*</span>')
        : '';
      const workInfo = p.workSummary
        ? '<span class="work-summary">' + p.workSummary.open + ' open, ' + p.workSummary.inProgress + ' in-progress</span>'
        : '';
      body += '<div class="list-item" onclick="navigate(\'project\',\'' + esc(p.id) + '\')">' +
        '<div class="list-item-main">' +
          '<div class="list-item-title">' + esc(p.name) + '</div>' +
          '<div class="list-item-sub">' + esc(p.path) + '</div>' +
        '</div>' +
        '<div style="text-align:right;font-size:12px">' + gitBadge + '<br>' + workInfo + '</div>' +
        '</div>';
    }
  }
  return '<div class="panel">' +
    '<div class="panel-header">Projects <span style="color:var(--text-dim);font-weight:normal">' + state.projects.length + '</span></div>' +
    '<div class="panel-body">' + body + '</div>' +
    '</div>';
}

function renderAgentsPanel() {
  const active = state.agents.filter(a => a.state !== "stopped");
  let body = "";
  if (active.length === 0) {
    body = '<div class="empty">No active agents</div>';
  } else {
    for (const a of active) {
      const proj = state.projects.find(p => p.id === a.projectId);
      body += '<div class="list-item" onclick="navigate(\'agent\',\'' + esc(a.id) + '\')">' +
        '<span class="badge badge-state-' + esc(a.state) + '">' + esc(a.state) + '</span>' +
        '<div class="list-item-main">' +
          '<div class="list-item-title">' + esc(a.id.slice(0, 8)) + ' - ' + esc(a.backend) + '</div>' +
          '<div class="list-item-sub">' + esc(proj ? proj.name : a.projectId) +
            (a.workItemId ? ' / ' + esc(a.workItemId) : '') + '</div>' +
        '</div>' +
        '<button class="btn btn-danger" onclick="event.stopPropagation();stopAgent(\'' + esc(a.id) + '\')">Stop</button>' +
        '</div>';
    }
  }
  return '<div class="panel">' +
    '<div class="panel-header">Agents <span style="color:var(--text-dim);font-weight:normal">' + active.length + ' active</span></div>' +
    '<div class="panel-body">' + body + '</div>' +
    '</div>';
}

function renderWorkQueuePanel() {
  // Gather all work items from all projects
  let allItems = [];
  for (const [pid, items] of Object.entries(state.workItems)) {
    for (const item of items) {
      if (item.status === "open" || item.status === "in-progress") {
        allItems.push({ ...item, _projectId: pid });
      }
    }
  }
  allItems.sort((a, b) => a.priority - b.priority);

  let body = "";
  if (allItems.length === 0) {
    body = '<div class="empty">No open work items loaded</div>';
    // Try loading for known projects
    if (state.projects.length > 0 && Object.keys(state.workItems).length === 0) {
      for (const p of state.projects) fetchWorkItems(p.id);
      body = '<div class="empty">Loading work items...</div>';
    }
  } else {
    for (const item of allItems.slice(0, 20)) {
      const pClass = "badge-p" + item.priority;
      body += '<div class="list-item" onclick="navigate(\'project\',\'' + esc(item._projectId) + '\')">' +
        '<span class="badge ' + pClass + '">P' + item.priority + '</span>' +
        '<div class="list-item-main">' +
          '<div class="list-item-title">' + esc(item.title) + '</div>' +
          '<div class="list-item-sub">' + esc(item.id) + '</div>' +
        '</div>' +
        '<span class="badge badge-status-' + esc(item.status) + '">' + esc(item.status) + '</span>' +
        '</div>';
    }
  }

  return '<div class="panel full-width">' +
    '<div class="panel-header">Work Queue <span style="color:var(--text-dim);font-weight:normal">' + allItems.length + ' items</span></div>' +
    '<div class="panel-body">' + body + '</div>' +
    '</div>';
}

// --- Project Detail ---
function renderProjectDetail(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  const detail = state.projectDetails[projectId];
  const items = state.workItems[projectId] || [];
  const agents = state.agents.filter(a => a.projectId === projectId && a.state !== "stopped");

  let stackHtml = "";
  if (detail && detail.stack) {
    const s = detail.stack;
    const tags = [];
    if (s.languages) s.languages.forEach(l => tags.push(l.name + (l.version ? " " + l.version : "")));
    if (s.frameworks) s.frameworks.forEach(f => tags.push(f.name + (f.version ? " " + f.version : "")));
    if (s.packageManagers) s.packageManagers.forEach(pm => tags.push(pm.name));
    if (s.infra) s.infra.forEach(i => tags.push(i.name));
    stackHtml = '<div class="stack-tags">' + tags.map(t => '<span class="stack-tag">' + esc(t) + '</span>').join("") + '</div>';
    if (tags.length === 0) stackHtml = '<div class="empty">No stack info</div>';
  } else {
    stackHtml = '<div class="empty">Loading...</div>';
  }

  // Tickets panel
  let ticketsHtml = "";
  if (items.length === 0) {
    ticketsHtml = '<div class="empty">No tickets found</div>';
  } else {
    for (const item of items) {
      const pClass = "badge-p" + item.priority;
      const startBtn = (item.status === "open" || item.status === "in-progress")
        ? '<button class="btn btn-primary" onclick="event.stopPropagation();startAgent(\'' + esc(projectId) + '\',\'' + esc(item.id) + '\')">Start Agent</button>'
        : '';
      ticketsHtml += '<div class="list-item">' +
        '<span class="badge ' + pClass + '">P' + item.priority + '</span>' +
        '<div class="list-item-main">' +
          '<div class="list-item-title">' + esc(item.title) + '</div>' +
          '<div class="list-item-sub">' + esc(item.id) + ' - ' + esc(item.status) + '</div>' +
        '</div>' +
        startBtn +
        '</div>';
    }
  }

  // Agents panel
  let agentsHtml = "";
  if (agents.length === 0) {
    agentsHtml = '<div class="empty">No active agents for this project</div>';
  } else {
    for (const a of agents) {
      agentsHtml += '<div class="list-item" onclick="navigate(\'agent\',\'' + esc(a.id) + '\')">' +
        '<span class="badge badge-state-' + esc(a.state) + '">' + esc(a.state) + '</span>' +
        '<div class="list-item-main">' +
          '<div class="list-item-title">' + esc(a.id.slice(0, 8)) + ' - ' + esc(a.backend) + '</div>' +
          '<div class="list-item-sub">' + (a.workItemId ? esc(a.workItemId) : 'no ticket') + '</div>' +
        '</div>' +
        '<button class="btn btn-danger" onclick="event.stopPropagation();stopAgent(\'' + esc(a.id) + '\')">Stop</button>' +
        '</div>';
    }
  }

  // Meta info
  let metaHtml = "";
  if (proj) {
    metaHtml += '<div class="meta-row"><span class="meta-label">Path</span><span class="meta-value">' + esc(proj.path) + '</span></div>';
    if (proj.git) {
      metaHtml += '<div class="meta-row"><span class="meta-label">Branch</span><span class="meta-value">' + esc(proj.git.branch) + (proj.git.clean ? "" : " (dirty)") + '</span></div>';
      if (proj.git.remote) {
        metaHtml += '<div class="meta-row"><span class="meta-label">Remote</span><span class="meta-value">' + esc(proj.git.remote) + '</span></div>';
      }
    }
  }

  return '<div class="detail-view">' +
    '<div class="detail-grid">' +
      '<div class="panel">' +
        '<div class="panel-header">Stack</div>' +
        '<div class="panel-body">' + metaHtml + stackHtml + '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-header">Agents <span style="color:var(--text-dim);font-weight:normal">' + agents.length + '</span></div>' +
        '<div class="panel-body">' + agentsHtml + '</div>' +
      '</div>' +
      '<div class="panel full-width">' +
        '<div class="panel-header">Tickets <span style="color:var(--text-dim);font-weight:normal">' + items.length + '</span></div>' +
        '<div class="panel-body">' + ticketsHtml + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// --- Agent View ---
function renderAgentView(sessionId) {
  const agent = state.agents.find(a => a.id === sessionId);
  const stateBadge = agent
    ? '<span class="badge badge-state-' + esc(agent.state) + '">' + esc(agent.state) + '</span>'
    : '';
  const contextInfo = agent && agent.contextUsage
    ? '<span style="font-size:12px;color:var(--text-dim)">Context: ' + agent.contextUsage.percentage + '%</span>'
    : '';
  const stopBtn = agent && agent.state !== "stopped"
    ? '<button class="btn btn-danger" onclick="stopAgent(\'' + esc(sessionId) + '\')">Stop Agent</button>'
    : '';

  return '<div class="agent-view">' +
    '<div class="agent-header">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        stateBadge +
        '<span style="font-family:var(--mono);font-size:13px;color:var(--text-bright)">' + esc(sessionId.slice(0, 12)) + '</span>' +
        contextInfo +
      '</div>' +
      stopBtn +
    '</div>' +
    '<div class="agent-output" id="agent-output"></div>' +
    '<button class="scroll-bottom-btn" id="scroll-btn" onclick="scrollToBottom()">Scroll to bottom</button>' +
    '<div class="agent-input">' +
      '<input type="text" id="prompt-input" placeholder="Send a message to agent..." ' +
        'onkeydown="if(event.key===\'Enter\')sendPrompt()" ' +
        (agent && agent.state === "stopped" ? "disabled" : "") + '>' +
      '<button class="btn btn-primary" onclick="sendPrompt()" ' +
        (agent && agent.state === "stopped" ? "disabled" : "") + '>Send</button>' +
    '</div>' +
  '</div>';
}

function setupAgentView(sessionId) {
  renderAgentOutput(sessionId);
  const outputEl = document.getElementById("agent-output");
  if (outputEl) {
    outputEl.addEventListener("scroll", () => {
      const el = outputEl;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      autoScroll = atBottom;
      const btn = document.getElementById("scroll-btn");
      if (btn) btn.classList.toggle("visible", !atBottom);
    });
  }
  const input = document.getElementById("prompt-input");
  if (input) input.focus();
}

function renderAgentOutput(sessionId) {
  const outputEl = document.getElementById("agent-output");
  if (!outputEl) return;

  const entries = state.agentOutput[sessionId] || [];
  let html = "";
  for (const entry of entries) {
    if (entry.kind === "tool") {
      const statusIcon = entry.done ? (entry.toolSuccess !== false ? "done" : "failed") : "running...";
      html += '<details class="tool-call"' + (entry.done ? '' : ' open') + '>' +
        '<summary>' + esc(entry.toolName) + ' (' + statusIcon + ')</summary>' +
        '<div class="tool-body">';
      if (entry.toolInput) html += '<div style="margin-bottom:4px;color:var(--accent)">Input:</div><pre style="margin:0 0 8px 0;white-space:pre-wrap">' + esc(entry.toolInput) + '</pre>';
      if (entry.toolOutput) html += '<div style="margin-bottom:4px;color:var(--accent)">Output:</div><pre style="margin:0;white-space:pre-wrap">' + esc(entry.toolOutput) + '</pre>';
      html += '</div></details>';
    } else {
      html += entry.html;
    }
  }

  outputEl.innerHTML = html;

  if (autoScroll) {
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

function scrollToBottom() {
  const el = document.getElementById("agent-output");
  if (el) {
    el.scrollTop = el.scrollHeight;
    autoScroll = true;
    const btn = document.getElementById("scroll-btn");
    if (btn) btn.classList.remove("visible");
  }
}

// === Actions ===
function startAgent(projectId, workItemId) {
  send({
    type: "start_agent",
    projectId: projectId,
    workItemId: workItemId || undefined,
    backend: "claude-code"
  });
}

function stopAgent(agentId) {
  send({ type: "stop_agent", agentId: agentId });
}

function sendPrompt() {
  const input = document.getElementById("prompt-input");
  if (!input || !input.value.trim() || !state.viewId) return;
  const text = input.value.trim();
  input.value = "";
  send({ type: "prompt", agentId: state.viewId, text: text });

  // Add the prompt to the local output
  if (!state.agentOutput[state.viewId]) state.agentOutput[state.viewId] = [];
  state.agentOutput[state.viewId].push({
    kind: "system",
    html: '<span class="system-line">You: ' + esc(text) + '</span>'
  });
  renderAgentOutput(state.viewId);
}

// === Utility ===
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// === Keepalive ===
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "ping" });
  }
}, 30000);

// === Init ===
connect();
render();
</script>
</body>
</html>`;
}
