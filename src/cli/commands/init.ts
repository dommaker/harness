/**
 * harness init 命令
 * 
 * 初始化项目的 harness 配置
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createExampleCheckpoint, createExampleResolutions } from './validate';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { getHarnessPackageVersion } from '../../utils/package-version';
import { getEffectiveConstraints } from '../../core/effective-constraints';
import type { GovernanceConfig } from '../../types/project-config';
import {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from '../../core/constraints/injection-renderer';
import {
  replaceStandaloneRange,
  replaceEnclosedRange,
  cutMarkerBlock,
  resolveGovernanceLanding,
  GOVERNANCE_HEADING,
} from '../../core/constraints/injection-writer';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface InitOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 预设名称 */
  preset: 'strict' | 'standard' | 'relaxed';
  /** 治理级别 */
  governance?: 'minimal' | 'standard' | 'strict';
  /** 项目类型 */
  type?: 'node-api' | 'nextjs-app' | 'python-api' | 'custom';
  /** 是否创建 Git hooks */
  gitHooks?: boolean;
  /** 是否创建 GitHub Actions */
  githubActions?: boolean;
  /** 只输出代码片段，不创建文件 */
  printSnippets?: boolean;
}

/**
 * 默认配置
 *
 * 只写有运行时消费者的字段：preset（ADR-0001 生效集链路由 mergeConstraints 消费）。
 * 历史模板里的 enabled / ironLaws.enforceErrors / ironLaws.warnWarnings /
 * validators.{checkpoint,passesGate,cso} 均为零消费者的死字段，不再写入；
 * strict/standard/relaxed 三档差异曾只存在于这些死字段上（实为两档），
 * 现在三档差异完全由 preset 键经生效集链路体现。
 */
const DEFAULT_CONFIG = {
  preset: 'standard',
};

/**
 * 预设配置
 */
const PRESETS = {
  strict: {
    ...DEFAULT_CONFIG,
    preset: 'strict',
  },
  standard: {
    ...DEFAULT_CONFIG,
    preset: 'standard',
  },
  relaxed: {
    ...DEFAULT_CONFIG,
    preset: 'relaxed',
  },
};

/**
 * 治理预设（形状 = 写入 config.yml 的 governance 段，直接用类型正本）
 */
const GOVERNANCE_PRESETS: Record<string, GovernanceConfig> = {
  minimal: {
    level: 'minimal',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: false,
      files: ['CAPABILITIES.md'],
    },
    context_files: {
      enabled: false,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: false,
    },
  },
  standard: {
    level: 'standard',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: true,
      files: ['CAPABILITIES.md', 'README.md'],
    },
    context_files: {
      enabled: true,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: false,
    },
  },
  strict: {
    level: 'strict',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: true,
      files: ['CAPABILITIES.md', 'README.md', 'CHANGELOG.md'],
    },
    context_files: {
      enabled: true,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: true,
    },
  },
};

/**
 * 初始化项目
 */
export async function init(options: InitOptions, io: CommandIO = processIO): Promise<CommandResult> {
  // 只输出代码片段
  if (options.printSnippets) {
    printSnippets(io);
    return { kind: 'ok' };
  }

  log(io, chalk.blue('🚀 初始化 harness 配置...'));

  const projectPath = options.projectPath || process.cwd();
  const configDir = path.join(projectPath, '.harness');

  // 创建配置目录
  await fs.mkdir(configDir, { recursive: true });
  log(io, chalk.gray(`配置目录: ${configDir}`));

  // 选择预设
  const preset = PRESETS[options.preset];
  log(io, chalk.gray(`预设: ${options.preset}`));

  // 合并治理配置
  const configData: Record<string, unknown> = { ...preset };
  if (options.governance) {
    configData.governance = GOVERNANCE_PRESETS[options.governance];
    log(io, chalk.gray(`治理级别: ${options.governance}`));
  }

  // 写入 harness 版本
  const pkgVersion = getHarnessPackageVersion();
  configData.harness = { version: pkgVersion };

  // 写入配置文件（harness 管理的配置，始终重新生成）
  const configPath = path.join(configDir, 'config.yml');
  const configContent = yaml.dump(configData, { indent: 2 });
  await fs.writeFile(configPath, configContent, 'utf-8');
  log(io, chalk.green(`✅ 已创建配置文件: ${configPath} (v${pkgVersion})`));

  // 创建检查点示例
  await createExampleCheckpoint(projectPath, io);

  // 创建 Resolutions（RKB 狗粮 — 约束 → 已知解法映射）
  await createExampleResolutions(projectPath, io);

  // 创建自定义约束示例
  await createCustomConstraintsExample(projectPath, io);

  // CAPABILITIES.md / CHANGELOG.md 由 sync-docs（AI 治理）管理，init 不创建

  // 创建 Git hooks
  if (options.gitHooks !== false) {
    await setupGitHooks(projectPath, io);
  }

  // 创建 GitHub Actions
  if (options.githubActions !== false) {
    await setupGitHubActions(projectPath, io);
  }

  // 治理相关文件生成
  if (options.governance) {
    await setupGovernance(projectPath, options.governance, io);
  }

  log(io);
  log(io, chalk.green('✅ harness 初始化完成！'));
  log(io);
  log(io, chalk.gray('下一步:'));
  log(io, chalk.gray('  1. 编辑 .harness/config.yml 自定义配置'));
  log(io, chalk.gray('  2. 编辑 .harness/custom-constraints.yml 添加项目约束'));
  log(io, chalk.gray('  3. 正常开发，每次 git commit 会自动检查约束'));
  log(io, chalk.gray('  4. 运行 harness status 查看状态'));
  log(io);
  log(io, chalk.blue('💡 提示: 使用 harness init --print-snippets 查看配置代码片段'));
  return { kind: 'ok' };
}

/**
 * 输出代码片段
 */
function printSnippets(io: CommandIO): void {
  log(io, chalk.blue('📄 Harness 配置代码片段'));
  log(io);
  
  log(io, chalk.yellow('Git pre-commit hook:'));
  log(io, chalk.gray('添加到 .git/hooks/pre-commit'));
  log(io);
  log(io, chalk.cyan(PRE_COMMIT_SNIPPET));
  
  log(io, chalk.yellow('GitHub Actions:'));
  log(io, chalk.gray('添加到 .github/workflows/*.yml 的 jobs 中'));
  log(io);
  log(io, chalk.cyan(GITHUB_ACTIONS_SNIPPET));
  
  log(io, chalk.blue('💡 提示: 运行 npx @dommaker/harness init 自动创建配置文件'));
}

/**
 * Git pre-commit 代码片段
 */
const PRE_COMMIT_SNIPPET = `
# Harness 约束检查
npx @dommaker/harness check --staged
if [ $? -ne 0 ]; then
  echo "❌ Iron law check failed"
  exit 1
fi

# Plan coverage check (via PostEval)
STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
if command -v npx > /dev/null 2>&1; then
  PLAN_FILES=$(echo "$STAGED" | grep -E 'plans/.*\\.md$|\\.plan\\.md$' || true)
  if [ -n "$PLAN_FILES" ]; then
    echo "📋 Checking plan coverage..."
    for plan in $PLAN_FILES; do
      npx @dommaker/harness posteval-plan "$plan" || {
        echo "🛑 Plan coverage incomplete. See above for missed items."
        exit 1
      }
    done
  fi
fi
`;

/**
 * GitHub Actions 代码片段
 */
const GITHUB_ACTIONS_SNIPPET = `
  harness-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx @dommaker/harness check
`;

/**
 * 设置 Git hooks
 */
async function setupGitHooks(projectPath: string, io: CommandIO): Promise<void> {
  const gitDir = path.join(projectPath, '.git');
  const hooksDir = path.join(gitDir, 'hooks');
  const preCommitPath = path.join(hooksDir, 'pre-commit');

  try {
    await fs.access(gitDir);
  } catch {
    log(io, chalk.yellow('⚠️  未检测到 Git 仓库，跳过 Git hooks'));
    log(io, chalk.gray('💡 初始化 Git 后可运行 npx @dommaker/harness init --print-snippets 查看配置'));
    return;
  }

  await fs.mkdir(hooksDir, { recursive: true });

  // 检查 pre-commit 是否已存在
  try {
    await fs.access(preCommitPath);
    // 已存在，输出代码片段
    log(io, chalk.yellow('⚠️  .git/hooks/pre-commit 已存在'));
    log(io, chalk.gray('💡 请手动添加以下内容到文件末尾：'));
    log(io);
    log(io, chalk.cyan(PRE_COMMIT_SNIPPET));
  } catch {
    // 不存在，创建文件
    const preCommitContent = `#!/bin/sh
# Harness pre-commit hook

echo "🔍 Running harness checks..."

STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

# 铁律检查
npx @dommaker/harness check --staged
if [ $? -ne 0 ]; then
  echo "❌ Iron law check failed"
  exit 1
fi

# Plan coverage check (via PostEval)
if command -v npx > /dev/null 2>&1; then
  PLAN_FILES=$(echo "$STAGED" | grep -E 'plans/.*\\.md$|\\.plan\\.md$' || true)
  if [ -n "$PLAN_FILES" ]; then
    echo "📋 Checking plan coverage..."
    for plan in $PLAN_FILES; do
      npx @dommaker/harness posteval-plan "$plan" || {
        echo "🛑 Plan coverage incomplete. See above for missed items."
        exit 1
      }
    done
  fi
fi

echo "✅ All checks passed"
`;
    await fs.writeFile(preCommitPath, preCommitContent, 'utf-8');
    await fs.chmod(preCommitPath, 0o755);
    log(io, chalk.green(`✅ 已创建 .git/hooks/pre-commit`));
  }
}

/**
 * 设置 GitHub Actions
 */
async function setupGitHubActions(projectPath: string, io: CommandIO): Promise<void> {
  const workflowsDir = path.join(projectPath, '.github', 'workflows');
  const workflowPath = path.join(workflowsDir, 'harness-check.yml');

  // 检查是否已有 CI 配置
  const existingFiles = await findCiWorkflows(workflowsDir);
  
  if (existingFiles.length > 0) {
    // 已有 CI 配置，输出代码片段
    log(io, chalk.yellow('⚠️  检测到已存在的 CI 配置：'));
    existingFiles.forEach(f => {
      log(io, chalk.gray(`  - .github/workflows/${f}`));
    });
    log(io, chalk.gray('💡 请手动添加以下内容到 jobs 中：'));
    log(io);
    log(io, chalk.cyan(GITHUB_ACTIONS_SNIPPET));
    return;
  }

  // 没有现有 CI 配置，创建文件
  await fs.mkdir(workflowsDir, { recursive: true });
  const workflowContent = `name: Harness Check

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  harness-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run harness check
        run: npx @dommaker/harness check

      - name: Run harness validate
        run: npx @dommaker/harness validate

      - name: Run harness passes-gate
        run: npx @dommaker/harness passes-gate
`;

  await fs.writeFile(workflowPath, workflowContent, 'utf-8');
  log(io, chalk.green(`✅ 已创建 .github/workflows/harness-check.yml`));
}

/**
 * 查找已存在的 CI 工作流文件
 */
async function findCiWorkflows(workflowsDir: string): Promise<string[]> {
  try {
    await fs.access(workflowsDir);
    const files = await fs.readdir(workflowsDir);
    // 过滤出可能是 CI 配置的文件
    return files.filter(f => 
      f.endsWith('.yml') || f.endsWith('.yaml')
    );
  } catch {
    return [];
  }
}

/**
 * 创建自定义约束示例
 */
async function createCustomConstraintsExample(projectPath: string, io: CommandIO): Promise<void> {
  const configDir = path.join(projectPath, '.harness');
  const customConstraintsPath = path.join(configDir, 'custom-constraints.yml');

  // 如果已存在，不覆盖
  try {
    await fs.access(customConstraintsPath);
    log(io, chalk.gray(`custom-constraints.yml 已存在`));
    return;
  } catch {
    // 文件不存在，创建
  }

  const content = `# 自定义约束配置
#
# 此文件定义项目特定的约束，扩展或覆盖 harness 内置约束

# ========================================
# 自定义约束示例
# ========================================

custom_constraints:
  # 示例 1：禁止 console.log
  # my_project_no_console_log:
  #   id: my_project_no_console_log
  #   level: guideline
  #   rule: "NO CONSOLE.LOG IN PRODUCTION CODE"
  #   message: "生产代码禁止使用 console.log，请使用 logger 模块"
  #   trigger: ["code_implementation"]
  #   description: "使用项目统一的 logger 模块代替 console.log"

  # 示例 2：禁止特定的导入
  # my_project_no_moment_js:
  #   id: my_project_no_moment_js
  #   level: guideline
  #   rule: "NO MOMENT.JS IMPORTS"
  #   message: "禁止使用 moment.js，请使用 date-fns 或 dayjs"
  #   trigger: ["code_implementation"]

  # 示例 3：要求特定的文件命名
  # my_project_component_naming:
  #   id: my_project_component_naming
  #   level: tip
  #   rule: "REACT COMPONENTS SHOULD BE PASCAL CASE"
  #   message: "React 组件文件名应使用 PascalCase"
  #   trigger: ["file_creation"]
`;

  await fs.writeFile(customConstraintsPath, content, 'utf-8');
  log(io, chalk.green(`✅ 已创建自定义约束示例: custom-constraints.yml`));
}

/**
 * Output Style 段标记（ADR-0001：init 只写标记区间内，标记外只读）
 */
const OUTPUT_STYLE_START = '<!-- HARNESS_OUTPUT_STYLE_START -->';
const OUTPUT_STYLE_END = '<!-- HARNESS_OUTPUT_STYLE_END -->';

/** 旧版 harness 无标记 Output Style 段的特征串（用于区分 harness 写入 vs 用户自写） */
const LEGACY_OUTPUT_STYLE_FINGERPRINT = 'Terse like caveman';

const OUTPUT_STYLE_BODY = [
  'Terse like caveman. Technical substance exact. Only fluff die.',
  'Drop: articles, filler (just/really/basically), pleasantries (sure/certainly/happy to), hedging.',
  'Fragments OK. Short synonyms. Code blocks unchanged. Error messages quoted exact.',
  'Pattern: [thing] [action] [reason]. [next step].',
  'No sycophantic openers/closing fluff. No emojis or em-dashes.',
  'Read existing files before writing. Don\'t re-read unless changed.',
  'Skip files over 100KB unless required.',
  'Don\'t guess APIs, versions, flags, commit SHAs, or package names. Verify before asserting.',
].join('\n');

/** 渲染带标记的 Output Style 段（含 `## Output Style` 标题，以换行结尾） */
function renderOutputStyleSection(): string {
  return `${OUTPUT_STYLE_START}\n## Output Style\n\n${OUTPUT_STYLE_BODY}\n${OUTPUT_STYLE_END}\n`;
}

/**
 * 在 CLAUDE.md 顶部写入 Output Style 段（标记化、幂等）
 *
 * - 已有 HARNESS_OUTPUT_STYLE 标记：替换标记间内容
 * - 无标记但存在旧版 harness 写入的无标记段（特征串匹配）：原位置换为标记版
 * - 无标记且 `## Output Style` 段为用户自写（特征串不匹配）：跳过并提示，不重复追加
 * - 完全没有该段：在文件顶部插入标记版
 */
export async function setupClaudeMdOutputStyle(projectPath: string, io: CommandIO = processIO): Promise<void> {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  let content: string;
  try {
    content = await fs.readFile(claudeMdPath, 'utf-8');
  } catch {
    // CLAUDE.md 不存在——setupClaudeMdConstraints 会创建它
    return;
  }

  const section = renderOutputStyleSection();
  const write = replaceStandaloneRange(content, OUTPUT_STYLE_START, OUTPUT_STYLE_END, section);

  if (write.kind === 'updated') {
    // 尾部换行规范化在 writer 内（幂等）。
    if (write.content !== content) {
      await fs.writeFile(claudeMdPath, write.content, 'utf-8');
      log(io, chalk.green('✅ 已更新 CLAUDE.md Output Style 段'));
    }
    return;
  }
  if (write.kind === 'half') {
    log(io, chalk.yellow('⚠️  CLAUDE.md 中 HARNESS_OUTPUT_STYLE 标记残缺（单边或乱序），跳过 Output Style 注入，请人工修复'));
    return;
  }

  // 检测旧版无标记 `## Output Style` 段
  const legacyMatch = /^## Output Style[ \t]*$/m.exec(content);
  if (legacyMatch) {
    const sectionStart = legacyMatch.index;
    const afterHeading = sectionStart + legacyMatch[0].length;
    const nextHeadingOffset = content.slice(afterHeading).search(/^#{1,6} /m);
    const sectionEnd = nextHeadingOffset === -1 ? content.length : afterHeading + nextHeadingOffset;
    const legacySection = content.slice(sectionStart, sectionEnd);

    if (!legacySection.includes(LEGACY_OUTPUT_STYLE_FINGERPRINT)) {
      // 用户自写的同名 section：不动，也不追加（避免重复）
      log(io, chalk.yellow('⚠️  CLAUDE.md 已存在自定义 "## Output Style" 段，跳过 harness Output Style 注入'));
      return;
    }

    // 旧版 harness 写入：原位置换为标记版
    const before = content.slice(0, sectionStart);
    const after = content.slice(sectionEnd);
    const newContent = before + section + (after.length > 0 ? '\n' + after : '');
    await fs.writeFile(claudeMdPath, newContent, 'utf-8');
    log(io, chalk.green('✅ 已将 CLAUDE.md Output Style 段迁移为标记化管理'));
    return;
  }

  // 完全没有该段：插入文件顶部
  await fs.writeFile(claudeMdPath, section + '\n' + content, 'utf-8');
  log(io, chalk.green('✅ 已在 CLAUDE.md 顶部写入 Output Style 段'));
}

/**
 * 治理契约 PRESERVE 段标记（studio #302，ADR 2026-08-21 落点模型：
 * 治理契约正本住 AGENTS.md 手写 PRESERVE 段，sync-docs 重新生成时原样保留）
 */
const GOVERNANCE_PRESERVE_BEGIN = '<!-- PRESERVE:governance -->';
const GOVERNANCE_PRESERVE_END = '<!-- /PRESERVE:governance -->';

/**
 * 在 AGENTS.md 的 PRESERVE:governance 段写入/更新 Governance Rules 约束段（新落点模型）
 *
 * - AGENTS.md 不存在：创建最小骨架（标题 + 说明 + PRESERVE:governance 段），
 *   完整导读由 `harness sync-docs --agents` 生成，PRESERVE 段在重新生成时原样保留
 * - 已有 PRESERVE:governance 段：段内机器管理的只有 HARNESS_CONSTRAINTS 标记区间——
 *   有标记则只替换标记区间，段内其余手写内容（治理契约引言/流程/纪律等）原样保留；
 *   无标记（纯手写段）则在段尾追加注入段，不动手写内容
 * - 无该段：在文件末尾追加
 * - 段标记残缺（外层或段内 HARNESS_CONSTRAINTS 单边/乱序）：不写入，告警交由人工修复（防二次损坏）
 */
export async function setupAgentsMdConstraints(projectPath: string, io: CommandIO = processIO): Promise<void> {
  const agentsMdPath = path.join(projectPath, 'AGENTS.md');
  const version = getHarnessPackageVersion();

  const constraints = getEffectiveConstraints(projectPath);
  const bodyOnly = renderConstraintsSection(constraints, version);
  const block = `${GOVERNANCE_PRESERVE_BEGIN}\n${GOVERNANCE_HEADING}\n${bodyOnly}${GOVERNANCE_PRESERVE_END}\n`;

  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(agentsMdPath, 'utf-8');
  } catch {
    // AGENTS.md 不存在
  }

  if (existingContent === null) {
    const skeleton = [
      '# AGENTS.md',
      '',
      '> 机器生成部分由 `harness sync-docs --agents` 维护；`PRESERVE:governance` 段是治理契约正本（手写/治理变更流程管控），重新生成时原样保留。',
      '',
      block,
    ].join('\n');
    await fs.writeFile(agentsMdPath, skeleton, 'utf-8');
    log(io, chalk.green(`✅ 已创建 AGENTS.md 并写入治理契约 PRESERVE:governance 段 (v${version})`));
    return;
  }

  const preserve = cutMarkerBlock(existingContent, GOVERNANCE_PRESERVE_BEGIN, GOVERNANCE_PRESERVE_END);

  if (preserve === 'half') {
    log(io, chalk.yellow('⚠️  AGENTS.md 中 PRESERVE:governance 标记残缺（只有单边），跳过治理契约写入，请人工修复'));
    return;
  }

  if (preserve !== 'absent') {
    // 段内机器管理的只有 HARNESS_CONSTRAINTS 标记区间；其余手写内容原样保留
    const inner = replaceEnclosedRange(preserve.inner, CONSTRAINTS_START_MARKER, CONSTRAINTS_END_MARKER, bodyOnly);
    if (inner.kind === 'half') {
      log(io, chalk.yellow('⚠️  AGENTS.md PRESERVE:governance 段内 HARNESS_CONSTRAINTS 标记残缺（单边或乱序），跳过治理契约写入，请人工修复'));
      return;
    }
    const newInner =
      inner.kind === 'updated'
        ? inner.content
        : // 纯手写段（无约束标记）：段尾追加注入段，手写内容不动
          preserve.inner.trimEnd() + '\n\n' + GOVERNANCE_HEADING + '\n' + bodyOnly;

    const write = replaceStandaloneRange(
      existingContent,
      GOVERNANCE_PRESERVE_BEGIN,
      GOVERNANCE_PRESERVE_END,
      GOVERNANCE_PRESERVE_BEGIN + newInner + GOVERNANCE_PRESERVE_END + '\n'
    );
    if (write.kind === 'updated' && write.content !== existingContent) {
      await fs.writeFile(agentsMdPath, write.content, 'utf-8');
      log(io, chalk.green(`✅ 已更新 AGENTS.md 治理契约 PRESERVE:governance 段 (v${version})`));
    }
    return;
  }

  // 无该段：文件末尾追加
  const newContent = existingContent.trimEnd() + '\n\n' + block;
  await fs.writeFile(agentsMdPath, newContent, 'utf-8');
  log(io, chalk.green(`✅ 已追加治理契约 PRESERVE:governance 段到 AGENTS.md (v${version})`));
}

/**
 * 在 CLAUDE.md 中写入/更新 Governance Rules 约束段（旧落点模型，向后兼容保留）
 *
 * - 约束集来自 getEffectiveConstraints（ADR-0001）：preset 裁剪、config.yml
 *   禁用、custom 追加、scenes 过滤全部反映在注入文本里
 * - 期望段文本由纯函数 renderConstraintsSection 渲染（P6 漂移校验复用）
 * - 如果 CLAUDE.md 不存在，创建并写入完整约束段
 * - 如果存在 HARNESS_CONSTRAINTS_START/END 标记，替换标记间内容
 * - 如果不存在标记，在文件末尾追加约束段
 */
export async function setupClaudeMdConstraints(projectPath: string, io: CommandIO = processIO): Promise<void> {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');

  const version = getHarnessPackageVersion();

  // 生效约束集 → 渲染期望段（纯函数，与写文件分离）
  const constraints = getEffectiveConstraints(projectPath);
  const bodyOnly = renderConstraintsSection(constraints, version);
  const fullSection = GOVERNANCE_HEADING + '\n' + bodyOnly;

  // 检查 CLAUDE.md 是否存在
  let existingContent: string;
  let fileExists = false;
  try {
    existingContent = await fs.readFile(claudeMdPath, 'utf-8');
    fileExists = true;
  } catch {
    existingContent = '';
  }

  if (!fileExists) {
    // 创建新文件
    await fs.writeFile(claudeMdPath, fullSection, 'utf-8');
    log(io, chalk.green(`✅ 已创建 CLAUDE.md 并写入治理约束 (v${version})`));
    return;
  }

  const write = replaceStandaloneRange(existingContent, CONSTRAINTS_START_MARKER, CONSTRAINTS_END_MARKER, bodyOnly);

  if (write.kind === 'updated') {
    // 替换标记区间含标记本身（保持包括最新版本号），尾部换行规范化在 writer 内
    await fs.writeFile(claudeMdPath, write.content, 'utf-8');
    log(io, chalk.green(`✅ 已更新 CLAUDE.md 治理约束 (v${version})`));
  } else if (write.kind === 'half') {
    log(io, chalk.yellow('⚠️  CLAUDE.md 中 HARNESS_CONSTRAINTS 标记残缺（单边或乱序），跳过治理约束注入，请人工修复'));
  } else {
    // 在文件末尾追加完整段
    const newContent = existingContent.trimEnd() + '\n\n' + fullSection;
    await fs.writeFile(claudeMdPath, newContent, 'utf-8');
    log(io, chalk.green(`✅ 已追加治理约束到 CLAUDE.md (v${version})`));
  }
}

/**
 * 治理约束段写入落点路由（studio #302，ADR 2026-08-21 落点模型）
 *
 * 判定收口在 core/constraints/injection-writer resolveGovernanceLanding：
 * - 旧模型仓（CLAUDE.md 已有 HARNESS_CONSTRAINTS 标记或 `## Governance Rules` 块）：
 *   继续写 CLAUDE.md——init 幂等重跑不破坏既有仓，不制造双份约束正本
 * - 其余（新仓初始化）：写 AGENTS.md PRESERVE:governance 段（入库公共面正本）
 */
export async function setupGovernanceConstraints(projectPath: string): Promise<void> {
  const { target } = resolveGovernanceLanding(projectPath);
  return target === 'claude-md'
    ? setupClaudeMdConstraints(projectPath)
    : setupAgentsMdConstraints(projectPath);
}

/**
 * 设置治理相关文件
 */
async function setupGovernance(projectPath: string, level: string, io: CommandIO): Promise<void> {
  const governance = GOVERNANCE_PRESETS[level];
  if (!governance) return;

  log(io);
  log(io, chalk.blue('📋 设置治理文件...'));

  // 1. 生成 CHANGELOG.md
  await createChangelog(projectPath, governance, io);

  // 2. 在 CLAUDE.md 中写入 Output Style 段（仅在不存在时创建）
  await setupClaudeMdOutputStyle(projectPath);

  // 3. 写入/更新 Governance Rules 约束段（新仓 → AGENTS.md PRESERVE:governance；
  //    旧模型仓 → CLAUDE.md，落点路由见 setupGovernanceConstraints）
  await setupGovernanceConstraints(projectPath);

  // 4. 生成 CONTEXT.md 文件（预设形状即 GovernanceConfig，无需再 cast）
  const contextConfig = governance.context_files;
  if (contextConfig?.enabled) {
    let requiredDirs = contextConfig.required_dirs ?? [];
    if (requiredDirs.length === 0) {
      requiredDirs = detectSourceRoots(projectPath);
    }
    for (const dir of requiredDirs) {
      await createContextMd(projectPath, dir, io);
    }
  }

  // 4. 生成治理 CI workflow
  await setupGovernanceWorkflow(projectPath, level, io);
}

/**
 * 创建 CHANGELOG.md
 */
async function createChangelog(projectPath: string, governance: GovernanceConfig, io: CommandIO): Promise<void> {
  const changelogPath = path.join(projectPath, 'CHANGELOG.md');

  try {
    await fs.access(changelogPath);
    log(io, chalk.gray(`CHANGELOG.md 已存在`));
    return;
  } catch {
    // 文件不存在，创建
  }

  const format = governance.changelog?.format || 'keep-a-changelog';

  let content: string;
  if (format === 'keep-a-changelog') {
    content = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup with harness governance

---

> 此文件可由 \`harness sync-docs\` 辅助维护
`;
  } else {
    content = `# Changelog

## [Unreleased]

- Initial project setup with harness governance

---

> 此文件可由 \`harness sync-docs\` 辅助维护
`;
  }

  await fs.writeFile(changelogPath, content, 'utf-8');
  log(io, chalk.green(`✅ 已创建 CHANGELOG.md`));
}

/**
 * 在指定目录创建 CONTEXT.md
 */
async function createContextMd(projectPath: string, dir: string, io: CommandIO): Promise<void> {
  const contextPath = path.join(projectPath, dir, 'CONTEXT.md');

  try {
    await fs.access(contextPath);
    log(io, chalk.gray(`${dir}/CONTEXT.md 已存在`));
    return;
  } catch {
    // 文件不存在，创建
  }

  // 检查目录是否存在
  const dirPath = path.join(projectPath, dir);
  try {
    await fs.access(dirPath);
  } catch {
    log(io, chalk.yellow(`⚠️  目录 ${dir} 不存在，跳过 CONTEXT.md`));
    return;
  }

  const dirName = path.basename(dir);
  const content = `# ${dirName}

> 此文件描述 ${dir} 目录的职责和上下文

## 职责

<!-- 本目录的核心职责是什么 -->

## 核心导出

<!-- 本目录对外暴露的主要模块/函数 -->

## 依赖关系

<!-- 本目录依赖哪些其他模块，谁依赖本目录 -->

## 注意事项

<!-- 开发时需要注意的约束或约定 -->
`;

  await fs.writeFile(contextPath, content, 'utf-8');
  log(io, chalk.green(`✅ 已创建 ${dir}/CONTEXT.md`));
}

/**
 * 检测已有 workflow 是否已覆盖 harness 治理命令
 * （harness check / passes-gate / sync-docs --check，含 npx、scoped 包名等调用形式）
 */
const GOVERNANCE_COMMAND_PATTERN = /\bharness\s+(?:check\b|passes-gate\b|sync-docs\b[^\n]*--check)/;

async function findGovernanceCoverage(workflowsDir: string): Promise<string | undefined> {
  for (const file of await findCiWorkflows(workflowsDir)) {
    try {
      const content = await fs.readFile(path.join(workflowsDir, file), 'utf-8');
      if (GOVERNANCE_COMMAND_PATTERN.test(content)) {
        return file;
      }
    } catch {
      // 读取失败，忽略该文件
    }
  }
  return undefined;
}

/**
 * 设置治理 CI workflow
 */
async function setupGovernanceWorkflow(projectPath: string, level: string, io: CommandIO): Promise<void> {
  const workflowsDir = path.join(projectPath, '.github', 'workflows');
  const workflowPath = path.join(workflowsDir, 'harness-governance.yml');

  // 检查是否已存在
  try {
    await fs.access(workflowPath);
    log(io, chalk.gray(`harness-governance.yml 已存在`));
    return;
  } catch {
    // 不存在，继续创建
  }

  // 能力检测：已有 workflow 已跑 harness 治理命令时跳过，避免重复 CI 面
  const coveredBy = await findGovernanceCoverage(workflowsDir);
  if (coveredBy) {
    log(io, chalk.gray(`治理检查已由 ${coveredBy} 覆盖，跳过创建 harness-governance.yml`));
    return;
  }

  await fs.mkdir(workflowsDir, { recursive: true });

  const docsCheckStep = level !== 'minimal'
    ? `
      - name: Check docs freshness
        run: npx @dommaker/harness sync-docs --check
        continue-on-error: true`
    : '';

  const workflowContent = `name: Harness Governance

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  governance:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Constraint check
        run: npx @dommaker/harness check

      - name: Quality gate
        run: npx @dommaker/harness passes-gate
${docsCheckStep}
`;

  await fs.writeFile(workflowPath, workflowContent, 'utf-8');
  log(io, chalk.green(`✅ 已创建 .github/workflows/harness-governance.yml`));
}
