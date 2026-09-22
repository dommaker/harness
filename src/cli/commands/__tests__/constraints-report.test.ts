/**
 * harness constraints report 测试（ADR-0001 P5）
 *
 * 覆盖：无 trace 文件、空 trace、含 skip 的统计、四类候选诊断、
 * --export 内容脱敏（无 projectPath）、unknownIds 配置健康提示。
 *
 * 使用真实临时目录（getEffectiveConstraints/ProjectConfigLoader 读真实 fs）。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as path from 'path';
import type { ExecutionTrace } from '../../../types/trace';
import {
  buildConstraintsUsageReport,
  diagnoseRetireCandidates,
  readProjectTraces,
  WATCHLIST_PERIOD_DAYS,
} from '../../../core/constraints/usage-report';
import type { HarnessState, StateIO } from '../../state-io';
import { constraintsReport, renderExportMarkdown } from '../constraints-report';
import { createProjectFixture, writeProjectTraces } from '../../../test-setup/project-fixture';

/** 生成 N 条同结果 trace */
function tracesOf(id: string, result: ExecutionTrace['result'], n: number, startTs = 1700000000000): Partial<ExecutionTrace>[] {
  return Array.from({ length: n }, (_, i) => ({ constraintId: id, result, timestamp: startTs + i * 1000 }));
}

beforeEach(() => {
});

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('buildConstraintsUsageReport', () => {
  it('无 trace 文件：生效集 check 约束全部列出且 total=0，全部判为零触发候选', () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    const report = buildConstraintsUsageReport(root);

    expect(report.traceFileExists).toBe(false);
    expect(report.stats.length).toBe(7); // 3 error + 4 warning
    for (const s of report.stats) {
      expect(s.total).toBe(0);
      expect(s.evaluated).toBe(0);
      expect(s.failRate).toBe(0);
      expect(s.firstAt).toBeUndefined();
    }
    expect(report.candidates.length).toBe(7);
    expect(report.candidates.every(c => c.kind === 'zero_trigger')).toBe(true);
  });

  it('空 trace 文件：与无文件一致，但 traceFileExists=true', () => {
    const root = createProjectFixture({ name: 'harness-report-test', traces: [] });
    const report = buildConstraintsUsageReport(root);

    expect(report.traceFileExists).toBe(true);
    expect(report.stats.every(s => s.total === 0)).toBe(true);
    expect(report.candidates.every(c => c.kind === 'zero_trigger')).toBe(true);
  });

  it('含 skip 的统计：skip 不计入 fail 率分母，首次/最近时间正确', () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeProjectTraces(root, [
      ...tracesOf('no_hardcoded_credentials', 'pass', 3, 1700000000000),
      ...tracesOf('no_hardcoded_credentials', 'fail', 1, 1700000100000),
      ...tracesOf('no_hardcoded_credentials', 'skip', 2, 1700000200000),
    ]);
    const report = buildConstraintsUsageReport(root);
    const s = report.stats.find(x => x.id === 'no_hardcoded_credentials')!;

    expect(s.total).toBe(6);
    expect(s.pass).toBe(3);
    expect(s.fail).toBe(1);
    expect(s.skip).toBe(2);
    expect(s.evaluated).toBe(4);
    expect(s.failRate).toBeCloseTo(0.25);
    expect(s.firstAt).toBe(1700000000000);
    expect(s.lastAt).toBe(1700000201000);
    // 4 次评估 1 次 fail：不构成任何候选
    expect(report.candidates.find(c => c.id === 'no_hardcoded_credentials')).toBeUndefined();
  });

  it('坏行容错：单行 JSON 损坏不影响其他行统计', () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'traces.log'),
      '{"constraintId":"docs_freshness","timestamp":1,"result":"pass","severity":"error"}\n{bad json\n',
      'utf-8'
    );
    expect(readProjectTraces(root).length).toBe(1);
  });

  it('四类候选诊断：零触发/不可评估(flag)/不可评估(探测)/高噪/零拦截', () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeProjectTraces(root, [
      // 不可评估（flag 未接线）：全部 skip
      ...tracesOf('no_completion_without_verification', 'skip', 3),
      // 不可评估（存在性探测未命中）：全部 skip
      ...tracesOf('capability_sync', 'skip', 5),
      // 高噪：24 次评估 fail 率 83% > 80%
      ...tracesOf('no_test_simplification', 'fail', 20),
      ...tracesOf('no_test_simplification', 'pass', 4, 1700001000000),
      // 零拦截：50 次评估 0 fail
      ...tracesOf('no_hardcoded_credentials', 'pass', 50, 1700010000000),
    ]);
    const report = buildConstraintsUsageReport(root);
    const byId = new Map(report.candidates.map(c => [c.id, c]));

    // 零触发（未出现在 trace 的 check 约束）
    expect(byId.get('docs_freshness')?.kind).toBe('zero_trigger');

    // 不可评估 · flag 未接线
    const flagC = byId.get('no_completion_without_verification');
    expect(flagC?.kind).toBe('unevaluable');
    expect(flagC?.reason).toContain('证据 flag 未接线');

    // 不可评估 · 约定未采用
    const probeC = byId.get('capability_sync');
    expect(probeC?.kind).toBe('unevaluable');
    expect(probeC?.reason).toContain('约定未采用');

    // 高噪
    const noiseC = byId.get('no_test_simplification');
    expect(noiseC?.kind).toBe('high_noise');
    expect(noiseC?.reason).toContain('83%');

    // 零拦截：先进观察名单（ADR-0032 中间态），不直接进退役候选
    expect(byId.get('no_hardcoded_credentials')).toBeUndefined();
    const watched = report.watchlist.find(w => w.id === 'no_hardcoded_credentials');
    expect(watched?.reason).toContain('50 次评估');
  });

  it('阈值可配：放宽零拦截样本阈值后 10 次全 pass 进观察名单（不直接进候选）', () => {
    const root = createProjectFixture({
      name: 'harness-report-test',
      traces: tracesOf('no_hardcoded_credentials', 'pass', 10),
    });

    const strict = buildConstraintsUsageReport(root);
    expect(strict.candidates.find(c => c.id === 'no_hardcoded_credentials')).toBeUndefined();
    expect(strict.watchlist.find(w => w.id === 'no_hardcoded_credentials')).toBeUndefined();

    const relaxed = buildConstraintsUsageReport(root, { zeroInterceptMinEvaluated: 10 });
    expect(relaxed.candidates.find(c => c.id === 'no_hardcoded_credentials')).toBeUndefined();
    expect(relaxed.watchlist.find(w => w.id === 'no_hardcoded_credentials')).toBeDefined();
  });

  it('diagnoseRetireCandidates 优先级：全 skip 不重复计入零拦截', () => {
    const candidates = diagnoseRetireCandidates([
      {
        id: 'x', severity: 'warning',
        total: 60, pass: 0, fail: 0, skip: 60,
        evaluated: 0, failRate: 0,
      },
    ]);
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe('unevaluable');
  });

  it('配置健康：config.yml 中未知 id 进入 unknownIds', () => {
    const root = createProjectFixture({
      name: 'harness-report-test',
      config: 'constraints:\n  ghost_constraint:\n    enabled: false\n',
    });
    const report = buildConstraintsUsageReport(root);
    expect(report.lint.unknownIds).toContain('ghost_constraint');
  });
});

describe('constraintsReport CLI', () => {
  it('console 输出包含统计表、候选、unknownIds 提示', async () => {
    const root = createProjectFixture({
      name: 'harness-report-test',
      config: 'constraints:\n  ghost_constraint:\n    enabled: false\n',
      traces: tracesOf('no_hardcoded_credentials', 'pass', 3),
    });

    await constraintsReport({ projectPath: root }, io);

    const output = io.outText();
    expect(output).toContain('约束使用报告');
    expect(output).toContain('no_hardcoded_credentials');
    expect(output).toContain('total=3');
    expect(output).toContain('退役候选');
    expect(output).toContain('ghost_constraint');
  });

  it('--export 缺省路径：写入 .harness/reports/constraints-<YYYYMMDD>.md 且内容脱敏', async () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeProjectTraces(root, [
      ...tracesOf('no_test_simplification', 'fail', 20),
      // projectPath 字段进 trace，但不得进 export
      { constraintId: 'no_test_simplification', result: 'fail', projectPath: root, timestamp: 1700001000000 },
    ]);

    await constraintsReport({ projectPath: root, export: true }, io);

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const exportPath = path.join(root, '.harness', 'reports', `constraints-${date}.md`);
    expect(fs.existsSync(exportPath)).toBe(true);

    const content = fs.readFileSync(exportPath, 'utf-8');
    expect(content).toContain('harness 版本');
    expect(content).toContain('| id | total | pass | fail | skip |');
    expect(content).toContain('no_test_simplification');
    expect(content).toContain('高噪');
    // 脱敏：不包含项目路径
    expect(content).not.toContain(root);
    expect(content).not.toContain('projectPath');

    // 打印了导出路径
    const output = io.outText();
    expect(output).toContain(exportPath);
  });

  it('--export 指定文件：写到给定路径', async () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    await constraintsReport({ projectPath: root, export: 'my-report.md' }, io);
    expect(fs.existsSync(path.join(root, 'my-report.md'))).toBe(true);
  });

  it('renderExportMarkdown：无候选时显式标注', () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeProjectTraces(root, [
      // 所有 check 约束给少量健康数据（低于一切阈值）
      ...buildConstraintsUsageReport(root).stats.flatMap(s => tracesOf(s.id, 'pass', 5)),
    ]);
    const report = buildConstraintsUsageReport(root);
    expect(report.candidates.length).toBe(0);
    const md = renderExportMarkdown(report, '0.0.0-test', new Date(1700000000000));
    expect(md).toContain('（无候选）');
    expect(md).toContain('0.0.0-test');
    expect(md).toContain('2023-11-14');
  });
});

describe('constraintsReport 坏行数透传（harness#100）', () => {
  /** 直接落原始行（含坏行）——writeProjectTraces 只写合法记录，构造不出损坏 fixture */
  function writeRawTraces(root: string, lines: string[]): void {
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'traces.log'), lines.join('\n') + '\n', 'utf-8');
  }

  const healthyTrace = (id: string) =>
    JSON.stringify({ constraintId: id, severity: 'error', timestamp: 1700000000000, result: 'pass' });
  const BAD = '{"constraintId":"ghost","broken';

  it('坏行 fixture：文本输出出现坏行数提示，--json 报告体带 skippedLines', async () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeRawTraces(root, [healthyTrace('no_hardcoded_credentials'), BAD, BAD]);

    await constraintsReport({ projectPath: root }, io);
    expect(io.outText()).toContain('2 行损坏');

    const jsonIo = captureIO();
    await constraintsReport({ projectPath: root, json: true }, jsonIo);
    expect(JSON.parse(jsonIo.outText()).skippedLines).toBe(2);
  });

  it('traceFileExists=true 且无损坏：零噪声（无坏行提示，既有文案不变）', async () => {
    const root = createProjectFixture({ name: 'harness-report-test' });
    writeRawTraces(root, [healthyTrace('no_hardcoded_credentials')]);

    await constraintsReport({ projectPath: root }, io);

    const output = io.outText();
    expect(output).toContain('约束使用报告');
    expect(output).not.toContain('损坏');
    expect(output).not.toContain('trace 文件不存在');
  });

  it('--export 摘要同样带坏行数（脱敏：只报条数，不报路径与坏行内容）', async () => {
    const dirty = createProjectFixture({ name: 'harness-report-test' });
    writeRawTraces(dirty, [healthyTrace('no_hardcoded_credentials'), BAD]);
    await constraintsReport({ projectPath: dirty, export: 'report.md' }, captureIO());

    const dirtyMd = fs.readFileSync(path.join(dirty, 'report.md'), 'utf-8');
    expect(dirtyMd).toContain('1 行损坏');
    expect(dirtyMd).not.toContain(BAD);
    expect(dirtyMd).not.toContain(dirty);

    const clean = createProjectFixture({ name: 'harness-report-test' });
    writeRawTraces(clean, [healthyTrace('no_hardcoded_credentials')]);
    await constraintsReport({ projectPath: clean, export: 'report.md' }, captureIO());
    expect(fs.readFileSync(path.join(clean, 'report.md'), 'utf-8')).not.toContain('损坏');
  });
});

describe('零拦截观察名单（ADR-0032，块 3 子项 4）', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // 固定时钟：观察期判定全靠注入 now，不在测试里等 90 天
  const NOW = 1700100000000;
  const NOW_ISO = new Date(NOW).toISOString();

  /** 内存 StateIO 假件（与 status/check 测试同形） */
  function memoryStateIO(initial: HarnessState = {}): StateIO & { snapshot(): HarnessState } {
    let state = initial;
    return {
      read: () => state,
      write: (s: HarnessState) => { state = s; },
      snapshot: () => state,
    };
  }

  /** 50 次全 pass 的零拦截 fixture 项目 */
  function zeroInterceptProject(id = 'no_hardcoded_credentials', n = 50): string {
    return createProjectFixture({
      name: 'harness-watchlist-test',
      traces: tracesOf(id, 'pass', n, NOW - 10 * DAY_MS),
    });
  }

  it('命中且不在名单：列入观察名单（记列入时间），进 watchlist 分组不进退役候选', () => {
    const root = zeroInterceptProject();
    const report = buildConstraintsUsageReport(root, {}, { now: NOW });

    expect(report.candidates.some(c => c.id === 'no_hardcoded_credentials')).toBe(false);
    const w = report.watchlist.find(x => x.id === 'no_hardcoded_credentials');
    expect(w).toBeDefined();
    expect(w!.listedAt).toBe(NOW_ISO);
    expect(w!.remainingDays).toBe(WATCHLIST_PERIOD_DAYS);
    expect(w!.reason).toContain('50 次评估');
    // 待写回状态只增不删
    expect(report.nextWatchlist['no_hardcoded_credentials']).toEqual({ listedAt: NOW_ISO });
  });

  it('观察期未满：仍留名单不转候选，剩余观察期按天折算', () => {
    const root = zeroInterceptProject();
    const listedAt = new Date(NOW - 30 * DAY_MS).toISOString();
    const report = buildConstraintsUsageReport(root, {}, {
      watchlist: { no_hardcoded_credentials: { listedAt } },
      now: NOW,
    });

    expect(report.candidates.some(c => c.id === 'no_hardcoded_credentials')).toBe(false);
    const w = report.watchlist.find(x => x.id === 'no_hardcoded_credentials');
    expect(w!.listedAt).toBe(listedAt);
    expect(w!.remainingDays).toBe(WATCHLIST_PERIOD_DAYS - 30);
    // 已列入不重复写
    expect(report.nextWatchlist).toEqual({ no_hardcoded_credentials: { listedAt } });
  });

  it('期满且样本够：转正式 zero_intercept 退役候选', () => {
    const root = zeroInterceptProject();
    const listedAt = new Date(NOW - WATCHLIST_PERIOD_DAYS * DAY_MS).toISOString();
    const report = buildConstraintsUsageReport(root, {}, {
      watchlist: { no_hardcoded_credentials: { listedAt } },
      now: NOW,
    });

    const c = report.candidates.find(x => x.id === 'no_hardcoded_credentials');
    expect(c?.kind).toBe('zero_intercept');
    expect(c?.reason).toContain('观察期满');
    expect(report.watchlist.some(w => w.id === 'no_hardcoded_credentials')).toBe(false);
  });

  it('期满但样本不够（评估数跌破阈值）：不转候选', () => {
    const root = zeroInterceptProject('no_hardcoded_credentials', 30);
    const listedAt = new Date(NOW - 120 * DAY_MS).toISOString();
    const report = buildConstraintsUsageReport(root, {}, {
      watchlist: { no_hardcoded_credentials: { listedAt } },
      now: NOW,
    });

    expect(report.candidates.some(c => c.id === 'no_hardcoded_credentials')).toBe(false);
  });

  it('其他三类候选不进观察名单（zero_trigger/unevaluable/high_noise 维持现状）', () => {
    const root = createProjectFixture({ name: 'harness-watchlist-test' });
    writeProjectTraces(root, [
      ...tracesOf('capability_sync', 'skip', 5),                    // 不可评估
      ...tracesOf('no_test_simplification', 'fail', 20),            // 高噪
      ...tracesOf('no_test_simplification', 'pass', 4, 1700001000000),
      // docs_freshness 等零触发
    ]);
    const report = buildConstraintsUsageReport(root, {}, { now: NOW });

    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.watchlist).toEqual([]);
    expect(report.nextWatchlist).toEqual({});
  });

  it('diagnoseRetireCandidates 兼容签名：只回候选，观察期内的零拦截不出现', () => {
    const stats = [{
      id: 'x', severity: 'warning' as const,
      total: 50, pass: 50, fail: 0, skip: 0,
      evaluated: 50, failRate: 0,
    }];
    expect(diagnoseRetireCandidates(stats)).toEqual([]);
    const listedAt = new Date(NOW - 100 * DAY_MS).toISOString();
    const converted = diagnoseRetireCandidates(stats, {}, {
      watchlist: { x: { listedAt } },
      now: NOW,
    });
    expect(converted.map(c => c.kind)).toEqual(['zero_intercept']);
  });

  it('列入时间损坏按未列入处理：重新列入、时钟重启', () => {
    const root = zeroInterceptProject();
    const report = buildConstraintsUsageReport(root, {}, {
      watchlist: { no_hardcoded_credentials: { listedAt: 'not-a-date' } },
      now: NOW,
    });

    expect(report.candidates.some(c => c.id === 'no_hardcoded_credentials')).toBe(false);
    expect(report.nextWatchlist['no_hardcoded_credentials']).toEqual({ listedAt: NOW_ISO });
  });

  it('CLI 级：report 经 StateIO 持久化列入，第二次运行读回仍在名单', async () => {
    const root = zeroInterceptProject();
    const stateIO = memoryStateIO();

    await constraintsReport({ projectPath: root, stateIO, now: NOW }, io);
    expect(stateIO.snapshot().constraintWatchlist?.['no_hardcoded_credentials']).toEqual({ listedAt: NOW_ISO });
    expect(io.outText()).toContain('观察名单');
    expect(io.outText()).toContain('no_hardcoded_credentials');

    // 第二次：名单状态经注入面读回，不重复写、不进候选
    const io2 = captureIO();
    await constraintsReport({ projectPath: root, stateIO, now: NOW + 10 * DAY_MS }, io2);
    expect(io2.outText()).toContain('剩余观察 80 天');
    expect(io2.outText()).not.toContain('[零拦截] no_hardcoded_credentials');

    // 期满：同一条转退役候选
    const io3 = captureIO();
    await constraintsReport({ projectPath: root, stateIO, now: NOW + WATCHLIST_PERIOD_DAYS * DAY_MS }, io3);
    expect(io3.outText()).toContain('[零拦截] no_hardcoded_credentials');
  });

  it('StateIO 写回不动其他状态字段（读-改-写）', async () => {
    const root = zeroInterceptProject();
    const stateIO = memoryStateIO({ shownHints: ['trace_50'], lastStatusRun: '2026-09-01T00:00:00.000Z' });

    await constraintsReport({ projectPath: root, stateIO, now: NOW }, captureIO());

    const s = stateIO.snapshot();
    expect(s.shownHints).toEqual(['trace_50']);
    expect(s.lastStatusRun).toBe('2026-09-01T00:00:00.000Z');
    expect(Object.keys(s.constraintWatchlist ?? {})).toEqual(['no_hardcoded_credentials']);
  });

  it('--export 脱敏摘要带观察名单分组（列入时间 + 剩余观察期）', async () => {
    const root = zeroInterceptProject();
    await constraintsReport({ projectPath: root, export: 'report.md', now: NOW }, captureIO());

    const md = fs.readFileSync(path.join(root, 'report.md'), 'utf-8');
    expect(md).toContain('## 观察名单');
    expect(md).toContain('no_hardcoded_credentials');
    expect(md).toContain(`剩余观察 ${WATCHLIST_PERIOD_DAYS} 天`);
    expect(md).not.toContain(root);
  });
});
