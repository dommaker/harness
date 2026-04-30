/**
 * 审查门禁
 * 
 * 检查代码审查状态：
 * - 是否有足够的审批
 * - 是否有变更请求
 * - 是否所有评论已解决
 */

import { execAsync } from '../utils/exec';
import type { GateResult, GateContext, ReviewGateConfig } from './types';

/**
 * 审查门禁
 */
export class ReviewGate {
  private config: Required<ReviewGateConfig>;

  constructor(config: Partial<ReviewGateConfig> = {}) {
    this.config = {
      minReviewers: config.minReviewers ?? 1,
      requireApproval: config.requireApproval ?? true,
      blockOnChangesRequested: config.blockOnChangesRequested ?? true,
      allowedReviewers: config.allowedReviewers ?? [],
    };
  }

  /**
   * 检查审查状态
   */
  async check(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    try {
      // 如果有 PR 号，使用 GitHub API
      if (context.prNumber) {
        return this.checkGitHubPR(context);
      }

      // 否则尝试从 git 获取
      return this.checkLocalGit(context);
    } catch (error: any) {
      return {
        gate: 'review',
        passed: false,
        message: `审查检查失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 检查 GitHub PR 审查状态
   */
  private async checkGitHubPR(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    try {
      // 使用 gh CLI 获取 PR 状态
      const { stdout } = await execAsync(
        `gh pr view ${context.prNumber} --json reviews,state`,
        { cwd: context.projectPath }
      );

      const pr = JSON.parse(stdout);
      const reviews = pr.reviews || [];

      // 统计审批和变更请求
      const approvals = reviews.filter((r: any) => r.state === 'APPROVED');
      const changesRequested = reviews.filter((r: any) => r.state === 'CHANGES_REQUESTED');
      const pending = reviews.filter((r: any) => r.state === 'PENDING' || r.state === 'COMMENTED');

      // 检查是否满足条件
      const passed = 
        approvals.length >= this.config.minReviewers &&
        (!this.config.blockOnChangesRequested || changesRequested.length === 0);

      return {
        gate: 'review',
        passed,
        message: passed
          ? `审查通过: ${approvals.length} 个审批`
          : `审查未通过: ${approvals.length}/${this.config.minReviewers} 审批, ${changesRequested.length} 个变更请求`,
        details: {
          approvals: approvals.length,
          changesRequested: changesRequested.length,
          pending: pending.length,
          minReviewers: this.config.minReviewers,
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      // gh CLI 不可用或 PR 不存在
      return {
        gate: 'review',
        passed: false,
        message: `无法获取 PR 状态: ${error.message}`,
        details: {
          suggestion: '确保已安装 gh CLI 并配置了 GitHub token',
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 本地 Git 检查
   */
  private async checkLocalGit(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    try {
      // 检查是否有最近的提交
      const { stdout: logOutput } = await execAsync(
        'git log -1 --pretty=format:"%H %s"',
        { cwd: context.projectPath }
      );

      // 检查是否有未推送的提交
      const { stdout: unpushed } = await execAsync(
        'git log @{u}..HEAD --oneline 2>/dev/null || echo ""',
        { cwd: context.projectPath }
      );

      const hasUnpushed = unpushed.trim().length > 0;

      // 本地模式无法验证审查，返回警告
      return {
        gate: 'review',
        passed: !this.config.requireApproval,
        message: this.config.requireApproval
          ? '本地模式无法验证审查，请通过 PR 进行代码审查'
          : '审查要求未启用，跳过检查',
        details: {
          lastCommit: logOutput,
          hasUnpushedCommits: hasUnpushed,
          requireApproval: this.config.requireApproval,
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        gate: 'review',
        passed: false,
        message: `Git 检查失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 设置最小审批人数
   */
  setMinReviewers(count: number): void {
    this.config.minReviewers = count;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ReviewGateConfig> {
    return { ...this.config };
  }
}
