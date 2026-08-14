/**
 * harness constraints retire 测试（ADR-0001 P5）
 *
 * 执行逻辑（retireConstraint，纯函数化）：config.yml 写入形态、
 * KnowledgeStore 记录、CLAUDE.md 注入段同步、重复 retire / 未知 id 保护。
 * 交互流程（runRetireInteractive）：注入 stdin 流测核心分支
 * （候选选择 + iron 二次确认拒绝；无候选手动输入 + 确认执行）。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Writable } from 'stream';
import * as yaml from 'js-yaml';
import type { ExecutionTrace } from '../../../types/trace';
import { getConstraint } from '../../../core/constraints/definitions';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { renderConstraintsSection } from '../../../core/constraints/injection-renderer';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { retireConstraint, constraintsRetire, runRetireInteractive, printRetireResult } from '../constraints-retire';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retire-test-'));
}

function writeTraces(root: string, traces: Partial<ExecutionTrace>[]): void {
  const dir = path.join(root, '.harness', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const lines = traces.map(t =>
    JSON.stringify({ level: 'guideline', timestamp: 1700000000000, result: 'pass', ...t })
  );
  fs.writeFileSync(path.join(dir, 'traces.log'), lines.join('\n') + '\n', 'utf-8');
}

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8'));
}

const CUSTOM_YML = `
custom_constraints:
  my_custom_rule:
    level: iron_law
    rule: 禁止引入 X
    message: X 已由平台能力替代
    promptInjection: 禁止引入 X
`;

function writeCustom(root: string, yml: string): void {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'custom-constraints.yml'), yml, 'utf-8');
}

function readCustom(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'custom-constraints.yml'), 'utf-8'));
}

let logSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('retireConstraint 执行逻辑', () => {
  it('config.yml 写入形态：enabled:false + retired 元数据（at/reason/stats）', () => {
    const root = makeTmpProject();
    writeTraces(root, [
      { constraintId: 'no_hardcoded_credentials', result: 'pass' },
      { constraintId: 'no_hardcoded_credentials', result: 'pass', timestamp: 1700000001000 },
      { constraintId: 'no_hardcoded_credentials', result: 'fail', timestamp: 1700000002000 },
    ]);

    const result = retireConstraint(root, 'no_hardcoded_credentials', {
      reason: '由 secret 扫描工具链覆盖',
      now: FIXED_NOW,
    });

    expect(result.status).toBe('retired');
    expect(result.isIronLaw).toBe(false);
    expect(result.stats).toEqual({ total: 3, fail: 1, failRate: 1 / 3 });

    const config = readConfig(root);
    const entry = config.constraints.no_hardcoded_credentials;
    expect(entry.enabled).toBe(false);
    expect(entry.retired.at).toBe(FIXED_NOW.toISOString());
    expect(entry.retired.reason).toBe('由 secret 扫描工具链覆盖');
    expect(entry.retired.stats.total).toBe(3);
    expect(entry.retired.stats.fail).toBe(1);
    expect(entry.retired.stats.failRate).toBeCloseTo(1 / 3);
  });

  it('config.yml 不存在时创建；已有其他配置时保留', () => {
    const root = makeTmpProject();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness', 'config.yml'), 'preset: strict\nscenes:\n  - llm-app\n', 'utf-8');

    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(result.status).toBe('retired');

    const config = readConfig(root);
    expect(config.preset).toBe('strict');
    expect(config.scenes).toEqual(['llm-app']);
    expect(config.constraints.capability_sync.enabled).toBe(false);
    expect(config.constraints.capability_sync.retired.reason).toBe('');
  });

  it('KnowledgeStore 写入退役记录：规则原文 + 原因 + 统计 + signal 模式', () => {
    const root = makeTmpProject();
    writeTraces(root, [{ constraintId: 'no_bypass_checkpoint', result: 'fail' }]);

    const result = retireConstraint(root, 'no_bypass_checkpoint', { reason: '流程已内置门禁', now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.knowledgeEntryId).toBe('constraint-retired-no_bypass_checkpoint');

    const store = new FileKnowledgeStore({ baseDir: path.join(root, '.harness', 'knowledge') });
    const entry = store.get('constraint-retired-no_bypass_checkpoint');
    expect(entry).toBeDefined();
    expect(entry!.consumptionMode).toBe('signal');
    expect(entry!.origin).toBe('human');
    expect(entry!.tags).toContain('constraint-retired');
    expect(entry!.tags).toContain('constraint:no_bypass_checkpoint');
    expect(entry!.title).toContain('no_bypass_checkpoint');

    const def = getConstraint('no_bypass_checkpoint')!;
    expect(entry!.content).toContain(def.description!);
    expect(entry!.content).toContain('流程已内置门禁');
    expect(entry!.content).toContain('total: 1');
    expect(entry!.content).toContain('failRate: 100%');
    expect(entry!.content).toContain(FIXED_NOW.toISOString());
  });

  it('CLAUDE.md 含标记段时同步重渲染（退役条目消失、标记保留）', () => {
    const root = makeTmpProject();
    // 先用当前生效集渲染一个合法注入段
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    expect(before).toContain('no_bypass_checkpoint');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# 项目\n\n## Governance Rules\n${before}\n其他内容\n`, 'utf-8');

    const result = retireConstraint(root, 'no_bypass_checkpoint', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.claudeMdSynced).toBe(true);

    const after = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(after).toContain('HARNESS_CONSTRAINTS_START');
    expect(after).toContain('HARNESS_CONSTRAINTS_END');
    expect(after).not.toContain('**no_bypass_checkpoint**');
    expect(after).toContain('其他内容');

    printRetireResult(result);
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('已同步 CLAUDE.md 注入段');
    expect(output).toContain('恢复方法');
  });

  it('CLAUDE.md 无标记段或不存在时不创建、不同步', () => {
    const root = makeTmpProject();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 用户自写\n', 'utf-8');
    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.claudeMdSynced).toBe(false);
    expect(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).toBe('# 用户自写\n');
  });

  it('重复 retire：already_retired，不覆盖原 retired 元数据', () => {
    const root = makeTmpProject();
    const first = retireConstraint(root, 'capability_sync', { reason: '第一次', now: FIXED_NOW });
    expect(first.status).toBe('retired');

    const later = new Date('2026-08-09T00:00:00.000Z');
    const second = retireConstraint(root, 'capability_sync', { reason: '第二次', now: later });
    expect(second.status).toBe('already_retired');

    const config = readConfig(root);
    expect(config.constraints.capability_sync.retired.at).toBe(FIXED_NOW.toISOString());
    expect(config.constraints.capability_sync.retired.reason).toBe('第一次');
  });

  it('未知 id：unknown_id，不落盘任何文件', () => {
    const root = makeTmpProject();
    const result = retireConstraint(root, 'not_a_constraint', { now: FIXED_NOW });
    expect(result.status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('check 层 iron：isIronLaw 标记为 true（供交互模式二次确认）', () => {
    const root = makeTmpProject();
    const result = retireConstraint(root, 'docs_freshness', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.isIronLaw).toBe(true);
  });

  it('退役后生效集不再包含该约束', () => {
    const root = makeTmpProject();
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);
  });

  it('custom 约束退役：落 custom-constraints.yml retired 段（不写 config.yml），生效集与注入段移除', () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    expect(before).toContain('**my_custom_rule**');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# 项目\n\n## Governance Rules\n${before}\n其他内容\n`, 'utf-8');

    const result = retireConstraint(root, 'my_custom_rule', { reason: '作用对象已从代码库消失', now: FIXED_NOW });

    expect(result.status).toBe('retired');
    expect(result.landing).toBe('custom-constraints.yml');
    expect(result.claudeMdSynced).toBe(true);
    // config.yml 不产生该 id 段
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
    // yml 保留规则原文 + retired 元数据
    const custom = readCustom(root).custom_constraints.my_custom_rule;
    expect(custom.rule).toBe('禁止引入 X');
    expect(custom.promptInjection).toBe('禁止引入 X');
    expect(custom.retired.at).toBe(FIXED_NOW.toISOString());
    expect(custom.retired.reason).toBe('作用对象已从代码库消失');
    // 生效集移除
    expect(getEffectiveConstraints(root).some(c => c.id === 'my_custom_rule')).toBe(false);
    // 注入段同步移除
    const after = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(after).not.toContain('**my_custom_rule**');
    expect(after).toContain('其他内容');
    // 打印的恢复提示指向 yml
    printRetireResult(result);
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('custom_constraints.my_custom_rule.retired');
  });

  it('custom 重复退役：yml 已带 retired → already_retired，不覆盖原元数据', () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    const first = retireConstraint(root, 'my_custom_rule', { reason: '第一次', now: FIXED_NOW });
    expect(first.status).toBe('retired');

    const later = new Date('2026-08-09T00:00:00.000Z');
    const second = retireConstraint(root, 'my_custom_rule', { reason: '第二次', now: later });
    expect(second.status).toBe('already_retired');

    const custom = readCustom(root).custom_constraints.my_custom_rule;
    expect(custom.retired.at).toBe(FIXED_NOW.toISOString());
    expect(custom.retired.reason).toBe('第一次');
  });

  it('custom 历史落点（config.yml enabled:false）仍判定 already_retired', () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    fs.writeFileSync(path.join(root, '.harness', 'config.yml'), 'constraints:\n  my_custom_rule:\n    enabled: false\n', 'utf-8');
    const result = retireConstraint(root, 'my_custom_rule', { now: FIXED_NOW });
    expect(result.status).toBe('already_retired');
  });

  it('custom 退役 KnowledgeStore 记录包含 promptInjection（规则原文完整）', () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    const result = retireConstraint(root, 'my_custom_rule', { reason: '由新机制覆盖', now: FIXED_NOW });
    expect(result.status).toBe('retired');

    const store = new FileKnowledgeStore({ baseDir: path.join(root, '.harness', 'knowledge') });
    const entry = store.get('constraint-retired-my_custom_rule');
    expect(entry).toBeDefined();
    expect(entry!.content).toContain('禁止引入 X');
    expect(entry!.content).toContain('promptInjection: 禁止引入 X');
  });

  it('custom 恢复：删除 yml retired 段后回到生效集', () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    retireConstraint(root, 'my_custom_rule', { now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'my_custom_rule')).toBe(false);

    const custom = readCustom(root);
    delete custom.custom_constraints.my_custom_rule.retired;
    fs.writeFileSync(path.join(root, '.harness', 'custom-constraints.yml'), yaml.dump(custom), 'utf-8');

    expect(getEffectiveConstraints(root).some(c => c.id === 'my_custom_rule')).toBe(true);
  });
});

describe('constraintsRetire 非交互直达', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('无 --yes 直达：报错 + 非零退出码 + 不落盘任何文件（#24 人确认闸门）', async () => {
    const root = makeTmpProject();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await constraintsRetire('docs_freshness', { projectPath: root, reason: '直接退役' });

      const output = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('--yes');
      expect(output).toContain('交互');
      expect(process.exitCode).toBe(1);
      // 无副作用：任何文件都不落盘
      expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('--yes 直达 iron 退役：打印额外警示并落盘', async () => {
    const root = makeTmpProject();
    await constraintsRetire('docs_freshness', { projectPath: root, reason: '直接退役', yes: true });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('Iron Law');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.docs_freshness.enabled).toBe(false);
  });

  it('--yes 直达非 iron（guideline）退役：不打印 iron 警示并落盘', async () => {
    const root = makeTmpProject();
    await constraintsRetire('no_hardcoded_credentials', { projectPath: root, reason: '直接退役', yes: true });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).not.toContain('Iron Law');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.no_hardcoded_credentials.enabled).toBe(false);
  });

  it('--yes 直达未知 id：明确提示', async () => {
    const root = makeTmpProject();
    await constraintsRetire('ghost', { projectPath: root, yes: true });
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('约束不存在');
  });
});

describe('runRetireInteractive 交互流程（注入 IO 流）', () => {
  /** 逐行 drip-feed，等待 readline 消费上一行 */
  function makeIo(lines: string[]) {
    const input = new PassThrough();
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) {
        input.write(lines[i] + '\n');
        i++;
      } else {
        clearInterval(timer);
      }
    }, 30);
    return { input, output, done: () => clearInterval(timer) };
  }

  it('候选编号选择 + iron 二次确认拒绝 → 不落盘', async () => {
    const root = makeTmpProject();
    // 无 trace → 候选全部为零触发，1 号候选是第一条 iron（no_completion_without_verification）
    const io = makeIo(['1', 'n']); // 选 1 号 → iron 确认拒绝

    await runRetireInteractive(root, io);
    io.done();

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('退役候选');
    expect(output).toContain('已跳过 no_completion_without_verification');
    expect(output).toContain('无可执行项');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('无候选 → 手动输入 id → 确认执行 → 落盘', async () => {
    const root = makeTmpProject();
    // 所有 check 约束给少量健康数据（低于一切候选阈值）
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [
        { constraintId: c.id, result: 'pass' as const },
        { constraintId: c.id, result: 'pass' as const, timestamp: 1700000001000 },
        { constraintId: c.id, result: 'fail' as const, timestamp: 1700000002000 },
      ]);
    writeTraces(root, healthy);

    const io = makeIo(['no_hardcoded_credentials', '误报太多', 'y']);
    await runRetireInteractive(root, io);
    io.done();

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('没有退役候选');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.no_hardcoded_credentials.enabled).toBe(false);
    expect(config.constraints.no_hardcoded_credentials.retired.reason).toBe('误报太多');
  });

  it('无候选 → 手动输入 custom id → 确认执行 → 落 custom-constraints.yml', async () => {
    const root = makeTmpProject();
    writeCustom(root, CUSTOM_YML);
    // 所有 check 约束给少量健康数据（低于一切候选阈值）
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [
        { constraintId: c.id, result: 'pass' as const },
        { constraintId: c.id, result: 'pass' as const, timestamp: 1700000001000 },
        { constraintId: c.id, result: 'fail' as const, timestamp: 1700000002000 },
      ]);
    writeTraces(root, healthy);

    const io = makeIo(['my_custom_rule', '作用对象消失', 'y']);
    await runRetireInteractive(root, io);
    io.done();

    const custom = readCustom(root).custom_constraints.my_custom_rule;
    expect(custom.retired.reason).toBe('作用对象消失');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('无候选 → 手动输入未知 id → 提示不存在并取消', async () => {
    const root = makeTmpProject();
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [{ constraintId: c.id, result: 'pass' as const }]);
    writeTraces(root, healthy);

    const io = makeIo(['ghost_id']);
    await runRetireInteractive(root, io);
    io.done();

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('ghost_id');
    expect(output).toContain('约束不存在');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });
});
