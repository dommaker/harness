/**
 * core 约束变更面（harness#198）：retire / reactivate / disable 库函数
 *
 * 从 cli 命令模块原样搬入 core（签名与状态联合不变），cli 命令改薄壳。
 * 知识沉淀写口按 harness#88 注入纪律由调用方经 `openKnowledgeStore` 工厂注入——
 * core 不 value-import 知识层；缺省（未注入）只落 config.yml、不写沉淀。
 *
 * 使用真实临时目录 + 内存 sink。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  retireConstraint,
  reactivateConstraint,
  disableConstraint,
  findRetireTarget,
  type LifecycleKnowledgeSink,
} from '../constraint-lifecycle';
import type { KnowledgeEntry } from '../../knowledge/types';
import { getEffectiveConstraints } from '../effective-constraints';
import { createProjectFixture, writeProjectConfig, writeProjectTraces } from '../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

const APP_YML = [
  'constraints:',
  '  - id: app_no_internal_url',
  '    rule: Web code must not contain internal URLs',
  '    checker: regex-scan',
  '    params:',
  "      pattern: 'https?://10\\.'",
  '    severity: warning',
  '    message: 检测到内网地址',
  '',
].join('\n');

function appFixture(configYml?: string): string {
  return createProjectFixture({
    name: 'harness-lifecycle-test',
    config: configYml,
    files: { [path.join('.harness', 'constraints.yml')]: APP_YML },
  });
}

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8'));
}

/** 内存知识写口：记录 save 调用，baseDir 固定 */
function fakeSink(): LifecycleKnowledgeSink & { entries: KnowledgeEntry[] } {
  const entries: KnowledgeEntry[] = [];
  return {
    entries,
    save(entry: KnowledgeEntry) {
      entries.push(entry);
    },
    getBaseDir() {
      return '/fake/kb';
    },
  };
}

describe('findRetireTarget（库面）', () => {
  it('内置约束 → source:builtin；应用层 → source:app；未知 → undefined', () => {
    const root = appFixture();
    expect(findRetireTarget('capability_sync', root)?.source).toBe('builtin');
    expect(findRetireTarget('app_no_internal_url', root)?.source).toBe('app');
    expect(findRetireTarget('ghost', root)).toBeUndefined();
  });
});

describe('retireConstraint（库面）', () => {
  it('config.yml 落墓碑（enabled:false + retired 元数据），沉淀经注入 sink 落盘', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    writeProjectTraces(root, [
      { constraintId: 'no_hardcoded_credentials', result: 'pass' },
      { constraintId: 'no_hardcoded_credentials', result: 'fail', timestamp: 1700000002000 },
    ]);
    const sink = fakeSink();

    const result = retireConstraint(root, 'no_hardcoded_credentials', {
      reason: '由 secret 扫描工具链覆盖',
      now: FIXED_NOW,
      openKnowledgeStore: () => sink,
    });

    expect(result.status).toBe('retired');
    expect(result.isError).toBe(true);
    expect(result.knowledgeEntryId).toBe('constraint-retired-no_hardcoded_credentials');
    expect(result.knowledgeBaseDir).toBe('/fake/kb');

    const entry = readConfig(root).constraints.no_hardcoded_credentials;
    expect(entry.enabled).toBe(false);
    expect(entry.retired.at).toBe(FIXED_NOW.toISOString());
    expect(entry.retired.reason).toBe('由 secret 扫描工具链覆盖');
    expect(entry.retired.stats.total).toBe(2);
    expect(entry.retired.stats.fail).toBe(1);

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].id).toBe('constraint-retired-no_hardcoded_credentials');
    expect(sink.entries[0].tags).toContain('constraint-retired');
    expect(sink.entries[0].consumptionMode).toBe('signal');
    expect(getEffectiveConstraints(root).some(c => c.id === 'no_hardcoded_credentials')).toBe(false);
  });

  it('未注入 sink（缺省）：config.yml 照落，不写沉淀、结果不带知识字段', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    const result = retireConstraint(root, 'capability_sync', { now: FIXED_NOW });

    expect(result.status).toBe('retired');
    expect(result.knowledgeEntryId).toBeUndefined();
    expect(result.knowledgeBaseDir).toBeUndefined();
    expect(readConfig(root).constraints.capability_sync.enabled).toBe(false);
  });

  it('应用层约束退休：tags 加 source:app，constraints.yml 条文保留', () => {
    const root = appFixture();
    const ymlBefore = fs.readFileSync(path.join(root, '.harness', 'constraints.yml'), 'utf-8');
    const sink = fakeSink();

    const result = retireConstraint(root, 'app_no_internal_url', {
      now: FIXED_NOW,
      openKnowledgeStore: () => sink,
    });

    expect(result.status).toBe('retired');
    expect(sink.entries[0].tags).toContain('source:app');
    expect(fs.readFileSync(path.join(root, '.harness', 'constraints.yml'), 'utf-8')).toBe(ymlBefore);
  });

  it('already_retired 幂等：不覆盖墓碑、不调 sink', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    retireConstraint(root, 'capability_sync', { reason: '第一次', now: FIXED_NOW });
    const sink = fakeSink();

    const second = retireConstraint(root, 'capability_sync', {
      reason: '第二次',
      now: new Date('2026-08-09T00:00:00.000Z'),
      openKnowledgeStore: () => sink,
    });

    expect(second.status).toBe('already_retired');
    expect(readConfig(root).constraints.capability_sync.retired.reason).toBe('第一次');
    expect(sink.entries).toHaveLength(0);
  });

  it('裸 disabled 被退休流程接管：补墓碑 + 沉淀', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    writeProjectConfig(root, 'constraints:\n  capability_sync:\n    enabled: false\n');
    const sink = fakeSink();

    const result = retireConstraint(root, 'capability_sync', {
      now: FIXED_NOW,
      openKnowledgeStore: () => sink,
    });

    expect(result.status).toBe('retired');
    expect(readConfig(root).constraints.capability_sync.retired).toBeDefined();
    expect(sink.entries).toHaveLength(1);
  });

  it('unknown_id：不落盘、不调 sink', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    const sink = fakeSink();
    const result = retireConstraint(root, 'ghost', { openKnowledgeStore: () => sink });

    expect(result.status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
    expect(sink.entries).toHaveLength(0);
  });
});

describe('reactivateConstraint（库面）', () => {
  it('删墓碑回生效集，复活沉淀经注入 sink 落盘（不改历史）', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    const sink = fakeSink();

    const result = reactivateConstraint(root, 'capability_sync', {
      reason: '误退',
      now: new Date('2026-08-10T00:00:00.000Z'),
      openKnowledgeStore: () => sink,
    });

    expect(result.status).toBe('reactivated');
    expect(result.knowledgeEntryId).toBe('constraint-reactivated-capability_sync');
    expect(readConfig(root).constraints?.capability_sync).toBeUndefined();
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(true);
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].id).toBe('constraint-reactivated-capability_sync');
    expect(sink.entries[0].tags).toContain('constraint-reactivated');
  });

  it('未注入 sink（缺省）：墓碑照删，不写沉淀', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });

    const result = reactivateConstraint(root, 'capability_sync', { now: FIXED_NOW });

    expect(result.status).toBe('reactivated');
    expect(result.knowledgeEntryId).toBeUndefined();
  });

  it('裸 disabled / 未退休 → not_retired，零落盘', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    writeProjectConfig(root, 'constraints:\n  capability_sync:\n    enabled: false\n');
    const before = fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8');
    const sink = fakeSink();

    const result = reactivateConstraint(root, 'capability_sync', { openKnowledgeStore: () => sink });

    expect(result.status).toBe('not_retired');
    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe(before);
    expect(sink.entries).toHaveLength(0);
  });

  it('unknown_id → unknown_id', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    expect(reactivateConstraint(root, 'ghost').status).toBe('unknown_id');
  });
});

describe('disableConstraint（库面）', () => {
  it('裸禁用：enabled:false 无墓碑，生效集缩小', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });

    const result = disableConstraint(root, 'capability_sync');

    expect(result.status).toBe('disabled');
    const entry = readConfig(root).constraints.capability_sync;
    expect(entry.enabled).toBe(false);
    expect(entry.retired).toBeUndefined();
    expect(getEffectiveConstraints(root).some(c => c.id === 'capability_sync')).toBe(false);
  });

  it('already_disabled 幂等', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    disableConstraint(root, 'capability_sync');
    expect(disableConstraint(root, 'capability_sync').status).toBe('already_disabled');
  });

  it('retired 墓碑不动 → already_retired', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    retireConstraint(root, 'capability_sync', { now: FIXED_NOW });
    expect(disableConstraint(root, 'capability_sync').status).toBe('already_retired');
  });

  it('unknown_id → unknown_id，零落盘', () => {
    const root = createProjectFixture({ name: 'harness-lifecycle-test' });
    expect(disableConstraint(root, 'ghost').status).toBe('unknown_id');
    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });
});
