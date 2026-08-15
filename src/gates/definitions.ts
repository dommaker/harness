/**
 * 门禁定义表（G1：定义即注册的单一定义源）
 *
 * - 每个门禁在此声明 id / description / 默认 order / CLI 元数据；
 *   registry.ts 按此表做「定义↔实现」双向闭环校验（复制 checker 闭环模式）。
 * - CLI 元数据被 bin/harness.js 消费，注册表驱动生成 6 个门禁命令：
 *   命令名/别名/选项/子命令路由与历史手工块完全兼容。
 * - 本模块禁止 import 任何门禁实现——bin 启动期只加载本纯数据模块
 *   （保持 --help/--version 懒加载，闭环校验在 registry 加载期执行）。
 */

/**
 * 门禁 CLI 选项元数据（直接映射 commander `.option()`）
 */
export interface GateCliOption {
  /** commander option flags，如 '-p, --project-path <path>' */
  flags: string;
  /** 选项描述 */
  description: string;
  /** commander 缺省值；negated option（如 --no-strict）不设，由 commander 默认 true */
  defaultValue?: string | boolean;
}

/**
 * 门禁 CLI 命令元数据（bin/harness.js 注册表驱动生成）
 */
export interface GateCliDefinition {
  /** 命令名（历史命令名兼容保留） */
  command: string;
  /** 命令别名 */
  alias?: string;
  /** 位置参数声明，如 '[subcommand]' / '[cmd]' */
  argument?: string;
  /** 命令描述 */
  description: string;
  /** 命令选项 */
  options: GateCliOption[];
  /** 子命令名 → src/cli/commands 桶导出函数名；命中后按 [options] 透传 */
  subcommands?: Record<string, string>;
  /** 默认 action（src/cli/commands 桶导出函数名） */
  action: string;
  /** 默认 action 实参构造：arg = 位置参数（无位置参数时为 undefined），options = commander 选项对象 */
  mapActionArgs: (arg: string | undefined, options: Record<string, unknown>) => unknown[];
}

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
  /** CLI 元数据（bin/harness.js 注册表驱动生成） */
  cli: GateCliDefinition;
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
      subcommands: { list: 'listAcceptanceCriteria' },
      action: 'acceptance',
      mapActionArgs: (_arg, options) => [options],
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
      action: 'executeCommand',
      mapActionArgs: (arg, options) => [arg, options],
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
      subcommands: { validate: 'validateSchema' },
      action: 'contract',
      mapActionArgs: (_arg, options) => [options],
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
      action: 'performance',
      mapActionArgs: (_arg, options) => [
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
      subcommands: { status: 'reviewStatus' },
      action: 'review',
      mapActionArgs: (_arg, options) => [
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
      subcommands: { audit: 'auditDetails' },
      action: 'security',
      mapActionArgs: (_arg, options) => [options],
    },
  },
];
