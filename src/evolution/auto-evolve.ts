/**
 * 约束自动进化
 *
 * 纯计算：接收 traces + anomalies，返回进化结果。
 * 不读写文件，数据存储由调用方负责。
 */

import type { ExecutionTrace, TraceAnomaly } from '../types/trace';
import type { LLMAdapter } from '../llm/types';
import { ConstraintDoctor } from '../monitoring/constraint-doctor';
import type { Diagnosis } from '../monitoring/constraint-doctor';
import { ConstraintEvolver } from '../monitoring/constraint-evolver';
import type { ConstraintProposal } from '../monitoring/constraint-evolver';
import { ConstraintLifecycleRunner } from '../constraints/lifecycle-runner';
import type { ExecutionResult } from '../constraints/lifecycle-runner';

export interface AutoEvolveOptions {
  /** 自动审核低风险提案（默认 true） */
  autoApproveLowRisk?: boolean;
  /** LLM adapter（用于深度诊断，可选） */
  llm?: LLMAdapter;
}

export interface AutoEvolveResult {
  /** 诊断结果 */
  diagnoses: Diagnosis[];
  /** 提案列表 */
  proposals: ConstraintProposal[];
  /** 自动审核通过数 */
  autoApproved: number;
  /** 需要人工审核数 */
  needsReview: number;
  /** 执行结果 */
  executions: ExecutionResult[];
}

/**
 * 自动进化：traces + anomalies → 诊断 → 提案 → 审核 → 执行
 *
 * 纯计算，不读写文件。调用方负责数据存储。
 */
export async function autoEvolve(
  traces: ExecutionTrace[],
  anomalies: TraceAnomaly[],
  options?: AutoEvolveOptions,
): Promise<AutoEvolveResult> {
  const { autoApproveLowRisk = true, llm } = options ?? {};

  const doctor = new ConstraintDoctor({ enabled: !!llm }, llm);
  doctor.setData(traces);

  const evolver = new ConstraintEvolver();
  const runner = new ConstraintLifecycleRunner();

  const diagnoses: Diagnosis[] = [];
  const proposals: ConstraintProposal[] = [];
  const executions: ExecutionResult[] = [];
  let autoApproved = 0;
  let needsReview = 0;

  // 1. 诊断每个异常
  for (const anomaly of anomalies) {
    const diagnosis = await doctor.diagnose(anomaly);
    diagnoses.push(diagnosis);

    if (!diagnosis.needsChange) continue;

    // 2. 生成提案
    const proposal = await evolver.propose(diagnosis);
    if (!proposal) continue;

    // 3. 审核
    const review = evolver.review(proposal);

    if (review.accepted && autoApproveLowRisk) {
      proposal.status = 'accepted';
      autoApproved++;

      // 4. 执行
      const result = runner.execute(proposal);
      executions.push(result);
      if (result.success) {
        proposal.status = 'implemented';
      }
    } else {
      proposal.status = 'reviewing';
      needsReview++;
      if (review.modifications) {
        Object.assign(proposal.content, review.modifications);
      }
    }

    proposal.reviewComment = review.comment;
    proposals.push(proposal);
  }

  return { diagnoses, proposals, autoApproved, needsReview, executions };
}
