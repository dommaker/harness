/**
 * status 的分析接线（ADR-0020）
 *
 * `status` 要的是「对已读出的 traces 做纯判定」，此前却为此构造
 * `new TraceCollector({traceFile})`（构造函数带 mkdir 副作用）+ `new TraceAnalyzer(c)`，
 * 测试端再叠一层 TraceAnalyzer mock 才能断言。ADR-0020 把判定下放为模块级纯函数后，
 * 本命令直调函数，构造仪式退出这条路径。
 *
 * 用真实临时工程根跑一遍（不 mock fs），顺带钉住「换成直调后统计与异常输出口径不变」。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { captureIO, type CapturingIO } from '../../command-contract';
import { status } from '../status';

const STATUS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'status.ts'), 'utf-8');

/** 1 pass + 1 fail：failRate 0.5、passRate 0.5 → 无异常；2 fail：passRate 0 → low_pass_rate */
const PASS = { constraintId: 'alpha', level: 'iron_law' as const, result: 'pass' as const };
const FAIL = { constraintId: 'beta', level: 'guideline' as const, result: 'fail' as const };

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('status 分析接线（ADR-0020）', () => {
  it('不再构造 TraceCollector / TraceAnalyzer', () => {
    expect(STATUS_SOURCE).not.toMatch(/new\s+TraceCollector\s*\(/);
    expect(STATUS_SOURCE).not.toMatch(/new\s+TraceAnalyzer\s*\(/);
    expect(STATUS_SOURCE).not.toMatch(/from\s+'[^']*monitoring\/traces'/);
  });

  it('直调 trace-analyzer 的模块级纯函数取统计与异常', () => {
    expect(STATUS_SOURCE).toMatch(/summarizeTraces\s*\(/);
    expect(STATUS_SOURCE).toMatch(/detectTraceAnomalies\s*\(/);
  });

  it('真实工程根跑通：按纯函数口径出统计，全过数据零异常', async () => {
    const root = createProjectFixture({
      name: 'status-pure-analysis',
      config: 'project:\n  name: status-pure-analysis\n',
      traces: [PASS, { ...PASS, timestamp: 2 }],
    });

    await status({ projectPath: root, detail: true }, io);

    expect(io.outText()).toContain('🔴 Iron Laws:');
    expect(io.outText()).toContain('alpha');
    expect(io.outText()).toContain('检查: 2 | 通过: 100% | 失败: 0%');
    expect(io.outText()).not.toContain('个异常');
    expect(io.outText()).toContain('继续积累数据');
  });

  it('真实工程根跑通：低通过率经纯函数判为异常并列出', async () => {
    const root = createProjectFixture({
      name: 'status-pure-analysis',
      traces: [FAIL, { ...FAIL, timestamp: 2 }],
    });

    await status({ projectPath: root, anomalies: true }, io);

    expect(io.outText()).toContain('发现 1 个异常');
    expect(io.outText()).toContain('类型: low_pass_rate');
  });
});
