/**
 * 防回归：src/ 与 bin/ 不得再出现特定下游消费方/环境引用
 *
 * harness 是通用约束框架，不得残留任何特定下游消费方、内部项目名或
 * 特定环境服务（含 MCP server 工具名）的引用（历史清理票落地，词表见下）。
 * provider 名（codex/claude/kimi 等）是领域词汇，不在词表内。
 * 递归扫描 src/ 与 bin/ 全部文本文件，逐行断言无目标词命中，
 * 命中即 fail 并列出 文件:行。二进制文件（含 NUL 字节）跳过。
 *
 * 目标词经拼接构造、本文件名以外的内容不出现其字面量——
 * 保证仓级全文检索（grep -ri）对本测试自身也零命中。
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['src', 'bin'];
const WORDS = [
  ['stu', 'dio'].join(''),
  ['way', 'finder'].join(''),
  ['mcp__', 'local', '-rag__'].join(''),
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function isText(buf: Buffer): boolean {
  return !buf.includes(0);
}

describe.each(WORDS)('no %s references', word => {
  // 只用前边界：目标词可能是更长工具名的前缀（如 mcp__xxx__ingest_file），
  // 后边界会让这类命中漏网
  const TARGET = new RegExp(`\\b${word}`, 'i');
  it('src/ 与 bin/ 全部文本文件零命中', () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(path.join(REPO_ROOT, dir))) {
        const buf = fs.readFileSync(file);
        if (!isText(buf)) continue;
        const lines = buf.toString('utf-8').split('\n');
        lines.forEach((line, i) => {
          if (TARGET.test(line)) {
            hits.push(`${path.relative(REPO_ROOT, file)}:${i + 1}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
