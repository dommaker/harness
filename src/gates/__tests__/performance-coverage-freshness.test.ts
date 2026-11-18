/**
 * D4：PerformanceGate 覆盖率报告与本次运行绑定
 *
 * 覆盖率报告必须能证明由本次测试执行产生。旧报告存在但本次测试失败、
 * 超时、成功却未生成/未刷新报告时，覆盖率必须判不可用（既有 warnings 口径），
 * 不能拿旧报告判有效。
 *
 * 运行身份判断（取舍说明，见 src/gates/performance.ts collectCoverage）：
 * 运行前把既有 coverage-summary.json 挪作备份，成功后只认「本次重新出现」的
 * 报告——首次生成、同内容重写、部分刷新都由「重新出现」获得身份，不依赖
 * 内容比较（同内容新报告不会被误判）也不依赖耗时断言；失败/超时/未刷新时
 * 恢复备份，不销毁用户既有报告。
 *
 * 替身落点：`src/utils/exec` 的 execAsync 缝（模拟测试执行成败/是否写报告），
 * 文件系统真实（每轮唯一 mkdtemp 夹具，报告由替身实现真实落盘）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import { PerformanceGate } from '../performance';

jest.mock('../../utils/exec', () => {
  const actual = jest.requireActual('../../utils/exec');
  return { ...actual, execAsync: jest.fn() };
});

const mockExecAsync = execAsync as unknown as jest.Mock;

const SUMMARY = (pct: number): string =>
  JSON.stringify({ total: { lines: { pct } } });

/** 每轮唯一项目夹具；summaryPct 给定时预置一份旧覆盖率报告 */
function makeProject(summaryPct?: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-coverage-'));
  if (summaryPct !== undefined) {
    writeSummary(root, SUMMARY(summaryPct));
  }
  return root;
}

function writeSummary(root: string, content: string): void {
  fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(root, 'coverage', 'coverage-summary.json'), content);
}

function readSummary(root: string): string | undefined {
  const p = path.join(root, 'coverage', 'coverage-summary.json');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined;
}

/** 从 GateResult 取 metrics.coverage */
function coverageOf(result: {
  details?: { metrics?: unknown };
}): number | undefined {
  return (result.details?.metrics as { coverage?: number } | undefined)?.coverage;
}

describe('PerformanceGate 覆盖率与本次运行绑定（D4）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('旧报告 100% + 本次测试失败 → 不读取旧报告，覆盖率不可用', async () => {
    const project = makeProject(100);
    try {
      mockExecAsync.mockRejectedValue(Object.assign(new Error('Test failed'), { code: 1 }));

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBeUndefined();
      expect(result.message).toContain('Test failed');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('旧报告存在 + 本次测试超时 → 判超时，不读取旧报告', async () => {
    const project = makeProject(100);
    try {
      mockExecAsync.mockRejectedValue(Object.assign(new Error('killed'), { killed: true }));

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
        coverageTimeout: 100,
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBeUndefined();
      expect(result.message).toContain('超时');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('旧报告存在 + 本次成功但未生成报告 → 判不可用，不拿旧报告充数', async () => {
    const project = makeProject(100);
    try {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' }); // 成功但什么都不写

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBeUndefined();
      expect(result.message).toContain('未找到覆盖率报告');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('首次生成（无旧报告）+ 本次成功写报告 → 有效', async () => {
    const project = makeProject();
    try {
      mockExecAsync.mockImplementation(async (_cmd: string, _opts: unknown) => {
        writeSummary(project, SUMMARY(90));
        return { stdout: '', stderr: '' };
      });

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBe(90);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('同内容重写（新旧报告字节相同）→ 本次运行产出的报告仍有效', async () => {
    const project = makeProject(90);
    try {
      mockExecAsync.mockImplementation(async () => {
        writeSummary(project, SUMMARY(90)); // 与旧报告字节相同
        return { stdout: '', stderr: '' };
      });

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBe(90);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('旧低覆盖率 + 本次刷新为高覆盖率 → 取本次报告', async () => {
    const project = makeProject(50);
    try {
      mockExecAsync.mockImplementation(async () => {
        writeSummary(project, SUMMARY(95));
        return { stdout: '', stderr: '' };
      });

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBe(95);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('本次报告损坏 → fail-loud 归 warnings 口径，不读取旧报告', async () => {
    const project = makeProject(100);
    try {
      mockExecAsync.mockImplementation(async () => {
        writeSummary(project, '{ broken');
        return { stdout: '', stderr: '' };
      });

      const result = await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      expect(coverageOf(result)).toBeUndefined();
      expect(result.message).toContain('警告');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('失败/未刷新路径恢复旧报告，不销毁用户既有报告', async () => {
    // 两条失败路径各跑一遍：旧报告原样留在盘上
    for (const behavior of ['fail', 'no-write'] as const) {
      const project = makeProject(77);
      try {
        if (behavior === 'fail') {
          mockExecAsync.mockRejectedValue(Object.assign(new Error('Test failed'), { code: 1 }));
        } else {
          mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
        }

        await new PerformanceGate({
          thresholds: { minCoverage: 80 },
        }).check({ projectPath: project });

        expect(readSummary(project)).toBe(SUMMARY(77));
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    }
  });

  it('成功路径清理备份，盘上只留本次报告', async () => {
    const project = makeProject(50);
    try {
      mockExecAsync.mockImplementation(async () => {
        writeSummary(project, SUMMARY(95));
        return { stdout: '', stderr: '' };
      });

      await new PerformanceGate({
        thresholds: { minCoverage: 80 },
      }).check({ projectPath: project });

      const coverageDir = path.join(project, 'coverage');
      const leftovers = fs.readdirSync(coverageDir).filter((f) => f.includes('harness'));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
