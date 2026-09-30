/**
 * init 的治理文件生成（Phase 3 自 init.ts 拆出，纯移位）
 *
 * -g 档的四个站点：CHANGELOG.md、CLAUDE.md Output Style 段、目录 CONTEXT.md
 * 骨架、治理 CI workflow（仅 github 形；gitlab 并入 .gitlab-ci.yml 正文，
 * none 不建，harness#156）。
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import type { CiPlatform, GovernanceConfig } from '../../../types/project-config';
import { log, type CommandIO } from '../../command-contract';
import {
  runPlan,
  nodeScaffoldFs,
  changelogFile,
  contextDocFile,
  governanceWorkflowFile,
  type ManagedFile,
} from '../scaffold';
import { GOVERNANCE_PRESETS } from './presets';
import { setupClaudeMdOutputStyle } from './output-style';
import { findCiWorkflows } from './ci-wiring';

/**
 * 设置治理相关文件
 */
export async function setupGovernance(
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
  await setupClaudeMdOutputStyle(projectPath, io);

  // 3. 生成 CONTEXT.md 文件（预设形状即 GovernanceConfig，无需再 cast）
  await runPlan(await contextDocPlan(projectPath, governance, io), io);

  // 4. 生成治理 CI 面（仅 github 形；gitlab 已并入 .gitlab-ci.yml 正文，none 不建，harness#156）
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
    // fail-fast：workflow 文件是刚 readdir 出来的，读失败 = 真 IO 故障，抛出不忽略
    const content = await fs.readFile(path.join(workflowsDir, file), 'utf-8');
    if (GOVERNANCE_COMMAND_PATTERN.test(content)) {
      return file;
    }
  }
  return undefined;
}

/**
 * 设置治理 CI workflow（目标已在场，或已有 workflow 覆盖治理命令时不新建 CI 面）
 *
 * 仅 github 形有本站点：gitlab 的治理任务已并入 `.gitlab-ci.yml` 正文（一个平台一份
 * CI 文件，harness#143）；`none` = 不创建任何 CI 文件，治理 CI 面随之不建
 * （harness#156 裁决 F1；治理文档面不受影响，见 setupGovernance 1–4）。
 */
async function setupGovernanceWorkflow(
  projectPath: string,
  level: string,
  io: CommandIO,
  platform: CiPlatform | 'none',
): Promise<void> {
  if (platform !== 'github') return;

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
