#!/usr/bin/env node
/**
 * PostToolUse hook — track deep analysis signals + collect AgentEvents
 *
 * Updates state file with:
 *   - planned: EnterPlanMode was called
 *   - explored: Agent(Explore) was spawned
 *   - readDirs: Set of unique directories Read was called on
 *   - captured: Write to .harness/knowledge-docs/ or .harness/knowledge/
 *   - turnCount: session turn counter
 *   - events: AgentEvent[] (B9-016) — buffered for batch POST on session:end
 *
 * Usage: PostToolUse hook with matcher "EnterPlanMode|Agent|Read|Write|Edit|Bash"
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = '/tmp/claude-knowledge-capture-state.json';
const LOG_FILE = '/tmp/claude-knowledge-hooks.log';

function log(level, message, data) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), level, message, ...data }) + '\n';
    fs.appendFileSync(LOG_FILE, entry, 'utf-8');
  } catch {}
}

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => input += chunk);

process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const state = loadState();
    updateState(state, event);
    saveState(state);
  } catch (e) {
    // Silently ignore parse errors
  }
});

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  // B9-016: generate sessionId for this Claude Code session
  const sessionId = 'cc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  return { planned: false, explored: false, readDirs: [], captured: false, sessionId, events: [], startTime: Date.now() };
}

function updateState(state, event) {
  const toolName = event.tool_name || '';

  if (toolName === 'EnterPlanMode') {
    state.planned = true;
    log('info', 'planned', { tool: toolName });
  }

  if (toolName === 'Agent') {
    const input = event.tool_input || {};
    if (input.subagent_type === 'Explore') {
      state.explored = true;
      log('info', 'explored', { tool: toolName, subagent_type: input.subagent_type });
    }
  }

  if (toolName === 'Read') {
    const input = event.tool_input || {};
    const filePath = input.file_path || '';
    const dir = path.dirname(filePath);
    if (dir && dir !== '.' && dir !== '/' && !state.readDirs.includes(dir)) {
      state.readDirs.push(dir);
    }
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    const input = event.tool_input || {};
    const filePath = input.file_path || '';
    if (filePath.includes('.harness/knowledge-docs/') || filePath.includes('.harness/knowledge/')) {
      state.captured = true;
      log('info', 'captured', { file: filePath });
    }
    // B9-016: collect file:change event
    if (filePath && !filePath.includes('.harness/')) {
      state.events.push({
        sessionId: state.sessionId,
        agentId: 'claude-code',
        timestamp: Date.now(),
        type: 'file:change',
        payload: { path: filePath, action: toolName === 'Write' ? 'create' : 'modify' },
      });
    }
  }

  if (toolName === 'Bash') {
    const input = event.tool_input || {};
    const command = input.command || '';
    // B9-016: collect tool:call event
    state.events.push({
      sessionId: state.sessionId,
      agentId: 'claude-code',
      timestamp: Date.now(),
      type: 'tool:call',
      payload: { tool: 'Bash', command: command.slice(0, 200) },
    });
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
  } catch {}
}
