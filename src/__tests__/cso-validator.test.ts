/**
 * CSOValidator 测试
 */

import { describe, it, expect } from '@jest/globals';
import { CSOValidator } from '../core/validators/cso';
import type { WorkflowMeta, StepMeta, ToolMeta } from '../types/cso';

describe('CSOValidator', () => {
  const validator = CSOValidator.getInstance();

  describe('单例模式', () => {
    it('应该返回单例实例', () => {
      const instance1 = CSOValidator.getInstance();
      const instance2 = CSOValidator.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('validateWorkflow', () => {
    it('有效的描述应该通过', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '用于处理用户登录场景，验证身份并创建会话',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.valid).toBe(true);
      expect(result.message).toContain('符合');
    });

    it('包含工作流关键词应该失败', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '首先验证用户身份，然后创建会话，最后返回令牌',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues?.some(i => i.type === 'workflow_summary')).toBe(true);
    });

    it('缺少触发关键词应该失败', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '验证用户身份并创建会话',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.issues?.some(i => i.type === 'missing_trigger')).toBe(true);
    });

    it('描述过长应该失败', () => {
      const longDesc = '用于处理用户登录场景，验证身份并创建会话'.repeat(12); // 228字符
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: longDesc,
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.issues?.some(i => i.type === 'too_long')).toBe(true);
    });

    it('多个问题应该全部返回', () => {
      const longDesc = '首先验证用户身份然后创建会话'.repeat(10);
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: longDesc,
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.issues?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateStep', () => {
    it('有效的步骤描述应该通过', () => {
      const step: StepMeta = {
        name: 'validate-user',
        description: '用于验证用户身份时，检查令牌有效性',
      };

      const result = validator.validateStep(step);

      expect(result.valid).toBe(true);
    });

    it('无效的步骤描述应该失败', () => {
      const step: StepMeta = {
        name: 'validate-user',
        description: 'Step 1: 验证令牌',
      };

      const result = validator.validateStep(step);

      expect(result.valid).toBe(false);
      expect(result.issues?.some(i => i.type === 'workflow_summary')).toBe(true);
    });
  });

  describe('validateTool', () => {
    it('有效的工具描述应该通过', () => {
      const tool: ToolMeta = {
        name: 'auth-tool',
        description: '用于认证场景，提供登录和令牌验证功能',
      };

      const result = validator.validateTool(tool);

      expect(result.valid).toBe(true);
    });

    it('无效的工具描述应该失败', () => {
      const tool: ToolMeta = {
        name: 'auth-tool',
        description: '首先调用登录API',
      };

      const result = validator.validateTool(tool);

      expect(result.valid).toBe(false);
    });
  });

  describe('建议生成', () => {
    it('无效描述应该包含建议', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '验证用户身份',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('建议');
    });

    it('有效描述不应该包含建议', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '用于验证用户身份',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.suggestion).toBeUndefined();
    });
  });

  describe('中文支持', () => {
    it('中文触发关键词应该被识别', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '当用户登录时，验证身份',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.issues?.some(i => i.type === 'missing_trigger')).toBe(false);
    });

    it('中文工作流关键词应该被识别', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: '首先检查权限，然后执行操作',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.issues?.some(i => i.type === 'workflow_summary')).toBe(true);
    });
  });

  describe('英文支持', () => {
    it('英文触发关键词应该被识别', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: 'Use for user authentication scenarios',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.issues?.some(i => i.type === 'missing_trigger')).toBe(false);
    });

    it('英文工作流关键词应该被识别', () => {
      const workflow: WorkflowMeta = {
        name: 'test-workflow',
        description: 'First validate the token, then create session',
      };

      const result = validator.validateWorkflow(workflow);

      expect(result.issues?.some(i => i.type === 'workflow_summary')).toBe(true);
    });
  });
});
