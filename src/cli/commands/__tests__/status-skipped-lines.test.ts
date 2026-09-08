/**
 * harness status 的坏行提示（harness#100）
 *
 * 冻结两件事：
 * 1. `记录数`（traceCount）保持**原始非空行数口径**（合法 + 坏行），逐字节不变——
 *    改口径属行为变更，#100 明确不做。
 * 2. 坏行数是一条**新增的独立提示**，走 stderr（CLI 侧契约：诊断信息进 stderr，
 *    与 #96 `failure list` 同一去向），stdout 报告体不受污染。
 *
 * 用真实临时工程根（不 mock fs），才能对账真实文件行数。
 */

import * as path from 'path';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { captureIO, type CapturingIO } from '../../command-contract';
import { status } from '../status';

const TRACE_REL = path.join('.harness', 'logs', 'traces.log');

const VALID_A = JSON.stringify({ constraintId: 'alpha', level: 'iron_law', timestamp: 1, result: 'pass' });
const VALID_B = JSON.stringify({ constraintId: 'beta', level: 'guideline', timestamp: 2, result: 'pass' });
const BAD = '{"constraintId":"broken"';

function projectWith(lines: string[]): string {
  return createProjectFixture({ name: 'status-skiplines', files: { [TRACE_REL]: lines.join('\n') + '\n' } });
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('harness status 坏行提示（harness#100）', () => {
  it('traceCount 口径不变：3 行合法 vs 2 合法 + 1 坏行，stdout 逐字节一致', async () => {
    const clean = projectWith([VALID_A, VALID_B, VALID_A]);
    const dirty = projectWith([VALID_A, BAD, VALID_B]);

    const cleanIo = captureIO();
    await status({ projectPath: clean }, cleanIo);
    const dirtyIo = captureIO();
    await status({ projectPath: dirty }, dirtyIo);

    // 原始行数口径：两者都显示 3 条（改前即 records.length + skippedLines）
    expect(cleanIo.outText()).toContain('记录数: 3 条');
    expect(dirtyIo.outText()).toContain('记录数: 3 条');
    expect(dirtyIo.outText()).toBe(cleanIo.outText());
  });

  it('坏行数落到 stderr 的独立一行，stdout 不含该提示', async () => {
    const root = projectWith([VALID_A, BAD, BAD, VALID_B]);

    await status({ projectPath: root }, io);

    expect(io.outText()).not.toContain('损坏');
    expect(io.errText()).toContain('2 行损坏');
    // 独立一行：不与既有 stdout 行合并，也不止一行输出
    expect(io.errLines()).toHaveLength(1);
  });

  it('无损坏时零噪声：stderr 为空', async () => {
    await status({ projectPath: projectWith([VALID_A, VALID_B]) }, io);

    expect(io.errText()).toBe('');
  });

  it('--anomalies 模式同样告知（提示在读文件后立即发出，不受展示分支影响）', async () => {
    await status({ projectPath: projectWith([VALID_A, BAD]), anomalies: true }, io);

    expect(io.errText()).toContain('1 行损坏');
    expect(io.outText()).toContain('记录数: 2 条');
  });
});
