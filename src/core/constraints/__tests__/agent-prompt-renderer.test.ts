/**
 * trigger 参数化约束分组渲染 API 测试（H6/G6，收编 studio prompt-injection.ts）
 *
 * 语义：
 * - 入参 = 触发条件（单 trigger 或数组），无 role 概念（role→trigger 路由留 studio）
 * - 数据源 = getEffectiveConstraints（内置 → preset → config.yml 禁用 → custom 追加 → scenes 过滤）
 * - 输出按层级分组：铁律 → 指导原则 → 行为提示；无 promptInjection 的约束不渲染
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderConstraintsByTrigger } from '../agent-prompt-renderer';
import { renderConstraintsByTrigger as PublicRenderConstraintsByTrigger } from '../../../index';

describe('公开导出（根 barrel）', () => {
  test('renderConstraintsByTrigger 经 src/index.ts 公开导出', () => {
    expect(PublicRenderConstraintsByTrigger).toBe(renderConstraintsByTrigger);
  });
});

/** 创建临时项目目录，可按相对路径写入 .harness/config.yml 等夹具文件 */
function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h6-render-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
  return dir;
}

describe('renderConstraintsByTrigger', () => {
  test('内置约束按层级分组渲染：铁律 → 指导原则 → 行为提示', () => {
    const projectRoot = makeProject({});
    const out = renderConstraintsByTrigger('code_implementation', { projectRoot });

    expect(out).toContain('## 行为约束（前置声明）');
    expect(out).toContain('### 铁律（绝对禁止，无例外）');
    expect(out).toContain('- **no_completion_without_verification**:');
    expect(out).toContain('### 指导原则（优先建议）');
    expect(out).toContain('- **no_hardcoded_credentials**:');
    expect(out).toContain('### 行为提示');
    expect(out).toContain('- **no_code_without_test**:');

    // 分组顺序：铁律 < 指导原则 < 行为提示
    const ironIdx = out.indexOf('### 铁律（绝对禁止，无例外）');
    const guideIdx = out.indexOf('### 指导原则（优先建议）');
    const promptIdx = out.indexOf('### 行为提示');
    expect(ironIdx).toBeGreaterThanOrEqual(0);
    expect(guideIdx).toBeGreaterThan(ironIdx);
    expect(promptIdx).toBeGreaterThan(guideIdx);
  });

  test('无 promptInjection 的约束不渲染（即使 trigger 匹配）', () => {
    const projectRoot = makeProject({});
    // docs_freshness / capability_sync / context_doc_sync 无 promptInjection
    const out = renderConstraintsByTrigger('module_modification', { projectRoot });

    expect(out).not.toContain('- **docs_freshness**:');
    expect(out).not.toContain('- **capability_sync**:');
    expect(out).not.toContain('- **context_doc_sync**:');
  });

  test('支持 trigger 数组入参，仅匹配交集约束', () => {
    const projectRoot = makeProject({});
    const out = renderConstraintsByTrigger(['test_creation'], { projectRoot });

    expect(out).toContain('- **no_test_simplification**:');
    // no_completion_without_verification 的 trigger 为 code_implementation，不匹配
    expect(out).not.toContain('- **no_completion_without_verification**:');
  });

  test('无匹配约束返回空字符串', () => {
    const projectRoot = makeProject({});
    expect(renderConstraintsByTrigger('nonexistent_trigger_xyz', { projectRoot })).toBe('');
    expect(renderConstraintsByTrigger([], { projectRoot })).toBe('');
  });

  test('config.yml 禁用的约束不进入渲染（生效集数据源）', () => {
    const projectRoot = makeProject({
      '.harness/config.yml': [
        'constraints:',
        '  no_hardcoded_credentials:',
        '    enabled: false',
        '',
      ].join('\n'),
    });
    const out = renderConstraintsByTrigger('code_implementation', { projectRoot });

    expect(out).not.toContain('- **no_hardcoded_credentials**:');
    // 同 trigger 的其它约束仍渲染
    expect(out).toContain('- **no_completion_without_verification**:');
  });

  test('custom 约束追加进生效集并参与分组渲染', () => {
    const projectRoot = makeProject({
      '.harness/config.yml': [
        'custom_constraints:',
        '  my_custom_rule:',
        '    level: prompt',
        '    trigger: code_implementation',
        '    rule: CUSTOM RULE',
        '    message: 自定义约束消息',
        '    promptInjection: 自定义行为提示文本',
        '',
      ].join('\n'),
    });
    const out = renderConstraintsByTrigger('code_implementation', { projectRoot });

    expect(out).toContain('- **my_custom_rule**: 自定义行为提示文本');
    const promptIdx = out.indexOf('### 行为提示');
    const customIdx = out.indexOf('- **my_custom_rule**:');
    expect(customIdx).toBeGreaterThan(promptIdx);
  });

  test('scenes 过滤：带 appliesTo 的场景专属 prompt 默认不渲染，声明场景后渲染', () => {
    // no_skill_without_test：appliesTo ['agent-skill']，trigger module_creation
    const plain = makeProject({});
    expect(renderConstraintsByTrigger('module_creation', { projectRoot: plain }))
      .not.toContain('- **no_skill_without_test**:');

    const withScene = makeProject({
      '.harness/config.yml': 'scenes:\n  - agent-skill\n',
    });
    expect(renderConstraintsByTrigger('module_creation', { projectRoot: withScene }))
      .toContain('- **no_skill_without_test**:');
  });
});
