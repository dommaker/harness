/**
 * CLI 命令定义形状（正本）
 *
 * 原住 `cli/commands/definitions.ts`；gates/definitions.ts 的 CLI 元数据同用此形状
 * （ADR-0007：门禁与非门禁共用同一命令定义形状，bin 单引擎单循环），type-import cli
 * 形成 gates→cli 倒挂，故下沉 types 层（ADR-0040 Phase 3）。两侧定义表改为从这里引。
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
