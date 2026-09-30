/**
 * harness init 命令（入口编排；Phase 3 拆分后本文件只留入参面与主流程）
 *
 * 初始化项目的 harness 配置。实现拆分（纯移位）：
 * - index.ts（本文件）  InitOptions + init() 主流程（config.yml 写入与落盘编排）
 * - presets.ts          preset / governance 预设数据表
 * - ci-platform.ts      --ci 平台解析（flag > config.yml > github，harness#143）
 * - snippets.ts         --print-snippets 片段视图
 * - git-hooks.ts        Git hooks 落盘（pre-commit / pre-push 两道本地防线）
 * - ci-wiring.ts        服务端 CI 接线（harness-check 站点，github/gitlab）
 * - output-style.ts     CLAUDE.md Output Style 段写入（标记化幂等）
 * - governance.ts       治理文件生成（CHANGELOG / CONTEXT.md / 治理 CI workflow）
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getHarnessPackageVersion } from '../../../utils/package-version';
import type { CiPlatform } from '../../../types/project-config';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  runPlan,
  checkpointsFile,
  resolutionsFile,
} from '../scaffold';
import { PRESETS, GOVERNANCE_PRESETS } from './presets';
import { resolveCiPlatform, readConfiguredCiPlatform } from './ci-platform';
import { printSnippets } from './snippets';
import { setupGitHooks } from './git-hooks';
import { setupCiWiring } from './ci-wiring';
import { setupGovernance } from './governance';

export interface InitOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 预设名称 */
  preset: 'strict' | 'standard' | 'relaxed';
  /** 治理级别（值域 = `GOVERNANCE_PRESETS` 键集合，非法值在命令入口判 usage-error、零落盘，harness#156） */
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

  // `-g` 值域校验在命令入口（harness#156 裁决 F2，与 #152 脏输入 fail-loud 同判据）：
  // 非法值 usage-error、先于任何落盘；合法值域与装配共用同一份 GOVERNANCE_PRESETS 表，
  // github / gitlab / none 三平台同判（bin 把用户敲的字符串原样递进来）。
  // 用 Object.hasOwn 而非 `in`（harness#164）：`in` 走原型链，`-g constructor`/`toString`
  // 会穿透校验、把 Object 构造函数写进 configData 并在 yaml.dump 炸成 YAMLException。
  if (options.governance !== undefined && !Object.hasOwn(GOVERNANCE_PRESETS, options.governance)) {
    const reason = `-g/--governance 取值非法: ${String(options.governance)}（可取 ${Object.keys(GOVERNANCE_PRESETS).join(' | ')}）`;
    logError(io, chalk.red(`❌ 用法错误: ${reason}`));
    return { kind: 'usage-error', reason };
  }

  // 只输出代码片段
  if (options.printSnippets) {
    printSnippets(io, ci.platform, options.governance);
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

  // 受管示例文件：检查点 / Resolutions（RKB 狗粮）
  await runPlan(
    [checkpointsFile(projectPath), resolutionsFile(projectPath)],
    io,
  );

  // CAPABILITIES.md / CHANGELOG.md 由 sync-docs（AI 治理）管理，init 不创建

  // 创建 Git hooks
  if (options.gitHooks !== false) {
    await setupGitHooks(projectPath, io);
  }

  // 服务端 CI 接线（平台维度）：`none` = CI 站点干脆不进 plan
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
  log(io, chalk.gray('  2. 正常开发：每次 git commit 查暂存的（增量快反馈），每次 git push 查整仓的（全量兜底）——重复是设计使然'));
  log(io, chalk.gray('  3. 运行 harness status 查看状态'));
  log(io);
  log(io, chalk.blue('💡 提示: 使用 harness init --print-snippets 查看配置代码片段'));
  return { kind: 'ok' };
}
