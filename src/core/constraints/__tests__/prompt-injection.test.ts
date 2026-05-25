/**
 * Tests for prompt-injection.ts
 *
 * formatConstraintsForPrompt is pure logic — no file I/O, no external state.
 */

import { formatConstraintsForPrompt } from '../prompt-injection';

describe('formatConstraintsForPrompt', () => {
  it('returns constraints with injectPrompt for deploy role', () => {
    const result = formatConstraintsForPrompt('deploy');
    // deploy maps to ['diagnosis'], analysis_verification_gate has diagnosis trigger
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('analysis_verification_gate');
  });

  it('returns constraints with injectPrompt for monitor role', () => {
    const result = formatConstraintsForPrompt('monitor');
    // monitor maps to ['monitoring', 'diagnosis']
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('analysis_verification_gate');
  });

  it('returns constraints with injectPrompt for triage role', () => {
    const result = formatConstraintsForPrompt('triage');
    // triage maps to ['triage', 'diagnosis'], analysis_verification_gate has diagnosis trigger
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('analysis_verification_gate');
  });

  it('returns formatted constraints for analyst role', () => {
    const result = formatConstraintsForPrompt('analyst');
    // analyst has triggers: design_request, api_change, code_implementation
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('铁律');
    expect(result).toContain('指导原则');
    expect(result).not.toContain('提示');
  });

  it('returns formatted constraints for executor role', () => {
    const result = formatConstraintsForPrompt('executor');
    // executor has the most triggers
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('铁律');
    expect(result).toContain('指导原则');
    expect(result).toContain('提示');
  });

  it('returns formatted constraints for reviewer role', () => {
    const result = formatConstraintsForPrompt('reviewer');
    // reviewer triggers: code_implementation
    expect(result).toContain('## 行为约束（前置声明）');
    expect(result).toContain('指导原则'); // has injectPrompt guidelines with code_implementation trigger
  });

  it('includes constraint IDs in the output', () => {
    const result = formatConstraintsForPrompt('executor');
    // Should contain some known constraint IDs
    expect(result).toContain('**no_self_approval**');
    expect(result).toContain('**incremental_progress**');
  });

  it('only includes constraints with promptInjection field', () => {
    const result = formatConstraintsForPrompt('executor');
    // docs_freshness has no promptInjection field so should not appear
    expect(result).not.toContain('**docs_freshness**');
  });

  it('sorts constraints by level: iron_law, guideline, tip', () => {
    const result = formatConstraintsForPrompt('executor');
    const ironLawIdx = result.indexOf('### 铁律（绝对禁止，无例外）');
    const guidelineIdx = result.indexOf('### 指导原则（优先建议）');
    const tipIdx = result.indexOf('### 提示');

    // Iron law section should appear before guideline section
    expect(ironLawIdx).toBeLessThan(guidelineIdx);

    // Tip section should appear last (if present)
    // Note: tips with executor triggers may or may not exist
    if (tipIdx >= 0) {
      expect(guidelineIdx).toBeLessThan(tipIdx);
    }
  });

  it('handles unknown role gracefully', () => {
    const result = formatConstraintsForPrompt('unknown' as any);
    expect(result).toBe('');
  });
});
