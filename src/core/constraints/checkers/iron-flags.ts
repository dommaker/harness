/**
 * 铁律层轻量检查（工单 21）：纯上下文证据标志判定，无 I/O
 */

import { contextFlag } from './types';

export const noSelfApproval = contextFlag(
  'no_self_approval',
  ctx => ctx.hasTest === true
);

export const noCompletionWithoutVerification = contextFlag(
  'no_completion_without_verification',
  ctx => ctx.hasVerificationEvidence === true
);

export const incrementalProgress = contextFlag(
  'incremental_progress',
  // undefined = 未验证 → Iron Law 必须显式确认
  ctx => ctx.hasSingleTask === true
);

export const verifyExternalCapability = contextFlag(
  'verify_external_capability',
  ctx => ctx.hasExternalCapabilityVerification === true
);

export const noImplementationWithoutRequirementReview = contextFlag(
  'no_implementation_without_requirement_review',
  ctx => ctx.hasRequirementReview === true
);

export const noImplementationWithoutRequirement = contextFlag(
  'no_implementation_without_requirement',
  ctx => ctx.hasRequirement === true
);

export const preferWorktree = contextFlag(
  'prefer_worktree',
  ctx => ctx.hasWorktree === true
);

export const noClaimWithoutEvidence = contextFlag(
  'no_claim_without_evidence',
  ctx =>
    ctx.hasVerificationEvidence === true ||
    (ctx.taskDescription || '').includes('test') ||
    ctx.hasTest === true
);

export const noDeleteWithoutContext = contextFlag(
  'no_delete_without_context',
  ctx =>
    ctx.hasRequirementReview === true ||
    ctx.hasRequirement === true ||
    ctx.isExistingDesign === true
);

export const twoStageReviewRequired = contextFlag(
  'two_stage_review_required',
  ctx => ctx.hasTwoStageReview === true
);
