/**
 * trace 记录器注入（工单 15 decycle 收尾 / harness#88）
 *
 * 原状态：checker 值导入 monitoring 的全局单例收集器，并在首次记录时惰性接线
 * （ADR-0003），`setTraceRecorder` 退化成只有测试在用的假 seam。
 * 现在：记录器经**构造参数**注入；未注入 = no-op（core 零上行依赖，默认无副作用），
 * 真实收集器由组合根（CLI 命令 / bootstrap）接线。monitoring 侧的单例出口
 * （getTraceCollector/configureTraceCollector）已随 #199 删除，「checker 不碰
 * monitoring 值面」由本文件的源码扫描断言直接钉住。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConstraintChecker } from '../checker';
import type { ExecutionTrace } from '../../../types/trace';

describe('trace 记录器构造注入（harness#88）', () => {
  let projectDir: string;
  /**
   * fixture 带真验证证据（harness#183：.harness/evidence 落盘）：本套件测 trace 接线
   * 而非判定，证据在位即不触发 block 模式的 throw
   */
  const context = () => ({
    operation: 'code_implementation' as const,
    projectPath: projectDir,
    changedFiles: [] as string[],
  });

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-trace-injection-'));
    fs.mkdirSync(path.join(projectDir, '.harness', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.harness', 'evidence', 'test.log'), 'ok');
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
      expect.arrayContaining(['no_completion_without_verification', 'no_hardcoded_credentials'])
    );
    expect(records.every(r => ['pass', 'fail', 'skip'].includes(r.result))).toBe(true);
  });

  it('setTraceRecorder 假 seam 已删除', () => {
    const checker = new ConstraintChecker({ record: () => undefined });
    expect((checker as any).setTraceRecorder).toBeUndefined();
  });

  it('未注入记录器时检查照常执行（no-op 默认，core 零上行依赖）', async () => {
    const unwired = new ConstraintChecker();

    await unwired.checkConstraints(context());
  });

  it('checker 对 monitoring 零值导入（单例出口删除后不可能再反向取全局收集器，#199）', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'checker.ts'), 'utf-8');
    const monitoringValueImports = source
      .split('\n')
      .filter(line => /^\s*import\s/.test(line) && !/^\s*import\s+type\b/.test(line))
      .filter(line => line.includes('monitoring'));

    expect(monitoringValueImports).toEqual([]);
  });
});
