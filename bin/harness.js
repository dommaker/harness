#!/usr/bin/env node

/**
 * @dommaker/harness CLI 入口
 * 
 * 通用工程约束框架
 */

const { Command } = require('commander');
const { version } = require('../package.json');

/**
 * 门禁命令定义表（G1 注册表驱动生成）。
 * 纯数据模块（无门禁实现 import），--help/--version 懒加载不受影响；
 * 注册表双向闭环校验在实现加载期执行，不在此处。
 */
const { GATE_DEFINITIONS } = require('../dist/gates/definitions');

/**
 * 懒加载命令实现（工单 17）：只在 .action 执行时 require 命令桶，
 * --version/--help 等不触发命令体的调用不再加载全部实现。
 */
function cmd(name) {
  return require('../dist/cli/commands/index')[name];
}

const program = new Command();

program
  .name('harness')
  .description('通用工程约束框架 - 铁律系统、检查点验证、测试门控、执行追踪')
  .version(version);

// ========================================
// harness check
// ========================================
program
  .command('check')
  .description('检查铁律是否满足')
  .option('-p, --preset <preset>', '预设名称', 'standard')
  .option('-s, --staged', '只检查暂存文件', false)
  .option('-t, --trigger <trigger>', '触发条件')
  .option('--project-path <path>', '项目路径')
  .option('--list', '列出所有铁律')
  .action(async (options) => {
    if (options.list) {
      cmd('listLaws')();
    } else {
      await cmd('check')(options);
    }
  });

// ========================================
// harness validate
// ========================================
program
  .command('validate')
  .description('验证检查点是否满足')
  .option('-f, --file <path>', '检查点文件路径')
  .option('-p, --project-path <path>', '项目路径')
  .option('--strict', '严格模式（任何失败都退出）', false)
  .action(async (options) => {
    await cmd('validate')(options);
  });

// ========================================
// harness passes-gate
// ========================================
program
  .command('passes-gate')
  .description('运行测试门控，确保测试通过')
  .alias('pg')
  .option('-t, --test-command <command>', '测试命令')
  .option('-p, --project-path <path>', '项目路径')
  .option('--allow-partial', '允许部分测试通过', false)
  .option('--max-retries <n>', '最大重试次数', '2')
  .option('--coverage', '检查测试覆盖率')
  .option('--coverage-threshold <n>', '覆盖率阈值', '80')
  .action(async (options) => {
    if (options.coverage) {
      const threshold = parseInt(options.coverageThreshold, 10);
      await cmd('runPassesGate')(options);
      const projectPath = options.projectPath || process.cwd();
      await cmd('checkCoverage')(projectPath, threshold);
    } else {
      await cmd('runPassesGate')(options);
    }
  });

// ========================================
// harness init
// ========================================
program
  .command('init')
  .description('初始化项目的 harness 配置')
  .option('-p, --preset <preset>', '预设名称 (strict/standard/relaxed)', 'standard')
  .option('-g, --governance <level>', '治理级别 (minimal/standard/strict)')
  .option('-t, --type <type>', '项目类型 (node-api/nextjs-app/python-api/custom)')
  .option('--project-path <path>', '项目路径')
  .option('--no-git-hooks', '不创建 Git hooks')
  .option('--no-github-actions', '不创建 GitHub Actions')
  .option('--print-snippets', '只输出代码片段，不创建文件')
  .action(async (options) => {
    await cmd('init')(options);
  });

// ========================================
// harness report
// ========================================
program
  .command('report')
  .description('生成检查报告')
  .option('-o, --output <path>', '输出文件路径')
  .option('-f, --format <format>', '输出格式 (json/markdown/html)', 'markdown')
  .option('-p, --project-path <path>', '项目路径')
  .action(async (options) => {
    await cmd('report')(options);
  });

// ========================================
// harness status
// ========================================
program
  .command('status')
  .description('显示 Harness 状态、统计、异常检测')
  .option('-p, --project-path <path>', '项目路径')
  .option('-d, --detail', '显示详细信息', false)
  .option('-a, --anomalies', '只显示异常', false)
  .option('--hours <n>', '分析最近 N 小时', '24')
  .action(async (options) => {
    await cmd('status')({
      projectPath: options.projectPath,
      detail: options.detail,
      anomalies: options.anomalies,
      hours: parseInt(options.hours, 10),
    });
  });

// ========================================
// harness spec
// ========================================
program
  .command('spec [subcommand]')
  .description('Spec 验证命令')
  .option('-s, --schema <path>', 'Schema 路径（项目定义）')
  .option('--staged', '只验证暂存文件', false)
  .option('-f, --file <path>', '验证指定文件')
  .option('-p, --project-path <path>', '项目路径')
  .option('-v, --verbose', '详细输出', false)
  .action(async (subcommand, options, command) => {
    if (subcommand === 'list') {
      cmd('listSpecTypes')();
    } else {
      // 默认执行 validate
      await cmd('specValidate')({
        schema: options.schema,
        staged: options.staged,
        file: options.file || (subcommand && !subcommand.startsWith('-') ? subcommand : undefined),
        projectPath: options.projectPath,
        verbose: options.verbose,
      });
    }
  });

// ========================================
// 门禁命令（6 个，注册表驱动生成，G1）
// 命令名/别名/选项/子命令路由由 GATE_DEFINITIONS 的 cli 元数据生成，
// 与历史手工块完全兼容；新增门禁只需补定义 + 注册实现，不再手写本段。
// ========================================
for (const def of GATE_DEFINITIONS) {
  const cli = def.cli;
  const command = program.command(cli.command + (cli.argument ? ' ' + cli.argument : ''));
  command.description(cli.description);
  if (cli.alias) {
    command.alias(cli.alias);
  }
  for (const opt of cli.options) {
    if (opt.defaultValue !== undefined) {
      command.option(opt.flags, opt.description, opt.defaultValue);
    } else {
      command.option(opt.flags, opt.description);
    }
  }
  command.action(async (arg, options) => {
    // commander：无位置参数的命令把 options 传入第一个形参
    const realArg = cli.argument ? arg : undefined;
    const realOptions = cli.argument ? options : arg;
    const sub = cli.subcommands && realArg != null ? cli.subcommands[realArg] : undefined;
    if (sub) {
      await cmd(sub)(realOptions);
    } else {
      await cmd(cli.action)(...cli.mapActionArgs(realArg, realOptions));
    }
  });
}

// ========================================
// harness sync-docs
// ========================================
program
  .command('sync-docs')
  .description('同步项目文档（CAPABILITIES.md、CONTEXT.md、AGENTS.md）')
  .option('-p, --project-path <path>', '项目路径')
  .option('-c, --check', '只检查不修改（CI 模式）', false)
  .option('--json', '输出 JSON 格式（供 LLM 消费）', false)
  .option('--agents', '同步 AGENTS.md（agent 导读；PRESERVE 标记段重新生成时保留）', false)
  .option('--compact', '一次性迁移：将 CAPABILITIES.md 文件表格折叠为目录条目', false)
  .action(async (options) => {
    const ok = await cmd('syncDocs')(options);
    if (!ok && options.check) {
      process.exit(1);
    }
  });

// ========================================
// harness knowledge
// ========================================
program
  .command('knowledge [subcommand] [arg]')
  .description('知识库管理（list/search/import/decay/stats/audit）')
  .alias('kb')
  .option('-p, --project-path <path>', '项目路径')
  .option('--type <types>', '按类型过滤（逗号分隔）')
  .option('--maturity <levels>', '按成熟度过滤（逗号分隔）')
  .option('--tag <tags>', '按标签过滤（逗号分隔）')
  .option('--sources <sources>', '导入源（逗号分隔: code,git,docs）')
  .option('--limit <n>', '结果数量限制', '20')
  .option('--reset', '重置导入状态', false)
  .option('--scope <scope>', '知识范围（用于 upsert 去重）')
  .option('--title <title>', '知识标题（用于 upsert）')
  .option('--content <content>', '知识内容 Markdown（用于 upsert）')
  .option('--file <path>', '从文件读取内容（用于 upsert）')
  .option('--source <source>', '知识来源 (analyst/cli/design)', 'cli')
  .option('--fix', '自动修复（用于 audit）', false)
  .option('--dry-run', '只输出报告不修改（用于 audit）', false)
  .option('--threshold <n>', '短内容阈值（字符数，用于 audit）', '50')
  .option('--dir <path>', '知识库目录（覆盖默认路径）')
  .option('--json', 'JSON 格式输出', false)
  .action(async (subcommand, arg, options) => {
    const opts = { projectPath: options.projectPath, json: options.json };
    switch (subcommand) {
      case 'list':
      case 'ls':
        await cmd('knowledgeList')({ ...opts, type: options.type, maturity: options.maturity, tag: options.tag });
        break;
      case 'search':
      case 's':
        if (!arg) { console.error('请提供搜索关键词'); process.exit(1); }
        await cmd('knowledgeSearch')(arg, { ...opts, limit: parseInt(options.limit, 10) });
        break;
      case 'import':
      case 'i':
        await cmd('knowledgeImport')({ ...opts, sources: options.sources, reset: options.reset });
        break;
      case 'decay':
      case 'd':
        await cmd('knowledgeDecay')(opts);
        break;
      case 'stats':
      case 'st':
        await cmd('knowledgeStats')(opts);
        break;
      case 'sync-rag':
        await cmd('knowledgeSyncRag')(opts);
        break;
      case 'sync-status':
      case 'sync':
        await cmd('knowledgeSyncStatus')(opts);
        break;
      case 'upsert':
      case 'up':
        await cmd('knowledgeUpsert')({
          scope: options.scope || '',
          title: options.title || '',
          content: options.content || '',
          file: options.file || '',
          type: options.type || 'architecture',
          source: options.source || 'cli',
        });
        break;
      case 'audit':
      case 'a':
        await cmd('knowledgeAudit')({
          ...opts,
          fix: options.fix,
          dryRun: options.dryRun,
          threshold: options.threshold,
          dir: options.dir,
        });
        break;
      case 'snapshot':
        cmd('knowledgeSnapshot')({ ...opts, dir: options.dir });
        break;
      case 'migrate':
        cmd('knowledgeMigrate')({ ...opts, dir: options.dir });
        break;
      case 'index':
      case 'idx':
        cmd('knowledgeIndex')({ ...opts, dir: options.dir });
        break;
      case 'health':
      case 'h':
        await cmd('knowledgeHealth')({ ...opts, dir: options.dir });
        break;
      default:
        // 无子命令时显示帮助
        if (!subcommand) {
          program.commands.find(c => c.name() === 'knowledge').help();
        } else {
          console.error(`未知子命令: ${subcommand}`);
          process.exit(1);
        }
    }
  });

// ========================================
// harness sdd
// ========================================
program
  .command('sdd [subcommand]')
  .description('SDD 管理（index）')
  .option('-p, --project-path <path>', '项目路径')
  .option('--dir <dir>', '指定基础目录')
  .option('--json', 'JSON 输出')
  .action(async (subcommand, options) => {
    const opts = { projectPath: options.projectPath, json: options.json };
    switch (subcommand) {
      case 'index':
      case 'idx':
        cmd('sddIndex')({ ...opts, dir: options.dir });
        break;
      default:
        if (!subcommand) {
          program.commands.find(c => c.name() === 'sdd').help();
        } else {
          console.error(`未知子命令: ${subcommand}`);
          process.exit(1);
        }
    }
  });

// ========================================
// harness failure
// ========================================
program
  .command('failure [subcommand]')
  .description('失败记录管理（list/stats/clear）')
  .option('-p, --project-path <path>', '项目路径')
  .option('--type <type>', '按错误类型过滤')
  .option('--level <level>', '按失败等级过滤 (L1/L2/L3/L4)')
  .option('--limit <n>', '结果数量限制', '20')
  .option('--json', 'JSON 格式输出', false)
  .action(async (subcommand, options) => {
    const opts = { projectPath: options.projectPath, json: options.json };
    switch (subcommand) {
      case 'list':
      case 'ls':
        await cmd('failureList')({ ...opts, limit: parseInt(options.limit, 10), type: options.type, level: options.level });
        break;
      case 'stats':
      case 'st':
        await cmd('failureStats')(opts);
        break;
      case 'clear':
        await cmd('failureClear')(opts);
        break;
      default:
        if (!subcommand) {
          program.commands.find(c => c.name() === 'failure').help();
        } else {
          console.error(`未知子命令: ${subcommand}`);
          process.exit(1);
        }
    }
  });

// ========================================
// harness posteval-plan
// ========================================
program
  .command('posteval-plan <planPath>')
  .description('验证 plan 文件的 checklist items 是否都有对应的 staged diff')
  .action(async (planPath) => {
    await cmd('postevalPlan')({ planPath });
  });

// ========================================
// harness update-user-model
// ========================================
program
  .command('update-user-model')
  .description('从新对话中提取信号，更新用户思维模型（增量演化）')
  .alias('uum')
  .option('--json', 'JSON 格式输出', false)
  .option('--dry-run', '只显示变化，不更新状态', false)
  .option('--days <n>', '只处理最近 N 天的会话（自然日，含今天）')
  .action(async (options) => {
    await cmd('updateUserModel')({
      days: options.days !== undefined ? parseInt(options.days, 10) : undefined,
      json: options.json,
      dryRun: options.dryRun,
    });
  });

// ========================================
// harness release
// ========================================
program
  .command('release')
  .description('npm 发布流水线：tsc → dist 验证 → npm version → git push → npm publish → gh release。不依赖 Studio API。')
  .option('--bump <type>', '版本递增类型', 'patch')
  .option('--dry-run <bool>', '仅模拟执行', 'false')
  .action(async (options) => {
    await cmd('release')({ bumpType: options.bump, dryRun: options.dryRun });
  });

// ========================================
// harness analyze-sessions
// ========================================
program
  .command('analyze-sessions')
  .description('分析 Claude Code 对话，挖掘纠正模式和高频概念，生成规则候选')
  .alias('analyze')
  .option('-d, --days <n>', '分析最近 N 天的会话', '7')
  .option('--json', 'JSON 格式输出', false)
  .action(async (options) => {
    await cmd('analyzeSessions')({
      days: parseInt(options.days, 10),
      json: options.json,
    });
  });

// ========================================
// harness constraints
// ========================================
const constraintsCmd = program
  .command('constraints')
  .description('输出约束集合元数据（版本、hash、计数、文本大小）')
  .option('--json', '输出 JSON 格式', false)
  .action(async (options) => {
    await cmd('constraints')(options);
  });

constraintsCmd
  .command('report')
  .description('约束使用报告：check 层统计表、退役候选诊断、prompt 注入清单、配置健康（只读）')
  .option('-p, --project-path <path>', '项目路径')
  .option('--export [file]', '导出脱敏 markdown 摘要（缺省 .harness/reports/constraints-<YYYYMMDD>.md）')
  .option('--json', '输出 JSON 格式', false)
  .option('--zero-intercept-min <n>', '零拦截候选的最小评估样本数', '50')
  .option('--noise-fail-rate <rate>', '高噪候选 fail 率阈值', '0.8')
  .option('--noise-min-total <n>', '高噪候选最小评估样本数', '20')
  .action(async (options) => {
    await cmd('constraintsReport')({
      projectPath: options.projectPath,
      export: options.export,
      json: options.json,
      zeroInterceptMin: parseInt(options.zeroInterceptMin, 10),
      noiseFailRate: parseFloat(options.noiseFailRate),
      noiseMinTotal: parseInt(options.noiseMinTotal, 10),
    });
  });

constraintsCmd
  .command('retire [id]')
  .description('退役约束：无 id 进入交互式候选选择（人确认）；带 id 直达退役需显式 --yes（写 config.yml + KnowledgeStore + 同步 CLAUDE.md 注入段）')
  .option('-p, --project-path <path>', '项目路径')
  .option('--reason <text>', '退役原因')
  .option('-y, --yes', '显式确认直达退役（人确认闸门；无此 flag 直达报错并提示改走交互模式）', false)
  .action(async (id, options) => {
    await cmd('constraintsRetire')(id, {
      projectPath: options.projectPath,
      reason: options.reason,
      yes: options.yes,
    });
  });

// ========================================
// harness doc-freshness-check
// ========================================
program
  .command('doc-freshness-check <docPath>')
  .description('检查文档声明的新鲜度：提取可验证声明，与代码对照')
  .option('--changed-files <list>', '变更文件列表（逗号分隔）')
  .option('--format <format>', '输出格式 (table/json)', 'table')
  .option('-p, --project-path <path>', '项目路径')
  .action(async (docPath, options) => {
    await cmd('docFreshnessCheck')(docPath, {
      changedFiles: options.changedFiles,
      format: options.format,
      projectPath: options.projectPath,
    });
  });

// ========================================
// harness spec-baseline-check
// ========================================
program
  .command('spec-baseline-check <specPath>')
  .description('验证 spec 文件的前置条件是否满足')
  .option('-p, --project-path <path>', '项目路径')
  .option('--json', '输出 JSON 格式', false)
  .action(async (specPath, options) => {
    await cmd('specBaselineCheck')(specPath, {
      projectPath: options.projectPath,
      json: options.json,
    });
  });

// 解析命令行参数
program.parse();
