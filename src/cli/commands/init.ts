/**
 * harness init 命令
 * 
 * 初始化项目的 harness 配置
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { getHarnessPackageVersion } from '../../utils/package-version';
import { getEffectiveConstraints } from '../../core/effective-constraints';
import { loadRawProjectConfig } from '../../core/project-config-loader';
import type { CiConfig, CiPlatform, GovernanceConfig } from '../../types/project-config';
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
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import {
  runPlan,
  nodeScaffoldFs,
  preCommitHookFile,
  harnessCheckCiFile,
  customConstraintsFile,
  changelogFile,
  contextDocFile,
  governanceWorkflowFile,
  checkpointsFile,
  resolutionsFile,
  type ManagedFile,
} from './scaffold';
import { GITHUB_ACTIONS_SNIPPET, GITLAB_CI_SNIPPET, PRE_COMMIT_SNIPPET } from './scaffold-templates';

export interface InitOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 预设名称 */
  preset: 'strict' | 'standard' | 'relaxed';
  /** 治理级别 */
  governance?: 'minimal' | 'standard' | 'strict';
  /** 是否创建 Git hooks */
  gitHooks?: boolean;
  /** 是否创建 GitHub Actions（`--no-github-actions`：已废弃，`--ci none` 的别名） */
  githubActions?: boolean;
  /**
   * 服务端 CI 接线平台（`--ci`，harness#143）
   *
   * 值域校验在命令层（bin 把用户敲的字符串原样递进来）；缺省时回落 config.yml
   * 的 `ci.platform`，再缺省即 `github`。
   */
  ci?: CiPlatform | 'none';
  /** 只输出代码片段，不创建文件 */
  printSnippets?: boolean;
}

/** `--ci` 的可取值域（`none` = 不做服务端 CI 接线，即旧 `--no-github-actions`） */
const CI_FLAG_VALUES: Array<CiPlatform | 'none'> = ['github', 'gitlab', 'none'];

/** CI 平台解析结果（`error` 属用法错误，命令层直接非零退出，不落任何文件） */
type CiResolution =
  | { kind: 'ok'; platform: CiPlatform | 'none'; warning?: string }
  | { kind: 'error'; reason: string };

/**
 * 解析 CI 平台（harness#143 决议 ①④）：flag > config.yml 的 `ci.platform` > `github`
 *
 * 不做 remote URL 自动检测：init 常跑在首次 push 之前无 remote 可测，而检测错的代价是
 * 静默写错文件。`--no-github-actions` 保留为 `--ci none` 的废弃别名；它与显式
 * `--ci <非 none>` 同时出现时不猜用户意图，判用法错误。
 */
function resolveCiPlatform(
  options: InitOptions,
  configured: CiPlatform | 'none' | undefined,
): CiResolution {
  const flag = options.ci;
  if (flag !== undefined && !CI_FLAG_VALUES.includes(flag)) {
    return {
      kind: 'error',
      reason: `--ci 取值非法: ${String(flag)}（可取 ${CI_FLAG_VALUES.join(' | ')}）`,
    };
  }
  if (options.githubActions === false) {
    if (flag !== undefined && flag !== 'none') {
      return {
        kind: 'error',
        reason: `--ci ${flag} 与 --no-github-actions（即 --ci none 的废弃别名）冲突，二选一`,
      };
    }
    return {
      kind: 'ok',
      platform: 'none',
      warning: '⚠️  --no-github-actions 已废弃，请改用 --ci none',
    };
  }
  return { kind: 'ok', platform: flag ?? configured ?? 'github' };
}

/**
 * 读 config.yml 已持久化的 `ci.platform`（解析链第二级）
 *
 * 缺失 / 解析失败 / 形状不符一律按未配置处理（与 `getGovernanceConfig` 同一口径：
 * 脏配置不替调用方做决定）。
 */
function readConfiguredCiPlatform(projectPath: string): CiPlatform | 'none' | undefined {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = loadRawProjectConfig(projectPath);
  } catch {
    return undefined;
  }
  const ci = raw?.ci;
  if (ci === null || typeof ci !== 'object') return undefined;
  const platform = (ci as CiConfig).platform;
  return platform !== undefined && CI_FLAG_VALUES.includes(platform) ? platform : undefined;
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
  const projectPath = options.projectPath || process.cwd();

  // CI 平台先解析：用法错误不落任何盘，且 `--print-snippets` 也要按解析出的平台出形
  const ci = resolveCiPlatform(options, readConfiguredCiPlatform(projectPath));
  if (ci.kind === 'error') {
    logError(io, chalk.red(`❌ 用法错误: ${ci.reason}`));
    return { kind: 'usage-error', reason: ci.reason };
  }
  if (ci.warning) log(io, chalk.yellow(ci.warning));

  // 只输出代码片段
  if (options.printSnippets) {
    printSnippets(io, ci.platform);
    return { kind: 'ok' };
  }

  log(io, chalk.blue('🚀 初始化 harness 配置...'));

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

  // 非默认平台才持久化：缺省即 github（旧配置零迁移），裸 init 重写 config.yml 时
  // 也因此不会丢掉已选定的平台
  if (ci.platform !== 'github') {
    configData.ci = { platform: ci.platform };
    log(io, chalk.gray(`CI 平台: ${ci.platform}`));
  }

  // 写入 harness 版本
  const pkgVersion = getHarnessPackageVersion();
  configData.harness = { version: pkgVersion };

  // 写入配置文件（harness 管理的配置，始终重新生成）
  const configPath = path.join(configDir, 'config.yml');
  const configContent = yaml.dump(configData, { indent: 2 });
  await fs.writeFile(configPath, configContent, 'utf-8');
  log(io, chalk.green(`✅ 已创建配置文件: ${configPath} (v${pkgVersion})`));

  // 受管示例文件：检查点 / Resolutions（RKB 狗粮）/ 自定义约束
  await runPlan(
    [checkpointsFile(projectPath), resolutionsFile(projectPath), customConstraintsFile(projectPath)],
    io,
  );

  // CAPABILITIES.md / CHANGELOG.md 由 sync-docs（AI 治理）管理，init 不创建

  // 创建 Git hooks
  if (options.gitHooks !== false) {
    await setupGitHooks(projectPath, io);
  }

  // 服务端 CI 门禁接线（平台维度）：`none` = CI 站点干脆不进 plan
  if (ci.platform !== 'none') {
    await setupCiWiring(projectPath, ci.platform, options.governance, io);
  }

  // 治理相关文件生成
  if (options.governance) {
    await setupGovernance(projectPath, options.governance, io, ci.platform);
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
 * 输出代码片段（CI 片段按解析出的平台出形，harness#143）
 */
function printSnippets(io: CommandIO, platform: CiPlatform | 'none'): void {
  log(io, chalk.blue('📄 Harness 配置代码片段'));
  log(io);

  log(io, chalk.yellow('Git pre-commit hook:'));
  log(io, chalk.gray('添加到 .git/hooks/pre-commit'));
  log(io);
  log(io, chalk.cyan(PRE_COMMIT_SNIPPET));

  if (platform === 'gitlab') {
    log(io, chalk.yellow('GitLab CI:'));
    log(io, chalk.gray('添加到 .gitlab-ci.yml'));
    log(io);
    log(io, chalk.cyan(GITLAB_CI_SNIPPET));
  } else {
    log(io, chalk.yellow('GitHub Actions:'));
    log(io, chalk.gray('添加到 .github/workflows/*.yml 的 jobs 下（以下正文取自 harness-check.yml 的 job 段）'));
    log(io);
    log(io, chalk.cyan(GITHUB_ACTIONS_SNIPPET));
  }

  log(io, chalk.blue('💡 提示: 运行 npx @dommaker/harness init 自动创建配置文件'));
}

/**
 * 设置 Git hooks（无 .git 即整站跳过；落盘语义在 scaffold plan）
 */
async function setupGitHooks(projectPath: string, io: CommandIO): Promise<void> {
  if (!(await nodeScaffoldFs.exists(path.join(projectPath, '.git')))) {
    log(io, chalk.yellow('⚠️  未检测到 Git 仓库，跳过 Git hooks'));
    log(io, chalk.gray('💡 初始化 Git 后可运行 npx @dommaker/harness init --print-snippets 查看配置'));
    return;
  }
  await runPlan([preCommitHookFile(projectPath)], io);
}

/**
 * 设置服务端 CI 接线（站点形状与冲突面由 scaffold 按平台给）
 *
 * gitlab 只有一个 `.gitlab-ci.yml`，治理任务已在正文里（`governanceLevel` 传给工厂）；
 * github 的冲突判定宽到整个 workflows 目录，需先扫一遍。
 */
async function setupCiWiring(
  projectPath: string,
  platform: CiPlatform,
  governanceLevel: string | undefined,
  io: CommandIO,
): Promise<void> {
  if (platform === 'gitlab') {
    await runPlan([harnessCheckCiFile(projectPath, 'gitlab', [], governanceLevel)], io);
    return;
  }
  const workflowsDir = path.join(projectPath, '.github', 'workflows');
  await runPlan(
    [harnessCheckCiFile(projectPath, 'github', await findCiWorkflows(workflowsDir))],
    io,
  );
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
async function setupGovernance(
  projectPath: string,
  level: string,
  io: CommandIO,
  platform: CiPlatform | 'none',
): Promise<void> {
  const governance = GOVERNANCE_PRESETS[level];
  if (!governance) return;

  log(io);
  log(io, chalk.blue('📋 设置治理文件...'));

  // 1. 生成 CHANGELOG.md
  await runPlan([changelogFile(projectPath, governance.changelog?.format || 'keep-a-changelog')], io);

  // 2. 在 CLAUDE.md 中写入 Output Style 段（仅在不存在时创建）
  await setupClaudeMdOutputStyle(projectPath);

  // 3. 写入/更新 Governance Rules 约束段（新仓 → AGENTS.md PRESERVE:governance；
  //    旧模型仓 → CLAUDE.md，落点路由见 setupGovernanceConstraints）
  await setupGovernanceConstraints(projectPath);

  // 4. 生成 CONTEXT.md 文件（预设形状即 GovernanceConfig，无需再 cast）
  await runPlan(await contextDocPlan(projectPath, governance, io), io);

  // 5. 生成治理 CI 面（gitlab 已在 .gitlab-ci.yml 的正文里，见 setupCiWiring）
  await setupGovernanceWorkflow(projectPath, level, io, platform);
}

/**
 * 目录 CONTEXT.md 骨架的 plan：required_dirs 缺省时按源码根探测，
 * 探测出来的目录不在场就不进 plan（告知由本函数负责）
 */
async function contextDocPlan(
  projectPath: string,
  governance: GovernanceConfig,
  io: CommandIO,
): Promise<ManagedFile[]> {
  const contextConfig = governance.context_files;
  if (!contextConfig?.enabled) return [];

  let requiredDirs = contextConfig.required_dirs ?? [];
  if (requiredDirs.length === 0) {
    requiredDirs = detectSourceRoots(projectPath);
  }

  const plan: ManagedFile[] = [];
  for (const dir of requiredDirs) {
    if (!(await nodeScaffoldFs.exists(path.join(projectPath, dir)))) {
      log(io, chalk.yellow(`⚠️  目录 ${dir} 不存在，跳过 CONTEXT.md`));
      continue;
    }
    plan.push(contextDocFile(projectPath, dir));
  }
  return plan;
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
 * 设置治理 CI workflow（目标已在场，或已有 workflow 覆盖治理命令时不新建 CI 面）
 *
 * 仅 github 形有本站点：gitlab 的治理任务已并入 `.gitlab-ci.yml` 正文（一个平台一份
 * CI 文件，harness#143）。
 */
async function setupGovernanceWorkflow(
  projectPath: string,
  level: string,
  io: CommandIO,
  platform: CiPlatform | 'none',
): Promise<void> {
  if (platform === 'gitlab') return;

  const workflowsDir = path.join(projectPath, '.github', 'workflows');
  const file = governanceWorkflowFile(projectPath, level);

  if (!(await nodeScaffoldFs.exists(file.target))) {
    const coveredBy = await findGovernanceCoverage(workflowsDir);
    if (coveredBy) {
      log(io, chalk.gray(`治理检查已由 ${coveredBy} 覆盖，跳过创建 harness-governance.yml`));
      return;
    }
  }

  await runPlan([file], io);
}
