/**
 * 唯一生产装配入口（P1.1）：checker 的 trace 接线只写一次
 *
 * 旧实现里 `new ConstraintChecker(new TraceCollector({ projectPath }))` 抄在
 * bootstrap.ts（assembleHarness）、cli/commands/check.ts、cli/commands/report.ts
 * 三处——trace 接线散在多处，改接线点要同步多处，漏一处就是静默不写 trace。
 *
 * 新契约：bootstrap 导出唯一装配函数 `assembleConstraintChecker(projectPath)`，
 * 全部生产调用方（含 bootstrapHarness 两入口）经它取接线好的 checker。
 * 本闸 = 一道源形状闸（装配点唯一）+ 一道行为闸（经唯一装配点拿到的
 * checker 确实把 trace 写到锚定的项目根——不是结构性空断言）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assembleConstraintChecker } from '../bootstrap';

const SRC_DIR = path.resolve(__dirname, '..');
const BOOTSTRAP_DIR = path.join(SRC_DIR, 'bootstrap');

function listProductionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listProductionTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('唯一生产装配入口（P1.1）', () => {
  it('装配点唯一：checker 直建与 trace 接线只在 bootstrap/（白名单见下）', () => {
    // 白名单（豁免理由随站点）：
    // - core/constraints/checker.ts：getInstance() 自构造未接线默认实例——公共兼容出口，
    //   只评估不写 trace，不是生产接线点
    // - monitoring/：TraceCollector 的本体实现就在这一层
    // - pretool-use-hook.ts：provider PreToolUse 执法脚本的独立组合根（ADR-0031），
    //   与 check/report 的 checker 接线不是同一件事
    const SELF_CONSTRUCT = path.join(SRC_DIR, 'core', 'constraints', 'checker.ts');
    const MONITORING_DIR = path.join(SRC_DIR, 'monitoring') + path.sep;
    const PRETOOL_HOOK = path.join(SRC_DIR, 'pretool-use-hook.ts');
    const offenders: string[] = [];
    for (const file of listProductionTsFiles(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file);
      if (file.startsWith(BOOTSTRAP_DIR + path.sep)) continue;
      const source = fs.readFileSync(file, 'utf-8');
      // trace 接线对（checker + 收集器同点构造）只允许出现在 bootstrap/
      if (/new\s+ConstraintChecker\s*\(\s*new\s+TraceCollector\s*\(/.test(source)) {
        offenders.push(`${rel}: trace 接线对`);
      }
      if (/new\s+ConstraintChecker\s*\(/.test(source) && file !== SELF_CONSTRUCT) {
        offenders.push(`${rel}: new ConstraintChecker`);
      }
      if (
        /new\s+TraceCollector\s*\(/.test(source) &&
        !file.startsWith(MONITORING_DIR) &&
        file !== PRETOOL_HOOK
      ) {
        offenders.push(`${rel}: new TraceCollector`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('check.ts 与 report.ts 经唯一装配函数取 checker', () => {
    for (const name of ['cli/commands/check.ts', 'cli/commands/report.ts']) {
      const source = fs.readFileSync(path.join(SRC_DIR, name), 'utf-8');
      expect(source).toMatch(/assembleConstraintChecker\s*\(/);
      expect(source).toMatch(/from\s+'[^']*bootstrap'/);
    }
  });

  it('bootstrap.ts 内部：checker 直建只有装配函数一处，assembleHarness 不得回退 inline', () => {
    const source = fs.readFileSync(path.join(BOOTSTRAP_DIR, 'bootstrap.ts'), 'utf-8');
    // 全文件 trace 接线对恰一处（在 assembleConstraintChecker 体内）
    const wiringPairs = source.match(/new\s+ConstraintChecker\s*\(\s*new\s+TraceCollector\s*\(/g) ?? [];
    expect(wiringPairs).toHaveLength(1);
    // assembleHarness 体内不得直建 checker / TraceCollector——
    // 否则它绕开装配函数重新 inline，第一道闸因整目录豁免而看不见
    const assembleBody = source.split('function assembleHarness')[1]?.split('\n}')[0] ?? '';
    expect(assembleBody).not.toMatch(/new\s+ConstraintChecker\s*\(/);
    expect(assembleBody).not.toMatch(/new\s+TraceCollector\s*\(/);
  });

  it('行为：经唯一装配点拿到的 checker 把 trace 写到锚定项目根', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-unique-assembly-'));
    try {
      fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
      const checker = assembleConstraintChecker(dir);
      await checker.checkConstraints({ operation: 'file_modification', projectPath: dir }, null);
      const traceFile = path.join(dir, '.harness', 'logs', 'traces.log');
      expect(fs.existsSync(traceFile)).toBe(true);
      const content = fs.readFileSync(traceFile, 'utf-8');
      expect(content).toContain('"projectPath"');
      expect(content).toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
