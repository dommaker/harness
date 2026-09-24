/**
 * 应用层约束加载器（ADR-0033 两层约束模型）测试
 *
 * 覆盖面：
 * - loadAppConstraints 校验分支（文件不存在 / 坏 YAML / 缺必填字段 / id 无前缀 /
 *   id 与内置冲突 / 未知模板 / validateParams 失败 / trigger 形状 / channel 枚举）
 * - channel 通道（ADR-0035）：缺省 gate；非 gate（discipline/workflow）允许无 checker，
 *   填写了仍按模板校验；gate 无 checker 依旧抛错（闭环不松绑）
 * - 实例化缺省（source='app'、kind='check'、channel='gate'、trigger 缺省全操作集、message 回落 rule）
 * - memo 口径与 RunEnv.rawConfig 同形（同一观察面至多读一次；路径入参每次读当下内容）
 * - 合并链（mergeConstraints / getEffectiveConstraints）：应用层并入 +
 *   config.yml enabled:false / retired 墓碑对应用层 id 同口径生效 + 不进 unknownIds
 *
 * 模板注册表（TEMPLATES）本票为空表：测试用替身模板注册/注销，
 * 真实模板（regex-scan / file-exists）随子项 2 进场。
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { loadAppConstraints } from '../core/app-constraints-loader';
import { getEffectiveConstraints, lintEffectiveConfig, getMergedConstraintsConfig } from '../core/effective-constraints';
import { CONSTRAINTS } from '../core/constraints/definitions';
import { createRunEnv } from '../core/constraints/run-env';
import { TEMPLATES, type TemplatedCheckerFactory } from '../core/constraints/checkers';
import { createProjectFixture } from '../test-setup/project-fixture';

const CONSTRAINTS_YML = path.join('.harness', 'constraints.yml');

const BUILTIN_TOTAL = Object.keys(CONSTRAINTS).length;

/** 替身模板：validateParams 要求 params.must 为 true（其余参数放行） */
const FAKE_TEMPLATE: TemplatedCheckerFactory = {
  validateParams: (params) => (params.must === true ? [] : ['params.must 必须为 true']),
  create: (id) => ({ id, evaluate: () => true }),
};

function fixture(constraintsYml?: string, configYml?: string): string {
  return createProjectFixture({
    name: 'app-constraints',
    config: configYml,
    files: constraintsYml !== undefined ? { [CONSTRAINTS_YML]: constraintsYml } : undefined,
  });
}

const VALID = `
constraints:
  - id: app_no_internal_url
    rule: Web code must not contain internal URLs
    checker: fake-template
    params:
      must: true
    severity: warning
    message: 检测到内网地址
`;

// 替身模板逐用例注册、统一注销：不污染模板注册表（其他套件断言注册表构成）
afterEach(() => {
  TEMPLATES.delete('fake-template');
});

function registerFake(): void {
  TEMPLATES.set('fake-template', FAKE_TEMPLATE);
}

describe('loadAppConstraints 校验分支', () => {
  it('文件不存在 = 无应用层约束，正常返回空', () => {
    expect(loadAppConstraints(fixture())).toEqual([]);
  });

  it('合法条目 → Constraint（source=app，kind=check，channel 缺省 gate，缺省 trigger=全操作集，message 回落 rule）', () => {
    registerFake();
    const constraints = loadAppConstraints(fixture(VALID));

    expect(constraints).toHaveLength(1);
    const c = constraints[0];
    expect(c).toMatchObject({
      id: 'app_no_internal_url',
      kind: 'check',
      channel: 'gate',
      rule: 'Web code must not contain internal URLs',
      severity: 'warning',
      message: '检测到内网地址',
      source: 'app',
      checker: 'fake-template',
      params: { must: true },
    });
    // 缺省 trigger = 每次 check 都评估
    expect(Array.isArray(c.trigger)).toBe(true);
    expect(c.trigger).toContain('commit');
    expect(c.trigger).toContain('file_modification');
  });

  it('坏 YAML → 抛错（配置坏不能静默放行）', () => {
    const root = fixture('constraints:\n  - id: app_x\n    bad indent: [');
    expect(() => loadAppConstraints(root)).toThrow(/YAML 解析失败/);
  });

  it('id 无 app_ 前缀 → 抛错', () => {
    registerFake();
    const root = fixture(`
constraints:
  - id: no_prefix
    rule: r
    checker: fake-template
    severity: warning
`);
    expect(() => loadAppConstraints(root)).toThrow(/app_ 前缀/);
  });

  it('id 与内置约束冲突 → 抛错', () => {
    registerFake();
    const builtinId = Object.keys(CONSTRAINTS)[0];
    const root = fixture(`
constraints:
  - id: ${builtinId}
    rule: r
    checker: fake-template
    severity: warning
`);
    expect(() => loadAppConstraints(root)).toThrow(/与内置约束冲突/);
  });

  it('checker 模板未注册 → 抛错（加载期闭环）', () => {
    const root = fixture(`
constraints:
  - id: app_unknown_template
    rule: r
    checker: not-a-template
    severity: warning
`);
    expect(() => loadAppConstraints(root)).toThrow(/未注册/);
  });

  it.each([
    ['id', 'rule: r\nchecker: fake-template\nseverity: warning'],
    ['rule', 'id: app_x\nchecker: fake-template\nseverity: warning'],
    ['checker', 'id: app_x\nrule: r\nseverity: warning'],
    ['severity', 'id: app_x\nrule: r\nchecker: fake-template'],
  ])('缺必填字段 %s → 抛错', (_field, entryYaml) => {
    registerFake();
    const root = fixture(`constraints:\n  - ${entryYaml.replace(/\n/g, '\n    ')}\n`);
    expect(() => loadAppConstraints(root)).toThrow(/缺必填字段/);
  });

  it('severity 取值非法 → 抛错', () => {
    registerFake();
    const root = fixture(`
constraints:
  - id: app_x
    rule: r
    checker: fake-template
    severity: critical
`);
    expect(() => loadAppConstraints(root)).toThrow(/severity/);
  });

  it('channel 取值非法 → 抛错', () => {
    registerFake();
    const root = fixture(`
constraints:
  - id: app_x
    rule: r
    checker: fake-template
    severity: warning
    channel: audit
`);
    expect(() => loadAppConstraints(root)).toThrow(/channel/);
  });

  it.each(['discipline', 'workflow'] as const)('channel: %s 无 checker → 校验通过（ADR-0035 闭环收窄）', (channel) => {
    const root = fixture(`
constraints:
  - id: app_no_checker_rule
    rule: Agents must not claim done without evidence
    severity: info
    channel: ${channel}
`);
    const constraints = loadAppConstraints(root);
    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({
      id: 'app_no_checker_rule',
      channel,
      source: 'app',
    });
    expect(constraints[0].checker).toBeUndefined();
  });

  it('channel: gate（含缺省）无 checker → 抛错（闭环不松绑）', () => {
    const root = fixture(`
constraints:
  - id: app_gate_no_checker
    rule: r
    severity: warning
    channel: gate
`);
    expect(() => loadAppConstraints(root)).toThrow(/缺必填字段 checker/);
  });

  it('非 gate 条目填写了 checker 仍按模板校验（写错的模板 id 加载期暴露）', () => {
    const root = fixture(`
constraints:
  - id: app_discipline_bad_template
    rule: r
    severity: info
    channel: discipline
    checker: not-a-template
`);
    expect(() => loadAppConstraints(root)).toThrow(/未注册/);
  });

  it('无 checker 的条目携带 params → 抛错（死配置不静默放行）', () => {
    const root = fixture(`
constraints:
  - id: app_discipline_dead_params
    rule: r
    severity: info
    channel: discipline
    params:
      pattern: foo
`);
    expect(() => loadAppConstraints(root)).toThrow(/死配置/);
  });

  it('validateParams 不通过 → 抛错（参数坏早报）', () => {
    registerFake();
    const root = fixture(`
constraints:
  - id: app_bad_params
    rule: r
    checker: fake-template
    severity: warning
`);
    expect(() => loadAppConstraints(root)).toThrow(/参数校验失败/);
  });

  it('constraints 段不是数组 → 抛错；顶层缺 constraints 段 = 空', () => {
    expect(() => loadAppConstraints(fixture('constraints: notalist\n'))).toThrow(/数组/);
    expect(loadAppConstraints(fixture('preset: standard\n'))).toEqual([]);
  });

  it('memo 与 rawConfig 同形：同一 RunEnv 至多读一次（缓存同一数组引用）', () => {
    registerFake();
    const root = fixture(VALID);
    const env = createRunEnv(root);
    const first = loadAppConstraints(env);
    // 观察面命中 memo 后，文件改动在本 run 内不可见
    fs.writeFileSync(path.join(root, CONSTRAINTS_YML), 'constraints: []\n');
    expect(loadAppConstraints(env)).toBe(first);
    // 传路径 = 一次性观察面，每次读当下内容
    expect(loadAppConstraints(root)).toEqual([]);
  });
});

describe('合并链并入（ADR-0033）', () => {
  it('应用层条目并入生效集尾部（getEffectiveConstraints）', () => {
    registerFake();
    const root = fixture(VALID);
    const constraints = getEffectiveConstraints(root);
    expect(constraints).toHaveLength(BUILTIN_TOTAL + 1);
    const app = constraints.find(c => c.id === 'app_no_internal_url');
    expect(app?.source).toBe('app');
  });

  it('config.yml enabled:false 禁用应用层条目（filterEnabledEntries 天然兼容）', () => {
    registerFake();
    const root = fixture(VALID, 'constraints:\n  app_no_internal_url:\n    enabled: false\n');
    const merged = getMergedConstraintsConfig(root);
    expect(merged.constraints.app_no_internal_url).toBeUndefined();
    expect(merged.disabled).toContain('app_no_internal_url');
    // 应用层 id 是已知 id，不进 unknownIds 诊断
    expect(merged.unknownIds).toEqual([]);
  });

  it('config.yml retired 墓碑对应用层条目同样生效（随 enabled:false）', () => {
    registerFake();
    const root = fixture(
      VALID,
      'constraints:\n  app_no_internal_url:\n    enabled: false\n    retired:\n      at: 2026-09-22\n      reason: 零拦截\n'
    );
    const ids = getEffectiveConstraints(root).map(c => c.id);
    expect(ids).not.toContain('app_no_internal_url');
  });

  it('lintEffectiveConfig 不把应用层 id 报成未知', () => {
    registerFake();
    const root = fixture(VALID, 'constraints:\n  app_no_internal_url:\n    enabled: false\n');
    expect(lintEffectiveConfig(root).unknownIds).toEqual([]);
  });

  it('discipline 条目并入生效集（登记记录在名册可读，供消费方计数）', () => {
    const root = fixture(`
constraints:
  - id: app_discipline_rule
    rule: Agents must not claim done without evidence
    severity: info
    channel: discipline
`);
    const constraints = getEffectiveConstraints(root);
    const entry = constraints.find(c => c.id === 'app_discipline_rule');
    expect(entry).toMatchObject({ channel: 'discipline', source: 'app' });
  });
});
