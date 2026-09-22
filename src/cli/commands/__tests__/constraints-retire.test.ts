/**
 * harness constraints retire 测试（ADR-0001 P5，ADR-0029 收窄）
 *
 * 执行逻辑（retireConstraint，纯函数化）：config.yml 写入形态、
 * KnowledgeStore 记录、重复 retire / 未知 id 保护。
 * 交互流程（runRetireInteractive）：注入 stdin 流测核心分支
 * （候选选择 + error 级二次确认拒绝；无候选手动输入 + 确认执行）。
 *
 * ADR-0029：custom 纯文本约束与治理注入段同步已随文本注入层关停一并退役，
 * 相关用例移除。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Writable } from 'stream';
import * as yaml from 'js-yaml';
import { getConstraint } from '../../../core/constraints/definitions';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { retireConstraint, constraintsRetire, runRetireInteractive, printRetireResult } from '../constraints-retire';
import { openKnowledgeStore } from '../knowledge-view';
import { createProjectFixture, writeProjectTraces } from '../../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8'));
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
  // retire 的 KnowledgeStore 写口走统一解析点（harness#177）：不隔离会写进真实用户主目录
  process.env.KNOWLEDGE_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retire-kb-'));
});
afterEach(() => {
  fs.rmSync(process.env.KNOWLEDGE_BASE_DIR!, { recursive: true, force: true });
  delete process.env.KNOWLEDGE_BASE_DIR;
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
    expect(result.isError).toBe(true);
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
    fs.writeFileSync(path.join(root, '.harness', 'config.yml'), 'preset: strict\nci:\n  platform: gitlab\n', 'utf-8');

    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(result.status).toBe('retired');

    const config = readConfig(root);
    expect(config.preset).toBe('strict');
    expect(config.ci.platform).toBe('gitlab');
    expect(config.constraints.capability_sync.enabled).toBe(false);
    expect(config.constraints.capability_sync.retired.reason).toBe('');
  });

  it('KnowledgeStore 写入退役记录：规则原文 + 原因 + 统计 + signal 模式，落点为 knowledge 读口同一解析根（harness#177）', () => {
    const root = createProjectFixture({
      name: 'harness-retire-test',
      traces: [{ constraintId: 'no_completion_without_verification', result: 'fail' }],
    });

    const result = retireConstraint(root, 'no_completion_without_verification', { reason: '流程已内置门禁', now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.knowledgeEntryId).toBe('constraint-retired-no_completion_without_verification');
    // 写口与读口同一解析点：KNOWLEDGE_BASE_DIR 覆盖对写口同步生效
    expect(result.knowledgeBaseDir).toBe(process.env.KNOWLEDGE_BASE_DIR);
    // 缺省解析（无 -p/--dir）构造的 store 直接可读——修复前写口硬编码 projectRoot，此处读不到
    expect(openKnowledgeStore({}, io).get('constraint-retired-no_completion_without_verification')).toBeDefined();

    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    const entry = store.get('constraint-retired-no_completion_without_verification');
    expect(entry).toBeDefined();
    expect(entry!.consumptionMode).toBe('signal');
    expect(entry!.origin).toBe('human');
    expect(entry!.tags).toContain('constraint-retired');
    expect(entry!.tags).toContain('constraint:no_completion_without_verification');
    expect(entry!.title).toContain('no_completion_without_verification');

    const def = getConstraint('no_completion_without_verification')!;
    expect(entry!.content).toContain(def.description!);
    expect(entry!.content).toContain('流程已内置门禁');
    expect(entry!.content).toContain('total: 1');
    expect(entry!.content).toContain('failRate: 100%');
    expect(entry!.content).toContain(FIXED_NOW.toISOString());
  });

  it('退役结果打印含回滚语义提示（恢复 = constraints reactivate 命令）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(result.status).toBe('retired');

    printRetireResult(result, io);
    const output = io.outText();
    expect(output).toContain('恢复方法');
    expect(output).toContain('harness constraints reactivate capability_sync');
  });

  it('退役结果打印：git 仓内附 commit 提示，非 git 目录不提示（票 02 断点 4）', () => {
    const gitRoot = createProjectFixture({ name: 'harness-retire-test', files: { '.git/HEAD': 'ref: refs/heads/master\n' } });
    const inGit = retireConstraint(gitRoot, 'capability_sync', { now: FIXED_NOW });
    printRetireResult(inGit, io, gitRoot);
    expect(io.outText()).toContain('git add .harness/config.yml');

    const plainRoot = createProjectFixture({ name: 'harness-retire-test' });
    const plainIo = captureIO();
    const notInGit = retireConstraint(plainRoot, 'capability_sync', { now: FIXED_NOW });
    printRetireResult(notInGit, plainIo, plainRoot);
    expect(plainIo.outText()).not.toContain('git add');
  });

  it('裸 disable 不吞退休：enabled:false 无墓碑时 retire 照常落墓碑 + 沉淀（ADR-0032 决策 6.6，票 02 断点 6）', () => {
    const root = createProjectFixture({
      name: 'harness-retire-test',
      config: 'constraints:\n  capability_sync:\n    enabled: false\n',
    });

    const result = retireConstraint(root, 'capability_sync', { reason: '升级裸 disable 为退休', now: FIXED_NOW });

    expect(result.status).toBe('retired');
    const config = readConfig(root);
    expect(config.constraints.capability_sync.enabled).toBe(false);
    expect(config.constraints.capability_sync.retired.at).toBe(FIXED_NOW.toISOString());
    expect(config.constraints.capability_sync.retired.reason).toBe('升级裸 disable 为退休');
    // 沉淀照写，不被裸 disable 吞掉
    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    expect(store.get('constraint-retired-capability_sync')).toBeDefined();
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

  it('severity=error：isError 标记为 true（供交互模式二次确认）', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const result = retireConstraint(root, 'docs_freshness', { now: FIXED_NOW });
    expect(result.status).toBe('retired');
    expect(result.isError).toBe(true);
  });

  it('退役后生效集不再包含该约束', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);
  });

  it('恢复：删除 config.yml constraints.<id> 段后回到生效集', () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);

    const config = readConfig(root);
    delete config.constraints.capability_sync;
    fs.writeFileSync(path.join(root, '.harness', 'config.yml'), yaml.dump(config), 'utf-8');

    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
  });
});

describe('落盘字节与装载次数冻结（harness#137）', () => {
  /**
   * YAML 读-改-写两段合并成 `setYamlEntry` 属内部重构：对外产物逐字不得漂移
   * （票验收 6）。故此处钉的是**字节**而非 yaml.load 后的对象——键序、缩进、
   * 行宽 120 的折叠口径、注释丢弃后的形态都在断言范围内。
   */
  it('内置退役落 config.yml：逐字节冻结', () => {
    const root = createProjectFixture({
      name: 'harness-retire-test',
      config: '# 项目配置\npreset: standard\nci:\n  platform: gitlab\n',
    });

    retireConstraint(root, 'capability_sync', { reason: '逐字节冻结', now: FIXED_NOW });

    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe(
      'preset: standard\nci:\n  platform: gitlab\nconstraints:\n  capability_sync:\n    enabled: false\n' +
        "    retired:\n      at: '2026-08-08T12:00:00.000Z'\n      reason: 逐字节冻结\n" +
        '      stats:\n        total: 0\n        fail: 0\n        failRate: 0\n'
    );
  });

  it('一次 retireConstraint 只装载一次项目配置', async () => {
    const { ProjectConfigLoader } = await import('../../../core/project-config-loader');
    const loadSpy = jest.spyOn(ProjectConfigLoader.prototype, 'load');
    const root = createProjectFixture({ name: 'harness-retire-test' });
    loadSpy.mockClear();

    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(loadSpy).toHaveBeenCalledTimes(1);

    loadSpy.mockClear();
    retireConstraint(root, 'capability_sync', { now: new Date('2026-08-09T00:00:00.000Z') });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    loadSpy.mockRestore();
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

  it('--yes 直达 error 级退役：打印额外警示并落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    await constraintsRetire('docs_freshness', { projectPath: root, reason: '直接退役', yes: true }, io);

    const output = io.outText();
    expect(output).toContain('error 级约束');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.docs_freshness.enabled).toBe(false);
  });

  it('--yes 直达 warning 级退役：不打印 error 级警示并落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    await constraintsRetire('capability_sync', { projectPath: root, reason: '直接退役', yes: true }, io);

    const output = io.outText();
    expect(output).not.toContain('是一条 error 级约束');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.capability_sync.enabled).toBe(false);
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

  it('候选编号选择 + error 级二次确认拒绝 → 不落盘', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    // 无 trace → 候选全部为零触发，1 号候选是第一条 error 级（no_completion_without_verification）
    const streams = makeIo(['1', 'n']); // 选 1 号 → error 级确认拒绝
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
      .flatMap(c => [
        { constraintId: c.id, result: 'pass' as const },
        { constraintId: c.id, result: 'pass' as const, timestamp: 1700000001000 },
        { constraintId: c.id, result: 'fail' as const, timestamp: 1700000002000 },
      ]);
    writeProjectTraces(root, healthy);

    const streams = makeIo(['capability_sync', '误报太多', 'y']);
    const printed = captureLog();
    await runRetireInteractive(root, streams);
    streams.done();
    printed.restore();

    const output = printed.text() + streams.text();
    expect(output).toContain('没有退役候选');
    expect(output).toContain('已退役');

    const config = readConfig(root);
    expect(config.constraints.capability_sync.enabled).toBe(false);
    expect(config.constraints.capability_sync.retired.reason).toBe('误报太多');
  });

  it('坏行 fixture：候选列表前告知损坏行数（决策依据不完整不静默，harness#100）', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const dir = path.join(root, '.harness', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'traces.log'),
      '{"constraintId":"a","severity":"error","timestamp":1700000000000,"result":"pass"}\n{bad json\n{also bad\n',
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
      '{"constraintId":"a","severity":"error","timestamp":1700000000000,"result":"pass"}\n{bad json\n',
      'utf-8'
    );

    const directIo = captureIO();
    await constraintsRetire('no_hardcoded_credentials', { projectPath: root, yes: true }, directIo);

    expect(directIo.errText()).toContain('1 行损坏');
    // 告知不挤动结果正文：退役结论仍在 stdout
    expect(directIo.outText()).toContain('已退役');
    expect(readConfig(root).constraints.no_hardcoded_credentials.enabled).toBe(false);
  });

  it('无候选 → 手动输入未知 id → 提示不存在并取消', async () => {
    const root = createProjectFixture({ name: 'harness-retire-test' });
    const healthy = getEffectiveConstraints(root)
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
