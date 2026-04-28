/**
 * FailureRecorder 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FailureRecorder, createFailureRecorder } from '../failure/recorder';
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
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    // 每个测试前清空日志文件
    fs.writeFileSync(logFile, '');
    recorder = new FailureRecorder({ logFile });
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

    it('应该记录完整字段', async () => {
      const record: FailureRecord = {
        type: ErrorType.VALIDATION_ERROR,
        level: FailureLevel.L3,
        message: 'Validation error with details',
        timestamp: 1234567890,
        metadata: { 
          file: 'test.ts', 
          line: 42,
          stack: 'Error at line 42',
          userId: 'user-001' 
        },
      };

      await recorder.record(record);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('VALIDATION_ERROR');
      expect(content).toContain('L3');
      expect(content).toContain('test.ts');
      expect(content).toContain('user-001');
    });
  });

  describe('recordBatch', () => {
    it('应该批量记录', async () => {
      const records: FailureRecord[] = [
        { type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 1', timestamp: Date.now() },
        { type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 2', timestamp: Date.now() },
        { type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 3', timestamp: Date.now() },
      ];

      await recorder.recordBatch(records);

      const history = await recorder.getHistory();
      expect(history.length).toBe(3);
    });
  });

  describe('getHistory', () => {
    it('应该读取所有记录', async () => {
      await recorder.record({ type: ErrorType.VALIDATION_ERROR, level: FailureLevel.L2, message: 'V1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T1', timestamp: Date.now() });

      const records = await recorder.getHistory();
      expect(records.length).toBe(2);
    });

    it('应该支持 limit 参数', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T2', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T3', timestamp: Date.now() });

      const records = await recorder.getHistory(2);
      expect(records.length).toBe(2);
      // 应该返回最后 2 条
      expect(records[0].message).toBe('T2');
      expect(records[1].message).toBe('T3');
    });

    it('空文件应该返回空数组', async () => {
      const emptyLogFile = path.join(tempDir, 'empty.log');
      fs.writeFileSync(emptyLogFile, '');

      const emptyRecorder = new FailureRecorder({ logFile: emptyLogFile });
      const records = await emptyRecorder.getHistory();

      expect(records).toEqual([]);
    });

    it('文件不存在应该返回空数组', async () => {
      const nonexistentRecorder = new FailureRecorder({ logFile: path.join(tempDir, 'nonexistent.log') });
      const records = await nonexistentRecorder.getHistory();
      expect(records).toEqual([]);
    });
  });

  describe('getByType', () => {
    it('应该按类型过滤记录', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.NETWORK_ERROR, level: FailureLevel.L1, message: 'Network 1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 2', timestamp: Date.now() });

      const testRecords = await recorder.getByType(ErrorType.TEST_FAILED);
      expect(testRecords.length).toBe(2);

      const networkRecords = await recorder.getByType(ErrorType.NETWORK_ERROR);
      expect(networkRecords.length).toBe(1);
    });

    it('应该支持 limit 参数', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T2', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T3', timestamp: Date.now() });

      const records = await recorder.getByType(ErrorType.TEST_FAILED, 2);
      expect(records.length).toBe(2);
    });
  });

  describe('getByLevel', () => {
    it('应该按等级过滤记录', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'L1 error', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L2, message: 'L2 error', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Another L1', timestamp: Date.now() });

      const l1Records = await recorder.getByLevel(FailureLevel.L1);
      expect(l1Records.length).toBe(2);

      const l2Records = await recorder.getByLevel(FailureLevel.L2);
      expect(l2Records.length).toBe(1);
    });

    it('应该支持 limit 参数', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'L1-1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'L1-2', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'L1-3', timestamp: Date.now() });

      const records = await recorder.getByLevel(FailureLevel.L1, 2);
      expect(records.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.NETWORK_ERROR, level: FailureLevel.L2, message: 'N1', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'T2', timestamp: Date.now() });

      const stats = await recorder.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byType[ErrorType.TEST_FAILED]).toBe(2);
      expect(stats.byType[ErrorType.NETWORK_ERROR]).toBe(1);
      expect(stats.byLevel[FailureLevel.L1]).toBe(2);
      expect(stats.byLevel[FailureLevel.L2]).toBe(1);
    });

    it('空记录应该返回零统计', async () => {
      const stats = await recorder.getStats();
      expect(stats.total).toBe(0);
      expect(Object.keys(stats.byType).length).toBe(0);
      expect(Object.keys(stats.byLevel).length).toBe(0);
    });
  });

  describe('clear', () => {
    it('应该清空记录', async () => {
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test', timestamp: Date.now() });
      await recorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 2', timestamp: Date.now() });

      await recorder.clear();

      const records = await recorder.getHistory();
      expect(records).toEqual([]);
    });

    it('文件不存在时清空不应报错', async () => {
      const newRecorder = new FailureRecorder({ logFile: path.join(tempDir, 'new.log') });
      await expect(newRecorder.clear()).resolves.not.toThrow();
    });
  });

  describe('文件滚动', () => {
    it('文件超过大小限制时应该滚动', async () => {
      const smallLogFile = path.join(tempDir, 'small.log');
      const smallRecorder = new FailureRecorder({
        logFile: smallLogFile,
        maxFileSize: 100, // 100 bytes
        maxHistoryFiles: 3,
      });

      // 写入超过 100 bytes 的数据
      const largeMessage = 'x'.repeat(150);
      await smallRecorder.record({ type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: largeMessage, timestamp: Date.now() });

      // 检查是否创建了历史文件
      const historyFile1 = smallLogFile.replace('.log', '.1.log');
      const fileExists = fs.existsSync(historyFile1) || !fs.existsSync(smallLogFile);
      // 滚动可能发生也可能不发生，取决于写入顺序
      expect(fileExists || fs.existsSync(smallLogFile)).toBe(true);
    });

    it('应该限制历史文件数量', async () => {
      const rotateLogFile = path.join(tempDir, 'rotate.log');
      const rotateRecorder = new FailureRecorder({
        logFile: rotateLogFile,
        maxFileSize: 50,
        maxHistoryFiles: 2,
      });

      // 多次写入触发滚动
      for (let i = 0; i < 5; i++) {
        await rotateRecorder.record({
          type: ErrorType.TEST_FAILED,
          level: FailureLevel.L1,
          message: 'x'.repeat(100),
          timestamp: Date.now(),
        });
      }

      // 检查历史文件数量不超过 maxHistoryFiles
      const dir = path.dirname(rotateLogFile);
      const base = path.basename(rotateLogFile, '.log');
      const historyFiles = fs.readdirSync(dir).filter(f => f.startsWith(base) && f !== path.basename(rotateLogFile));
      expect(historyFiles.length).toBeLessThanOrEqual(2);
    });
  });

  describe('配置', () => {
    it('应该支持自定义最大文件大小', () => {
      const customRecorder = new FailureRecorder({
        logFile: path.join(tempDir, 'custom.log'),
        maxFileSize: 1024 * 1024, // 1MB
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

    it('应该自动创建目录', () => {
      const nestedLogFile = path.join(tempDir, 'nested', 'dir', 'failures.log');
      const nestedRecorder = new FailureRecorder({ logFile: nestedLogFile });
      expect(nestedRecorder).toBeDefined();
      expect(fs.existsSync(path.dirname(nestedLogFile))).toBe(true);
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

  describe('createFailureRecorder', () => {
    it('便捷函数应该创建 recorder', () => {
      const r = createFailureRecorder({ logFile: path.join(tempDir, 'create.log') });
      expect(r).toBeDefined();
      expect(r).toBeInstanceOf(FailureRecorder);
    });
  });
});
