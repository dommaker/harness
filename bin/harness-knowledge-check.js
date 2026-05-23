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
const STATE_FILE = '/tmp/claude-knowledge-capture-state.json';
const LOG_FILE = '/tmp/claude-knowledge-hooks.log';
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
} catch (e) {
  // Silently ignore errors
} finally {
  // Clean up state file for next session
  try { fs.unlinkSync(STATE_FILE); } catch {}
}
