/**
 * harness knowledge audit 子命令（知识库质量审计；Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import { KnowledgeAudit } from '../../../knowledge/audit';
import type { AuditRuleName } from '../../../knowledge/audit-rules';
import type { AuditReport, DimensionMetrics } from '../../../knowledge/audit-dimensions';
import { KnowledgeIndexGenerator } from '../../../knowledge/index-generator';
import { logError, processIO, type CommandIO, type CommandResult } from '../../command-contract';
import { parseNumericFlag } from '../../../utils/numeric-flag';
import {
  announce,
  blankLine,
  dimensionLabel,
  emitKnowledgeView,
  openKnowledgeStore,
  resolveKnowledgeBaseDir,
  ruleLabel,
  toneForScore,
  toneForSeverity,
  type DisplayModel,
  type DisplayRow,
  type DisplaySection,
} from '../knowledge-view';
import type { KnowledgeDirOption, KnowledgeOptions } from './shared';

export type KnowledgeAuditOptions = KnowledgeOptions & KnowledgeDirOption & {
  fix?: boolean;
  dryRun?: boolean;
  /**
   * `--threshold <n>` 的 commander 原值。旗帜给到的恒是字符串（缺省 '50' 也是），
   * 声明跟着运行时走（harness#152）；窄化在 `knowledgeAudit` 装配点做一次。
   */
  threshold?: string;
};

/** `knowledgeAuditView` 的入参面：threshold 已过装配窄化，引擎槽位要的是数值 */
export type KnowledgeAuditViewOptions = Omit<KnowledgeAuditOptions, 'threshold'> & {
  threshold?: number;
};

/** 阈值装配结果：`ok: false` = 脏输入，由命令入口 fail-loud（不得往判定槽塞 NaN） */
type ThresholdAssembly = { ok: true; value?: number } | { ok: false; raw: string };

/**
 * `--threshold` 的装配点窄化（harness#152）：非负整数字符串 → 数值，转不出来即脏输入。
 * `undefined` = 未传，落引擎缺省（50）；`'0'` 是显式零值，不当「未传」兜掉。
 * 判定规则正本是 `parseNumericFlag`（harness#154 统一解析器），此处保留 #152 的
 * 函数面与报错文案（冻结测试钉死），只做委派。
 */
function assembleShortContentThreshold(raw: string | undefined): ThresholdAssembly {
  return parseNumericFlag(raw, 'int');
}

export function knowledgeAuditView(options: KnowledgeAuditViewOptions, io: CommandIO) {
  const audit = new KnowledgeAudit(openKnowledgeStore(options, io), {
    shortContentThreshold: options.threshold,
  });
  const isDryRun = options.dryRun && !options.fix;
  if (!isDryRun) announce(io, options.json, '🔍 知识库质量审计...\n');
  const report = audit.run({ autoFix: options.fix && !isDryRun });
  const showFixHint = !options.fix && report.issues.length > 0;

  return {
    data: report,
    human: (): DisplayModel => ({ sections: auditSections(report, showFixHint) }),
  };
}

function auditSections(report: AuditReport, showFixHint: boolean): DisplaySection[] {
  const sections: DisplaySection[] = [{
    rows: [
      { cells: [{ label: '  总条目: ', tone: 'emph' }, { field: 'totalEntries', text: String(report.totalEntries), tone: 'emph' }] },
      { cells: [{ label: '  健康分: ', tone: 'emph' }, { field: 'healthScore.before', text: `${report.healthScore.before}/100`, tone: 'emph' }] },
    ],
  }];

  if (report.autoFixed > 0) {
    sections[0].rows.push(
      { cells: [{ label: '  自动修复: ', tone: 'ok' }, { field: 'autoFixed', text: String(report.autoFixed), tone: 'ok' }] },
      { cells: [{ label: '  修复后: ', tone: 'emph' }, { field: 'healthScore.after', text: `${report.healthScore.after}/100`, tone: 'emph' }] },
    );
  }
  sections[0].rows.push(blankLine());

  const dimensions: DisplayRow[] = [];
  for (const [key, dim] of Object.entries(report.dimensions) as Array<[keyof AuditReport['dimensions'], DimensionMetrics]>) {
    dimensions.push({ cells: [
      { field: `dimensions.${key}`, text: `    ${dimensionLabel(key)}: ` },
      { field: `dimensions.${key}.score`, text: `${dim.score}/100`, tone: toneForScore(dim.score) },
      { field: `dimensions.${key}.issues`, text: ` (${dim.issues} 问题)` },
    ] });
  }
  dimensions.push(blankLine());
  sections.push({ title: '  维度评分:', rows: dimensions });

  // 规则 label 正本在 audit-rules.ts 的规则定义上（#109 编译期闭环经 ruleLabel 转发）
  const rules: DisplayRow[] = [];
  for (const [rule, count] of Object.entries(report.summary) as Array<[AuditRuleName, number]>) {
    if (count === 0) continue;
    rules.push({ cells: [{ field: `summary.${rule}`, text: `  ${ruleLabel(rule)}: ${count}`, tone: 'error' }] });
  }
  if (report.issues.length > 0) {
    rules.push(blankLine()); // 「问题详情」标题前的空行（原排版是 `\n` 前缀）
  }
  sections.push({ rows: rules });

  if (report.issues.length > 0) {
    const issues: DisplayRow[] = [blankLine()];
    for (const [i, issue] of report.issues.slice(0, 20).entries()) {
      issues.push({ cells: [
        { field: `issues.${i}.severity`, text: `  [${issue.severity}]`, tone: toneForSeverity(issue.severity) },
        { field: `issues.${i}.entryId`, text: ` ${issue.entryId}: ` },
        { field: `issues.${i}.title`, text: issue.title },
      ] });
      issues.push({ cells: [
        { field: `issues.${i}.detail`, text: `    ${issue.detail}`, tone: 'muted' },
        { label: ' → ' },
        { field: `issues.${i}.action`, text: issue.action },
      ] });
    }
    if (report.issues.length > 20) {
      issues.push(blankLine(), { cells: [
        { label: '  ... 还有 ', tone: 'muted' },
        { field: 'issues.length', text: String(report.issues.length - 20), tone: 'muted' },
        { label: ' 条', tone: 'muted' },
      ] });
    }
    sections.push({ title: '  问题详情 (前 20 条):', rows: issues });
  }

  if (showFixHint) {
    sections.push({ rows: [blankLine(), { cells: [{ label: '  使用 --fix 自动修复', tone: 'warn' }] }] });
  }
  return sections;
}

export async function knowledgeAudit(options: KnowledgeAuditOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const threshold = assembleShortContentThreshold(options.threshold);
  if (!threshold.ok) {
    logError(io, `错误：--threshold 需要非负整数阈值（字符数），收到 "${threshold.raw}"；短内容判定未执行`);
    return { kind: 'usage-error', reason: `knowledge audit --threshold 非法阈值: "${threshold.raw}"` };
  }
  const result = emitKnowledgeView(io, options, knowledgeAuditView({ ...options, threshold: threshold.value }, io));
  // 审计可能改文件，人读路径收尾重建索引；--json 保持不写盘（现状冻结，#133 不动这条策略）
  if (!options.json) {
    new KnowledgeIndexGenerator(resolveKnowledgeBaseDir(options, io)).regenerate();
    announce(io, options.json, '  📇 索引已重建', 'muted');
  }
  return result;
}
