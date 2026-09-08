/**
 * CLI 命令定义表（H5：命令定义即注册的单一来源，R6 消灭 commands/index.ts
 * 与 bin/harness.js 两处手工同步）
 *
 * - bin/harness.js 遍历本表注册表驱动生成全部 commander 命令块，
 *   不再手写命令注册；新增命令 = 命令实现文件 + 本表一条定义 + 测试。
 * - 每个实现引用（CommandImplRef）标注实现文件与导出名；bin 按需
 *   per-command 懒加载（O2）：只在 action 执行时 require 对应命令模块，
 *   不再经单一 barrel 加载全部命令实现。
 * - 本模块是纯数据模块（候选7 后零闭包）：禁止 import 任何命令实现，
 *   子命令别名是数据（aliases），实参编组归各命令模块的具名导出
 *   （那才是它的 interface/测试面）；保证 --help/--version 懒加载不被破坏；
 *   注册表完整性断言（引用实现可解析）在 __tests__/registry.test.ts 构建/测试期校验。
 */

/**
 * 命令 CLI 选项元数据（直接映射 commander `.option()`）
 */
export interface CommandCliOption {
  /** commander option flags，如 '-p, --project-path <path>' */
  flags: string;
  /** 选项描述 */
  description: string;
  /** commander 缺省值；negated option（如 --no-strict）不设，由 commander 默认 true */
  defaultValue?: string | boolean;
}

/**
 * 命令实现引用（per-command 懒加载路径）
 */
export interface CommandImplRef {
  /** 实现模块名（相对 src/cli/commands，如 'check' / 'sync-docs'） */
  module: string;
  /** 模块内导出函数名 */
  export: string;
}

/**
 * 子命令条目：主名 → 实现（别名经 aliases 一名多注册，架构评审候选7）
 */
export interface CommandSubcommand {
  /** 实现引用 */
  impl: CommandImplRef;
  /** 别名：与主名解析到同一实现（不再整块复印 args 闭包） */
  aliases?: string[];
  /** true = 实现签名 (positionals, options)（需要位置参数的命令，如 knowledge search）；缺省 (options) */
  withPositionals?: boolean;
}

/**
 * 选项条件路由（如 check --list）：选项值匹配时以路由替代默认 action；
 * 同一选项可挂多条路由（按序执行，如 passes-gate --coverage）。
 * 实现一律以 (options) 调用；需编组/取值的指向命令模块内的具名包装导出。
 */
export interface CommandOptionRoute {
  /** 触发选项键（commander options 对象键名，如 'list'） */
  flag: string;
  /** 触发值 */
  when: unknown;
  /** 实现引用 */
  impl: CommandImplRef;
}

/**
 * 命令定义
 */
export interface CommandDefinition {
  /** 命令名（commander 注册字符串，可含位置参数，如 'retire [id]'） */
  command: string;
  /** 命令描述 */
  description: string;
  /** 命令别名 */
  alias?: string;
  /** 位置参数声明（如 '[subcommand]' / '[subcommand] [arg]' / '<planPath>'） */
  argument?: string;
  /** 命令选项 */
  options: CommandCliOption[];
  /** 子命令（commander 嵌套命令，如 constraints report / retire） */
  children?: CommandDefinition[];
  /** 默认 action 实现引用；缺省时裸调用显示帮助（subcommand 命令） */
  action?: CommandImplRef;
  /** 子命令路由：位置参数首值 → 条目；未知值报错退出（strict） */
  subcommands?: Record<string, CommandSubcommand>;
  /** false = 未知位置参数不报错、落回默认 action（spec 的文件参数用法） */
  subcommandStrict?: boolean;
  /** true = 有 subcommands 但无位置参数时运行默认 action 而非显示帮助（门禁命令语义） */
  bareRunsAction?: boolean;
  /** 选项条件路由（匹配时替代默认 action 执行） */
  optionRoutes?: CommandOptionRoute[];
  /** 默认 action 实参构造（缺省为 [options]） */
  mapActionArgs?: (positionals: (string | undefined)[], options: Record<string, unknown>) => unknown[];
}

/**
 * 全部非门禁 CLI 命令定义（门禁命令由 GATE_DEFINITIONS 生成，见 src/gates/definitions.ts）
 */
export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  {
    command: 'check',
    description: '检查铁律是否满足',
    options: [
      { flags: '-p, --preset <preset>', description: '预设名称', defaultValue: 'standard' },
      { flags: '-s, --staged', description: '只检查暂存文件', defaultValue: false },
      { flags: '-t, --trigger <trigger>', description: '触发条件' },
      { flags: '--project-path <path>', description: '项目路径' },
      { flags: '--list', description: '列出所有铁律' },
    ],
    action: { module: 'check', export: 'check' },
    optionRoutes: [
      { flag: 'list', when: true, impl: { module: 'check', export: 'listLaws' } },
    ],
  },
  {
    command: 'validate',
    description: '验证检查点是否满足',
    options: [
      { flags: '-f, --file <path>', description: '检查点文件路径' },
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--strict', description: '严格模式（任何失败都退出）', defaultValue: false },
    ],
    action: { module: 'validate', export: 'validate' },
  },
  {
    command: 'passes-gate',
    alias: 'pg',
    description: '运行测试门控，确保测试通过',
    options: [
      { flags: '-t, --test-command <command>', description: '测试命令' },
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--allow-partial', description: '允许部分测试通过', defaultValue: false },
      { flags: '--max-retries <n>', description: '最大重试次数', defaultValue: '2' },
      { flags: '--coverage', description: '检查测试覆盖率' },
      { flags: '--coverage-threshold <n>', description: '覆盖率阈值', defaultValue: '80' },
    ],
    action: { module: 'passes-gate', export: 'runPassesGate' },
    optionRoutes: [
      { flag: 'coverage', when: true, impl: { module: 'passes-gate', export: 'runPassesGate' } },
      { flag: 'coverage', when: true, impl: { module: 'passes-gate', export: 'coverageCheck' } },
    ],
  },
  {
    command: 'init',
    description: '初始化项目的 harness 配置',
    options: [
      { flags: '-p, --preset <preset>', description: '预设名称 (strict/standard/relaxed)', defaultValue: 'standard' },
      { flags: '-g, --governance <level>', description: '治理级别 (minimal/standard/strict)' },
      { flags: '-t, --type <type>', description: '项目类型 (node-api/nextjs-app/python-api/custom)' },
      { flags: '--project-path <path>', description: '项目路径' },
      { flags: '--no-git-hooks', description: '不创建 Git hooks' },
      { flags: '--no-github-actions', description: '不创建 GitHub Actions' },
      { flags: '--print-snippets', description: '只输出代码片段，不创建文件' },
    ],
    action: { module: 'init', export: 'init' },
  },
  {
    command: 'report',
    description: '生成检查报告',
    options: [
      { flags: '-o, --output <path>', description: '输出文件路径' },
      { flags: '-f, --format <format>', description: '输出格式 (json/markdown)', defaultValue: 'markdown' },
      { flags: '-p, --project-path <path>', description: '项目路径' },
    ],
    action: { module: 'report', export: 'report' },
  },
  {
    command: 'status',
    description: '显示 Harness 状态、统计、异常检测',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '-d, --detail', description: '显示详细信息', defaultValue: false },
      { flags: '-a, --anomalies', description: '只显示异常', defaultValue: false },
      { flags: '--hours <n>', description: '分析最近 N 小时', defaultValue: '24' },
    ],
    action: { module: 'status', export: 'status' },
    mapActionArgs: (_pos, options) => [
      {
        projectPath: options.projectPath,
        detail: options.detail,
        anomalies: options.anomalies,
        hours: parseInt(String(options.hours), 10),
      },
    ],
  },
  {
    command: 'spec',
    argument: '[subcommand]',
    description: 'Spec 验证命令',
    options: [
      { flags: '-s, --schema <path>', description: 'Schema 路径（项目定义）' },
      { flags: '--staged', description: '只验证暂存文件', defaultValue: false },
      { flags: '-f, --file <path>', description: '验证指定文件' },
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '-v, --verbose', description: '详细输出', defaultValue: false },
    ],
    action: { module: 'spec', export: 'specValidate' },
    subcommands: {
      list: { impl: { module: 'spec', export: 'listSpecTypes' } },
    },
    // 未知位置参数按文件路径落回默认 action（spec foo.yaml 合法用法）
    subcommandStrict: false,
    mapActionArgs: (positionals, options) => [
      {
        schema: options.schema,
        staged: options.staged,
        file: options.file ||
          (positionals[0] && !String(positionals[0]).startsWith('-') ? positionals[0] : undefined),
        projectPath: options.projectPath,
        verbose: options.verbose,
      },
    ],
  },
  {
    command: 'sync-docs',
    description: '同步项目文档（CAPABILITIES.md、CONTEXT.md、AGENTS.md）',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '-c, --check', description: '只检查不修改（CI 模式）', defaultValue: false },
      { flags: '--json', description: '输出 JSON 格式（供 LLM 消费）', defaultValue: false },
      { flags: '--agents', description: '同步 AGENTS.md（agent 导读；PRESERVE 标记段重新生成时保留）', defaultValue: false },
      { flags: '--compact', description: '一次性迁移：将 CAPABILITIES.md 文件表格折叠为目录条目', defaultValue: false },
    ],
    // --check 下的漂移由实现返回 fail（候选7：退出码映射只在 bin 一处），故无需 afterRun
    action: { module: 'sync-docs', export: 'syncDocs' },
  },
  {
    command: 'knowledge',
    argument: '[subcommand] [arg]',
    alias: 'kb',
    description: '知识库管理（list/search/import/decay/stats/audit）',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--type <types>', description: '按类型过滤（逗号分隔）' },
      { flags: '--maturity <levels>', description: '按成熟度过滤（逗号分隔）' },
      { flags: '--tag <tags>', description: '按标签过滤（逗号分隔）' },
      { flags: '--sources <sources>', description: '导入源（逗号分隔: code,git,docs）' },
      { flags: '--limit <n>', description: '结果数量限制', defaultValue: '20' },
      { flags: '--reset', description: '重置导入状态', defaultValue: false },
      { flags: '--fix', description: '自动修复（用于 audit）', defaultValue: false },
      { flags: '--dry-run', description: '只输出报告不修改（用于 audit）', defaultValue: false },
      { flags: '--threshold <n>', description: '短内容阈值（字符数，用于 audit）', defaultValue: '50' },
      { flags: '--dir <path>', description: '知识库目录（覆盖默认路径）' },
      { flags: '--json', description: 'JSON 格式输出', defaultValue: false },
    ],
    subcommands: {
      // 纯投影条目：commander options 与处理器参数同名，原样传入（编组归命令模块）
      list: { impl: { module: 'knowledge', export: 'knowledgeList' }, aliases: ['ls'] },
      search: {
        impl: { module: 'knowledge', export: 'knowledgeSearchCommand' },
        aliases: ['s'],
        withPositionals: true,
      },
      import: { impl: { module: 'knowledge', export: 'knowledgeImport' }, aliases: ['i'] },
      decay: { impl: { module: 'knowledge', export: 'knowledgeDecay' }, aliases: ['d'] },
      stats: { impl: { module: 'knowledge', export: 'knowledgeStats' }, aliases: ['st'] },
      'sync-rag': { impl: { module: 'knowledge', export: 'knowledgeSyncRag' } },
      audit: { impl: { module: 'knowledge', export: 'knowledgeAudit' }, aliases: ['a'] },
      snapshot: { impl: { module: 'knowledge', export: 'knowledgeSnapshot' } },
      migrate: { impl: { module: 'knowledge', export: 'knowledgeMigrate' } },
      index: { impl: { module: 'knowledge', export: 'knowledgeIndex' }, aliases: ['idx'] },
      health: { impl: { module: 'knowledge', export: 'knowledgeHealth' }, aliases: ['h'] },
    },
  },
  {
    command: 'sdd',
    argument: '[subcommand]',
    description: 'SDD 管理（index）',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--dir <dir>', description: '指定基础目录' },
      { flags: '--json', description: 'JSON 输出' },
    ],
    subcommands: {
      index: { impl: { module: 'sdd', export: 'sddIndex' }, aliases: ['idx'] },
    },
  },
  {
    command: 'failure',
    argument: '[subcommand]',
    description: '失败记录管理（list/stats/clear）',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--type <type>', description: '按错误类型过滤' },
      { flags: '--level <level>', description: '按失败等级过滤 (L1/L2/L3/L4)' },
      { flags: '--limit <n>', description: '结果数量限制', defaultValue: '20' },
      { flags: '--json', description: 'JSON 格式输出', defaultValue: false },
    ],
    subcommands: {
      list: { impl: { module: 'failure', export: 'failureList' }, aliases: ['ls'] },
      stats: { impl: { module: 'failure', export: 'failureStats' }, aliases: ['st'] },
      clear: { impl: { module: 'failure', export: 'failureClear' } },
    },
  },
  {
    command: 'posteval-plan',
    argument: '<planPath>',
    description: '验证 plan 文件的 checklist items 是否都有对应的 staged diff',
    options: [],
    action: { module: 'posteval-plan', export: 'postevalPlan' },
    mapActionArgs: (positionals) => [{ planPath: positionals[0] }],
  },
  {
    command: 'release',
    description: 'npm 发布流水线：tsc → dist 验证 → npm version → git push → npm publish → gh release。不依赖 Studio API。',
    options: [
      { flags: '--bump <type>', description: '版本递增类型', defaultValue: 'patch' },
      { flags: '--dry-run <bool>', description: '仅模拟执行', defaultValue: 'false' },
    ],
    action: { module: 'release', export: 'release' },
    mapActionArgs: (_pos, options) => [{ bumpType: options.bump, dryRun: options.dryRun }],
  },
  {
    command: 'constraints',
    description: '输出约束集合元数据（版本、hash、计数、文本大小）',
    options: [
      { flags: '--json', description: '输出 JSON 格式', defaultValue: false },
    ],
    action: { module: 'constraints', export: 'constraints' },
    children: [
      {
        command: 'report',
        description: '约束使用报告：check 层统计表、退役候选诊断、prompt 注入清单、配置健康（只读）',
        options: [
          { flags: '-p, --project-path <path>', description: '项目路径' },
          { flags: '--export [file]', description: '导出脱敏 markdown 摘要（缺省 .harness/reports/constraints-<YYYYMMDD>.md）' },
          { flags: '--json', description: '输出 JSON 格式', defaultValue: false },
          { flags: '--zero-intercept-min <n>', description: '零拦截候选的最小评估样本数', defaultValue: '50' },
          { flags: '--noise-fail-rate <rate>', description: '高噪候选 fail 率阈值', defaultValue: '0.8' },
          { flags: '--noise-min-total <n>', description: '高噪候选最小评估样本数', defaultValue: '20' },
        ],
        action: { module: 'constraints-report', export: 'constraintsReport' },
        mapActionArgs: (_pos, options) => [{
          projectPath: options.projectPath,
          export: options.export,
          json: options.json,
          zeroInterceptMin: parseInt(String(options.zeroInterceptMin), 10),
          noiseFailRate: parseFloat(String(options.noiseFailRate)),
          noiseMinTotal: parseInt(String(options.noiseMinTotal), 10),
        }],
      },
      {
        command: 'retire',
        argument: '[id]',
        description: '退役约束：无 id 进入交互式候选选择（人确认）；带 id 直达退役需显式 --yes（写 config.yml + KnowledgeStore + 同步 CLAUDE.md 注入段）',
        options: [
          { flags: '-p, --project-path <path>', description: '项目路径' },
          { flags: '--reason <text>', description: '退役原因' },
          { flags: '-y, --yes', description: '显式确认直达退役（人确认闸门；无此 flag 直达报错并提示改走交互模式）', defaultValue: false },
        ],
        action: { module: 'constraints-retire', export: 'constraintsRetire' },
        mapActionArgs: (positionals, options) => [positionals[0], {
          projectPath: options.projectPath,
          reason: options.reason,
          yes: options.yes,
        }],
      },
    ],
  },
  {
    command: 'spec-baseline-check',
    argument: '<specPath>',
    description: '验证 spec 文件的前置条件是否满足',
    options: [
      { flags: '-p, --project-path <path>', description: '项目路径' },
      { flags: '--json', description: '输出 JSON 格式', defaultValue: false },
    ],
    action: { module: 'spec-baseline-check', export: 'specBaselineCheck' },
    mapActionArgs: (positionals, options) => [positionals[0], {
      projectPath: options.projectPath,
      json: options.json,
    }],
  },
];
