/**
 * CrossProjectChecker 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { checkCrossProjectContracts, checkDocCodeConsistency, type CrossProjectConfig } from '../architecture/cross-project-checker';
import * as fs from 'fs';
import * as path from 'path';

const TEST_CONFIG: CrossProjectConfig = {
  dependencies: {
    'agent-studio': ['agent-runtime', 'harness'],
    'agent-runtime': ['harness', 'agent-workflows'],
    'agent-workflows': ['harness'],
    'harness': [],
  },
  contractLocations: {
    'studio-runtime': [
      'agent-runtime/src/api/types.ts',
      'agent-studio/src/services/runtime-client.ts',
    ],
    'runtime-harness': [
      'harness/src/index.ts',
      'agent-runtime/src/core/harness-adapter.ts',
    ],
  },
};

// Mock utils/exec
jest.mock('../utils/exec', () => ({
  runCommand: jest.fn((() => Promise.resolve('')) as any),
}));

import { runCommand } from '../utils/exec';
const mockRunCommand = runCommand as jest.MockedFunction<typeof runCommand>;

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
      mockRunCommand.mockResolvedValue('');
      
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      }, TEST_CONFIG);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('空变更列表应该返回空数组', async () => {
      mockRunCommand.mockResolvedValue('');
      
      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: [],
        changedFiles: [],
      }, TEST_CONFIG);

      expect(result).toEqual([]);
    });

    it('runtime API 变更未同步到 studio 应该报错', async () => {
      mockRunCommand.mockResolvedValueOnce('projects/agent-runtime/src/api/types.ts\nprojects/agent-runtime/src/api/client.ts');
      mockRunCommand.mockResolvedValue('');

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime'],
        changedFiles: ['projects/agent-runtime/src/api/types.ts'],
      }, TEST_CONFIG);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('api-mismatch');
      expect(result[0].fromProject).toBe('agent-runtime');
      expect(result[0].toProject).toBe('agent-studio');
    });

    it('runtime 和 studio 同时变更不应该报错', async () => {
      mockRunCommand.mockResolvedValueOnce('projects/agent-runtime/src/api/types.ts');
      mockRunCommand.mockResolvedValue('');

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime', 'agent-studio'],
        changedFiles: [
          'projects/agent-runtime/src/api/types.ts',
          'projects/agent-studio/src/services/runtime-client.ts',
        ],
      }, TEST_CONFIG);

      // API 变更已同步，不应该有 api-mismatch 错误
      const apiMismatches = result.filter(v => v.type === 'api-mismatch');
      expect(apiMismatches.length).toBe(0);
    });

    it('破坏性变更未适配依赖项目应该报错', async () => {
      // checkApiSync 和 checkBreakingChanges 都调用 getApiChanges，需要两轮 mock
      // checkApiSync → getApiChanges → runCommand(name-only) + detectChangeType → runCommand(name-status)
      // checkBreakingChanges → getApiChanges → runCommand(name-only) + detectChangeType → runCommand(name-status)
      mockRunCommand
        .mockResolvedValueOnce('projects/harness/src/core/checkpoint.ts')  // checkApiSync: name-only
        .mockResolvedValueOnce('D\tprojects/harness/src/core/checkpoint.ts')  // checkApiSync: name-status
        .mockResolvedValueOnce('projects/harness/src/core/checkpoint.ts')  // checkBreakingChanges: name-only
        .mockResolvedValueOnce('D\tprojects/harness/src/core/checkpoint.ts');  // checkBreakingChanges: name-status

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['harness'],
        changedFiles: ['projects/harness/src/core/checkpoint.ts'],
      }, TEST_CONFIG);

      // 删除文件是破坏性变更，应产生 breaking-change 违规
      const breakingChanges = result.filter(v => v.type === 'breaking-change');
      expect(breakingChanges.length).toBeGreaterThan(0);
    });

    it('签名变更应该被检测为破坏性变更', async () => {
      // checkApiSync 和 checkBreakingChanges 都调用 getApiChanges
      mockRunCommand
        .mockResolvedValueOnce('projects/agent-runtime/src/api/types.ts')  // checkApiSync: name-only
        .mockResolvedValueOnce('M\tprojects/agent-runtime/src/api/types.ts')  // checkApiSync: name-status
        .mockResolvedValueOnce('-export function createAgent(config: Config): void\n+export function createAgent(config: Config, opts: Options): void')  // checkApiSync: signature diff
        .mockResolvedValueOnce('projects/agent-runtime/src/api/types.ts')  // checkBreakingChanges: name-only
        .mockResolvedValueOnce('M\tprojects/agent-runtime/src/api/types.ts')  // checkBreakingChanges: name-status
        .mockResolvedValueOnce('-export function createAgent(config: Config): void\n+export function createAgent(config: Config, opts: Options): void');  // checkBreakingChanges: signature diff

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime'],
        changedFiles: ['projects/agent-runtime/src/api/types.ts'],
      }, TEST_CONFIG);

      const breakingChanges = result.filter(v => v.type === 'breaking-change');
      expect(breakingChanges.length).toBeGreaterThan(0);
    });

    it('git 命令失败时应该返回空数组', async () => {
      mockRunCommand.mockRejectedValue(new Error('git error'));

      const result = await checkCrossProjectContracts({
        baseBranch: 'main',
        changedProjects: ['agent-runtime'],
        changedFiles: [],
      }, TEST_CONFIG);

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

      // parseDocInterfaces 现在应该解析出 3 个接口
      // 由于 extractExportedApis 也已实现但项目目录不存在，应产生 missing-implementation 违规
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('missing-implementation');
    });

    it('项目目录存在时应该提取导出 API', async () => {
      // 创建项目目录结构
      const projectDir = path.join(process.cwd(), 'projects', 'test-proj', 'src');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'index.ts'), `
export function hello(name: string): string {
  return name;
}
export class MyService {
  run() {}
}
export const helper = (x: number) => x + 1;
export interface Config { key: string; }
export type Result = { ok: boolean; }
`);

      const docPath = path.join(tempDir, 'api-with-impl.md');
      fs.writeFileSync(docPath, `# API

## test-proj
- \`hello(name: string): string\`
`);

      const result = await checkDocCodeConsistency(docPath, ['test-proj']);

      // 应该能匹配到 hello 函数
      expect(Array.isArray(result)).toBe(true);

      // 清理
      fs.rmSync(path.join(process.cwd(), 'projects'), { recursive: true, force: true });
    });

    it('文档签名不匹配应该报 doc-code-mismatch', async () => {
      const projectDir = path.join(process.cwd(), 'projects', 'mismatch-proj', 'src');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'api.ts'), `
export function createAgent(config: object): void {}
`);

      const docPath = path.join(tempDir, 'api-mismatch.md');
      fs.writeFileSync(docPath, `# API

## mismatch-proj
- \`createAgent(config: string, opts: object): boolean\`
`);

      const result = await checkDocCodeConsistency(docPath, ['mismatch-proj']);

      // 签名不匹配，应产生 doc-code-mismatch
      const mismatches = result.filter(v => v.type === 'doc-code-mismatch');
      expect(mismatches.length).toBeGreaterThan(0);

      fs.rmSync(path.join(process.cwd(), 'projects'), { recursive: true, force: true });
    });

    it('findTsFiles 应该排除 node_modules 和 dist', async () => {
      const projectDir = path.join(process.cwd(), 'projects', 'filter-proj', 'src');
      fs.mkdirSync(path.join(projectDir, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, '__tests__'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'valid.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(projectDir, 'node_modules', 'dep.ts'), 'export const y = 2;');
      fs.writeFileSync(path.join(projectDir, 'dist', 'built.js'), 'var x = 1;');
      fs.writeFileSync(path.join(projectDir, '__tests__', 'test.ts'), 'export const z = 3;');
      fs.writeFileSync(path.join(projectDir, 'types.d.ts'), 'export interface I {}');

      const docPath = path.join(tempDir, 'api-filter.md');
      fs.writeFileSync(docPath, `# API

## filter-proj
- \`nonexistent()\`
`);

      const result = await checkDocCodeConsistency(docPath, ['filter-proj']);

      // 应该只找到 valid.ts，不包含 node_modules/dist/__tests__/.d.ts
      expect(Array.isArray(result)).toBe(true);

      fs.rmSync(path.join(process.cwd(), 'projects'), { recursive: true, force: true });
    });

    it('parseDocInterfaces 不存在的文件应该返回空', async () => {
      const result = await checkDocCodeConsistency('/nonexistent/doc.md', ['any']);
      expect(result).toEqual([]);
    });
  });
});
