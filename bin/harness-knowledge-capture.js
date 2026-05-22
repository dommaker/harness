#!/usr/bin/env node
/**
 * Harness Knowledge Capture Hook
 *
 * Runs as an afterTurn hook in Claude Code.
 * Detects deep analysis (≥3 source files read) without knowledge-doc output,
 * and warns the user that knowledge may need to be captured.
 *
 * Usage (in settings.json):
 *   "hooks": {
 *     "afterTurn": [{
 *       "command": "node ~/projects/harness/bin/harness-knowledge-capture.js"
 *     }]
 *   }
 */

const fs = require('fs');
const path = require('path');

// Read turn data from stdin
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => input += chunk);

process.stdin.on('end', () => {
  try {
    const turn = JSON.parse(input);
    const result = checkTurn(turn);
    if (result.shouldWarn) {
      process.stderr.write(`\n${'='.repeat(60)}\n`);
      process.stderr.write('  ⚠️  可能遗漏了知识沉淀\n');
      process.stderr.write(`${'='.repeat(60)}\n`);
      process.stderr.write(`  本回合读取了 ${result.fileReads} 个文件\n`);
      process.stderr.write(`  但未写入 .harness/knowledge-docs/\n`);
      process.stderr.write(`\n`);
      process.stderr.write(`  如果这是深度分析，请执行：\n`);
      process.stderr.write(`    npx harness knowledge upsert --scope <scope> --file <file> --source claude\n`);
      process.stderr.write(`${'='.repeat(60)}\n\n`);
    }
  } catch (e) {
    // Silently ignore parse errors — non-JSON input is fine
  }
});

function checkTurn(turn) {
  let fileReads = 0;
  let knowledgeWrites = 0;

  // Walk through messages looking for tool calls
  const messages = turn.messages || [turn];
  for (const msg of messages) {
    // Claude Code format: tool_uses array
    if (msg.role === 'assistant' && msg.tool_uses) {
      for (const tool of msg.tool_uses) {
        if (isFileRead(tool)) fileReads++;
        if (isKnowledgeWrite(tool)) knowledgeWrites++;
      }
    }
    // Plain tool_calls format
    if (msg.tool_calls) {
      for (const tool of msg.tool_calls) {
        if (isFileRead(tool)) fileReads++;
        if (isKnowledgeWrite(tool)) knowledgeWrites++;
      }
    }
    // Messages content with tool use markers
    if (msg.content && typeof msg.content === 'string') {
      const readMatches = msg.content.match(/\bRead\b.*/g);
      if (readMatches) fileReads += readMatches.length;
    }
  }

  return {
    fileReads,
    knowledgeWrites,
    shouldWarn: fileReads >= 3 && knowledgeWrites === 0,
  };
}

function isFileRead(tool) {
  const name = (tool.name || tool.function?.name || '').toLowerCase();
  const isReadTool = ['read', 'glob', 'grep', 'agent'].includes(name);
  if (!isReadTool) return false;

  const params = tool.parameters || tool.function?.arguments || {};
  const filePath = params.file_path || params.path || params.pattern || '';
  // Only count actual source file reads, not config/memory/docs
  const isSource = /\/(src|packages|apps)\/|\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath);
  return isSource;
}

function isKnowledgeWrite(tool) {
  const name = (tool.name || tool.function?.name || '').toLowerCase();
  if (name !== 'write') return false;

  const params = tool.parameters || tool.function?.arguments || {};
  const filePath = params.file_path || '';
  return filePath.includes('.harness/knowledge-docs/') || filePath.includes('.harness/knowledge/');
}
