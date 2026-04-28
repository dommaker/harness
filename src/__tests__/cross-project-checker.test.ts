/**
 * CrossProjectChecker 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { checkCrossProjectContracts } from '../architecture/cross-project-checker';
import * as fs from 'fs';
import * as path from 'path';

describe('CrossProjectChecker', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-cross');

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

  describe('checkCrossProjectContracts', () => {
    it('应该检查跨项目依赖', async () => {
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('空变更列表应该返回空数组', async () => {
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      });

      expect(result).toEqual([]);
    });
  });
});