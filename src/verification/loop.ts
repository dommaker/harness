/**
 * 验证循环（Gather-Act-Verify）
 *
 * 编排验证流程：
 * 1. Gather：收集当前状态
 * 2. Act：执行动作
 * 3. Verify：验证结果
 * 失败时重试，最多 N 次
 */

import type {
  VerificationLoopConfig,
  LoopSnapshot,
  LoopStatus,
  VerificationResult,
  GatherState,
  ActAction,
  VerificationContext,
} from './types';
import { RulesBasedVerification } from './rules-based';

export type GatherFn = (attempt: number) => Promise<GatherState>;
export type ActFn = (state: GatherState, results: VerificationResult[]) => Promise<ActAction>;

export class VerificationLoop {
  private config: VerificationLoopConfig;
  private verifier: RulesBasedVerification;
  private status: LoopStatus = 'idle';
  private attempt = 0;
  private results: VerificationResult[] = [];
  private lastError?: string;

  constructor(config: VerificationLoopConfig) {
    this.config = config;
    this.verifier = new RulesBasedVerification(config.rules);
  }

  /**
   * 执行验证循环
   */
  async run(
    context: VerificationContext,
    gather: GatherFn,
    act?: ActFn,
  ): Promise<LoopSnapshot> {
    this.status = 'idle';
    this.attempt = 0;
    this.results = [];
    this.lastError = undefined;

    while (this.attempt < this.config.maxRetries) {
      this.attempt++;

      // Gather
      this.status = 'gathering';
      let gatherState: GatherState;
      try {
        gatherState = await gather(this.attempt);
      } catch (error) {
        this.lastError = `Gather 失败: ${error instanceof Error ? error.message : String(error)}`;
        this.status = 'failed';
        return this.snapshot();
      }

      // Act（可选）
      if (act && this.attempt > 1) {
        this.status = 'acting';
        try {
          const action = await act(gatherState, this.results);
          if (action.type === 'abort') {
            this.lastError = `Act 中止: ${action.description}`;
            this.status = 'failed';
            return this.snapshot();
          }
          if (action.type === 'skip') {
            this.status = 'passed';
            return this.snapshot();
          }
        } catch (error) {
          this.lastError = `Act 失败: ${error instanceof Error ? error.message : String(error)}`;
          this.status = 'failed';
          return this.snapshot();
        }
      }

      // Verify
      this.status = 'verifying';
      try {
        this.results = await this.verifier.verifyAll(context);
      } catch (error) {
        this.lastError = `Verify 失败: ${error instanceof Error ? error.message : String(error)}`;
        this.status = 'failed';
        return this.snapshot();
      }

      const allPassed = this.results.every(r => r.passed);
      if (allPassed) {
        this.status = 'passed';
        return this.snapshot();
      }

      // failFast: 首次失败立即停止
      if (this.config.failFast) {
        this.lastError = '验证失败 (failFast)';
        this.status = 'failed';
        return this.snapshot();
      }
    }

    this.lastError = `达到最大重试次数 (${this.config.maxRetries})`;
    this.status = 'failed';
    return this.snapshot();
  }

  private snapshot(): LoopSnapshot {
    return {
      status: this.status,
      attempt: this.attempt,
      maxRetries: this.config.maxRetries,
      results: this.results,
      lastError: this.lastError,
      timestamp: new Date().toISOString(),
    };
  }

  getStatus(): LoopStatus {
    return this.status;
  }

  getAttempt(): number {
    return this.attempt;
  }

  getResults(): VerificationResult[] {
    return [...this.results];
  }
}
