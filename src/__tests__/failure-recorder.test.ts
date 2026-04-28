/**
 * FailureRecorder 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FailureRecorder } from '../failure/recorder';
import { ErrorType, FailureLevel } from '../failure/types';
import * as fs from 'fs';
import * as path from 'path';
import type { FailureRecord } from '../failure/types';

describe('FailureRecorder', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-recorder');
  const logFile = path.join(tempDir, 'failures.log');
  let recorder: FailureRecorder;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    recorder = new FailureRecorder({ logFile });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('record', () => {
    it('应该记录失败', async () => {
      const record: FailureRecord = {
        type: ErrorType.TEST_FAILED,
        level: FailureLevel.L1,
        message: 'Test failed',
        timestamp: Date.now(),
      };

      await recorder.record(record);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('TEST_FAILED');
      expect(content).toContain('Test failed');
    });

    it('应该追加多条记录', async () => {
      const record1: FailureRecord = {
        type: ErrorType.NETWORK_ERROR,
        level: FailureLevel.L1,
        message: 'Network failed',
        timestamp: Date.now(),
      };
      const record2: FailureRecord = {
        type: ErrorType.TIMEOUT,
        level: FailureLevel.L2,
        message: 'Timeout occurred',
        timestamp: Date.now(),
      };

      await recorder.record(record1);
      await recorder.record(record2);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('NETWORK_ERROR');
      expect(content).toContain('TIMEOUT');
    });
  });

  describe('getHistory', () => {
    it('应该读取所有记录', async () => {
      // 清空文件重新测试
      fs.writeFileSync(logFile, '');

      const record: FailureRecord = {
        type: ErrorType.VALIDATION_ERROR,
        level: FailureLevel.L2,
        message: 'Validation failed',
        timestamp: Date.now(),
      };

      await recorder.record(record);
      const records = await recorder.getHistory();

      expect(records.length).toBeGreaterThan(0);
      expect(records[records.length - 1].type).toBe(ErrorType.VALIDATION_ERROR);
    });

    it('空文件应该返回空数组', async () => {
      const emptyLogFile = path.join(tempDir, 'empty.log');
      fs.writeFileSync(emptyLogFile, '');

      const emptyRecorder = new FailureRecorder({ logFile: emptyLogFile });
      const records = await emptyRecorder.getHistory();

      expect(records).toEqual([]);
    });
  });

  describe('clear', () => {
    it('应该清空记录', async () => {
      const record: FailureRecord = {
        type: ErrorType.TEST_FAILED,
        level: FailureLevel.L1,
        message: 'Test',
        timestamp: Date.now(),
      };

      await recorder.record(record);
      await recorder.clear();

      const records = await recorder.getHistory();
      expect(records).toEqual([]);
    });
  });

  describe('配置', () => {
    it('应该支持自定义最大文件大小', () => {
      const customRecorder = new FailureRecorder({
        logFile: path.join(tempDir, 'custom.log'),
        maxFileSize: 1024 * 1024,  // 1MB
      });

      expect(customRecorder).toBeDefined();
    });

    it('应该支持自定义历史文件数', () => {
      const customRecorder = new FailureRecorder({
        logFile: path.join(tempDir, 'custom.log'),
        maxHistoryFiles: 10,
      });

      expect(customRecorder).toBeDefined();
    });
  });

  describe('元数据', () => {
    it('应该记录元数据', async () => {
      const record: FailureRecord = {
        type: ErrorType.GATE_FAILED,
        level: FailureLevel.L2,
        message: 'Gate failed',
        timestamp: Date.now(),
        metadata: {
          gate: 'passes-gate',
          taskId: 'TASK-001',
        },
      };

      await recorder.record(record);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('passes-gate');
      expect(content).toContain('TASK-001');
    });
  });

  describe('getByType', () => {
    it('应该按类型过滤记录', async () => {
      fs.writeFileSync(logFile, '');

      await recorder.record({
        type: ErrorType.TEST_FAILED,
        level: FailureLevel.L1,
        message: 'Test 1',
        timestamp: Date.now(),
      });
      await recorder.record({
        type: ErrorType.NETWORK_ERROR,
        level: FailureLevel.L1,
        message: 'Network 1',
        timestamp: Date.now(),
      });
      await recorder.record({
        type: ErrorType.TEST_FAILED,
        level: FailureLevel.L1,
        message: 'Test 2',
        timestamp: Date.now(),
      });

      const testRecords = await recorder.getByType(ErrorType.TEST_FAILED);
      expect(testRecords.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', async () => {
      const stats = await recorder.getStats();

      expect(stats.total).toBeDefined();
      expect(stats.byType).toBeDefined();
      expect(stats.byLevel).toBeDefined();
    });
  });
});
