/**
 * harness constraints report 测试（ADR-0001 P5）
 *
 * 覆盖：无 trace 文件、空 trace、含 skip 的统计、四类候选诊断、
 * --export 内容脱敏（无 projectPath）、unknownIds 配置健康提示。
 *
 * 使用真实临时目录（getEffectiveConstraints/ProjectConfigLoader 读真实 fs）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExecutionTrace } from '../../../types/trace';
import {
  buildConstraintsUsageReport,
  diagnoseRetireCandidates,
  readProjectTraces,
} from '../../../core/constraints/usage-report';
import { constraintsReport, renderExportMarkdown } from '../constraints-report';

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-report-test-'));
}

function writeTraces(root: string, traces: Partial<ExecutionTrace>[]): void {
  const dir = path.join(root, '.harness', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const lines = traces.map(t =>
    JSON.stringify({
      level: 'guideline',
      timestamp: 1700000000000,
      result: 'pass',
      ...t,
    })
  );
  fs.writeFileSync(path.join(dir, 'traces.log'), lines.join('\n') + '\n', 'utf-8');
}

/** 生成 N 条同结果 trace */
function tracesOf(id: string, result: ExecutionTrace['result'], n: number, startTs = 1700000000000): Partial<ExecutionTrace>[] {
  return Array.from({ length: n }, (_, i) => ({ constraintId: id, result, timestamp: startTs + i * 1000 }));
}

let logSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('buildConstraintsUsageReport', () => {
  it('无 trace 文件：生效集 check 约束全部列出且 total=0，全部判为零触发候选', () => {
    const root = makeTmpProject();
    const report = buildConstraintsUsageReport(root);

    expect(report.traceFileExists).toBe(false);
    expect(report.stats.length).toBe(9); // 5 iron + 4 guideline
    for (const s of report.stats) {
      expect(s.total).toBe(0);
      expect(s.evaluated).toBe(0);
      expect(s.failRate).toBe(0);
      expect(s.firstAt).toBeUndefined();
    }
    expect(report.candidates.length).toBe(9);
    expect(report.candidates.every(c => c.kind === 'zero_trigger')).toBe(true);
    // prompt 注入清单（standard preset、无 scenes → 14 条通用 prompt）
    expect(report.activePromptIds.length).toBe(14);
    expect(report.activePromptIds).toContain('no_fuzzy_completion_claim');
  });

  it('空 trace 文件：与无文件一致，但 traceFileExists=true', () => {
    const root = makeTmpProject();
    writeTraces(root, []);
    const report = buildConstraintsUsageReport(root);

    expect(report.traceFileExists).toBe(true);
    expect(report.stats.every(s => s.total === 0)).toBe(true);
    expect(report.candidates.every(c => c.kind === 'zero_trigger')).toBe(true);
  });

  it('含 skip 的统计：skip 不计入 fail 率分母，首次/最近时间正确', () => {
    const root = makeTmpProject();
    writeTraces(root, [
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
    const root = makeTmpProject();
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'traces.log'),
      '{"constraintId":"docs_freshness","timestamp":1,"result":"pass","level":"iron_law"}\n{bad json\n',
      'utf-8'
    );
    expect(readProjectTraces(root).length).toBe(1);
  });

  it('四类候选诊断：零触发/不可评估(flag)/不可评估(探测)/高噪/零拦截', () => {
    const root = makeTmpProject();
    writeTraces(root, [
      // 不可评估（flag 未接线）：全部 skip
      ...tracesOf('no_completion_without_verification', 'skip', 3),
      // 不可评估（存在性探测未命中）：全部 skip
      ...tracesOf('capability_sync', 'skip', 5),
      // 高噪：24 次评估 fail 率 83% > 80%
      ...tracesOf('no_bypass_checkpoint', 'fail', 20),
      ...tracesOf('no_bypass_checkpoint', 'pass', 4, 1700001000000),
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
    const noiseC = byId.get('no_bypass_checkpoint');
    expect(noiseC?.kind).toBe('high_noise');
    expect(noiseC?.reason).toContain('83%');

    // 零拦截
    const zeroC = byId.get('no_hardcoded_credentials');
    expect(zeroC?.kind).toBe('zero_intercept');
    expect(zeroC?.reason).toContain('50 次评估');
  });

  it('阈值可配：放宽零拦截样本阈值后 10 次全 pass 也成为候选', () => {
    const root = makeTmpProject();
    writeTraces(root, tracesOf('no_hardcoded_credentials', 'pass', 10));

    const strict = buildConstraintsUsageReport(root);
    expect(strict.candidates.find(c => c.id === 'no_hardcoded_credentials')).toBeUndefined();

    const relaxed = buildConstraintsUsageReport(root, { zeroInterceptMinEvaluated: 10 });
    expect(relaxed.candidates.find(c => c.id === 'no_hardcoded_credentials')?.kind).toBe('zero_intercept');
  });

  it('diagnoseRetireCandidates 优先级：全 skip 不重复计入零拦截', () => {
    const candidates = diagnoseRetireCandidates([
      {
        id: 'x', level: 'guideline',
        total: 60, pass: 0, fail: 0, skip: 60,
        evaluated: 0, failRate: 0,
      },
    ]);
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe('unevaluable');
  });

  it('配置健康：config.yml 中未知 id 进入 unknownIds', () => {
    const root = makeTmpProject();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.harness', 'config.yml'),
      'constraints:\n  ghost_constraint:\n    enabled: false\n',
      'utf-8'
    );
    const report = buildConstraintsUsageReport(root);
    expect(report.lint.unknownIds).toContain('ghost_constraint');
  });
});

describe('constraintsReport CLI', () => {
  it('console 输出包含统计表、候选、注入清单、unknownIds 提示', async () => {
    const root = makeTmpProject();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.harness', 'config.yml'),
      'constraints:\n  ghost_constraint:\n    enabled: false\n',
      'utf-8'
    );
    writeTraces(root, tracesOf('no_hardcoded_credentials', 'pass', 3));

    await constraintsReport({ projectPath: root });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('约束使用报告');
    expect(output).toContain('no_hardcoded_credentials');
    expect(output).toContain('total=3');
    expect(output).toContain('退役候选');
    expect(output).toContain('当前生效 prompt 注入');
    expect(output).toContain('ghost_constraint');
  });

  it('--export 缺省路径：写入 .harness/reports/constraints-<YYYYMMDD>.md 且内容脱敏', async () => {
    const root = makeTmpProject();
    writeTraces(root, [
      ...tracesOf('no_bypass_checkpoint', 'fail', 20),
      // projectPath 字段进 trace，但不得进 export
      { constraintId: 'no_bypass_checkpoint', result: 'fail', projectPath: root, timestamp: 1700001000000 },
    ]);

    await constraintsReport({ projectPath: root, export: true });

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const exportPath = path.join(root, '.harness', 'reports', `constraints-${date}.md`);
    expect(fs.existsSync(exportPath)).toBe(true);

    const content = fs.readFileSync(exportPath, 'utf-8');
    expect(content).toContain('harness 版本');
    expect(content).toContain('| id | total | pass | fail | skip |');
    expect(content).toContain('no_bypass_checkpoint');
    expect(content).toContain('高噪');
    // 脱敏：不包含项目路径
    expect(content).not.toContain(root);
    expect(content).not.toContain('projectPath');

    // 打印了导出路径
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain(exportPath);
  });

  it('--export 指定文件：写到给定路径', async () => {
    const root = makeTmpProject();
    await constraintsReport({ projectPath: root, export: 'my-report.md' });
    expect(fs.existsSync(path.join(root, 'my-report.md'))).toBe(true);
  });

  it('renderExportMarkdown：无候选时显式标注', () => {
    const root = makeTmpProject();
    writeTraces(root, [
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

describe('constraintsReport 注入漂移小节（ADR-0001 决策 7）', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realVersion = require('../../../../package.json').version as string;

  const writeSyncedClaudeMd = (root: string, version = realVersion) => {
    const { renderConstraintsSection } = require('../../../core/constraints/injection-renderer');
    const { getEffectiveConstraints } = require('../../../core/effective-constraints');
    const section = '## Governance Rules\n' + renderConstraintsSection(getEffectiveConstraints(root), version);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# Test Project\n\n${section}`, 'utf-8');
  };

  it('有漂移：输出条目级差异（缺失/多余）与修复指引', async () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root, '0.0.1-old');
    const claudeMdPath = path.join(root, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const originalLine = content.split('\n').find((l: string) => l.startsWith('- **'))!;
    const editedLine = originalLine.replace(/: .+$/, ': 手工篡改');
    fs.writeFileSync(claudeMdPath, content.replace(originalLine, editedLine), 'utf-8');

    await constraintsReport({ projectPath: root });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('注入漂移');
    expect(output).toContain('版本漂移');
    expect(output).toContain('0.0.1-old');
    expect(output).toContain(`缺失: ${originalLine}`);
    expect(output).toContain(`多余: ${editedLine}`);
    expect(output).toContain('npx @dommaker/harness init');
  });

  it('重复章节：输出重复章节提示', async () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root);
    fs.appendFileSync(path.join(root, 'CLAUDE.md'), '\n## Governance Rules\n\n旧版遗留\n', 'utf-8');

    await constraintsReport({ projectPath: root });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('重复章节');
  });

  it('无漂移：小节显示无漂移', async () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root);

    await constraintsReport({ projectPath: root });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('注入漂移');
    expect(output).toContain('无漂移');
  });

  it('未注入（无标记段）：一句话提示，不算漂移', async () => {
    const root = makeTmpProject();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Test Project\n', 'utf-8');

    await constraintsReport({ projectPath: root });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('未注入');
  });
});
