/**
 * harness constraints reactivate 测试（ADR-0032 决策 6.5，票 02 断点 5）
 *
 * 执行逻辑（reactivateConstraint，纯函数化）：墓碑段删除、复活沉淀条目、
 * not_retired / unknown_id 保护、旧 retired 沉淀不改历史。
 * CLI 直达（constraintsReactivate）：--yes 人确认闸门。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { retireConstraint } from '../constraints-retire';
import { reactivateConstraint, constraintsReactivate, printReactivateResult } from '../constraints-reactivate';
import { createProjectFixture, writeProjectConfig } from '../../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');
const REACTIVATE_NOW = new Date('2026-09-01T08:00:00.000Z');

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8'));
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
  // 复活沉淀写口与 retire 同一解析点：不隔离会写进真实用户主目录
  process.env.KNOWLEDGE_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reactivate-kb-'));
});
afterEach(() => {
  fs.rmSync(process.env.KNOWLEDGE_BASE_DIR!, { recursive: true, force: true });
  delete process.env.KNOWLEDGE_BASE_DIR;
});

describe('reactivateConstraint 执行逻辑', () => {
  it('复活落盘：config.yml 墓碑段删除，约束回到生效集', () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    retireConstraint(root, 'capability_sync', { reason: '先退', now: FIXED_NOW });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);

    const result = reactivateConstraint(root, 'capability_sync', { reason: '误退', now: REACTIVATE_NOW });

    expect(result.status).toBe('reactivated');
    const config = readConfig(root);
    expect(config.constraints?.capability_sync).toBeUndefined();
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
  });

  it('KnowledgeStore 写复活条目：引用原 retired 条目 + 复活原因 + signal 模式；旧沉淀不改历史', () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    retireConstraint(root, 'capability_sync', { reason: '先退', now: FIXED_NOW });

    const result = reactivateConstraint(root, 'capability_sync', { reason: '模型能力回退，仍需兜底', now: REACTIVATE_NOW });

    expect(result.status).toBe('reactivated');
    expect(result.knowledgeEntryId).toBe('constraint-reactivated-capability_sync');
    expect(result.knowledgeBaseDir).toBe(process.env.KNOWLEDGE_BASE_DIR);

    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    const entry = store.get('constraint-reactivated-capability_sync');
    expect(entry).toBeDefined();
    expect(entry!.consumptionMode).toBe('signal');
    expect(entry!.origin).toBe('human');
    expect(entry!.tags).toContain('constraint-reactivated');
    expect(entry!.tags).toContain('constraint:capability_sync');
    expect(entry!.content).toContain('constraint-retired-capability_sync');
    expect(entry!.content).toContain('模型能力回退，仍需兜底');
    expect(entry!.content).toContain(REACTIVATE_NOW.toISOString());

    // 不改历史：旧 retired 沉淀原样保留（原因仍是"先退"）
    const retired = store.get('constraint-retired-capability_sync');
    expect(retired).toBeDefined();
    expect(retired!.content).toContain('先退');
  });

  it('裸 disable（enabled:false 无 retired 墓碑）：not_retired，不落盘不吞配置', () => {
    const root = createProjectFixture({
      name: 'harness-reactivate-test',
      config: 'constraints:\n  capability_sync:\n    enabled: false\n',
    });

    const result = reactivateConstraint(root, 'capability_sync', { now: REACTIVATE_NOW });

    expect(result.status).toBe('not_retired');
    // 配置原样保留（裸 disable 的处置权在用户，reactivate 不代为"清理"）
    expect(readConfig(root).constraints.capability_sync.enabled).toBe(false);
    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    expect(store.get('constraint-reactivated-capability_sync')).toBeUndefined();
  });

  it('从未配置的约束：not_retired，不落盘任何文件', () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });

    const result = reactivateConstraint(root, 'capability_sync', { now: REACTIVATE_NOW });

    expect(result.status).toBe('not_retired');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('未知 id：unknown_id，不落盘任何文件', () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    const result = reactivateConstraint(root, 'not_a_constraint', { now: REACTIVATE_NOW });
    expect(result.status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('复活结果打印：git 仓内附 commit 提示，非 git 目录不提示（票 02 断点 4）', () => {
    const gitRoot = createProjectFixture({ name: 'harness-reactivate-test', files: { '.git/HEAD': 'ref: refs/heads/master\n' } });
    retireConstraint(gitRoot, 'capability_sync', { now: FIXED_NOW });
    const inGit = reactivateConstraint(gitRoot, 'capability_sync', { now: REACTIVATE_NOW });
    printReactivateResult(inGit, io, gitRoot);
    expect(io.outText()).toContain('git add .harness/config.yml');

    const plainRoot = createProjectFixture({ name: 'harness-reactivate-test' });
    retireConstraint(plainRoot, 'capability_sync', { now: FIXED_NOW });
    const plainIo = captureIO();
    const notInGit = reactivateConstraint(plainRoot, 'capability_sync', { now: REACTIVATE_NOW });
    printReactivateResult(notInGit, plainIo, plainRoot);
    expect(plainIo.outText()).not.toContain('git add');
  });
});

describe('constraintsReactivate 非交互直达', () => {
  it('无 --yes 直达：报错 + 非零退出码 + 不落盘任何文件（人确认闸门）', async () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });

    const result = await constraintsReactivate('capability_sync', { projectPath: root, reason: '误退' }, io);

    expect(io.errText()).toContain('--yes');
    expect(result.kind).toBe('usage-error');
    // 墓碑原样在，复活条目未写
    expect(readConfig(root).constraints.capability_sync.retired).toBeDefined();
    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    expect(store.get('constraint-reactivated-capability_sync')).toBeUndefined();
  });

  it('--yes 直达复活：落盘并打印结果', async () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    retireConstraint(root, 'capability_sync', { reason: '先退', now: FIXED_NOW });

    const result = await constraintsReactivate('capability_sync', { projectPath: root, reason: '误退', yes: true }, io);

    expect(result.kind).toBe('ok');
    expect(io.outText()).toContain('已复活');
    expect(readConfig(root).constraints?.capability_sync).toBeUndefined();
  });

  it('--yes 直达无墓碑：明确提示 not_retired 语义', async () => {
    const root = createProjectFixture({ name: 'harness-reactivate-test' });
    writeProjectConfig(root, 'constraints:\n  capability_sync:\n    enabled: false\n');

    const result = await constraintsReactivate('capability_sync', { projectPath: root, yes: true }, io);

    expect(result.kind).toBe('skip');
    expect(io.outText()).toContain('无 retired 墓碑');
  });

  it('缺 id：usage-error 提示用法', async () => {
    const result = await constraintsReactivate(undefined, { yes: true }, io);
    expect(result.kind).toBe('usage-error');
    expect(io.errText()).toContain('用法');
  });
});
