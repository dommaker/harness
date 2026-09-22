/**
 * regex-scan 模板：正则扫描约束（ADR-0033，块 3 子项 2）
 *
 * 形态参照 no-hardcoded-credentials：scope='diff'（缺省）扫 staged diff 新增行，
 * diff 为空/不可用时退化为变更文件内容扫描；scope='content' 直接扫变更文件内容。
 * 命中即违规，证据行点名文件与命中行（harness#119：fail 必须可归因）。
 *
 * 参数：
 * - pattern（必填）：正则字符串
 * - glob（可选）：限定文件集（相对路径，支持 `**`/`*`/`?`）
 * - scope（可选）：'diff' | 'content'，缺省 'diff'
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { formatEvidence, type CheckDetail, type CheckEnv, type ConstraintCheck, type TemplatedCheckerFactory } from '../types';
import { matchGlob } from './glob';

/** 证据行单行长度上限（命中行可能是整行配置/长文本） */
const MAX_LINE = 120;

interface AddedLine {
  file: string;
  line: string;
}

/** 从 unified diff 中取新增行（按 +++ b/<path> 归属文件，glob 过滤文件集） */
function collectAddedLines(diff: string, inScope: (file: string) => boolean): AddedLine[] {
  const out: AddedLine[] = [];
  let file = '';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('diff --git')) {
      if (raw.startsWith('diff --git')) file = '';
      continue;
    }
    if (raw.startsWith('+') && file && inScope(file)) {
      out.push({ file, line: raw.slice(1) });
    }
  }
  return out;
}

function hitEvidence(pattern: RegExp, hits: string[]): CheckDetail {
  return {
    pass: false,
    evidence: formatEvidence(`命中禁用模式 /${pattern.source}/`, hits),
  };
}

function clip(line: string): string {
  const t = line.trim();
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE)}…` : t;
}

export const regexScan: TemplatedCheckerFactory = {
  validateParams(params) {
    const errors: string[] = [];
    const pattern = params.pattern;
    if (typeof pattern !== 'string' || pattern.length === 0) {
      errors.push('pattern 必填（正则字符串）');
    } else {
      try {
        new RegExp(pattern);
      } catch (err) {
        errors.push(`pattern 不是合法正则：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (params.glob !== undefined && typeof params.glob !== 'string') {
      errors.push('glob 必须是字符串');
    }
    if (params.scope !== undefined && params.scope !== 'diff' && params.scope !== 'content') {
      errors.push("scope 必须是 'diff' 或 'content'");
    }
    return errors;
  },

  create(id, params): ConstraintCheck {
    const pattern = new RegExp(params.pattern as string);
    const glob = params.glob as string | undefined;
    const scope = (params.scope as 'diff' | 'content' | undefined) ?? 'diff';
    const inScope = (file: string) => !glob || matchGlob(file, glob);

    const scanChangedFiles = (env: CheckEnv): string[] => {
      const hits: string[] = [];
      for (const file of (env.context.changedFiles ?? []).filter(inScope)) {
        let content: string;
        try {
          content = readFileSync(join(env.projectPath, file), 'utf-8');
        } catch {
          continue; // 文件不可读（已删除/二进制）→ 跳过
        }
        for (const line of content.split('\n')) {
          if (pattern.test(line)) hits.push(`${file}: ${clip(line)}`);
        }
      }
      return hits;
    };

    return {
      id,
      async evaluate(env) {
        if (scope === 'content') {
          const hits = scanChangedFiles(env);
          return hits.length > 0 ? hitEvidence(pattern, hits) : true;
        }

        // scope='diff'：staged diff 新增行；diff 为空/不可用 → 退化变更文件内容扫描
        let scanned = false;
        try {
          const diff = await env.stagedDiff();
          const added = collectAddedLines(diff, inScope);
          if (added.length > 0) {
            scanned = true;
            const hits = added.filter(a => pattern.test(a.line)).map(a => `${a.file}: ${clip(a.line)}`);
            if (hits.length > 0) return hitEvidence(pattern, hits);
          }
        } catch {
          // diff 不可用 → 退化为文件内容扫描
        }
        if (!scanned) {
          const hits = scanChangedFiles(env);
          if (hits.length > 0) return hitEvidence(pattern, hits);
        }
        return true;
      },
    };
  },
};
