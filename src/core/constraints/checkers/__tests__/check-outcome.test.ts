/**
 * 检查结果证据通道测试（harness#119）
 *
 * 背景：checker 只回 `boolean | 'skip'`，fail 的具体原因（哪个文件没登记）在 CLI
 * 与 trace 两头都无处落脚——capability_sync 连红 22 次而无人能说出红在哪。
 * 本套件锁住新接缝：CheckDetail（pass + evidence）经 normalizeCheckOutcome
 * 归一后，落到 ConstraintResult.evidence 与 ExecutionTrace.evidence。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ConstraintChecker } from '../../checker';
import { normalizeCheckOutcome } from '../types';
import type { ExecutionTrace } from '../../../../types/trace';
import { ConstraintViolationError } from '../../../../types/constraint';
import type { Constraint, ConstraintResult } from '../../../../types/constraint';
import type { MergedConstraintsConfig } from '../../../../types/project-config';

const CAPABILITY_SYNC: Constraint = {
  id: 'capability_sync',
  kind: 'check',
  level: 'guideline',
  rule: 'CODE CHANGES MUST UPDATE CAPABILITIES.MD',
  message: '核心模块变更必须同步功能清单',
  trigger: ['module_modification'],
  enforcement: 'update-capabilities',
};

/** 建临时项目根：CAPABILITIES.md + 指定源文件（无 git，staged 证据自然为空） */
function projectRoot(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-evidence-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
  return dir;
}

describe('normalizeCheckOutcome — 三态 + 证据归一', () => {
  it('boolean 兼容旧形状：true → satisfied / false → violated，evidence 空', () => {
    expect(normalizeCheckOutcome(true)).toEqual({ satisfied: true, skipped: false, evidence: [] });
    expect(normalizeCheckOutcome(false)).toEqual({ satisfied: false, skipped: false, evidence: [] });
  });

  it("'skip' → skipped 且不记证据", () => {
    expect(normalizeCheckOutcome('skip')).toEqual({ satisfied: true, skipped: true, evidence: [] });
  });

  it('CheckDetail 透传 pass 与 evidence；缺省 evidence 归一为空数组', () => {
    expect(normalizeCheckOutcome({ pass: false, evidence: ['a.ts'] })).toEqual({
      satisfied: false,
      skipped: false,
      evidence: ['a.ts'],
    });
    expect(normalizeCheckOutcome({ pass: true })).toEqual({
      satisfied: true,
      skipped: false,
      evidence: [],
    });
  });
});

/** 只含 capability_sync 的生效集：一次 run 一条 trace，不牵动其他约束 */
function onlyCapabilitySync(): MergedConstraintsConfig {
  return {
    ironLaws: {},
    guidelines: { capability_sync: CAPABILITY_SYNC },
    prompts: {},
    disabled: [],
    custom: [],
  };
}

/** 跑一次 checkConstraints，返回 capability_sync 的结果与它那条 trace */
async function runGuideline(dir: string): Promise<{
  result: ConstraintResult;
  trace: ExecutionTrace;
}> {
  const traces: ExecutionTrace[] = [];
  const checker = new ConstraintChecker({ record: (t) => traces.push(t) });
  const run = await checker.checkConstraints(
    { operation: 'module_modification', projectPath: dir },
    onlyCapabilitySync()
  );
  const result = run.guidelines.find(r => r.id === 'capability_sync')!;
  const trace = traces.find(t => t.constraintId === 'capability_sync')!;
  return { result, trace };
}

describe('capability_sync 证据经编排层落到 ConstraintResult 与 trace', () => {
  it('满足但存在仓库级未登记文件 → satisfied=true，evidence 带路径，trace 记 pass', async () => {
    const dir = projectRoot({
      'CAPABILITIES.md': '| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/foo.ts | foo |\n',
      'src/foo.ts': 'export const a = 1;\n',
      'src/unlisted.ts': 'export const b = 2;\n',
    });

    const { result, trace } = await runGuideline(dir);

    expect(result.satisfied).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.evidence?.join('\n')).toContain('unlisted.ts');
    expect(trace.result).toBe('pass');
    expect(trace.evidence?.join('\n')).toContain('unlisted.ts');
  });

  it('违规（staged 新文件未登记）→ satisfied=false，evidence 指出该文件，trace 记 fail', async () => {
    const dir = projectRoot({
      'CAPABILITIES.md': '| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/foo.ts | foo |\n',
      'src/foo.ts': 'export const a = 1;\n',
    });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'src/brand-new.ts'), 'export const c = 3;\n');
    execFileSync('git', ['add', '--', 'src/brand-new.ts'], { cwd: dir });

    const { result, trace } = await runGuideline(dir);

    expect(result.satisfied).toBe(false);
    expect(result.evidence?.join('\n')).toContain('src/brand-new.ts');
    expect(trace.result).toBe('fail');
    expect(trace.evidence?.join('\n')).toContain('src/brand-new.ts');
  });

  it('skip 不携带证据（未评估不得留下证据行）', async () => {
    const dir = projectRoot({ 'README.md': '# no capabilities convention\n' });

    const { result, trace } = await runGuideline(dir);

    expect(result.skipped).toBe(true);
    expect(result.evidence).toBeUndefined();
    expect(trace.result).toBe('skip');
    expect(trace.evidence).toBeUndefined();
  });
});

describe('证据随铁律异常外溢（CLI catch 分支只打印 error.message）', () => {
  it('ConstraintViolationError 文案带出证据行', () => {
    const error = new ConstraintViolationError({
      id: 'docs_freshness',
      level: 'iron_law',
      satisfied: false,
      message: '文档新鲜度检查未通过',
      evidence: ['CAPABILITIES.md 登记的条目不存在:', 'src/gone.ts'],
      checkedAt: new Date(),
    });

    expect(error.message).toContain('文档新鲜度检查未通过');
    expect(error.message).toContain('src/gone.ts');
  });

  it('无证据时文案保持原样（旧消费方断言不受影响）', () => {
    const error = new ConstraintViolationError({
      id: 'no_test_simplification',
      level: 'iron_law',
      satisfied: false,
      message: '禁止简化测试绕过困难',
      checkedAt: new Date(),
    });

    expect(error.message).toBe('禁止简化测试绕过困难');
  });
});
