/**
 * Claude Code transcript（.jsonl）读取（工单 19-C）
 *
 * 原 analyze-sessions.findSessions 与 update-user-model.findNewSessions
 * 各持一份解析逻辑，收敛于此。
 */

import * as fs from 'fs';
import * as path from 'path';
import { readJsonl } from '../../utils/jsonl';

export interface MinedTurn {
  role: string;
  content: string;
}

export interface MinedSession {
  /** 会话 ID（文件名去掉 .jsonl，截断至 40 字符） */
  id: string;
  /** 文件修改日期（YYYY-MM-DD） */
  date: string;
  /** 修改时间戳（毫秒） */
  mtimeMs: number;
  turns: MinedTurn[];
  /** 出现过的工具调用名（去重，保持出现顺序） */
  toolCalls: string[];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join(' ');
  }
  return '';
}

/**
 * 扫描目录下的 .jsonl transcript 文件
 *
 * 不可读/损坏的行静默跳过（与原实现一致）。
 */
export function readTranscriptSessions(dir: string): MinedSession[] {
  const sessions: MinedSession[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return sessions;
  }

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = path.join(dir, file);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    const turns: MinedTurn[] = [];
    const toolCalls: string[] = [];

    let records: Record<string, any>[];
    try {
      // 损坏行静默跳过（坏行策略 skip，与原实现一致，harness#82 走 jsonl 正本）；
      // 外层 catch 兜文件不可读，沿用原「跳过该文件」语义
      records = readJsonl<Record<string, any>>(filePath, 'skip').records;
    } catch {
      continue;
    }

    for (const entry of records) {
      try {
        const msg = entry.message;
        if (msg?.role && (msg.content || entry.type === 'user')) {
          turns.push({ role: msg.role, content: extractText(msg.content) });
        }
        if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_use' && block.name) {
              toolCalls.push(block.name);
            }
          }
        }
      } catch {
        // 单条记录提取异常跳过（原逐行 catch 语义：parse 已由 module skip，此处兜提取）
      }
    }

    if (turns.length > 0) {
      sessions.push({
        id: file.replace('.jsonl', '').slice(0, 40),
        date: stat.mtime.toISOString().slice(0, 10),
        mtimeMs: stat.mtimeMs,
        turns,
        toolCalls: [...new Set(toolCalls)],
      });
    }
  }

  return sessions;
}
