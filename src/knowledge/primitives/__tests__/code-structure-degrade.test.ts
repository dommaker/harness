/**
 * typescript 缺失时的降级路径测试
 *
 * typescript 仅是 devDependency,消费者运行时可能没有安装;
 * extractCodeStructure 必须降级为空结果而不是崩溃。
 */

import { describe, it, expect, jest } from '@jest/globals';

describe('extractCodeStructure typescript 降级', () => {
  it('typescript 不可用时返回空结构', () => {
    jest.isolateModules(() => {
      jest.doMock('typescript', () => {
        throw new Error('typescript not installed');
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractCodeStructure } = require('../code-structure');
      const result = extractCodeStructure(__dirname);
      expect(result.files).toEqual([]);
      expect(result.functions).toEqual([]);
      expect(result.imports).toEqual([]);
    });
  });
});
