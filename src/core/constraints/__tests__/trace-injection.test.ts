/**
 * trace 记录器注入（工单 15 decycle 收尾 / harness#88）
 *
 * 原状态：checker 值导入 monitoring 的 getTraceCollector，并在首次记录时惰性接线
 * （ADR-0003），`setTraceRecorder` 退化成只有测试在用的假 seam。
 * 现在：记录器经**构造参数**注入；未注入 = no-op（core 零上行依赖，默认无副作用），
 * 真实收集器由组合根（CLI 命令 / bootstrap）接线。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConstraintChecker } from '../checker';
import type { ExecutionTrace } from '../../../types/trace';

jest.mock('../../../monitoring/traces', () => ({
  getTraceCollector: jest.fn(() => ({ record: jest.fn() })),
  TraceCollector: jest.fn(),
  configureTraceCollector: jest.fn(),
}));

/** 替身收集器工厂（core 侧连测试也不值导入 monitoring，方向由 #88 规则锁） */
const getTraceCollector = jest.requireMock('../../../monitoring/traces')
  .getTraceCollector as jest.Mock;

describe('trace 记录器构造注入（harness#88）', () => {
  let projectDir: string;
  /** 与 skip-semantics 同族的 fixture：目录不存在 → 存在性探测走 skip，不阻断 */
  const context = () => ({
    operation: 'code_implementation' as const,
    projectPath: path.join(projectDir, 'not-created'),
  });

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-trace-injection-'));
    getTraceCollector.mockClear();
  });

  afterAll(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('构造注入的记录器收到每条约束的 trace', async () => {
    const records: ExecutionTrace[] = [];
    const checker = new ConstraintChecker({ record: (t) => records.push(t) });

    await checker.checkConstraints(context());

    expect(records.map(r => r.constraintId)).toEqual(
      expect.arrayContaining(['incremental_progress', 'no_implementation_without_requirement'])
    );
    expect(records.every(r => ['pass', 'fail', 'skip'].includes(r.result))).toBe(true);
  });

  it('setTraceRecorder 假 seam 已删除', () => {
    const checker = new ConstraintChecker({ record: () => undefined });
    expect((checker as any).setTraceRecorder).toBeUndefined();
  });

  it('未注入记录器时不记录，也不反向取全局收集器（core 零上行依赖）', async () => {
    const unwired = new ConstraintChecker();

    await unwired.checkConstraints(context());

    expect(getTraceCollector).not.toHaveBeenCalled();
  });
});
