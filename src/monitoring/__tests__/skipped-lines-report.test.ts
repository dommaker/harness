/**
 * 坏行计数跨层透传（harness#100，承接 #82 裁决 4 的范围外项）
 *
 * #82 统一了 JSONL 读协议并让读「不抛 + 返回部分结果」，但计数在 TraceCollector
 * 这一层被 `read()` 的兼容签名吞掉：studio 端点拿到部分结果却零提示。
 * 本套件钉住收口后的形状——
 * - 新报告入口 `readReport()` / `analyzeRecentReport()` 把计数带到消费面
 * - 旧入口 `read()` / `readRecent()` / `readByConstraint()` / `getStats()` /
 *   `analyzeRecent()` / `analyzeConstraint()` 的签名与返回类型逐条不变（编译期断言）
 * - 跨层对账：module 计数 == collector 报告入口计数 == analyzer 报告入口计数
 * - 时间窗只过滤合法行（坏行无 timestamp 可归窗），计数始终是文件级口径
 */

import * as path from 'path';
import { createProjectFixture } from '../../test-setup/project-fixture';
import { readJsonl } from '../../utils/jsonl';
import { TraceCollector } from '../traces';
import { TraceAnalyzer } from '../trace-analyzer';
import type { ExecutionTrace, TraceSummary } from '../../types/trace';

const BAD_LINE_1 = '{"constraintId":"broken"';
const BAD_LINE_2 = 'not json at all';
const BAD_LINE_3 = '{"constraintId":"half"';

const NOW = 1700000000000;
/** 覆盖全部 fixture 时间戳的窗口（100 年），语义 = "不按时间过滤" */
const ALL_HOURS = 24 * 365 * 100;

function validLine(constraintId: string, timestamp: number, result: ExecutionTrace['result'] = 'pass'): string {
  return JSON.stringify({ constraintId, level: 'iron_law', timestamp, result });
}

/** 落一个只有 traces.log 的临时工程根 */
function fixtureWith(lines: string[], name: string): string {
  return createProjectFixture({
    name,
    files: { [path.join('.harness', 'logs', 'traces.log')]: lines.join('\n') + '\n' },
  });
}

function collectorFor(root: string): TraceCollector {
  return new TraceCollector({ traceFile: path.join(root, '.harness', 'logs', 'traces.log') });
}

describe('TraceCollector.readReport / TraceAnalyzer.analyzeRecentReport（harness#100）', () => {
  describe.each([
    { badCount: 1, badLines: [BAD_LINE_1] },
    { badCount: 3, badLines: [BAD_LINE_1, BAD_LINE_2, BAD_LINE_3] },
  ])('fixture 塞 $badCount 行坏数据', ({ badLines }) => {
    const lines = [
      validLine('alpha', NOW),
      badLines[0],
      validLine('beta', NOW + 1000, 'fail'),
      ...(badLines.length > 1 ? [badLines[1], badLines[2]] : []),
      validLine('alpha', NOW + 2000),
    ];
    const expectedSkipped = badLines.length;

    it('跨层对账：module 计数 == collector 报告入口计数 == analyzer 报告入口计数', () => {
      const root = fixtureWith(lines, 'skiplines-cross-layer');
      const collector = collectorFor(root);
      const analyzer = new TraceAnalyzer(collector);
      const traceFile = path.join(root, '.harness', 'logs', 'traces.log');

      const moduleResult = readJsonl<ExecutionTrace>(traceFile, 'skip');
      const collectorReport = collector.readReport();
      const analyzerReport = analyzer.analyzeRecentReport(ALL_HOURS);

      expect(moduleResult.skippedLines).toBe(expectedSkipped);
      expect(collectorReport.skippedLines).toBe(moduleResult.skippedLines);
      expect(analyzerReport.skippedLines).toBe(moduleResult.skippedLines);
      // 计数只有一份正本：合法记录集合在三层完全一致
      expect(collectorReport.traces).toEqual(moduleResult.records);
      expect(collectorReport.traces.map(t => t.constraintId)).toEqual(['alpha', 'beta', 'alpha']);
    });

    it('报告入口带过滤条件时，计数不受过滤影响（坏行无法归窗）', () => {
      const root = fixtureWith(lines, 'skiplines-filtered');

      const filtered = collectorFor(root).readReport({ constraintId: 'beta' });

      expect(filtered.traces.map(t => t.constraintId)).toEqual(['beta']);
      expect(filtered.skippedLines).toBe(expectedSkipped);
    });

    it('旧入口逐条不变：read()/readRecent()/readByConstraint() 仍只返回合法记录', () => {
      const root = fixtureWith(lines, 'skiplines-compat');
      const collector = collectorFor(root);

      expect(collector.read().map(t => t.constraintId)).toEqual(['alpha', 'beta', 'alpha']);
      expect(collector.readByConstraint('alpha')).toHaveLength(2);
      expect(collector.readRecent(ALL_HOURS)).toHaveLength(3);
    });

    it('getStats().totalLines 保持原始行数口径（合法 + 坏行），与改动前一致', () => {
      const root = fixtureWith(lines, 'skiplines-stats');

      expect(collectorFor(root).getStats().totalLines).toBe(lines.length);
    });
  });

  it('无损坏时报告入口计数为 0（零噪声前提）', () => {
    const root = fixtureWith([validLine('alpha', NOW), validLine('beta', NOW + 1)], 'skiplines-clean');
    const collector = collectorFor(root);

    expect(collector.readReport()).toEqual({ traces: collector.read(), skippedLines: 0 });
    expect(new TraceAnalyzer(collector).analyzeRecentReport(1).skippedLines).toBe(0);
  });

  it('缺 trace 文件时报告入口返回空记录 + 0，不抛', () => {
    const collector = collectorFor(createProjectFixture({ name: 'skiplines-missing-file' }));

    expect(collector.readReport()).toEqual({ traces: [], skippedLines: 0 });
  });

  it('时间窗内被丢掉的合法行不减计数：文件级口径（studio 无法自算的根因）', () => {
    const lines = [
      validLine('old', NOW - 10 * 3600 * 1000),
      BAD_LINE_1,
      BAD_LINE_2,
      validLine('new', Date.now()),
    ];
    const root = fixtureWith(lines, 'skiplines-window');
    const analyzer = new TraceAnalyzer(collectorFor(root));

    const report = analyzer.analyzeRecentReport(1);

    // 1 小时窗只剩 1 条合法 trace，但两条坏行仍要告知
    expect(report.summaries.map(s => s.constraintId)).toEqual(['new']);
    expect(report.summaries.reduce((n, s) => n + s.totalChecks, 0)).toBe(1);
    expect(report.skippedLines).toBe(2);
  });

  describe('签名与返回类型冻结（#82 裁决 4 兼容约束，编译期固定）', () => {
    it('旧入口返回类型逐条不变，新入口就地返回形状', () => {
      const root = fixtureWith([validLine('alpha', NOW), BAD_LINE_1], 'skiplines-signature');
      const collector = collectorFor(root);
      const analyzer = new TraceAnalyzer(collector);

      // 旧入口：返回类型逐条不变
      const traces: ExecutionTrace[] = collector.read();
      const recent: ExecutionTrace[] = collector.readRecent(ALL_HOURS);
      const byConstraint: ExecutionTrace[] = collector.readByConstraint('alpha');
      const stats: {
        fileExists: boolean;
        fileSize: number;
        totalLines: number;
        oldestTrace?: number;
        newestTrace?: number;
      } = collector.getStats();
      const summaries: TraceSummary[] = analyzer.analyzeRecent(ALL_HOURS);
      const constraintSummaries: TraceSummary[] = analyzer.analyzeConstraint('alpha');
      expect(traces).toHaveLength(1);
      expect(recent).toHaveLength(1);
      expect(byConstraint).toHaveLength(1);
      expect(stats.totalLines).toBe(2);
      expect(summaries).toHaveLength(1);
      expect(constraintSummaries).toHaveLength(1);

      // 新入口：就地返回形状（不另立第二份计数概念，也不经包根导出的类型）
      const collectorReport: { traces: ExecutionTrace[]; skippedLines: number } = collector.readReport();
      const analyzerReport: { summaries: TraceSummary[]; skippedLines: number } = analyzer.analyzeRecentReport(
        ALL_HOURS
      );
      expect(collectorReport.traces).toHaveLength(1);
      expect(analyzerReport.summaries).toHaveLength(1);

      // 兼容签名不会漂成报告对象：赋给报告类型是编译期错误（@ts-expect-error 消化），
      // 运行期返回的仍是数组
      // @ts-expect-error read() 仍返回 ExecutionTrace[]，不含坏行数
      const readNoCount: { skippedLines: number } = collector.read();
      // @ts-expect-error analyzeRecent() 仍返回 TraceSummary[]，不含坏行数
      const analyzeNoCount: { skippedLines: number } = analyzer.analyzeRecent(ALL_HOURS);
      expect(Array.isArray(readNoCount)).toBe(true);
      expect(Array.isArray(analyzeNoCount)).toBe(true);
    });
  });
});
