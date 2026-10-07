/**
 * harness review 命令
 *
 * 代码审查门控，检查审查状态
 */

import chalk from 'chalk';
import { execAsync } from '../../utils/exec';
import { ReviewGate } from '../../gates/review';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { reportGateDecision, reportGateError } from '../gate-command';

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

    const decision = await gate.evaluate({ projectPath });

    return reportGateDecision(
      io,
      {
        gateId: 'review',
        label: '代码审查门控',
        onPass: (r) =>
          r.details
            ? [chalk.gray(`   审批: ${r.details.approvals ?? 0}, 变更请求: ${r.details.changesRequested ?? 0}`)]
            : [],
        onFail: (r) => (r.details?.suggestion ? [chalk.gray(`   ${r.details.suggestion}`)] : []),
      },
      decision
    );
  } catch (error) {
    return reportGateError(io, 'review', '代码审查门控', error, (message) =>
      message.includes('not a git repository')
        ? ['', chalk.gray('提示: 此命令需要在 Git 仓库中运行')]
        : []
    );
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
        (pr.reviews as Array<{ state?: string; author?: { login?: string } }>).forEach((r) => {
          const statusColor = r.state === 'APPROVED' ? chalk.green :
                              r.state === 'CHANGES_REQUESTED' ? chalk.red : chalk.gray;
          log(io, statusColor(`  - ${r.author?.login || 'unknown'}: ${r.state}`));
        });
      }
    } catch (error) {
      // 「gh 说没有 PR」= 合法状态（提示即可）；gh 未安装/超时/认证失败/输出损坏 = 调用失败，上抛走 fail
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no pull requests found')) {
        log(io, chalk.yellow('\n⚠️  未找到关联的 PR'));
        log(io, chalk.gray('   使用 gh pr create 创建 PR'));
        return { kind: 'ok' };
      }
      throw error;
    }
    return { kind: 'ok' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // 只兜合法情形：不在 git 仓内 = 无审查状态可查（skip）；其余（gh 失败等）= fail
    if (message.includes('not a git repository')) {
      log(io, chalk.yellow('⚠️  当前目录不是 Git 仓库，无法获取审查状态'));
      return { kind: 'skip', reason: '获取审查状态跳过: 不是 Git 仓库' };
    }
    log(io, chalk.red(`❌ 获取审查状态失败: ${message}`));
    return { kind: 'fail', reason: `获取审查状态失败: ${message}` };
  }
}
