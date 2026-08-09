/**
 * init 注入重写测试（ADR-0001 P3）
 *
 * - renderConstraintsSection 纯函数
 * - setupClaudeMdConstraints：消费生效集、幂等、尊重 config.yml 禁用与 scenes
 * - setupClaudeMdOutputStyle：标记化三种情形（无段插入 / 旧 harness 段迁移 / 用户自有段跳过）
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderConstraintsSection,
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
} from '../../../core/constraints/injection-renderer';
import {
  setupClaudeMdConstraints,
  setupClaudeMdOutputStyle,
} from '../init';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { getAllConstraints } from '../../../core/constraints/definitions';
import type { Constraint } from '../../../types/constraint';

const OUTPUT_STYLE_START = '<!-- HARNESS_OUTPUT_STYLE_START -->';
const OUTPUT_STYLE_END = '<!-- HARNESS_OUTPUT_STYLE_END -->';

const makeConstraint = (overrides: Partial<Constraint>): Constraint => ({
  id: 'x',
  kind: 'prompt',
  level: 'prompt',
  rule: 'R',
  message: 'M',
  trigger: 'manual',
  enforcement: 'none',
  ...overrides,
});

describe('renderConstraintsSection（纯函数）', () => {
  it('按 level 分组渲染，含标记与版本行', () => {
    const constraints = [
      makeConstraint({ id: 'iron_a', kind: 'check', level: 'iron_law', promptInjection: 'iron 注入' }),
      makeConstraint({ id: 'guide_a', kind: 'check', level: 'guideline', promptInjection: 'guide 注入' }),
      makeConstraint({ id: 'prompt_a', level: 'prompt', promptInjection: 'prompt 注入' }),
    ];

    const section = renderConstraintsSection(constraints, '9.9.9');

    expect(section.startsWith(`${CONSTRAINTS_START_MARKER}\n<!-- version: 9.9.9 -->\n`)).toBe(true);
    expect(section.endsWith(`${CONSTRAINTS_END_MARKER}\n`)).toBe(true);
    expect(section).toContain('### Iron Laws');
    expect(section).toContain('### Guidelines');
    expect(section).toContain('### Prompts');
    expect(section).toContain('- **iron_a**: iron 注入');
    expect(section).toContain('- **guide_a**: guide 注入');
    expect(section).toContain('- **prompt_a**: prompt 注入');
    // 分组顺序：Iron Laws → Guidelines → Prompts
    expect(section.indexOf('### Iron Laws')).toBeLessThan(section.indexOf('### Guidelines'));
    expect(section.indexOf('### Guidelines')).toBeLessThan(section.indexOf('### Prompts'));
  });

  it('无 promptInjection 的 check 条目（如 docs_freshness）不出现在注入段', () => {
    const constraints = [
      makeConstraint({ id: 'docs_freshness', kind: 'check', level: 'iron_law' }),
      makeConstraint({ id: 'iron_a', kind: 'check', level: 'iron_law', promptInjection: 'iron 注入' }),
    ];

    const section = renderConstraintsSection(constraints, '1.0.0');

    expect(section).not.toContain('docs_freshness');
    expect(section).toContain('- **iron_a**: iron 注入');
  });

  it('内置全集渲染：docs_freshness 不出现，场景 prompt 由调用方过滤后传入', () => {
    const section = renderConstraintsSection(getAllConstraints(), '1.0.0');
    expect(section).not.toContain('docs_freshness');
    expect(section).toContain('- **no_fuzzy_completion_claim**');
  });
});

describe('setupClaudeMdConstraints（消费生效集）', () => {
  let tempDir: string;
  let claudeMdPath: string;

  const writeConfig = (yaml: string) => {
    fs.mkdirSync(path.join(tempDir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.harness', 'config.yml'), yaml);
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-init-'));
    claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('CLAUDE.md 不存在时创建并写入约束段', async () => {
    await setupClaudeMdConstraints(tempDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('## Governance Rules');
    expect(content).toContain(CONSTRAINTS_START_MARKER);
    expect(content).toContain(CONSTRAINTS_END_MARKER);
    expect(content).toContain('### Iron Laws');
    expect(content).toContain('### Prompts (行为约束)');
  });

  it('连跑两次输出一致（幂等）', async () => {
    await setupClaudeMdConstraints(tempDir);
    const first = fs.readFileSync(claudeMdPath, 'utf-8');
    await setupClaudeMdConstraints(tempDir);
    const second = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(second).toBe(first);
  });

  it('标记区间外内容保持不动', async () => {
    fs.writeFileSync(claudeMdPath, '# My Project\n\n用户自定义内容\n');
    await setupClaudeMdConstraints(tempDir);
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('用户自定义内容');
  });

  it('尊重 config.yml 禁用：注入段不含被禁条目', async () => {
    writeConfig('constraints:\n  no_fuzzy_completion_claim:\n    enabled: false\n');
    await setupClaudeMdConstraints(tempDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).not.toContain('no_fuzzy_completion_claim');
    expect(content).toContain('- **no_fix_without_root_cause**');
  });

  it('scenes 缺省不注入场景专属 prompt；配置 scenes 后注入', async () => {
    writeConfig('preset: standard\n');
    await setupClaudeMdConstraints(tempDir);
    let content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).not.toContain('no_skill_without_test');

    writeConfig('preset: standard\nscenes:\n  - agent-skill\n');
    await setupClaudeMdConstraints(tempDir);
    content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('- **no_skill_without_test**');
    expect(content).not.toContain('no_model_for_deterministic');
  });

  it('注入段文本与 renderConstraintsSection(getEffectiveConstraints()) 一致', async () => {
    writeConfig('constraints:\n  no_bypass_checkpoint:\n    enabled: false\n');
    await setupClaudeMdConstraints(tempDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const start = content.indexOf(CONSTRAINTS_START_MARKER);
    const end = content.indexOf(CONSTRAINTS_END_MARKER) + CONSTRAINTS_END_MARKER.length + 1;
    const actual = content.slice(start, end);
    const version = /<!-- version: ([^ ]+) -->/.exec(content)![1];
    // P6 漂移校验同款比对：期望段（生效集渲染） vs 实际段
    expect(actual).toBe(renderConstraintsSection(getEffectiveConstraints(tempDir), version));
  });
});

describe('setupClaudeMdOutputStyle（标记化）', () => {
  let tempDir: string;
  let claudeMdPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-output-style-'));
    claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('CLAUDE.md 不存在时不创建（由 constraints 注入负责创建）', async () => {
    await setupClaudeMdOutputStyle(tempDir);
    expect(fs.existsSync(claudeMdPath)).toBe(false);
  });

  it('无 Output Style 段：插入带标记段到文件顶部，二次运行幂等', async () => {
    fs.writeFileSync(claudeMdPath, '# My Project\n\n正文\n');
    await setupClaudeMdOutputStyle(tempDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content.startsWith(OUTPUT_STYLE_START)).toBe(true);
    expect(content).toContain('## Output Style');
    expect(content).toContain(OUTPUT_STYLE_END);
    expect(content).toContain('# My Project');

    await setupClaudeMdOutputStyle(tempDir);
    expect(fs.readFileSync(claudeMdPath, 'utf-8')).toBe(content);
  });

  it('旧版 harness 无标记段（特征串匹配）：迁移为标记版', async () => {
    const legacy = [
      '## Output Style',
      '',
      'Terse like caveman. Technical substance exact. Only fluff die.',
      'Drop: articles, filler (just/really/basically), pleasantries (sure/certainly/happy to), hedging.',
      '',
      '# My Project',
      '',
    ].join('\n');
    fs.writeFileSync(claudeMdPath, legacy);

    await setupClaudeMdOutputStyle(tempDir);
    const content = fs.readFileSync(claudeMdPath, 'utf-8');

    expect(content).toContain(OUTPUT_STYLE_START);
    expect(content).toContain(OUTPUT_STYLE_END);
    expect(content).toContain('Terse like caveman');
    expect(content).toContain('# My Project');
    // 迁移后只剩一个 Output Style 标题
    expect(content.match(/^## Output Style$/gm)).toHaveLength(1);
    // 幂等
    await setupClaudeMdOutputStyle(tempDir);
    expect(fs.readFileSync(claudeMdPath, 'utf-8')).toBe(content);
  });

  it('用户自写 Output Style 段（特征串不匹配）：不动、不追加、console 提示', async () => {
    const userContent = '# My Project\n\n## Output Style\n\n用户自己的输出风格要求。\n';
    fs.writeFileSync(claudeMdPath, userContent);
    const logSpy = jest.spyOn(console, 'log');

    await setupClaudeMdOutputStyle(tempDir);

    expect(fs.readFileSync(claudeMdPath, 'utf-8')).toBe(userContent);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('跳过'));
  });
});
