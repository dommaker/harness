/**
 * harness constraints retire 测试（ADR-0001 P5）
 *
 * 执行逻辑（retireConstraint，纯函数化）：config.yml 写入形态、
 * KnowledgeStore 记录、治理注入段同步（CLAUDE.md / AGENTS.md 落点路由）、重复 retire / 未知 id 保护。
 * 交互流程（runRetireInteractive）：注入 stdin 流测核心分支
 * （候选选择 + iron 二次确认拒绝；无候选手动输入 + 确认执行）。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as path from 'path';
import { PassThrough, Writable } from 'stream';
import * as yaml from 'js-yaml';
import { getConstraint } from '../../../core/constraints/definitions';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { renderConstraintsSection } from '../../../core/constraints/injection-renderer';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { retireConstraint, constraintsRetire, runRetireInteractive, printRetireResult } from '../constraints-retire';
import { createProjectFixture, writeProjectTraces } from '../../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

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

beforeEach(() => {
});

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('retireConstraint 执行逻辑', () => {
  it('config.yml 写入形态：enabled:false + retired 元数据（at/reason/stats）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    writeProjectTraces(root, [
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
    const root = createProjectFixture({ name: 'harness-retire-test' });
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
    const root = createProjectFixture({
      name: 'harness-retire-test',
      traces: [{ constraintId: 'no_bypass_checkpoint', result: 'fail' }],
    });

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
    const root = createProjectFixture({ name: 'harness-retire-test' });
    // 先用当前生效集渲染一个合法注入段
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    expect(before).toContain('no_bypass_checkpoint');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# 项目\n\n## Governance Rules\n${before}\n其他内容\n`, 'utf-8');

    const result = retireConstraint(root, 'no_bypass_checkpoint', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.injectionSynced).toBe(true);

    const after = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(after).toContain('HARNESS_CONSTRAINTS_START');
    expect(after).toContain('HARNESS_CONSTRAINTS_END');
    expect(after).not.toContain('**no_bypass_checkpoint**');
    expect(after).toContain('其他内容');

    printRetireResult(result, io);
    const output = io.outText();
    expect(output).toContain('已同步 CLAUDE.md 注入段');
    expect(output).toContain('恢复方法');
  });

  it('CLAUDE.md 无标记段或不存在时不创建、不同步', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 用户自写\n', 'utf-8');
    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.injectionSynced).toBe(false);
    expect(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).toBe('# 用户自写\n');
  });

  it('新模型仓：AGENTS.md PRESERVE:governance 内含标记段时同步重渲染（无 CLAUDE.md）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    expect(before).toContain('no_bypass_checkpoint');
    fs.writeFileSync(
      path.join(root, 'AGENTS.md'),
      `# AGENTS.md\n\n<!-- PRESERVE:governance -->\n## Governance Rules\n${before}<!-- /PRESERVE:governance -->\n\n其他内容\n`,
      'utf-8'
    );

    const result = retireConstraint(root, 'no_bypass_checkpoint', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.injectionSynced).toBe(true);
    expect(result.injectionFile).toBe('AGENTS.md');

    const after = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8');
    expect(after).toContain('HARNESS_CONSTRAINTS_START');
    expect(after).toContain('HARNESS_CONSTRAINTS_END');
    expect(after).not.toContain('**no_bypass_checkpoint**');
    expect(after).toContain('PRESERVE:governance');
    expect(after).toContain('其他内容');
    // 不制造 CLAUDE.md
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
  });

  it('两文件均有标记段时旧模型仓豁免：只同步 CLAUDE.md，AGENTS.md 不动', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# 项目\n\n## Governance Rules\n${before}`, 'utf-8');
    const agentsMd = `# AGENTS.md\n\n<!-- PRESERVE:governance -->\n## Governance Rules\n${before}<!-- /PRESERVE:governance -->\n`;
    fs.writeFileSync(path.join(root, 'AGENTS.md'), agentsMd, 'utf-8');

    const result = retireConstraint(root, 'no_bypass_checkpoint', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.injectionSynced).toBe(true);
    expect(result.injectionFile).toBe('CLAUDE.md');

    expect(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).not.toContain('**no_bypass_checkpoint**');
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8')).toBe(agentsMd);
  });

  it('重复 retire：already_retired，不覆盖原 retired 元数据', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
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
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const result = retireConstraint(root, 'not_a_constraint', { now: FIXED_NOW });
    expect(result.status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('check 层 iron：isIronLaw 标记为 true（供交互模式二次确认）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const result = retireConstraint(root, 'docs_freshness', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.isIronLaw).toBe(true);
  });

  it('退役后生效集不再包含该约束', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);
  });

  it('custom 约束退役：落 custom-constraints.yml retired 段（不写 config.yml），生效集与注入段移除', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    writeCustom(root, CUSTOM_YML);
    const before = renderConstraintsSection(getEffectiveConstraints(root), '0.0.0-test');
    expect(before).toContain('**my_custom_rule**');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# 项目\n\n## Governance Rules\n${before}\n其他内容\n`, 'utf-8');

    const result = retireConstraint(root, 'my_custom_rule', { reason: '作用对象已从代码库消失', now: FIXED_NOW });

    expect(result.status).toBe('retired');
    expect(result.landing).toBe('custom-constraints.yml');
    expect(result.injectionSynced).toBe(true);
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
    printRetireResult(result, io);
    const output = io.outText();
    expect(output).toContain('custom_constraints.my_custom_rule.retired');
  });

  it('custom 重复退役：yml 已带 retired → already_retired，不覆盖原元数据', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
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
    const root = createProjectFixture({ name: 'harness-retire-test' });
    writeCustom(root, CUSTOM_YML);
    fs.writeFileSync(path.join(root, '.harness', 'config.yml'), 'constraints:\n  my_custom_rule:\n    enabled: false\n', 'utf-8');
    const result = retireConstraint(root, 'my_custom_rule', { now: FIXED_NOW });
    expect(result.status).toBe('already_retired');
  });

  it('custom 退役 KnowledgeStore 记录包含 promptInjection（规则原文完整）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
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
    const root = createProjectFixture({ name: 'harness-retire-test' });
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
  it('无 --yes 直达：报错 + 非零退出码 + 不落盘任何文件（#24 人确认闸门）', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    {
      const result = await constraintsRetire('docs_freshness', { projectPath: root, reason: '直接退役' }, io);

      const output = io.errText();
      expect(output).toContain('--yes');
      expect(output).toContain('交互');
      expect(result).toEqual({ kind: 'usage-error', reason: expect.stringContaining('缺少显式 --yes 人确认') });
      // 无副作用：任何文件都不落盘
      expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
    }
  });

  it('--yes 直达 iron 退役：打印额外警示并落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    await constraintsRetire('docs_freshness', { projectPath: root, reason: '直接退役', yes: true }, io);

    const output = io.outText();
    expect(output).toContain('Iron Law');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.docs_freshness.enabled).toBe(false);
  });

  it('--yes 直达非 iron（guideline）退役：不打印 iron 警示并落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    await constraintsRetire('no_hardcoded_credentials', { projectPath: root, reason: '直接退役', yes: true }, io);

    const output = io.outText();
    expect(output).not.toContain('Iron Law');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.no_hardcoded_credentials.enabled).toBe(false);
  });

  it('--yes 直达未知 id：明确提示', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    await constraintsRetire('ghost', { projectPath: root, yes: true }, io);
    const output = io.outText();
    expect(output).toContain('约束不存在');
  });
});

describe('runRetireInteractive 交互流程（注入 IO 流）', () => {
  /**
   * 交互正文仍走 console（RetireIO 只注入 readline 的 input/output 流，
   * 且 retireConstraint 核心直接 console.warn 式打印）→ 用 console 捕获。
   */
  function captureLog(): { text: () => string; restore: () => void } {
    let out = '';
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out += String(args[0] ?? '') + '\n';
    });
    return { text: () => out, restore: () => spy.mockRestore() };
  }

  /** 逐行 drip-feed，等待 readline 消费上一行；output 收集写入文本 */
  function makeIo(lines: string[]) {
    const input = new PassThrough();
    const chunks: string[] = [];
    const output = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } });
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) {
        input.write(lines[i] + '\n');
        i++;
      } else {
        clearInterval(timer);
      }
    }, 30);
    return { input, output, text: () => chunks.join(''), done: () => clearInterval(timer) };
  }

  it('候选编号选择 + iron 二次确认拒绝 → 不落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    // 无 trace → 候选全部为零触发，1 号候选是第一条 iron（no_completion_without_verification）
    const streams = makeIo(['1', 'n']); // 选 1 号 → iron 确认拒绝
    const printed = captureLog();

    await runRetireInteractive(root, streams);
    streams.done();
    printed.restore();

    const output = printed.text() + streams.text();
    expect(output).toContain('退役候选');
    expect(output).toContain('已跳过 no_completion_without_verification');
    expect(output).toContain('无可执行项');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('无候选 → 手动输入 id → 确认执行 → 落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    // 所有 check 约束给少量健康数据（低于一切候选阈值）
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [
        { constraintId: c.id, result: 'pass' as const },
        { constraintId: c.id, result: 'pass' as const, timestamp: 1700000001000 },
        { constraintId: c.id, result: 'fail' as const, timestamp: 1700000002000 },
      ]);
    writeProjectTraces(root, healthy);

    const streams = makeIo(['no_hardcoded_credentials', '误报太多', 'y']);
    const printed = captureLog();
    await runRetireInteractive(root, streams);
    streams.done();
    printed.restore();

    const output = printed.text() + streams.text();
    expect(output).toContain('没有退役候选');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.no_hardcoded_credentials.enabled).toBe(false);
    expect(config.constraints.no_hardcoded_credentials.retired.reason).toBe('误报太多');
  });

  it('坏行 fixture：候选列表前告知损坏行数（决策依据不完整不静默，harness#100）', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'traces.log'),
      '{"constraintId":"a","level":"iron_law","timestamp":1700000000000,"result":"pass"}\n{bad json\n{also bad\n',
      'utf-8'
    );

    const streams = makeIo(['']); // 直接取消，只验证告知行
    const printed = captureLog();
    const notices: string[] = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      notices.push(String(args[0] ?? ''));
    });
    await runRetireInteractive(root, streams);
    streams.done();
    errSpy.mockRestore();
    printed.restore();

    expect(notices.join('\n')).toContain('2 行损坏');
    expect(printed.text()).toContain('退役候选');
  });

  it('trace 无损坏时不出现坏行提示（零噪声）', async () => {
    const root = createProjectFixture({
      name: 'harness-retire-test',
      traces: [{ constraintId: 'a', result: 'pass' }],
    });

    const streams = makeIo(['']);
    const printed = captureLog();
    const notices: string[] = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      notices.push(String(args[0] ?? ''));
    });
    await runRetireInteractive(root, streams);
    streams.done();
    errSpy.mockRestore();
    printed.restore();

    expect(notices.join('\n')).not.toContain('损坏');
    expect(printed.text()).toContain('退役候选');
  });

  it('直达 --yes 路径也在落盘前告知损坏行数（harness#100：不经过交互也有告知）', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'traces.log'),
      '{"constraintId":"a","level":"iron_law","timestamp":1700000000000,"result":"pass"}\n{bad json\n',
      'utf-8'
    );

    const directIo = captureIO();
    await constraintsRetire('no_hardcoded_credentials', { projectPath: root, yes: true }, directIo);

    expect(directIo.errText()).toContain('1 行损坏');
    // 告知不挤动结果正文：退役结论仍在 stdout
    expect(directIo.outText()).toContain('已退役');
    expect(readConfig(root).constraints.no_hardcoded_credentials.enabled).toBe(false);
  });

  it('无候选 → 手动输入 custom id → 确认执行 → 落 custom-constraints.yml', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    writeCustom(root, CUSTOM_YML);
    // 所有 check 约束给少量健康数据（低于一切候选阈值）
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [
        { constraintId: c.id, result: 'pass' as const },
        { constraintId: c.id, result: 'pass' as const, timestamp: 1700000001000 },
        { constraintId: c.id, result: 'fail' as const, timestamp: 1700000002000 },
      ]);
    writeProjectTraces(root, healthy);

    const streams = makeIo(['my_custom_rule', '作用对象消失', 'y']);
    await runRetireInteractive(root, streams);
    streams.done();

    const custom = readCustom(root).custom_constraints.my_custom_rule;
    expect(custom.retired.reason).toBe('作用对象消失');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('无候选 → 手动输入未知 id → 提示不存在并取消', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const healthy = getEffectiveConstraints(root)
      .filter(c => c.kind === 'check')
      .flatMap(c => [{ constraintId: c.id, result: 'pass' as const }]);
    writeProjectTraces(root, healthy);

    const streams = makeIo(['ghost_id']);
    const printed = captureLog();
    await runRetireInteractive(root, streams);
    streams.done();
    printed.restore();

    const output = printed.text() + streams.text();
    expect(output).toContain('ghost_id');
    expect(output).toContain('约束不存在');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });
});
