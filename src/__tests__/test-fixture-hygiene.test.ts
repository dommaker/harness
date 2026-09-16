/**
 * 测试夹具卫生闸（harness#145）
 *
 * 钉住一件事：`__tests__` 里的文件系统夹具根一律经 `fs.mkdtempSync` 取每轮唯一目录，
 * 不得再出现「cwd 下固定名 temp-test 目录」这种夹具形状。
 *
 * 固定名的危害：同一 checkout 的两个并发 jest 进程共享该路径，一方的 afterAll rmSync
 * 会删掉另一方在用的夹具（表现为像产品 bug 的 flaky）；被 kill 的运行还会留下目录，
 * 下一轮从脏夹具起步。唯一后缀（mkdtemp 前缀以 `-` 结尾）从根上消掉这两条。
 *
 * 只判「名字是否唯一」，不判「落在哪个父目录」：cwd 锚定行为本身是被测语义的套件
 * （injection-writer / init-injection / parentDir opt-out）留在 cwd 是有意为之。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/** 固定名夹具形状：cwd 拼一个字面量 temp-test 目录名，且该名字不以 `-` 结尾（非 mkdtemp 前缀） */
const FIXED_FIXTURE_RE = /(?:path\.)?join\(\s*process\.cwd\(\)\s*,\s*(['"])temp-test-([^'"]*)\1\s*\)/g;

function collectTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, out);
    else if (entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('测试夹具卫生（#145）', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const files = collectTestFiles(repoRoot);

  it('扫描面非空（防止 glob 失效把闸扫成空集）', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('__tests__ 内不存在固定名 temp-test-* 夹具目录', () => {
    const offenders: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf-8').split('\n').forEach((line, idx) => {
        FIXED_FIXTURE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FIXED_FIXTURE_RE.exec(line)) !== null) {
          if (!m[2].endsWith('-')) offenders.push(`${path.relative(repoRoot, file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
