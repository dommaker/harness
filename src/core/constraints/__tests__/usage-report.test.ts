/**
 * traces.log 坏行 fixture（harness#82 + harness#100）
 *
 * #82：三种现行响应例证之「静默跳过」（原语义不变）——
 * traces.log 单行损坏时 report 数据层不失败，返回全部合法 trace。
 * #100：计数不再断在 module 层——新增 `readProjectTracesReport()` 报告入口，
 * 并把坏行数挂进 `ConstraintsUsageReport`（与 `traceFileExists` 同一降级维度）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { readJsonl } from '../../../utils/jsonl';
import {
  buildConstraintsUsageReport,
  readProjectTraces,
  readProjectTracesReport,
} from '../usage-report';
import { DEFAULT_TRACE_FILE } from '../../../types/trace';

describe('readProjectTraces 坏行容错（harness#82）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-usage-report-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeTraces(lines: string[]): void {
    const tracePath = path.join(root, DEFAULT_TRACE_FILE);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(tracePath, lines.join('\n') + '\n', 'utf-8');
  }

  it('坏行静默跳过，返回全部合法 trace', () => {
    writeTraces([
      '{"constraintId":"a","level":"iron_law","timestamp":1,"result":"pass"}',
      '{"constraintId":"b","broken',
      '{"constraintId":"c","level":"iron_law","timestamp":3,"result":"fail"}',
    ]);
    const traces = readProjectTraces(root);
    expect(traces.map(t => t.constraintId)).toEqual(['a', 'c']);
  });

  it('缺文件返回空数组', () => {
    expect(readProjectTraces(root)).toEqual([]);
  });
});

describe('坏行计数透传到 report 数据层（harness#100）', () => {
  const VALID_A = '{"constraintId":"a","level":"iron_law","timestamp":1,"result":"pass"}';
  const VALID_B = '{"constraintId":"b","level":"iron_law","timestamp":3,"result":"fail"}';
  const BAD = '{"constraintId":"x","broken';
  const TRACE_REL = path.join('.harness', 'logs', 'traces.log');

  function projectWith(lines: string[]): string {
    return createProjectFixture({
      name: 'usage-report-skiplines',
      files: { [TRACE_REL]: lines.join('\n') + '\n' },
    });
  }

  it.each([
    [1, [BAD]],
    [3, [BAD, 'garbage', '{"half"]  }']],
  ] as Array<[number, string[]]>)(
    '%i 行坏数据：readProjectTracesReport 计数与 module 计数对账',
    (expectedSkipped, badLines) => {
      const lines = [VALID_A, ...badLines, VALID_B];
      const root = projectWith(lines);

      const report = readProjectTracesReport(root);

      expect(report.skippedLines).toBe(expectedSkipped);
      expect(report.skippedLines).toBe(
        readJsonl(path.join(root, TRACE_REL), 'skip').skippedLines
      );
      // 兼容签名不变：旧入口仍只返回合法记录数组
      expect(readProjectTraces(root)).toEqual(report.traces);
      expect(report.traces.map(t => t.constraintId)).toEqual(['a', 'b']);
    }
  );

  it('buildConstraintsUsageReport 报告体带坏行数（与 traceFileExists 同一降级维度）', () => {
    const root = projectWith([VALID_A, BAD, VALID_B]);

    const report = buildConstraintsUsageReport(root);

    expect(report.skippedLines).toBe(1);
    expect(report.traceFileExists).toBe(true);
  });

  it('无损坏时计数为 0（既有输出零噪声的前提）', () => {
    const report = buildConstraintsUsageReport(projectWith([VALID_A, VALID_B]));

    expect(report.skippedLines).toBe(0);
    expect(report.traceFileExists).toBe(true);
  });

  it('缺 trace 文件：计数 0 且 traceFileExists=false', () => {
    const report = buildConstraintsUsageReport(
      createProjectFixture({ name: 'usage-report-notracefile' })
    );

    expect(report.skippedLines).toBe(0);
    expect(report.traceFileExists).toBe(false);
  });
});
