/**
 * verifyPhaseFormat 测试（subject 不合规 / merge commit 违规）
 */

import { verifyPhaseFormat } from '../phase-format';
import type { CommitInput } from '../types';

const sha = (n: number) => n.toString(16).padStart(40, '0');

function commit(partial: Partial<CommitInput> & { sha: string }): CommitInput {
  return { subject: 'phase(impl): x', body: '', files: ['src/a.ts'], ...partial };
}

describe('verifyPhaseFormat', () => {
  it('合规 subject → pass', () => {
    const commits = [
      commit({ sha: sha(1), subject: 'phase(test): add chain tests' }),
      commit({ sha: sha(2), subject: 'phase(impl-2): wire it' }),
    ];
    const result = verifyPhaseFormat(commits);
    expect(result.verdict).toBe('pass');
  });

  it.each([
    'feat: not a phase subject',
    'phase: missing scope',
    'phase(Impl): uppercase scope',
    'phase(impl):missing space after colon',
    'phase(impl): ',
  ])('subject 不合规 → violation：%s', (subject) => {
    const result = verifyPhaseFormat([commit({ sha: sha(1), subject })]);
    expect(result.verdict).toBe('violation');
    expect(result.commits[0].reason).toContain('subject 不合规');
  });

  it('merge commit（显式 isMerge）→ violation', () => {
    const result = verifyPhaseFormat([commit({ sha: sha(1), isMerge: true })]);
    expect(result.verdict).toBe('violation');
    expect(result.commits[0].reason).toContain('merge commit');
  });

  it('merge commit（isMerge 缺省时 subject 启发式）→ violation', () => {
    const result = verifyPhaseFormat([
      commit({ sha: sha(1), subject: "Merge branch 'w/x'" }),
    ]);
    expect(result.verdict).toBe('violation');
  });

  it('显式 isMerge=false 覆盖 subject 启发式', () => {
    const result = verifyPhaseFormat([
      commit({ sha: sha(1), subject: 'Merge 字样但非 merge', isMerge: false }),
    ]);
    // subject 不含 phase 结构，仍因 subject 违规——但不应记 merge 违规
    expect(result.commits[0].reason).not.toContain('merge commit');
  });

  it('checker 关闭 → skip', () => {
    expect(verifyPhaseFormat([commit({ sha: sha(1) })], { checkers: { phaseFormat: false } }).verdict).toBe('skip');
  });
});
