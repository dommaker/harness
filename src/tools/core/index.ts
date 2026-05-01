/**
 * 核心工具定义
 *
 * 内置工具：file / git / npm / shell
 */

import type { ToolDefinition } from '../types';

export const FILE_TOOLS: ToolDefinition[] = [
  {
    id: 'read_file',
    name: 'Read File',
    description: '读取文件内容',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        offset: { type: 'number', description: '起始行号' },
        limit: { type: 'number', description: '读取行数' },
      },
      required: ['path'],
    },
    sandboxLevel: 1,
  },
  {
    id: 'write_file',
    name: 'Write File',
    description: '写入文件内容',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
    sandboxLevel: 3,
  },
  {
    id: 'edit_file',
    name: 'Edit File',
    description: '编辑文件（精确替换）',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '要替换的文本' },
        new_string: { type: 'string', description: '替换后的文本' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    sandboxLevel: 3,
  },
  {
    id: 'list_directory',
    name: 'List Directory',
    description: '列出目录内容',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
      },
      required: ['path'],
    },
    sandboxLevel: 1,
  },
];

export const GIT_TOOLS: ToolDefinition[] = [
  {
    id: 'git_status',
    name: 'Git Status',
    description: '查看 git 工作区状态',
    category: 'core',
    parameters: { type: 'object', properties: {} },
    sandboxLevel: 1,
  },
  {
    id: 'git_diff',
    name: 'Git Diff',
    description: '查看 git 差异',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: '是否查看暂存区' },
        file: { type: 'string', description: '指定文件' },
      },
    },
    sandboxLevel: 1,
  },
  {
    id: 'git_commit',
    name: 'Git Commit',
    description: '创建 git 提交',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '提交信息' },
        files: { type: 'array', items: { type: 'string' }, description: '要提交的文件' },
      },
      required: ['message'],
    },
    sandboxLevel: 3,
    requiresConfirmation: true,
  },
  {
    id: 'git_log',
    name: 'Git Log',
    description: '查看 git 提交历史',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '显示条数' },
        file: { type: 'string', description: '指定文件' },
      },
    },
    sandboxLevel: 1,
  },
];

export const NPM_TOOLS: ToolDefinition[] = [
  {
    id: 'npm_install',
    name: 'NPM Install',
    description: '安装依赖',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        packages: { type: 'array', items: { type: 'string' }, description: '包名列表' },
        dev: { type: 'boolean', description: '是否为开发依赖' },
      },
    },
    sandboxLevel: 3,
    rateLimit: 10,
  },
  {
    id: 'npm_run',
    name: 'NPM Run',
    description: '执行 npm 脚本',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: '脚本名称' },
        args: { type: 'array', items: { type: 'string' }, description: '参数' },
      },
      required: ['script'],
    },
    sandboxLevel: 3,
  },
  {
    id: 'npm_test',
    name: 'NPM Test',
    description: '运行测试',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '测试文件匹配模式' },
        coverage: { type: 'boolean', description: '是否生成覆盖率报告' },
      },
    },
    sandboxLevel: 3,
  },
];

export const SHELL_TOOLS: ToolDefinition[] = [
  {
    id: 'shell_exec',
    name: 'Shell Execute',
    description: '执行 shell 命令',
    category: 'core',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令' },
        cwd: { type: 'string', description: '工作目录' },
        timeout: { type: 'number', description: '超时（ms）' },
      },
      required: ['command'],
    },
    sandboxLevel: 3,
    rateLimit: 30,
  },
];

/** 所有核心工具 */
export const CORE_TOOLS: ToolDefinition[] = [
  ...FILE_TOOLS,
  ...GIT_TOOLS,
  ...NPM_TOOLS,
  ...SHELL_TOOLS,
];
