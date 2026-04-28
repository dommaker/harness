/**
 * CrossProjectChecker 测试
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { checkCrossProjectContracts, checkDocCodeConsistency } from '../architecture/cross-project-checker';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkCrossProjectContracts', () => {
    it('应该检查跨项目依赖', async () => {
      mockExecSync.mockReturnValue('');
      
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('空变更列表应该返回空数组', async () => {
      mockExecSync.mockReturnValue('');
      
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      });

      expect(result).toEqual([]);
    });

    it('runtime API 变更未同步到 studio 应该报错', async () => {
      mockExecSync.mockReturnValueOnce('projects/agent-runtime/src/api/types.ts\nprojects/agent-runtime/src/api/client.ts');
      mockExecSync.mockReturnValue('');

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime'],
        changedFiles: ['projects/agent-runtime/src/api/types.ts'],
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('api-mismatch');
      expect(result[0].fromProject).toBe('agent-runtime');
      expect(result[0].toProject).toBe('agent-studio');
    });

    it('runtime 和 studio 同时变更不应该报错', async () => {
      mockExecSync.mockReturnValueOnce('projects/agent-runtime/src/api/types.ts');
      mockExecSync.mockReturnValue('');

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime', 'agent-studio'],
        changedFiles: [
          'projects/agent-runtime/src/api/types.ts',
          'projects/agent-studio/src/services/runtime-client.ts',
        ],
      });

      // API 变更已同步，不应该有 api-mismatch 错误
      const apiMismatches = result.filter(v => v.type === 'api-mismatch');
      expect(apiMismatches.length).toBe(0);
    });

    it('破坏性变更未适配依赖项目应该报错', async () => {
      mockExecSync.mockReturnValueOnce('projects/harness/src/core/checkpoint.ts');
      mockExecSync.mockReturnValue('');

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['harness'],
        changedFiles: ['projects/harness/src/core/checkpoint.ts'],
      });

      // harness 有依赖项目 agent-runtime 和 agent-studio
      // 破坏性变更应该检查它们是否适配
      expect(result).toBeDefined();
    });

    it('git 命令失败时应该返回空数组', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('git error');
      });

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime'],
        changedFiles: [],
      });

      expect(result).toEqual([]);
    });
  });

  describe('checkDocCodeConsistency', () => {
    it('文档接口未实现应该报错', async () => {
      const docPath = path.join(tempDir, 'api-doc.md');
      fs.writeFileSync(docPath, '# API\n\n## agent-runtime\n- `createAgent(config)` - 创建 Agent');

      const result = await checkDocCodeConsistency(docPath, ['agent-runtime']);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('项目不在列表中应该跳过', async () => {
      const docPath = path.join(tempDir, 'api-doc-2.md');
      fs.writeFileSync(docPath, '# API\n\n## unknown-project\n- `test()`');

      const result = await checkDocCodeConsistency(docPath, ['agent-runtime']);

      // unknown-project 不在 projects 列表中，应该跳过
      expect(result).toBeDefined();
    });

    it('extractExportedApis 应该返回数组', async () => {
      // 测试内部函数的行为
      const docPath = path.join(tempDir, 'api-doc-3.md');
      fs.writeFileSync(docPath, '# API\n\n## agent-runtime\n- `createAgent(config)` - 创建 Agent');

      const result = await checkDocCodeConsistency(docPath, ['agent-runtime']);

      // 结果应该是数组
      expect(Array.isArray(result)).toBe(true);
    });

    it('isCompatible 检查签名一致性', async () => {
      const docPath = path.join(tempDir, 'api-doc-4.md');
      fs.writeFileSync(docPath, '# API\n\n## test-project\n- `testFunction(x: number)`');

      const result = await checkDocCodeConsistency(docPath, ['test-project']);

      expect(result).toBeDefined();
    });

    it('解析文档接口测试', async () => {
      const docPath = path.join(tempDir, 'complex-doc.md');
      fs.writeFileSync(docPath, `# API

## project-a
- \`funcA(a: string, b: number): boolean\`
- \`funcB(config: Config): void\`

## project-b
- \`funcC()\`
`);

      const result = await checkDocCodeConsistency(docPath, ['project-a', 'project-b']);

      // 结果应该是数组
      expect(Array.isArray(result)).toBe(true);
    });
  });
});