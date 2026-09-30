/**
 * init 的 Git hooks 落盘（Phase 3 自 init.ts 拆出，纯移位）
 *
 * 本地防线两道（harness#144）：pre-commit 查暂存的（增量、快反馈），
 * pre-push 查整仓的（全量、兜底）。落盘语义在 scaffold plan。
 */

import chalk from 'chalk';
import * as path from 'path';
import { log, type CommandIO } from '../../command-contract';
import {
  runPlan,
  nodeScaffoldFs,
  preCommitHookFile,
  prePushHookFile,
} from '../scaffold';

/**
 * 设置 Git hooks（无 .git 即整站跳过；落盘语义在 scaffold plan）
 *
 * 两道：pre-commit 查暂存的（增量、快反馈），pre-push 查整仓的（全量、兜底，
 * harness#144）。跳过旗帜 `--no-git-hooks` 在命令层翻成「本站点不进 plan」。
 */
export async function setupGitHooks(projectPath: string, io: CommandIO): Promise<void> {
  if (!(await nodeScaffoldFs.exists(path.join(projectPath, '.git')))) {
    log(io, chalk.yellow('⚠️  未检测到 Git 仓库，跳过 Git hooks'));
    log(io, chalk.gray('💡 初始化 Git 后可运行 npx @dommaker/harness init --print-snippets 查看配置'));
    return;
  }
  await runPlan([preCommitHookFile(projectPath), prePushHookFile(projectPath)], io);
}
