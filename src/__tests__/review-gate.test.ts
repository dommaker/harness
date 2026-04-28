/**
 * ReviewGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ReviewGate } from '../gates/review';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

describe('ReviewGate', () => {
  const tempDir = join(process.cwd(), 'temp-test-review-gate');
  let gate: ReviewGate;

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    gate = new ReviewGate({ minReviewers: 1, requireApproval: true });
    
    // 初始化 git
    try {
      execSync('git init', { cwd: tempDir });
      execSync('git config user.name "test"', { cwd: tempDir });
      execSync('git config user.email "test@test.com"', { cwd: tempDir });
      writeFileSync(join(tempDir, 'test.txt'), 'test');
      execSync('git add .', { cwd: tempDir });
      execSync('git commit -m "initial"', { cwd: tempDir });
    } catch {
      // git 可能不可用
    }
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('check', () => {
    it('本地模式应该返回警告', async () => {
      const result = await gate.check({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.gate).toBe('review');
      expect(result.passed).toBe(false);  // requireApproval=true
      expect(result.message).toContain('本地模式');
    });

    it('禁用 requireApproval 应该通过', async () => {
      const relaxedGate = new ReviewGate({ requireApproval: false });
      
      const result = await relaxedGate.check({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.passed).toBe(true);
      expect(result.message).toContain('审查要求未启用');
    });
  });

  describe('配置', () => {
    it('应该能设置最小审批人数', () => {
      gate.setMinReviewers(2);
      
      const config = gate.getConfig();
      expect(config.minReviewers).toBe(2);
    });

    it('应该能获取配置', () => {
      const config = gate.getConfig();
      
      expect(config).toBeDefined();
      expect(config.minReviewers).toBeDefined();
      expect(config.requireApproval).toBeDefined();
    });
  });

  describe('checkLocalGit', () => {
    it('应该检查 git 状态', async () => {
      const result = await gate.check({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.details?.lastCommit).toBeDefined();
    });
  });
});
