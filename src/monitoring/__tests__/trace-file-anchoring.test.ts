/**
 * TraceCollector 落点锚根（harness#139，#95 约定的 trace 侧）
 *
 * 不 mock IO：落点本身就是被测行为，只有 **cwd ≠ projectPath** 才看得出锚到了哪一侧
 * （前提形状照 `src/cli/commands/__tests__/project-path-anchoring.test.ts`）。
 * 两态都要钉：给了 projectPath → 锚项目根；没给 → 保持 cwd 解析（跨仓消费者的兼容面）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { TraceCollector } from '../traces';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../types/trace';
import { createProjectFixture } from '../../test-setup/project-fixture';

const trace = (constraintId: string): ExecutionTrace => ({
  constraintId,
  level: 'guideline',
  timestamp: 1700000000000,
  result: 'pass',
});

const traceLines = (projectRoot: string): string[] =>
  fs.readFileSync(path.join(projectRoot, DEFAULT_TRACE_FILE), 'utf-8').split('\n').filter(Boolean);

describe('TraceCollector 落点锚根（harness#139）', () => {
  const originalCwd = process.cwd();
  let cwdSide: string;
  let projectSide: string;

  beforeEach(() => {
    cwdSide = createProjectFixture({ name: 'traceanchor-cwd' });
    projectSide = createProjectFixture({ name: 'traceanchor-project' });
    process.chdir(cwdSide);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('给了 projectPath → 缺省落点锚到 <projectPath> 下，cwd 侧不产生文件', () => {
    new TraceCollector({ projectPath: projectSide }).record(trace('anchored'));

    expect(traceLines(projectSide).map(l => JSON.parse(l).constraintId)).toEqual(['anchored']);
    expect(fs.existsSync(path.join(cwdSide, DEFAULT_TRACE_FILE))).toBe(false);
  });

  it('没给 projectPath → 缺省落点仍按 cwd 解析（兼容语义，行为逐字不变）', () => {
    new TraceCollector().record(trace('cwd_default'));

    expect(traceLines(cwdSide).map(l => JSON.parse(l).constraintId)).toEqual(['cwd_default']);
    expect(fs.existsSync(path.join(projectSide, DEFAULT_TRACE_FILE))).toBe(false);
  });

  it('显式绝对 traceFile 优先，不被 projectPath 改写', () => {
    const custom = path.join(cwdSide, 'custom.log');

    new TraceCollector({ projectPath: projectSide, traceFile: custom }).record(trace('explicit'));

    expect(fs.existsSync(custom)).toBe(true);
    expect(fs.existsSync(path.join(projectSide, DEFAULT_TRACE_FILE))).toBe(false);
  });

  it('projectPath + 相对 traceFile → 相对落点在 projectPath 之下（自定义片段的锚定形状）', () => {
    new TraceCollector({ projectPath: projectSide, traceFile: 'logs/custom.log' }).record(
      trace('relative')
    );

    // 自定义片段跟缺省片段同一条锚定规则：给了根就锚根，不给仍按 cwd（兼容面逐字不变）
    expect(fs.existsSync(path.join(projectSide, 'logs', 'custom.log'))).toBe(true);
    expect(fs.existsSync(path.join(cwdSide, 'logs', 'custom.log'))).toBe(false);
  });

  it('读侧同锚：另一实例按同一 projectPath 构造，read()/getStats() 读到刚写的记录', () => {
    new TraceCollector({ projectPath: projectSide }).record(trace('roundtrip'));

    const reader = new TraceCollector({ projectPath: projectSide });
    expect(reader.read().map(t => t.constraintId)).toEqual(['roundtrip']);
    expect(reader.getStats().totalLines).toBe(1);
  });
});
