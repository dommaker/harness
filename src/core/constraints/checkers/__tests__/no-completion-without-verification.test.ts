/**
 * no_completion_without_verification 证据源重构（harness#183）
 *
 * 旧证据源是语义循环：traces.log 尾部 pass 记录的唯一生产写入方是约束检查自身
 * ——「你验证过了吗」的回答是「你之前被检查过吗」。本套件钉死新口径：
 *
 * - 证据源 = `.harness/evidence/`（独立链路写入：PassesGate.runTests 真实跑测试
 *   命令落盘，或消费方外部验证事件），与 traces.log 彻底脱钩
 * - 新鲜度 = 最新证据 mtime 严格晚于全部可读变更文件（验证跑在最新变更之后）；
 *   同刻等值 = 时钟精度内先后不可判（harness#195）→ 显式降级 skip，不放行也不违规
 * - 缺失/空目录 → fail；过期 → fail（点名晚于证据的变更文件）；
 *   证据位不可读 / 新鲜度不可判定 → 带原因的显式降级 skip（不静默）
 *
 * 端到端口径：一律经 ConstraintChecker.check 编排层进，不直调 evaluate。
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConstraintChecker } from '../../checker';
import { CONSTRAINTS } from '../../definitions';
import { getConstraintCheck } from '..';
import { PassesGate } from '../../../validators/passes-gate';
import { DEFAULT_TRACE_FILE } from '../../../../types/trace';
import type { ConstraintContext } from '../../../../types/constraint';

const LAW = CONSTRAINTS['no_completion_without_verification'];
/** 缺省 no-op trace 记录器：本套件不验 trace 面 */
const checker = new ConstraintChecker();

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ncwv-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 造一个变更文件，mtime 钉到指定时刻（不等真实时钟） */
function writeChangedFile(rel: string, mtime: Date): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'export const x = 1;');
  fs.utimesSync(abs, mtime, mtime);
  return rel;
}

/** 造一条验证证据，mtime 钉到指定时刻 */
function writeEvidence(name: string, mtime: Date): void {
  const evidenceDir = path.join(dir, '.harness', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const abs = path.join(evidenceDir, name);
  fs.writeFileSync(abs, 'test output');
  fs.utimesSync(abs, mtime, mtime);
}

function contextOf(changedFiles?: string[]): ConstraintContext {
  return { operation: 'code_implementation', projectPath: dir, changedFiles };
}

const T_OLD = new Date('2026-09-01T00:00:00Z');
const T_NEW = new Date('2026-09-02T00:00:00Z');

describe('no_completion_without_verification（harness#183 证据源重构）', () => {
  it('真实跑过验证且证据新鲜（证据晚于最新变更）→ pass', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    writeEvidence('test-2026-09-02.log', T_NEW);

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(true);
  });

  it('证据与最新变更同一时刻（等值不可判，harness#195）→ 显式降级 skip，不放行也不违规', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    writeEvidence('test-same-instant.log', T_OLD);

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    // 时钟精度内「同刻」物理上无法区分先后：判 pass 是假绿灯，判 fail 又可能误杀
    // 正常时序（改完立刻验证落进同一毫秒）——不可判定态走显式降级，与「变更清单
    // 未接线」「mtime 均不可读」同一出口
    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true); // skip 不产生违规
    expect(result.skipReason).toContain('同刻');
    expect(result.skipReason).toContain('src/a.ts');
  });

  it('严格晚于证据的变更与同刻变更并存 → fail 优先（证据确定过期，不因同刻降级）', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    writeChangedFile('src/b.ts', T_NEW);
    writeEvidence('test-same-instant.log', T_OLD);

    const result = await checker.check(LAW, contextOf(['src/a.ts', 'src/b.ts']));

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(false);
    expect(result.evidence?.join('\n')).toContain('src/b.ts');
  });

  it('changedFiles 为 undefined（调用方未接线变更清单）→ 显式降级 skip，不放行', async () => {
    writeEvidence('test-2026-09-02.log', T_NEW);

    const result = await checker.check(LAW, contextOf(undefined));

    // 新鲜度无所依 ≠ 合规：生产侧直调（跳过 context-builder）正是这形态，必须有声
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('变更清单未接线');
  });

  it('空 changedFiles（真无变更）+ 有证据 → pass', async () => {
    writeEvidence('test-2026-09-02.log', T_NEW);

    const result = await checker.check(LAW, contextOf([]));

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(true);
  });

  it('未跑验证（.harness/evidence 不存在）→ fail，证据行给出修复入口', async () => {
    writeChangedFile('src/a.ts', T_OLD);

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(false);
    expect(result.evidence?.join('\n')).toContain('.harness/evidence');
  });

  it('证据目录为空 → fail（等价未跑）', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    fs.mkdirSync(path.join(dir, '.harness', 'evidence'), { recursive: true });

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    expect(result.satisfied).toBe(false);
  });

  it('证据过期（旧于最新变更）→ fail，点名晚于证据的变更文件', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    writeChangedFile('src/b.ts', T_NEW);
    writeEvidence('test-2026-09-01.log', T_OLD);

    const result = await checker.check(LAW, contextOf(['src/a.ts', 'src/b.ts']));

    expect(result.satisfied).toBe(false);
    const text = result.evidence?.join('\n') ?? '';
    expect(text).toContain('过期');
    expect(text).toContain('src/b.ts');
    expect(text).not.toContain('src/a.ts');
  });

  it('循环拆除：traces.log 里有 pass 记录但无证据目录 → 仍 fail', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    // 旧口径下这是一条「验证证据」；新口径必须不认
    const logsDir = path.dirname(path.join(dir, DEFAULT_TRACE_FILE));
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, DEFAULT_TRACE_FILE),
      JSON.stringify({ constraintId: 'x', severity: 'error', timestamp: Date.now(), result: 'pass' }) + '\n'
    );

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    expect(result.satisfied).toBe(false);
  });

  it('证据位被占用但不是目录 → 显式降级 skip（带原因），不静默', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.harness', 'evidence'), 'not a directory');

    const result = await checker.check(LAW, contextOf(['src/a.ts']));

    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true); // skip 不产生违规
    expect(result.skipReason).toContain('.harness/evidence');
  });

  it('有证据但全部变更文件 mtime 不可读 → 显式降级 skip（无法判定新鲜度）', async () => {
    writeEvidence('test-2026-09-02.log', T_NEW);

    const result = await checker.check(LAW, contextOf(['src/gone.ts']));

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('新鲜度');
  });

  it('部分变更文件不可读不降级：按可读文件判定（删除文件是常态）', async () => {
    writeChangedFile('src/a.ts', T_OLD);
    writeEvidence('test-2026-09-02.log', T_NEW);

    const result = await checker.check(LAW, contextOf(['src/a.ts', 'src/deleted.ts']));

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(true);
  });

  it('flag 退役：不声明任何上下文证据标志输入契约（证据判定在 checker 体内）', () => {
    const check = getConstraintCheck('no_completion_without_verification');
    expect(check).toBeDefined();
    // contextFlags 契约面已整体删除；checker 只声明 git 证据需求
    expect(check!.needs?.evidence ?? []).toEqual([]);
  });

  it('端到端：PassesGate 真跑验证命令 → 证据落盘 → checker pass', async () => {
    // 生产链路的最小真身：package.json 声明测试命令，PassesGate 真跑（退出码判定），
    // 输出落 .harness/evidence/test-*.log，checker 读同一约定位放行
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "console.log(\'1 passed\')"' } })
    );
    writeChangedFile('src/a.ts', T_OLD);

    const run = await new PassesGate().runTests(dir);
    expect(run.passed).toBe(true);
    const evidenceDir = path.join(dir, '.harness', 'evidence');
    expect(fs.readdirSync(evidenceDir).some(f => f.startsWith('test-'))).toBe(true);

    const result = await checker.check(LAW, contextOf(['src/a.ts']));
    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(true);
  });
});
