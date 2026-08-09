/**
 * no_hardcoded_credentials：硬编码凭证扫描（ADR-0001：shell 扫描逻辑接入真 checker）
 *
 * 扫描 staged diff 的新增行（无 staged diff 时退化为变更文件内容），
 * 命中常见私钥/密码/token 模式即 fail。
 *
 * 模板文件（.example/.sample/.template）与占位符值（your_xxx、process.env 引用等）豁免。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ConstraintCheck } from './types';

/** 私钥/令牌指纹模式（命中即违规，无例外） */
const FINGERPRINT_PATTERNS: RegExp[] = [
  // PEM 私钥头
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  // AWS Access Key ID
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  // GitHub token
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  // Slack token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Google API key
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

/** 通用赋值模式：password/secret/token/api key = "字面量"（不要求前词边界，覆盖 dbPassword 等 camelCase） */
const ASSIGNMENT_PATTERN =
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/i;

/** 占位符/环境变量引用等明显非真实值 */
const PLACEHOLDER_PATTERN =
  /process\.env|your[_-]|<[^>]+>|\$\{|xxx+|placeholder|example|changeme|dummy|fake|test/i;

/** 允许占位符的模板文件后缀 */
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist'];

function isTemplateFile(file: string): boolean {
  return TEMPLATE_SUFFIXES.some(s => file.endsWith(s));
}

/** 判定一段文本是否包含硬编码凭证 */
export function containsHardcodedCredential(text: string): boolean {
  for (const line of text.split('\n')) {
    // 占位符/环境变量引用行整体豁免（your_xxx、process.env、示例值等）
    if (PLACEHOLDER_PATTERN.test(line)) continue;
    for (const pattern of FINGERPRINT_PATTERNS) {
      if (pattern.test(line)) return true;
    }
    if (ASSIGNMENT_PATTERN.test(line)) return true;
  }
  return false;
}

export const noHardcodedCredentials: ConstraintCheck = {
  id: 'no_hardcoded_credentials',
  evaluate: async (env) => {
    const files = (env.context.changedFiles || []).filter(f => !isTemplateFile(f));

    // 1) staged diff 新增行
    let scanned = false;
    try {
      const diff = await env.stagedDiff();
      const added = diff
        .split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++'))
        .map(l => l.slice(1))
        .join('\n');
      if (added.trim().length > 0) {
        scanned = true;
        if (containsHardcodedCredential(added)) return false;
      }
    } catch {
      // diff 不可用 → 退化为文件内容扫描
    }

    // 2) 变更文件内容（diff 为空或不可用时）
    if (!scanned) {
      for (const file of files) {
        try {
          const content = readFileSync(join(env.projectPath, file), 'utf-8');
          if (containsHardcodedCredential(content)) return false;
        } catch {
          // 文件不可读（已删除/二进制）→ 跳过
        }
      }
    }

    return true;
  },
};
