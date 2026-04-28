/**
 * harness review 命令
 *
 * 代码审查门控，检查审查状态
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
export async function review(options: ReviewOptions): Promise<void> {
  console.log(chalk.blue('👀 代码审查门控检查...'));

  const projectPath = options.projectPath || process.cwd();
  const minReviewers = options.minReviewers || 1;

  try {
    // 获取当前分支
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const currentBranch = branch.trim();
    console.log(chalk.gray(`当前分支: ${currentBranch}`));

    // 尝试获取 PR 信息
    try {
      const { stdout: prInfo } = await execAsync('gh pr view --json number,title,state,reviewDecision,reviews', {
        cwd: projectPath,
      });
      const pr = JSON.parse(prInfo);

      console.log();
      console.log(chalk.cyan(`PR #${pr.number}: ${pr.title}`));
      console.log(chalk.gray(`状态: ${pr.state}`));

      // 检查审查决策
      if (pr.reviewDecision === 'APPROVED') {
        console.log(chalk.green(`审查决策: APPROVED ✅`));
        console.log();
        console.log(chalk.green('✅ 代码审查门控检查通过'));
        return;
      } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
        console.log(chalk.red(`审查决策: CHANGES_REQUESTED ❌`));
        console.log();
        console.log(chalk.red('❌ 代码审查门控检查失败'));
        console.log(chalk.red('   有变更请求未处理'));
        process.exit(1);
        return;
      } else if (pr.reviewDecision === 'REVIEW_REQUIRED') {
        console.log(chalk.yellow(`审查决策: REVIEW_REQUIRED`));
        console.log();
        console.log(chalk.red('❌ 代码审查门控检查失败'));
        console.log(chalk.yellow(`   需要至少 ${minReviewers} 个审查`));
        process.exit(1);
        return;
      }

      // 检查审批数
      const approvals = pr.reviews?.filter((r: any) => r.state === 'APPROVED').length || 0;
      if (approvals >= minReviewers) {
        console.log();
        console.log(chalk.green('✅ 代码审查门控检查通过'));
        console.log(chalk.gray(`   审批数: ${approvals}`));
      } else {
        console.log();
        console.log(chalk.red('❌ 代码审查门控检查失败'));
        console.log(chalk.yellow(`   当前审批: ${approvals}`));
        console.log(chalk.yellow(`   所需审批: ${minReviewers}`));
        process.exit(1);
      }
    } catch {
      console.log();
      console.log(chalk.yellow('⚠️  未找到关联的 PR'));
      console.log(chalk.gray('   使用 gh pr create 创建 PR'));
      process.exit(1);
    }
  } catch (error: any) {
    console.log();
    console.log(chalk.red('❌ 代码审查门控检查出错'));
    console.log(chalk.red(`   ${error.message}`));

    if (error.message.includes('not a git repository')) {
      console.log();
      console.log(chalk.gray('提示: 此命令需要在 Git 仓库中运行'));
    }

    process.exit(1);
  }
}

/**
 * 显示审查状态详情
 */
export async function reviewStatus(options: ReviewOptions): Promise<void> {
  console.log(chalk.blue('👀 代码审查状态...\n'));

  const projectPath = options.projectPath || process.cwd();

  try {
    // 获取当前分支
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const currentBranch = branch.trim();

    console.log(chalk.gray(`当前分支: ${currentBranch}`));

    // 尝试获取 PR 信息
    try {
      const { stdout: prInfo } = await execAsync('gh pr view --json number,title,state,reviewDecision,reviews', {
        cwd: projectPath,
      });
      const pr = JSON.parse(prInfo);

      console.log();
      console.log(chalk.cyan(`PR #${pr.number}: ${pr.title}`));
      console.log(chalk.gray(`状态: ${pr.state}`));

      if (pr.reviewDecision) {
        const decisionColor = pr.reviewDecision === 'APPROVED' ? chalk.green : chalk.yellow;
        console.log(decisionColor(`审查决策: ${pr.reviewDecision}`));
      }

      if (pr.reviews && pr.reviews.length > 0) {
        console.log();
        console.log(chalk.gray('审查历史:'));
        pr.reviews.forEach((r: any) => {
          const statusColor = r.state === 'APPROVED' ? chalk.green :
                              r.state === 'CHANGES_REQUESTED' ? chalk.red : chalk.gray;
          console.log(statusColor(`  - ${r.author?.login || 'unknown'}: ${r.state}`));
        });
      }
    } catch {
      console.log(chalk.yellow('\n⚠️  未找到关联的 PR'));
      console.log(chalk.gray('   使用 gh pr create 创建 PR'));
    }
  } catch (error: any) {
    console.log(chalk.red(`❌ 获取审查状态失败: ${error.message}`));
  }
}
