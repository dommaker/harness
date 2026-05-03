#!/usr/bin/env node

/**
 * @dommaker/harness CLI 入口
 * 
 * 通用工程约束框架
 */

const { Command } = require('commander');
const { version } = require('../package.json');
const {
  check,
  listLaws,
  validate,
  runPassesGate,
  checkCoverage,
  init,
  report,
  status,
  flow,
  specValidate,
  listSpecTypes,
  acceptance,
  listAcceptanceCriteria,
  performance,
  security,
  auditDetails,
  contract,
  validateSchema,
  review,
  reviewStatus,
  executeCommand,
  syncDocs,
  knowledgeList,
  knowledgeSearch,
  knowledgeImport,
  knowledgeDecay,
  knowledgeStats,
  failureList,
  failureStats,
  failureClear,
} = require('../dist/cli/commands/index');

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
      listLaws();
    } else {
      await check(options);
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
    await validate(options);
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
      await runPassesGate(options);
      const projectPath = options.projectPath || process.cwd();
      await checkCoverage(projectPath, threshold);
    } else {
      await runPassesGate(options);
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
  .option('--upgrade', '升级现有配置（合并缺失字段，不覆盖自定义值）')
  .action(async (options) => {
    await init(options);
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
    await report(options);
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
    await status({
      projectPath: options.projectPath,
      detail: options.detail,
      anomalies: options.anomalies,
      hours: parseInt(options.hours, 10),
    });
  });

// ========================================
// harness flow
// ========================================
program
  .command('flow')
  .description('一键执行诊断 + 提案流程')
  .option('-p, --project-path <path>', '项目路径')
  .option('--from <step>', '从哪个步骤开始 (analyze/diagnose/propose)')
  .option('--auto-apply', '自动应用低风险提案', false)
  .option('--hours <n>', '分析最近 N 小时', '24')
  .action(async (options) => {
    await flow({
      projectPath: options.projectPath,
      from: options.from,
      autoApply: options.autoApply,
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
      listSpecTypes();
    } else {
      // 默认执行 validate
      await specValidate({
        schema: options.schema,
        staged: options.staged,
        file: options.file || (subcommand && !subcommand.startsWith('-') ? subcommand : undefined),
        projectPath: options.projectPath,
        verbose: options.verbose,
      });
    }
  });

// ========================================
// harness acceptance
// ========================================
program
  .command('acceptance [subcommand]')
  .description('验收标准门控，检查任务是否满足验收标准')
  .alias('acc')
  .option('-t, --task-id <id>', '任务 ID')
  .option('--tasks-path <path>', 'tasks.yml 路径')
  .option('-p, --project-path <path>', '项目路径')
  .option('--check-all', '检查所有任务', false)
  .option('--run-e2e', '运行 E2E 测试', false)
  .action(async (subcommand, options, command) => {
    if (subcommand === 'list') {
      await listAcceptanceCriteria(options);
    } else {
      await acceptance(options);
    }
  });

// ========================================
// harness performance
// ========================================
program
  .command('performance')
  .description('性能门控，检查性能指标')
  .alias('perf')
  .option('-p, --project-path <path>', '项目路径')
  .option('--coverage', '检查测试覆盖率', false)
  .option('--coverage-threshold <n>', '覆盖率阈值', '80')
  .option('--bundle', '检查打包大小', false)
  .option('--bundle-threshold <n>', '打包大小阈值 (KB)', '500')
  .option('--benchmark', '运行基准测试', false)
  .option('--benchmark-timeout <n>', '基准测试超时（秒）', '60')
  .action(async (options) => {
    await performance({
      projectPath: options.projectPath,
      coverage: options.coverage,
      coverageThreshold: parseInt(options.coverageThreshold, 10),
      bundle: options.bundle,
      bundleThreshold: parseInt(options.bundleThreshold, 10),
      benchmark: options.benchmark,
      benchmarkTimeout: parseInt(options.benchmarkTimeout, 10),
    });
  });

// ========================================
// harness security
// ========================================
program
  .command('security [subcommand]')
  .description('安全门控，检查安全漏洞')
  .alias('sec')
  .option('-p, --project-path <path>', '项目路径')
  .option('--severity <level>', '严重性阈值 (low/moderate/high/critical)', 'high')
  .option('--ignore-warnings', '忽略警告', false)
  .option('--ignore-dev-deps', '忽略开发依赖', false)
  .option('--scan-command <cmd>', '自定义扫描命令')
  .action(async (subcommand, options, command) => {
    if (subcommand === 'audit') {
      await auditDetails(options);
    } else {
      await security(options);
    }
  });

// ========================================
// harness contract
// ========================================
program
  .command('contract [subcommand]')
  .description('API 契约门控，检查 OpenAPI Schema')
  .option('-p, --project-path <path>', '项目路径')
  .option('--contract-path <path>', '契约文件路径', 'openapi.yaml')
  .option('--no-strict', '关闭严格模式')
  .option('--allow-breaking', '允许破坏性变更', false)
  .action(async (subcommand, options, command) => {
    if (subcommand === 'validate') {
      await validateSchema(options);
    } else {
      await contract(options);
    }
  });

// ========================================
// harness review
// ========================================
program
  .command('review [subcommand]')
  .description('代码审查门控，检查审查状态')
  .option('-p, --project-path <path>', '项目路径')
  .option('--min-reviewers <n>', '最少审查人数', '1')
  .option('--no-require-approval', '不要求审批')
  .option('--no-block-on-changes', '不阻止变更请求')
  .option('--allowed-reviewers <list>', '允许的审查者（逗号分隔）')
  .action(async (subcommand, options, command) => {
    if (subcommand === 'status') {
      await reviewStatus(options);
    } else {
      await review({
        projectPath: options.projectPath,
        minReviewers: parseInt(options.minReviewers, 10),
        requireApproval: options.requireApproval,
        blockOnChangesRequested: options.blockOnChanges,
        allowedReviewers: options.allowedReviewers,
      });
    }
  });

// ========================================
// harness command
// ========================================
program
  .command('command [cmd]')
  .description('检查命令是否在黑名单中')
  .alias('cmd')
  .option('-l, --level', '显示风险等级')
  .option('--list', '列出所有黑名单规则')
  .option('--json', 'JSON 格式输出')
  .option('--strict', '严格模式（warn 也阻止）')
  .action(async (cmd, options) => {
    await executeCommand(cmd, options);
  });

// ========================================
// harness sync-docs
// ========================================
program
  .command('sync-docs')
  .description('同步项目文档（CAPABILITIES.md、CONTEXT.md、CHANGELOG.md）')
  .option('-p, --project-path <path>', '项目路径')
  .option('-c, --check', '只检查不修改（CI 模式）', false)
  .option('--changelog', '生成 CHANGELOG 条目', false)
  .option('--json', '输出 JSON 格式（供 LLM 消费）', false)
  .action(async (options) => {
    const ok = await syncDocs(options);
    if (!ok && options.check) {
      process.exit(1);
    }
  });

// ========================================
// harness knowledge
// ========================================
program
  .command('knowledge [subcommand] [arg]')
  .description('知识库管理（list/search/import/decay/stats）')
  .alias('kb')
  .option('-p, --project-path <path>', '项目路径')
  .option('--type <types>', '按类型过滤（逗号分隔）')
  .option('--maturity <levels>', '按成熟度过滤（逗号分隔）')
  .option('--tag <tags>', '按标签过滤（逗号分隔）')
  .option('--sources <sources>', '导入源（逗号分隔: code,git,docs）')
  .option('--limit <n>', '结果数量限制', '20')
  .option('--reset', '重置导入状态', false)
  .option('--json', 'JSON 格式输出', false)
  .action(async (subcommand, arg, options) => {
    const opts = { projectPath: options.projectPath, json: options.json };
    switch (subcommand) {
      case 'list':
      case 'ls':
        await knowledgeList({ ...opts, type: options.type, maturity: options.maturity, tag: options.tag });
        break;
      case 'search':
      case 's':
        if (!arg) { console.error('请提供搜索关键词'); process.exit(1); }
        await knowledgeSearch(arg, { ...opts, limit: parseInt(options.limit, 10) });
        break;
      case 'import':
      case 'i':
        await knowledgeImport({ ...opts, sources: options.sources, reset: options.reset });
        break;
      case 'decay':
      case 'd':
        await knowledgeDecay(opts);
        break;
      case 'stats':
      case 'st':
        await knowledgeStats(opts);
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
        await failureList({ ...opts, limit: parseInt(options.limit, 10), type: options.type, level: options.level });
        break;
      case 'stats':
      case 'st':
        await failureStats(opts);
        break;
      case 'clear':
        await failureClear(opts);
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

// 解析命令行参数
program.parse();
