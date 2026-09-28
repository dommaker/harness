/**
 * harness constraints disable 测试（harness#190，ADR-0032 决策 6.6 的另一侧）
 *
 * 裸禁用 = config.yml `constraints.<id>.enabled:false`，无 retired 墓碑、无知识沉淀
 * （墓碑与沉淀是 retire 专有语义）。幂等 already_disabled；retired 墓碑不接管不动；
 * 写后验证生效集已缩小，失败回滚（与下游消费方 applier 同一纪律）。
 * CLI 直达（constraintsDisable）：--yes 人确认闸门，与 retire/reactivate 同形。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { captureIO, type CapturingIO } from '../../command-contract';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import * as effectiveConstraints from '../../../core/effective-constraints';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { retireConstraint } from '../constraints-retire';
import { disableConstraint, constraintsDisable, printDisableResult } from '../constraints-disable';
import { createProjectFixture, writeProjectConfig } from '../../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8'));
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
  // disable 不写沉淀——隔离知识库根以便断言「零沉淀」
  process.env.KNOWLEDGE_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-disable-kb-'));
});
afterEach(() => {
  fs.rmSync(process.env.KNOWLEDGE_BASE_DIR!, { recursive: true, force: true });
  delete process.env.KNOWLEDGE_BASE_DIR;
});

describe('disableConstraint 执行逻辑', () => {
  it('禁用落盘：config.yml enabled:false 无 retired 段，约束离开生效集', () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('disabled');
    const entry = readConfig(root).constraints.capability_sync;
    expect(entry.enabled).toBe(false);
    expect(entry.retired).toBeUndefined();
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);
  });

  it('零知识沉淀：disable 不写任何 KnowledgeStore 条目（沉淀是 retire 专有语义）', () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('disabled');
    const store = new FileKnowledgeStore({ baseDir: process.env.KNOWLEDGE_BASE_DIR! });
    expect(store.list()).toHaveLength(0);
  });

  it('幂等：裸 enabled:false 已禁用 → already_disabled，配置原样不动', () => {
    const root = createProjectFixture({
      name: 'harness-disable-test',
      config: 'constraints:\n  capability_sync:\n    enabled: false\n',
    });
    const before = fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8');

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('already_disabled');
    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe(before);
  });

  it('retired 墓碑不接管：already_retired，墓碑原样保留（disable 不吞 retire 语义）', () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });
    retireConstraint(root, 'capability_sync', { reason: '先退', now: FIXED_NOW });

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('already_retired');
    const entry = readConfig(root).constraints.capability_sync;
    expect(entry.enabled).toBe(false);
    expect(entry.retired).toBeDefined();
    expect(entry.retired.reason).toBe('先退');
  });

  it('未知 id：unknown_id，不落盘任何文件', () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });

    const result = disableConstraint(root, 'not_a_constraint');

    expect(result.status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('同文件其他约束条目不受影响', () => {
    const root = createProjectFixture({
      name: 'harness-disable-test',
      config: 'constraints:\n  docs_freshness:\n    enabled: false\n',
    });

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('disabled');
    const config = readConfig(root);
    expect(config.constraints.docs_freshness.enabled).toBe(false);
    expect(config.constraints.capability_sync.enabled).toBe(false);
  });

  it('禁用结果打印：git 仓内附 commit 提示，非 git 目录不提示', () => {
    const gitRoot = createProjectFixture({ name: 'harness-disable-test', files: { '.git/HEAD': 'ref: refs/heads/master\n' } });
    printDisableResult(disableConstraint(gitRoot, 'capability_sync'), io, gitRoot);
    expect(io.outText()).toContain('git add .harness/config.yml');

    const plainRoot = createProjectFixture({ name: 'harness-disable-test' });
    const plainIo = captureIO();
    printDisableResult(disableConstraint(plainRoot, 'capability_sync'), plainIo, plainRoot);
    expect(plainIo.outText()).not.toContain('git add');
  });
});

describe('写后验证失败回滚（harness#190 AC：失败回滚）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('生效集仍含该约束 → verify_failed，config.yml 恢复备份逐字节', () => {
    const root = createProjectFixture({
      name: 'harness-disable-test',
      config: 'constraints:\n  docs_freshness:\n    enabled: false\n',
    });
    const before = fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8');
    // 强制验证失败：生效集仍含该 id（spy 只钉本用例，afterEach 恢复）
    jest.spyOn(effectiveConstraints, 'getEffectiveConstraints').mockReturnValue([{ id: 'capability_sync' } as any]);

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('verify_failed');
    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe(before);
  });

  it('原本无 config.yml → verify_failed 时删除新建文件，回到零落盘', () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });
    jest.spyOn(effectiveConstraints, 'getEffectiveConstraints').mockReturnValue([{ id: 'capability_sync' } as any]);

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('verify_failed');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('verify_failed 打印：fail kind + 回滚告知走 stderr', () => {
    const cmdResult = printDisableResult({ id: 'capability_sync', status: 'verify_failed' }, io);
    expect(cmdResult.kind).toBe('fail');
    expect(io.errText()).toContain('已回滚');
  });
});

describe('constraintsDisable 非交互直达', () => {
  it('无 --yes 直达：报错 + 非零退出码 + 不落盘任何文件（人确认闸门）', async () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });

    const result = await constraintsDisable('capability_sync', { projectPath: root }, io);

    expect(io.errText()).toContain('--yes');
    expect(result.kind).toBe('usage-error');
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
  });

  it('--yes 直达禁用：落盘并打印结果', async () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });

    const result = await constraintsDisable('capability_sync', { projectPath: root, yes: true }, io);

    expect(result.kind).toBe('ok');
    expect(io.outText()).toContain('已禁用');
    expect(readConfig(root).constraints.capability_sync.enabled).toBe(false);
  });

  it('--yes 直达已禁用：幂等 skip', async () => {
    const root = createProjectFixture({ name: 'harness-disable-test' });
    writeProjectConfig(root, 'constraints:\n  capability_sync:\n    enabled: false\n');

    const result = await constraintsDisable('capability_sync', { projectPath: root, yes: true }, io);

    expect(result.kind).toBe('skip');
    expect(io.outText()).toContain('已处于禁用状态');
  });

  it('缺 id：usage-error 提示用法', async () => {
    const result = await constraintsDisable(undefined, { yes: true }, io);
    expect(result.kind).toBe('usage-error');
    expect(io.errText()).toContain('用法');
  });
});

describe('应用层约束禁用（ADR-0033 同路径）', () => {
  const APP_YML = [
    'constraints:',
    '  - id: app_no_internal_url',
    '    rule: Web code must not contain internal URLs',
    '    checker: regex-scan',
    '    params:',
    "      pattern: 'https?://10\\.'",
    '    severity: warning',
    '',
  ].join('\n');

  it('应用层 check 约束可禁用：config.yml enabled:false，离开生效集，constraints.yml 条文保留', () => {
    const root = createProjectFixture({
      name: 'harness-disable-test',
      files: { [path.join('.harness', 'constraints.yml')]: APP_YML },
    });
    expect(getEffectiveConstraints(root).some(c => c.id === 'app_no_internal_url')).toBe(true);

    const result = disableConstraint(root, 'app_no_internal_url');

    expect(result.status).toBe('disabled');
    expect(readConfig(root).constraints.app_no_internal_url.enabled).toBe(false);
    expect(getEffectiveConstraints(root).some(c => c.id === 'app_no_internal_url')).toBe(false);
    // 条文保留不删（禁用 = 停用不是删除）
    expect(fs.readFileSync(path.join(root, '.harness', 'constraints.yml'), 'utf-8')).toBe(APP_YML);
  });
});
