/**
 * no_performative_agreement：表演性同意辅助检查（工单 21）
 *
 * 主要由 promptInjection 驱动，此处做辅助检查。
 */

import type { ConstraintCheck } from './types';

const PERFORMATIVE_START = /^(好的[，,]*\s*我[来去]做|明白了[，,]*|没问题[，,]*|ok[，,]*\s*i.?ll)/i;

export const noPerformativeAgreement: ConstraintCheck = {
  id: 'no_performative_agreement',
  evaluate(env) {
    const text = env.context.taskDescription || '';
    if (!text) return true;
    // 以表演性模式开头且总长度很短 → 视为表演性同意
    if (PERFORMATIVE_START.test(text) && text.length < 100) {
      return false;
    }
    return true;
  },
};
