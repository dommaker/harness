/**
 * verifyTddChain 测试（studio#160 验收：伪造引用三形态 / Tests: none waiver / 免检分类）
 */

import { verifyTddChain } from '../tdd-chain';
import type { CommitInput } from '../types';

const sha = (n: number) => n.toString(16).padStart(40, '0');

function commit(partial: Partial<CommitInput> & { sha: string }): CommitInput {
  return { subject: 'phase(impl): x', body: '', files: ['src/a.ts'], ...partial };
}

describe('verifyTddChain', () => {
  it('合法引用链 → pass（测试 commit 在前，实现 commit 引用它）', () => {
    const commits = [
      commit({ sha: sha(1), files: ['src/a.test.ts'], subject: 'phase(test): add test' }),
      commit({ sha: sha(2), files: ['src/a.ts'], body: 'impl\n\nTested-By: ' + sha(1) }),
    ];
    const result = verifyTddChain(commits);
    expect(result.verdict).toBe('pass');
    expect(result.commits.map((c) => c.verdict)).toEqual(['skip', 'pass']);
  });

  it('短 sha（7 位前缀）引用可命中', () => {
    const commits = [
      commit({ sha: sha(1), files: ['__tests__/a.ts'] }),
      commit({ sha: sha(2), body: 'Tested-By: ' + sha(1).slice(0, 7) }),
    ];
    expect(verifyTddChain(commits).verdict).toBe('pass');
  });

  it('伪造引用：sha 不在提交集内 → violation', () => {
    const commits = [commit({ sha: sha(2), body: 'Tested-By: ' + sha(9) })];
    const result = verifyTddChain(commits);
    expect(result.verdict).toBe('violation');
    expect(result.commits[0].reason).toContain('不在本 WU 提交集内');
  });

  it('伪造引用：被引 commit 位置在本 commit 之后 → violation', () => {
    const commits = [
      commit({ sha: sha(2), body: 'Tested-By: ' + sha(1) }),
      commit({ sha: sha(1), files: ['src/a.test.ts'] }),
    ];
    const result = verifyTddChain(commits);
    expect(result.verdict).toBe('violation');
    expect(result.commits[0].reason).toContain('位置不在本 commit 之前');
  });

  it('伪造引用：被引 commit 文件清单不含测试文件 → violation', () => {
    const commits = [
      commit({ sha: sha(1), files: ['src/b.ts'] }),
      commit({ sha: sha(2), body: 'Tested-By: ' + sha(1) }),
    ];
    const result = verifyTddChain(commits);
    expect(result.verdict).toBe('violation');
    expect(result.commits[1].reason).toContain('未命中 test_globs');
  });

  it('缺 Tested-By trailer → violation', () => {
    const result = verifyTddChain([commit({ sha: sha(1) })]);
    expect(result.verdict).toBe('violation');
    expect(result.commits[0].reason).toContain('缺 Tested-By trailer');
  });

  it('Tests: none trailer → waiver（放行，不算 violation）', () => {
    const result = verifyTddChain([commit({ sha: sha(1), body: 'chore\n\nTests: none' })]);
    expect(result.verdict).toBe('pass');
    expect(result.commits[0].verdict).toBe('waiver');
  });

  it('纯测试 commit 与纯非代码 commit 天然免检', () => {
    const commits = [
      commit({ sha: sha(1), files: ['src/a.test.ts'] }),
      commit({ sha: sha(2), files: ['README.md', 'docs/guide.md'] }),
    ];
    const result = verifyTddChain(commits);
    expect(result.verdict).toBe('pass');
    expect(result.commits.every((c) => c.verdict === 'skip')).toBe(true);
  });

  it('混合 commit（代码+测试同 commit）仍需引用链', () => {
    const commits = [commit({ sha: sha(1), files: ['src/a.ts', 'src/a.test.ts'] })];
    expect(verifyTddChain(commits).verdict).toBe('violation');
  });

  it('自定义 test_globs / noncode_globs 生效', () => {
    const commits = [commit({ sha: sha(1), files: ['assets/logo.png'] })];
    const withGlob = verifyTddChain(commits, { noncodeGlobs: ['**/*.png'] });
    expect(withGlob.commits[0].verdict).toBe('skip');
    expect(verifyTddChain(commits).commits[0].verdict).toBe('violation');
  });

  it('checker 关闭 / 总开关关闭 → skip', () => {
    const commits = [commit({ sha: sha(1) })];
    expect(verifyTddChain(commits, { checkers: { tddChain: false } }).verdict).toBe('skip');
    expect(verifyTddChain(commits, { enabled: false }).verdict).toBe('skip');
  });
});
