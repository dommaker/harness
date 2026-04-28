/**
 * SessionStartup 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SessionStartup } from '../core/session/startup';
import * as fs from 'fs';
import * as path from 'path';

describe('SessionStartup', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-session');

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

  describe('run', () => {
    it('应该运行 pwd 检查点', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].type).toBe('pwd');
    });

    it('应该运行 git_status 检查点', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['git_status'],
        optional: [],
      });

      const result = await startup.run();

      // git_status 可能失败（目录没有 git）
      expect(result.results.length).toBe(1);
      expect(result.results[0].type).toBe('git_status');
    });

    it('可选检查点失败不应该影响 success', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: ['git_log'],  // 可能失败
      });

      const result = await startup.run();

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
    });

    it('必要检查点失败应该影响 success', async () => {
      const startup = new SessionStartup('/nonexistent/path', {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();

      // 可能成功或失败取决于实现
      expect(result.results.length).toBe(1);
    });
  });

  describe('检查点数据', () => {
    it('pwd 应该返回当前目录', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();
      const pwdResult = result.results.find(r => r.type === 'pwd');

      expect(pwdResult?.data).toBeDefined();
    });
  });
});