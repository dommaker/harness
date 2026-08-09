/**
 * 铁律层轻量检查（工单 21）：纯上下文证据标志判定，无 I/O
 *
 * ADR-0001 后仅存活的三个 flag：hasVerificationEvidence / hasSingleTask / hasRequirement
 *
 * 三态语义（ADR-0001 防爆措施）：
 * - undefined = flag 未接线 → skip（不评估，CLI pre-commit 等路径不误报违规）
 * - 显式 false → fail；true → pass
 */

import { contextEvidenceFlag } from './types';

export const noCompletionWithoutVerification = contextEvidenceFlag(
  'no_completion_without_verification',
  ctx => ctx.hasVerificationEvidence
);

export const incrementalProgress = contextEvidenceFlag(
  'incremental_progress',
  ctx => ctx.hasSingleTask
);

export const noImplementationWithoutRequirement = contextEvidenceFlag(
  'no_implementation_without_requirement',
  ctx => ctx.hasRequirement
);
