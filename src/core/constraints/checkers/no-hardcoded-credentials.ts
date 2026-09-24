/**
 * no_hardcoded_credentials：硬编码凭证扫描（ADR-0001：shell 扫描逻辑接入真 checker；
 * harness#184：收窄正则版 + fail 证据行）
 *
 * 扫描 staged diff 的新增行（无 staged diff 时退化为变更文件内容），
 * 命中私钥指纹/口令赋值/URL 内嵌凭证即 fail，证据行带 文件:行号（harness#119）。
 *
 * 分工：本 checker 是 commit 时增量快速反馈；全历史专业扫描走 gitleaks
 * （`security secrets`，ADR-0031）。文档类文件（.md 等）不参与增量扫描——
 * 文档里的密钥样例是误报大户，真实泄露由全历史扫描兜底。
 *
 * 模板文件（.example/.sample/.template/.dist）与占位符值（your_xxx、process.env
 * 引用、变量插值等）豁免；占位符判定作用于「值」而非整行，行内出现 test/example
 * 等词不再豁免真实值。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { formatEvidence, type CheckDetail, type ConstraintCheck } from './types';

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
  // JWT（三段 base64url，header 恒以 eyJ 开头）
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
];

/**
 * 通用赋值模式：口令类变量 = 字面量，键名两侧允许引号（JSON），值允许无引号
 * （.env 裸值 / 无引号 YAML）。捕获组 1 = 引号值，2 = 裸值。
 * 不要求前词边界，覆盖 dbPassword 等 camelCase。
 */
const ASSIGNMENT_PATTERN =
  /["']?(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|token|credential|private[_-]?key|signing[_-]?key)\b["']?\s*[:=]\s*(?:['"]([^'"\n]{8,})['"]|([^\s'"]{8,}))/i;

/** URL 内嵌凭证（userinfo 带口令的 URL） */
const URL_CREDENTIAL_PATTERN = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^/\s:@'"]+:[^/\s@'"]+@/i;

/**
 * 占位符值（判定作用于值本身，不再整行豁免）：
 * 环境变量引用 / your_xxx / <placeholder> / ${...} / xxx / 明显假值 /
 * TS 类型注解（token: string|undefined 的值是类型名而非字面量）
 */
const PLACEHOLDER_VALUE =
  /^(?:process\.env\b|your[_-]|<|\$\{|xxx+$|placeholder|changeme|dummy|fake|redacted|string\b|number\b|boolean\b|unknown\b|any\b)/i;

/** URL 匹配串内的占位符（变量插值、尖括号、your_xxx） */
const URL_PLACEHOLDER = /\$\{|<|your[_-]|xxx+/i;

/** 允许占位符的模板文件后缀 */
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist'];

/** 文档文件后缀：增量扫描豁免（样例误报大户；真实泄露由 gitleaks 全历史扫描兜底） */
const DOC_SUFFIXES = ['.md', '.mdx', '.rst', '.adoc'];

function scannableFile(file: string): boolean {
  return ![...TEMPLATE_SUFFIXES, ...DOC_SUFFIXES].some(s => file.endsWith(s));
}

/** 命中规则名（进证据行；密钥原文一律不外显） */
type HitRule = '私钥/令牌指纹' | '口令类赋值' | 'URL 内嵌凭证';

interface Hit {
  file: string;
  line: number;
  rule: HitRule;
}

/** 判定单行是否命中，返回规则名 */
function classifyLine(line: string): HitRule | null {
  for (const pattern of FINGERPRINT_PATTERNS) {
    if (pattern.test(line)) return '私钥/令牌指纹';
  }
  const assign = line.match(ASSIGNMENT_PATTERN);
  if (assign) {
    const value = assign[1] ?? assign[2];
    if (!PLACEHOLDER_VALUE.test(value)) return '口令类赋值';
  }
  const url = line.match(URL_CREDENTIAL_PATTERN);
  if (url && !URL_PLACEHOLDER.test(url[0])) return 'URL 内嵌凭证';
  return null;
}

/** 扫描文本（file 仅用于证据行），返回全部命中 */
function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rule = classifyLine(lines[i]);
    if (rule) hits.push({ file, line: i + 1, rule });
  }
  return hits;
}

/** 判定一段文本是否包含硬编码凭证 */
export function containsHardcodedCredential(text: string): boolean {
  return scanText(text, '(text)').length > 0;
}

interface AddedLine {
  file: string;
  lineNo: number;
  text: string;
}

/** 从 unified diff 中取新增行：按 +++ b/<path> 归属文件，按 @@ +n @@ 推算新文件行号 */
function collectAddedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = '';
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      file = '';
      newLine = 0;
      continue;
    }
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length);
      continue;
    }
    if (raw.startsWith('+++')) {
      file = '';
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (!file || newLine === 0) continue;
    if (raw.startsWith('+')) {
      out.push({ file, lineNo: newLine, text: raw.slice(1) });
      newLine++;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      newLine++;
    }
  }
  return out;
}

function failDetail(hits: Hit[]): CheckDetail {
  return {
    pass: false,
    evidence: formatEvidence(
      '发现疑似硬编码凭证（原文不外显；确认后吊销轮换，改走环境变量/加密配置）',
      hits.map(h => `${h.file}:${h.line} — ${h.rule}`)
    ),
  };
}

export const noHardcodedCredentials: ConstraintCheck = {
  id: 'no_hardcoded_credentials',
  evaluate: async (env) => {
    // 1) staged diff 新增行（按文件过滤：模板/文档豁免在 diff 路径同样生效）
    let scanned = false;
    try {
      const diff = await env.stagedDiff();
      const added = collectAddedLines(diff).filter(a => scannableFile(a.file));
      if (added.length > 0) {
        scanned = true;
        const hits: Hit[] = [];
        for (const a of added) {
          const rule = classifyLine(a.text);
          if (rule) hits.push({ file: a.file, line: a.lineNo, rule });
        }
        if (hits.length > 0) return failDetail(hits);
      }
    } catch {
      // diff 不可用 → 退化为文件内容扫描
    }

    // 2) 变更文件内容（diff 为空或不可用时）
    if (!scanned) {
      const files = (env.context.changedFiles || []).filter(scannableFile);
      const hits: Hit[] = [];
      for (const file of files) {
        try {
          const content = readFileSync(join(env.projectPath, file), 'utf-8');
          hits.push(...scanText(content, file));
        } catch {
          // 文件不可读（已删除/二进制）→ 跳过
        }
      }
      if (hits.length > 0) return failDetail(hits);
    }

    return true;
  },
};
