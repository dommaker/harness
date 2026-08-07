/**
 * 指导原则层轻量检查（工单 21）：纯上下文证据标志判定，无 I/O
 */

import { contextFlag } from './types';

export const noFixWithoutRootCause = contextFlag(
  'no_fix_without_root_cause',
  ctx => ctx.hasRootCauseInvestigation === true
);

export const noCodeWithoutTest = contextFlag(
  'no_code_without_test',
  ctx => ctx.hasFailingTest === true
);

export const simplestSolutionFirst = contextFlag(
  'simplest_solution_first',
  ctx => ctx.hasReuseCheck === true
);

export const noCreationWithoutReuseCheck = contextFlag(
  'no_creation_without_reuse_check',
  ctx => ctx.hasReuseCheck === true
);

export const noSkillWithoutTest = contextFlag(
  'no_skill_without_test',
  ctx => ctx.hasTest === true
);
