/**
 * 门禁定义表（G1：定义即注册的单一定义源）
 *
 * - 每个门禁在此声明 id / description / 默认 order / CLI 元数据；
 *   registry.ts 按此表做「定义↔实现」双向闭环校验（复制 checker 闭环模式）。
 * - CLI 元数据即 CommandDefinition（架构评审候选8，ADR-0007：形状对齐通用
 *   命令定义，bin/harness.js 单引擎单循环生成全部命令）：命令名/别名/选项/
 *   子命令路由与历史手工块完全兼容；实现引用为 module+export（CommandImplRef），
 *   bin 按需 per-command 懒加载（H5/O2）。门禁特有语义由两个标志表达：
 *   subcommandStrict:false（未知位置参数落回默认 action）+
 *   bareRunsAction:true（无位置参数时跑默认 action 而非显示帮助）。
 * - 本模块禁止 import 任何门禁/命令实现（仅 type import，运行时零依赖）——
 *   bin 启动期只加载本纯数据模块（保持 --help/--version 懒加载，
 *   闭环校验在 registry 加载期执行）。
 */

import type { CommandDefinition } from '../cli/commands/definitions';

/**
 * 门禁定义
 */
export interface GateDefinition {
  /** 门禁 id（与实现 Gate.id 一致） */
  id: string;
  /** 一句话描述 */
  description: string;
  /** 默认顺序（config.yml `gates.order` 可覆盖），小者先执行 */
  order: number;
  /** CLI 元数据（形状 = CommandDefinition，bin/harness.js 通用引擎驱动生成） */
  cli: CommandDefinition;
}

/**
 * 6 门禁定义（默认 order 按字母序，与历史 bin 块顺序一致）
 */
export const GATE_DEFINITIONS: GateDefinition[] = [
  {
    id: 'acceptance',
    description: '验收标准门控，检查任务是否满足验收标准',
    order: 0,
    cli: {
      command: 'acceptance',
      alias: 'acc',
      argument: '[subcommand]',
      description: '验收标准门控，检查任务是否满足验收标准',
      options: [
        { flags: '-t, --task-id <id>', description: '任务 ID' },
        { flags: '--tasks-path <path>', description: 'tasks.yml 路径' },
        { flags: '-p, --project-path <path>', description: '项目路径' },
        { flags: '--check-all', description: '检查所有任务', defaultValue: false },
        { flags: '--run-e2e', description: '运行 E2E 测试', defaultValue: false },
      ],
      subcommands: { list: { impl: { module: 'acceptance', export: 'listAcceptanceCriteria' } } },
      subcommandStrict: false,
      bareRunsAction: true,
      action: { module: 'acceptance', export: 'acceptance' },
      mapActionArgs: (_positionals, options) => [options],
    },
  },
  {
    id: 'command',
    description: '命令黑名单门控，检查命令是否在禁用列表',
    order: 1,
    cli: {
      command: 'command',
      alias: 'cmd',
      argument: '[cmd]',
      description: '检查命令是否在黑名单中',
      options: [
        { flags: '-l, --level', description: '显示风险等级' },
        { flags: '--list', description: '列出所有黑名单规则' },
        { flags: '--json', description: 'JSON 格式输出' },
        { flags: '--strict', description: '严格模式（warn 也阻止）' },
      ],
      action: { module: 'command', export: 'executeCommand' },
      mapActionArgs: (positionals, options) => [positionals[0], options],
    },
  },
  {
    id: 'contract',
    description: 'API 契约门控，检查 OpenAPI Schema',
    order: 2,
    cli: {
      command: 'contract',
      argument: '[subcommand]',
      description: 'API 契约门控，检查 OpenAPI Schema',
      options: [
        { flags: '-p, --project-path <path>', description: '项目路径' },
        { flags: '--contract-path <path>', description: '契约文件路径', defaultValue: 'openapi.yaml' },
        { flags: '--no-strict', description: '关闭严格模式' },
        { flags: '--allow-breaking', description: '允许破坏性变更', defaultValue: false },
      ],
      subcommands: { validate: { impl: { module: 'contract', export: 'validateSchema' } } },
      subcommandStrict: false,
      bareRunsAction: true,
      action: { module: 'contract', export: 'contract' },
      mapActionArgs: (_positionals, options) => [options],
    },
  },
  {
    id: 'performance',
    description: '性能门控，检查性能指标',
    order: 3,
    cli: {
      command: 'performance',
      alias: 'perf',
      description: '性能门控，检查性能指标',
      options: [
        { flags: '-p, --project-path <path>', description: '项目路径' },
        { flags: '--coverage', description: '检查测试覆盖率', defaultValue: false },
        { flags: '--coverage-threshold <n>', description: '覆盖率阈值', defaultValue: '80' },
        { flags: '--bundle', description: '检查打包大小', defaultValue: false },
        { flags: '--bundle-threshold <n>', description: '打包大小阈值 (KB)', defaultValue: '500' },
        { flags: '--benchmark', description: '运行基准测试', defaultValue: false },
        { flags: '--benchmark-timeout <n>', description: '基准测试超时（秒）', defaultValue: '60' },
      ],
      action: { module: 'performance', export: 'performance' },
      mapActionArgs: (_positionals, options) => [
        {
          projectPath: options.projectPath,
          coverage: options.coverage,
          coverageThreshold: parseInt(String(options.coverageThreshold), 10),
          bundle: options.bundle,
          bundleThreshold: parseInt(String(options.bundleThreshold), 10),
          benchmark: options.benchmark,
          benchmarkTimeout: parseInt(String(options.benchmarkTimeout), 10),
        },
      ],
    },
  },
  {
    id: 'review',
    description: '代码审查门控，检查审查状态',
    order: 4,
    cli: {
      command: 'review',
      argument: '[subcommand]',
      description: '代码审查门控，检查审查状态',
      options: [
        { flags: '-p, --project-path <path>', description: '项目路径' },
        { flags: '--min-reviewers <n>', description: '最少审查人数', defaultValue: '1' },
        { flags: '--no-require-approval', description: '不要求审批' },
        { flags: '--no-block-on-changes', description: '不阻止变更请求' },
        { flags: '--allowed-reviewers <list>', description: '允许的审查者（逗号分隔）' },
      ],
      subcommands: { status: { impl: { module: 'review', export: 'reviewStatus' } } },
      subcommandStrict: false,
      bareRunsAction: true,
      action: { module: 'review', export: 'review' },
      mapActionArgs: (_positionals, options) => [
        {
          projectPath: options.projectPath,
          minReviewers: parseInt(String(options.minReviewers), 10),
          requireApproval: options.requireApproval,
          blockOnChangesRequested: options.blockOnChanges,
          allowedReviewers: options.allowedReviewers,
        },
      ],
    },
  },
  {
    id: 'security',
    description: '安全门控，检查安全漏洞',
    order: 5,
    cli: {
      command: 'security',
      alias: 'sec',
      argument: '[subcommand]',
      description: '安全门控，检查安全漏洞',
      options: [
        { flags: '-p, --project-path <path>', description: '项目路径' },
        { flags: '--severity <level>', description: '严重性阈值 (low/moderate/high/critical)', defaultValue: 'high' },
        { flags: '--ignore-warnings', description: '忽略警告', defaultValue: false },
        { flags: '--ignore-dev-deps', description: '忽略开发依赖', defaultValue: false },
        { flags: '--scan-command <cmd>', description: '自定义扫描命令' },
      ],
      subcommands: { audit: { impl: { module: 'security', export: 'auditDetails' } } },
      subcommandStrict: false,
      bareRunsAction: true,
      action: { module: 'security', export: 'security' },
      mapActionArgs: (_positionals, options) => [options],
    },
  },
];
