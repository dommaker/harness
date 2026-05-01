/**
 * OutputGuardrail 测试
 */

import { OutputGuardrail } from '../output-guardrail';

describe('OutputGuardrail', () => {
  let guardrail: OutputGuardrail;

  beforeEach(() => {
    guardrail = new OutputGuardrail({ checkKnowledgeRefs: true });
  });

  describe('check', () => {
    it('应该通过正常输出', () => {
      const result = guardrail.check('function add(a: number, b: number) { return a + b; }');
      expect(result.safe).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it('应该检测 API key', () => {
      const result = guardrail.check('api_key = "sk-1234567890abcdef1234567890abcdef"');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'sensitive_info')).toBe(true);
    });

    it('应该检测 AWS key', () => {
      const result = guardrail.check('AWS_KEY=AKIAIOSFODNN7EXAMPLE');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'sensitive_info')).toBe(true);
    });

    it('应该检测 private key', () => {
      const result = guardrail.check('-----BEGIN PRIVATE KEY-----\nMIIEvg...');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'sensitive_info')).toBe(true);
    });

    it('应该检测 GitHub token', () => {
      const result = guardrail.check('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'sensitive_info')).toBe(true);
    });

    it('应该检测 connection string', () => {
      const result = guardrail.check('MONGO_URI=mongodb://user:pass@host:27017/db');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'sensitive_info')).toBe(true);
    });

    it('应该检测 TODO/FIXME', () => {
      const result = guardrail.check('function test() {\n  // TODO: fix this\n  return true;\n}');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'quality' && v.description.includes('TODO'))).toBe(true);
    });

    it('应该检测 console.log', () => {
      const result = guardrail.check('console.log("debug");');
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === 'quality' && v.description.includes('console.log'))).toBe(true);
    });

    it('应该检测缺失的知识引用', () => {
      const result = guardrail.check('some output', ['kb-001', 'kb-002']);
      expect(result.safe).toBe(false);
      expect(result.violations.filter(v => v.type === 'knowledge_missing').length).toBe(2);
    });

    it('应该通过包含引用 ID 的输出', () => {
      const result = guardrail.check('output references kb-001 and kb-002', ['kb-001', 'kb-002']);
      expect(result.safe).toBe(true);
    });
  });

  describe('sanitize', () => {
    it('应该清理敏感信息', () => {
      const result = guardrail.check('api_key = "sk-1234567890abcdef1234567890abcdef"');
      expect(result.safe).toBe(false);
      // sanitize is called internally, sanitizedContent should be set
      expect(result.sanitizedContent).toBeDefined();
    });
  });

  describe('custom config', () => {
    it('应该支持自定义敏感模式', () => {
      const guardrail = new OutputGuardrail({
        sensitivePatterns: [/CUSTOM_SECRET:\s*\w+/g],
      });

      const result = guardrail.check('CUSTOM_SECRET: abc123');
      expect(result.safe).toBe(false);
    });

    it('应该支持关闭知识引用检查', () => {
      const guardrail = new OutputGuardrail({ checkKnowledgeRefs: false });
      const result = guardrail.check('output', ['kb-001']);
      expect(result.safe).toBe(true);
    });
  });

  describe('location tracking', () => {
    it('应该报告违规所在行号', () => {
      const result = guardrail.check('line 1\nline 2\napi_key = "sk-1234567890abcdef1234567890abcdef"');
      const sensitiveViolation = result.violations.find(v => v.type === 'sensitive_info');
      expect(sensitiveViolation?.location?.line).toBe(3);
    });
  });
});
