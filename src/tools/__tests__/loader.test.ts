/**
 * Tool YAML Loader 测试
 */

import * as path from 'path';
import * as fs from 'fs';
import { parseToolYaml, loadToolsFromDir, loadRegistry } from '../loader';
import { getToolsDir, getRegistryPath } from '../paths';

const DEFINITIONS_DIR = path.resolve(__dirname, '..', 'definitions');

describe('parseToolYaml', () => {
  it('应该解析 Pattern A (input map) 的 YAML', () => {
    const yaml = `
name: file-read
description: 读取文件内容
input:
  path:
    type: path
    required: true
    description: 文件路径
  encoding:
    type: string
    required: false
    description: 文件编码
    default: "utf-8"
`;
    const filePath = path.join(DEFINITIONS_DIR, 'core', 'file', 'read.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.id).toBe('core/file/read');
    expect(tool.name).toBe('file-read');
    expect(tool.description).toBe('读取文件内容');
    expect(tool.category).toBe('core');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        encoding: { type: 'string', description: '文件编码', default: 'utf-8' },
      },
      required: ['path'],
    });
  });

  it('应该解析 Pattern B (inputs list) 的 YAML', () => {
    const yaml = `
id: deploy/backend
name: deploy-backend
description: 后端部署
category: deploy
inputs:
  - name: platform
    type: string
    default: "docker"
    description: 部署平台
  - name: env
    type: string
    required: true
    description: 环境
`;
    const filePath = path.join(DEFINITIONS_DIR, 'std', 'deploy', 'deploy-backend.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.id).toBe('deploy/backend');
    expect(tool.name).toBe('deploy-backend');
    expect(tool.category).toBe('std');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        platform: { type: 'string', description: '部署平台', default: 'docker' },
        env: { type: 'string', description: '环境' },
      },
      required: ['env'],
    });
  });

  it('应该解析 Pattern C (inputs map) 的 YAML', () => {
    const yaml = `
id: quick/implement
name: 实现功能
description: 快速实现功能
category: quick
inputs:
  project_path:
    type: string
    description: 项目路径
    required: true
  analysis:
    type: object
    description: 分析结果
    required: true
`;
    const filePath = path.join(DEFINITIONS_DIR, 'std', 'quick', 'implement.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.id).toBe('quick/implement');
    expect(tool.category).toBe('std');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        project_path: { type: 'string', description: '项目路径' },
        analysis: { type: 'object', description: '分析结果' },
      },
      required: ['project_path', 'analysis'],
    });
  });

  it('应该从文件路径推导 ID（无显式 id 时）', () => {
    const yaml = `
name: git-branch
description: 创建并切换 Git 分支
input:
  branch_name:
    type: string
    required: true
    description: 分支名称
`;
    const filePath = path.join(DEFINITIONS_DIR, 'core', 'git', 'branch.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.id).toBe('core/git/branch');
  });

  it('应该正确分类 ext 工具', () => {
    const yaml = `
name: browser-automate
description: 浏览器自动化
input:
  url:
    type: string
    required: true
    description: URL
`;
    const filePath = path.join(DEFINITIONS_DIR, 'ext', 'browser', 'browser-automate.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.category).toBe('ext');
    expect(tool.id).toBe('ext/browser/browser-automate');
  });

  it('应该处理空 input 的工具', () => {
    const yaml = `
name: no-params
description: 无参数工具
`;
    const filePath = path.join(DEFINITIONS_DIR, 'core', 'test.yml');
    const tool = parseToolYaml(yaml, filePath, DEFINITIONS_DIR);

    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
    });
    expect((tool.parameters as Record<string, unknown>).required).toBeUndefined();
  });
});

describe('loadToolsFromDir', () => {
  let tools: ReturnType<typeof loadToolsFromDir>;

  beforeAll(() => {
    tools = loadToolsFromDir(DEFINITIONS_DIR);
  });

  it('应该加载所有 113 个工具', () => {
    expect(tools.length).toBe(113);
  });

  it('应该包含 core、std、ext 三个分类', () => {
    const categories = new Set(tools.map(t => t.category));
    expect(categories).toEqual(new Set(['core', 'std', 'ext']));
  });

  it('应该有 core 工具 (22)', () => {
    const coreTools = tools.filter(t => t.category === 'core');
    expect(coreTools.length).toBe(22);
  });

  it('应该有 std 工具 (87)', () => {
    const stdTools = tools.filter(t => t.category === 'std');
    expect(stdTools.length).toBe(87);
  });

  it('应该有 ext 工具 (4)', () => {
    const extTools = tools.filter(t => t.category === 'ext');
    expect(extTools.length).toBe(4);
  });

  it('每个工具都应该有 id、name、description、category、parameters', () => {
    for (const tool of tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(['core', 'std', 'ext']).toContain(tool.category);
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
    }
  });

  it('所有工具 ID 应该唯一', () => {
    const ids = tools.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('loadRegistry', () => {
  let registry: ReturnType<typeof loadRegistry>;

  beforeAll(() => {
    const registryPath = path.join(DEFINITIONS_DIR, 'registry.json');
    registry = loadRegistry(registryPath);
  });

  it('应该加载 113 个工具条目', () => {
    expect(registry.length).toBe(113);
  });

  it('所有条目 type 应该是 tool', () => {
    for (const entry of registry) {
      expect(entry.type).toBe('tool');
    }
  });

  it('所有路径应该是相对路径', () => {
    for (const entry of registry) {
      expect(entry.path).not.toMatch(/^\//);
      expect(entry.path).toMatch(/\.yml$/);
    }
  });

  it('路径应该包含分类前缀 (core/ 或 std/ 或 ext/)', () => {
    for (const entry of registry) {
      expect(entry.path).toMatch(/^(core|std|ext)\//);
    }
  });
});

describe('paths', () => {
  it('getToolsDir 应该返回 definitions 目录的绝对路径', () => {
    const dir = getToolsDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toMatch(/definitions$/);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('getRegistryPath 应该返回 registry.json 的绝对路径', () => {
    const p = getRegistryPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/registry\.json$/);
    expect(fs.existsSync(p)).toBe(true);
  });
});
