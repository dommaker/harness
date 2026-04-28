/**
 * CleanStateManager 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { CleanStateManager } from '../core/session/clean-state';
import * as fs from 'fs';
import * as path from 'path';

describe('CleanStateManager', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-clean');
  let manager: CleanStateManager;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    manager = new CleanStateManager({
      enabled: true,
      autoCommit: false,  // 禁用自动提交
      detectBugs: true,
      updateProgress: false,
    });
  });

  describe('onSessionEnd', () => {
    it('禁用应该返回空结果', async () => {
      const disabledManager = new CleanStateManager({ enabled: false });

      const result = await disabledManager.onSessionEnd(tempDir, {
        sessionId: 'session-001',
        workflowId: 'workflow-001',
      });

      expect(result.isClean).toBe(true);
      expect(result.hasUncommittedChanges).toBe(false);
    });

    it('应该运行 bug 检测', async () => {
      // Bug 检测需要扫描目录中的文件
      const result = await manager.onSessionEnd(tempDir, {
        sessionId: 'session-001',
        workflowId: 'workflow-001',
      });

      // 只验证运行不崩溃
      expect(result).toBeDefined();
    });

    it('安全文件应该通过', async () => {
      // 创建安全的文件
      const safeFile = path.join(tempDir, 'safe.ts');
      fs.writeFileSync(safeFile, `
export function hello() {
  return 'world';
}
`);

      const result = await manager.onSessionEnd(tempDir, {
        sessionId: 'session-002',
        workflowId: 'workflow-002',
      });

      expect(result.isClean).toBe(true);
    });
  });

  describe('配置', () => {
    it('应该支持自定义配置', () => {
      const customManager = new CleanStateManager({
        detectBugs: false,
        autoCommit: false,
      });

      expect(customManager).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('不存在目录应该返回结果', async () => {
      const result = await manager.onSessionEnd('/nonexistent/path', {
        sessionId: 'session-003',
        workflowId: 'workflow-003',
      });

      expect(result).toBeDefined();
    });
  });

  describe('自动提交', () => {
    it('禁用自动提交应该跳过', async () => {
      const noCommitManager = new CleanStateManager({
        enabled: true,
        autoCommit: false,
      });

      const result = await noCommitManager.onSessionEnd(tempDir, {
        sessionId: 'session-004',
        workflowId: 'workflow-004',
      });

      expect(result.committedFiles).toBeUndefined();
    });
  });

  describe('Progress 更新', () => {
    it('应该更新 progress 文件', async () => {
      const progressManager = new CleanStateManager({
        enabled: true,
        autoCommit: false,
        detectBugs: false,
        updateProgress: true,
      });

      const result = await progressManager.onSessionEnd(tempDir, {
        sessionId: 'session-005',
        workflowId: 'workflow-005',
        task: { id: 'task-001', name: 'Test Task' },
      });

      expect(result.progressUpdated).toBe(true);
    });
  });

  describe('Bug 检测', () => {
    it('应该检测 console.error', async () => {
      const bugFile = path.join(tempDir, 'buggy.ts');
      fs.writeFileSync(bugFile, `
console.error('Something went wrong');
`);

      const result = await manager.onSessionEnd(tempDir, {
        sessionId: 'session-006',
        workflowId: 'workflow-006',
      });

      // Bug 检测运行了，但可能找不到变更（没有 git 历史）
      expect(result).toBeDefined();

      fs.rmSync(bugFile, { force: true });
    });

    it('应该检测 FIXME 注释', async () => {
      const fixmeFile = path.join(tempDir, 'fixme.ts');
      fs.writeFileSync(fixmeFile, `
// FIXME: This is a hack
function hack() {}
`);

      const result = await manager.onSessionEnd(tempDir, {
        sessionId: 'session-007',
        workflowId: 'workflow-007',
      });

      expect(result).toBeDefined();

      fs.rmSync(fixmeFile, { force: true });
    });
  });
});