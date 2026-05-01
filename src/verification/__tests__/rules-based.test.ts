/**
 * RulesBasedVerification 测试
 */

import { RulesBasedVerification } from '../rules-based';
import type { VerificationRule, VerificationContext } from '../types';

describe('RulesBasedVerification', () => {
  const context: VerificationContext = {
    projectRoot: process.cwd(),
  };

  describe('verifyAll', () => {
    it('应该通过空规则列表', async () => {
      const verifier = new RulesBasedVerification([]);
      const results = await verifier.verifyAll(context);
      expect(results.length).toBe(0);
    });

    it('应该执行所有规则', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'rule-1',
          type: 'custom',
          name: 'Rule 1',
          description: 'Always pass',
          verify: async () => ({ passed: true, ruleId: 'rule-1', duration: 0 }),
        },
        {
          id: 'rule-2',
          type: 'custom',
          name: 'Rule 2',
          description: 'Always pass',
          verify: async () => ({ passed: true, ruleId: 'rule-2', duration: 0 }),
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results.length).toBe(2);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('应该收集失败结果', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'pass',
          type: 'custom',
          name: 'Pass',
          description: '',
          verify: async () => ({ passed: true, ruleId: 'pass', duration: 0 }),
        },
        {
          id: 'fail',
          type: 'custom',
          name: 'Fail',
          description: '',
          verify: async () => ({ passed: false, ruleId: 'fail', message: 'failed', duration: 0 }),
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results.some(r => r.passed)).toBe(true);
      expect(results.some(r => !r.passed)).toBe(true);
    });
  });

  describe('command rules', () => {
    it('应该执行成功的命令', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'echo',
          type: 'test',
          name: 'Echo Test',
          description: 'Run echo',
          command: 'echo "hello"',
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(true);
      expect(results[0].details).toContain('hello');
    });

    it('应该处理失败的命令', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'fail-cmd',
          type: 'test',
          name: 'Fail Test',
          description: 'Run failing command',
          command: 'exit 1',
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
    });

    it('应该处理缺少 command 的规则', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'no-cmd',
          type: 'lint',
          name: 'No Command',
          description: 'Missing command',
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('缺少 command');
    });
  });

  describe('custom rules', () => {
    it('应该执行自定义验证函数', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'custom',
          type: 'custom',
          name: 'Custom Check',
          description: 'Check changed files',
          verify: async (ctx) => ({
            passed: (ctx.changedFiles?.length ?? 0) > 0,
            ruleId: 'custom',
            message: '需要变更文件',
            duration: 0,
          }),
        },
      ];

      const verifier = new RulesBasedVerification(rules);

      // 没有变更文件 -> 失败
      const failResults = await verifier.verifyAll(context);
      expect(failResults[0].passed).toBe(false);

      // 有变更文件 -> 通过
      const passResults = await verifier.verifyAll({ ...context, changedFiles: ['a.ts'] });
      expect(passResults[0].passed).toBe(true);
    });

    it('应该处理缺少 verify 的 custom 规则', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'no-verify',
          type: 'custom',
          name: 'No Verify',
          description: 'Missing verify function',
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('缺少 verify');
    });
  });

  describe('rule management', () => {
    it('应该添加规则', () => {
      const verifier = new RulesBasedVerification([]);
      verifier.addRule({
        id: 'new',
        type: 'custom',
        name: 'New',
        description: '',
        verify: async () => ({ passed: true, ruleId: 'new', duration: 0 }),
      });
      expect(verifier.getRules().length).toBe(1);
    });

    it('应该移除规则', () => {
      const verifier = new RulesBasedVerification([
        { id: 'a', type: 'custom', name: 'A', description: '' },
        { id: 'b', type: 'custom', name: 'B', description: '' },
      ]);
      verifier.removeRule('a');
      expect(verifier.getRules().length).toBe(1);
      expect(verifier.getRules()[0].id).toBe('b');
    });
  });

  describe('error handling', () => {
    it('应该处理验证函数抛出异常', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'throw',
          type: 'custom',
          name: 'Throw',
          description: '',
          verify: async () => { throw new Error('boom'); },
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('boom');
    });

    it('应该处理未知规则类型', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'unknown',
          type: 'unknown' as any,
          name: 'Unknown',
          description: '',
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('未知');
    });

    it('应该处理命令执行超时', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'timeout',
          type: 'test',
          name: 'Timeout Test',
          description: '',
          command: 'sleep 10',
          timeout: 100,
        },
      ];

      const verifier = new RulesBasedVerification(rules);
      const results = await verifier.verifyAll(context);
      expect(results[0].passed).toBe(false);
    }, 10000);
  });
});
