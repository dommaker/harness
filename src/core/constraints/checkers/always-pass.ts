/**
 * 恒通过检查组（工单 21）
 *
 * 行为类约束由 promptInjection 注入驱动 + 事后检查，检查器侧恒通过；
 * Tips 仅作信息提示。这些约束无独立检查逻辑，故集中一处。
 */

import { alwaysPass } from './types';

// Mnilax guidelines + first-principles（injectPrompt=true，行为层，事后检查）
export const surgicalChangesOnly = alwaysPass('surgical_changes_only');
export const noModelForDeterministic = alwaysPass('no_model_for_deterministic');
export const noConflictBlending = alwaysPass('no_conflict_blending');
export const readBeforeWrite = alwaysPass('read_before_write');
export const followConventions = alwaysPass('follow_conventions');
export const firstPrinciplesFirst = alwaysPass('first_principles_first');
export const fixTheProblemNotTheGate = alwaysPass('fix_the_problem_not_the_gate');
export const diagnosisToFixGate = alwaysPass('diagnosis_to_fix_gate');

// Tips — 总是通过（仅提示）
export const readmeRequired = alwaysPass('readme_required');
export const docRequiredForPublicApi = alwaysPass('doc_required_for_public_api');
