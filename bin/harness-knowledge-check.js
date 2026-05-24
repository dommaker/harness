#!/usr/bin/env node
/**
 * Stop hook — check if deep analysis happened without knowledge capture
 *
 * Reads state file written by harness-knowledge-track.js.
 * If EnterPlanMode was called, or Agent(Explore) was spawned, or 10+ unique
 * directories were Read — and no knowledge files were Written — warn.
 *
 * Output: JSON with systemMessage (shown to user)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const STATE_FILE = '/tmp/claude-knowledge-capture-state.json';
const LOG_FILE = '/tmp/claude-knowledge-hooks.log';
const EVENTS_FILE = path.join(os.homedir(), 'events', 'studio.jsonl');
const UNIQUE_DIR_THRESHOLD = 10;

function log(level, message, data) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), level, message, ...data }) + '\n';
    fs.appendFileSync(LOG_FILE, entry, 'utf-8');
  } catch {}
}

try {
  if (!fs.existsSync(STATE_FILE)) process.exit(0);

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const deepAnalysis = state.planned || state.explored || state.readDirs.length >= UNIQUE_DIR_THRESHOLD;
  const missingCapture = !state.captured;

  log('info', 'stop-check', {
    planned: state.planned, explored: state.explored,
    readDirsCount: state.readDirs.length, captured: state.captured,
    deepAnalysis, missingCapture,
  });

  // Check 1: deep analysis without knowledge capture
  if (deepAnalysis && missingCapture) {
    const signals = [];
    if (state.planned) signals.push('EnterPlanMode called');
    if (state.explored) signals.push('Agent(Explore) spawned');
    if (state.readDirs.length >= UNIQUE_DIR_THRESHOLD) signals.push(`${state.readDirs.length} unique directories Read`);

    log('warn', 'missing-capture', { signals });

    const message = [
      '⚠️  Deep analysis detected but no knowledge captured.',
      `   Signals: ${signals.join(', ')}`,
      '',
      '   To capture:',
      '   1. Write .harness/knowledge-docs/<scope>.md',
      '   2. npx harness knowledge upsert --scope <scope> --file <file> --source claude',
      '',
      '   Or run `harness knowledge sync-status` to check staleness.',
    ].join('\n');

    console.log(JSON.stringify({ systemMessage: message }));
  }

  // Check 2: sensitive file operations without prior Read
  const sensitiveOps = (state.sensitiveOps || []).filter(op => !op.verified);
  if (sensitiveOps.length > 0) {
    log('warn', 'unverified-sensitive-ops', { sensitiveOps });

    const opsList = sensitiveOps.map(op => `   - ${op.tool}: ${op.file}`).join('\n');
    const message = [
      '⚠️  File operations on sensitive paths without prior verification.',
      `   Operations:`,
      opsList,
      '',
      '   These files were moved/edited/written without being Read first.',
      '   Verify the changes were intentional and correct.',
      '',
      '   📋 Rule: feedback_verify_before_move.md — Read before acting on file classification.',
    ].join('\n');

    console.log(JSON.stringify({ systemMessage: message }));
  }
  // Emit session summary event → events-daemon → knowledge extraction pipeline
  try {
    const now = Date.now();
    const durationMs = state.startTime ? now - state.startTime : 0;
    const durationMin = Math.round(durationMs / 60000);
    const event = {
      type: 'session:summary',
      sessionType: 'development',
      tool: state.tool || 'unknown',        // claude | codex | opencode | etc
      timestamp: new Date().toISOString(),
      durationMs,
      durationMin,
      deepAnalysis: state.planned || state.explored || state.readDirs.length >= UNIQUE_DIR_THRESHOLD,
      knowledgeCaptured: !!state.captured,
      readDirsCount: state.readDirs.length,
      planned: state.planned || false,
      explored: state.explored || false,
      sensitiveOpsCount: (state.sensitiveOps || []).filter(op => !op.verified).length,
      turnCount: state.turnCount || 0,
    };
    const dir = path.dirname(EVENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf-8');
    log('info', 'session-summary-emitted', event);
  } catch {}

  // Auto-ingest: scan memory files with ingest:true → call local-rag API
  // PostToolUse hooks don't fire in interactive mode, so Stop hook handles it
  try {
    const MEMORY_DIR = path.join(os.homedir(), '.claude', 'projects', '-root-projects', 'memory');
    if (fs.existsSync(MEMORY_DIR)) {
      const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
      const ingested = [];
      for (const f of files) {
        const fp = path.join(MEMORY_DIR, f);
        const head = fs.readFileSync(fp, 'utf-8').slice(0, 500);
        if (/^---[\s\S]*?ingest:\s*true[\s\S]*?---/.test(head)) {
          // Check if already ingested recently (skip if unchanged in last hour)
          const stat = fs.statSync(fp);
          const hourAgo = Date.now() - 3600_000;
          if (stat.mtimeMs > hourAgo) {
            ingested.push(fp);
          }
        }
      }
      if (ingested.length > 0) {
        log('info', 'auto-ingest-start', { count: ingested.length, files: ingested });
        const { execSync } = require('child_process');
        const syncScript = '/root/projects/studio/bin/memory-knowledge-sync.js';
        let successCount = 0;
        for (const fp of ingested) {
          try {
            execSync(`node "${syncScript}" "${fp}"`, { timeout: 10_000, stdio: 'pipe' });
            successCount++;
          } catch (e) {
            log('warn', 'auto-ingest-failed', { file: fp, error: (e.message || String(e)).slice(0, 100) });
          }
        }
        log('info', 'auto-ingest-done', { success: successCount, total: ingested.length });
      }
    }
  } catch {}
} catch (e) {
  // Silently ignore errors
} finally {
  // Clean up state file for next session
  try { fs.unlinkSync(STATE_FILE); } catch {}
}
