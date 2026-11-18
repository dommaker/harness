/**
 * 测试居所闸（handoff P2 第 2 项）
 *
 * 约定：只测单一模块的测试必须住在该模块自己的 `__tests__` 里；
 * 根 `src/__tests__` 只留分层、公共导出等跨模块架构测试。
 *
 * 判定口径：对根 `src/__tests__` 下每个测试文件，收集它相对 import 到的
 * src 内部落点（`../monitoring/...` → 模块目录 `monitoring`；
 * `../utils`/`../types`/`../test-setup` 是共享层，不算「被测模块」；
 * `../xxx` 直指 src 根文件（如 `../pretool-use-hook`）算跨模块面）。
 * 若文件 import 了某个已执法模块目录、却完全没有 import 任何其他
 * 非共享模块目录或 src 根文件，它就是该模块的测试放错了居所。
 *
 * 执法是分批的：`ENFORCED_MODULES` 从 monitoring（P2.1 trace 半）开始，
 * gates 等其余模块目录在各自切片（P2.2 gates 半、P2.3 core 半）加入，
 * 不一次性搬全仓。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..');
const ROOT_TESTS_DIR = path.join(SRC_ROOT, '__tests__');

/** 共享层：被测模块判定时不计入「另一个模块」 */
const SHARED_DIRS = new Set(['utils', 'types', 'test-setup']);

/** 已执法的模块目录（P2.1 = trace/monitoring；P2.2 = gates；P2.3 = core；P2.4 = failure） */
const ENFORCED_MODULES = ['monitoring', 'gates', 'core', 'failure'];

const IMPORT_RE = /(?:from\s+|require\(\s*)['"](\.[^'"]+)['"]/g;

/** 把相对 import 落点解析成 src 相对的一级段：模块目录名、共享目录名，或 null（src 根文件/越界） */
function resolveSegment(spec: string): string | null {
  const abs = path.resolve(ROOT_TESTS_DIR, spec);
  const rel = path.relative(SRC_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // 不在 src 内
  const seg = rel.split(path.sep)[0];
  return seg === rel ? null : seg; // 无分隔符 = 直指 src 根文件，算跨模块面
}

describe('测试居所（根 __tests__ 不驻留单模块测试）', () => {
  const files = fs.readdirSync(ROOT_TESTS_DIR).filter(name => name.endsWith('.test.ts'));

  it('扫描面非空（防止目录读空把闸扫成空集）', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(ENFORCED_MODULES)('只测 %s 的测试必须住在该模块自己的 __tests__', (mod) => {
    const offenders: string[] = [];
    for (const name of files) {
      const src = fs.readFileSync(path.join(ROOT_TESTS_DIR, name), 'utf-8');
      const segments = new Set<string>();
      IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_RE.exec(src)) !== null) {
        const seg = resolveSegment(m[1]);
        if (seg && !SHARED_DIRS.has(seg)) segments.add(seg);
      }
      const importsMod = segments.has(mod);
      const hasCrossModuleFace = [...segments].some(s => s !== mod);
      if (importsMod && !hasCrossModuleFace) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
