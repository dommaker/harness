/**
 * harness review 命令
 *
 * 代码审查门控，检查审查状态
 */

import chalk from 'chalk';
import { execAsync } from '../../utils/exec';
import { ReviewGate } from '../../gates/review';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ReviewOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 最少审查人数 */
  minReviewers?: number;
  /** 是否要求审批 */
  requireApproval?: boolean;
  /** 是否阻止变更请求 */
  blockOnChangesRequested?: boolean;
  /** 允许的审查者（逗号分隔） */
  allowedReviewers?: string;
}

/**
 * 执行审查门控
 */
export async function review(
  options: ReviewOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('👀 代码审查门控检查...'));

  const projectPath = options.projectPath || process.cwd();

  const gate = new ReviewGate({
    minReviewers: options.minReviewers ?? 1,
    requireApproval: options.requireApproval ?? true,
    blockOnChangesRequested: options.blockOnChangesRequested ?? true,
    allowedReviewers: options.allowedReviewers
      ? options.allowedReviewers.split(',').map(s => s.trim()).filter(Boolean)
      : [],
  });

  try {
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    log(io, chalk.gray(`当前分支: ${branch.trim()}`));

    const result = await gate.check({ projectPath, projectId: 'default' });

    log(io);
    if (result.passed) {
      log(io, chalk.green('✅ 代码审查门控检查通过'));
      if (result.details) {
        log(io, chalk.gray(`   审批: ${result.details.approvals ?? 0}, 变更请求: ${result.details.changesRequested ?? 0}`));
      }
    } else {
      log(io, chalk.red('❌ 代码审查门控检查失败'));
      log(io, chalk.red(`   ${result.message}`));
      if (result.details?.suggestion) {
        log(io, chalk.gray(`   ${result.details.suggestion}`));
      }
      return { kind: 'fail', reason: `review gate denied: ${result.message}` };
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io);
    log(io, chalk.red('❌ 代码审查门控检查出错'));
    log(io, chalk.red(`   ${error.message}`));

    if (error.message.includes('not a git repository')) {
      log(io);
      log(io, chalk.gray('提示: 此命令需要在 Git 仓库中运行'));
    }

    return { kind: 'fail', reason: `review gate error: ${error.message}` };
  }
}

/**
 * 显示审查状态详情
 */
export async function reviewStatus(
  options: ReviewOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('👀 代码审查状态...\n'));

  const projectPath = options.projectPath || process.cwd();

  try {
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    log(io, chalk.gray(`当前分支: ${branch.trim()}`));

    try {
      const { stdout: prInfo } = await execAsync('gh pr view --json number,title,state,reviewDecision,reviews', {
        cwd: projectPath,
      });
      const pr = JSON.parse(prInfo);

      log(io);
      log(io, chalk.cyan(`PR #${pr.number}: ${pr.title}`));
      log(io, chalk.gray(`状态: ${pr.state}`));

      if (pr.reviewDecision) {
        const decisionColor = pr.reviewDecision === 'APPROVED' ? chalk.green : chalk.yellow;
        log(io, decisionColor(`审查决策: ${pr.reviewDecision}`));
      }

      if (pr.reviews && pr.reviews.length > 0) {
        log(io);
        log(io, chalk.gray('审查历史:'));
        pr.reviews.forEach((r: any) => {
          const statusColor = r.state === 'APPROVED' ? chalk.green :
                              r.state === 'CHANGES_REQUESTED' ? chalk.red : chalk.gray;
          log(io, statusColor(`  - ${r.author?.login || 'unknown'}: ${r.state}`));
        });
      }
    } catch {
      log(io, chalk.yellow('\n⚠️  未找到关联的 PR'));
      log(io, chalk.gray('   使用 gh pr create 创建 PR'));
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io, chalk.red(`❌ 获取审查状态失败: ${error.message}`));
    return { kind: 'skip', reason: `获取审查状态失败: ${error.message}` };
  }
}
