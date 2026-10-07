/**
 * 约束升级提案材料打包（库面，harness#198；ADR-0033 决策 4，块 3 子项 5）
 *
 * 升级通道链路：下游审卡发起/初审 → approve 后打包脱敏材料 → 人拿材料去 harness 仓
 * 开 issue（github 操作留给人，本模块不触网）。
 *
 * `packProposal` 执行产物生成并返回结构化 `{ materialPath, content }`——消费方不再按
 * 命名约定反猜产物路径：命名规律（`.harness/reports/proposal-<id>-<yyyymmdd>.md`）
 * 的单一来源是本模块的 `proposalMaterialPath`。
 *
 * 材料内容：条文 + severity + checker 模板与参数 + traces.log 使用统计（只有计数）
 * + 升级理由留白段。
 *
 * 脱敏口径（工具做路径脱敏，内容脱敏归人）：
 * - 项目根绝对路径一律替换为 `<repoRoot>`；
 * - 统计只有计数与首末次日期，不带样本内容；
 * - 应用层约束的 params（正则/glob）**原文带出**并标注"请人工确认无应用内部信息"——
 *   打包工具是质量前置，不是保密闸门。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { findConstraintDefinition } from './find-constraint';
import { collectUsageByConstraint, readProjectTraces } from './usage-report';
import type { Constraint } from '../../types/constraint';

/** 提案材料的输入（查找结果 + 使用统计聚合） */
export interface ProposalMaterial {
  constraint: Constraint;
  stats: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    evaluated: number;
    firstAt?: number;
    lastAt?: number;
  };
}

/** packProposal 的结构化返回：产物路径（命名规律单一来源算出）+ 材料全文 */
export interface PackProposalResult {
  materialPath: string;
  content: string;
}

function formatDate(ts: number | undefined): string {
  return ts === undefined ? '（无记录）' : new Date(ts).toISOString().slice(0, 10);
}

/**
 * 渲染脱敏提案材料 markdown（纯函数）
 *
 * @param projectRoot 用于路径脱敏（材料中出现的项目根绝对路径替换为 `<repoRoot>`）
 */
export function renderProposalMarkdown(
  material: ProposalMaterial,
  projectRoot: string,
  now: Date = new Date()
): string {
  const c = material.constraint;
  const s = material.stats;
  const isApp = c.source === 'app';

  const lines: string[] = [];
  lines.push(`# 约束升级提案材料：${c.id}`);
  lines.push('');
  lines.push(`- 生成日期: ${now.toISOString().slice(0, 10)}`);
  lines.push(`- 来源: ${isApp ? '应用层（.harness/constraints.yml）' : '内置'}`);
  lines.push(`- severity: ${c.severity}`);
  lines.push('');

  lines.push('## 条文');
  lines.push('');
  lines.push(`rule: ${c.rule}`);
  if (c.message && c.message !== c.rule) lines.push(`message: ${c.message}`);
  if (c.description) lines.push(`description: ${c.description}`);
  lines.push('');

  lines.push('## checker');
  lines.push('');
  if (isApp) {
    lines.push(`模板: \`${c.checker}\``);
    lines.push('');
    lines.push('参数（原文带出，**请人工确认无应用内部信息**——工具只做路径脱敏，内容脱敏归人）:');
    lines.push('');
    lines.push('```yaml');
    lines.push(yaml.dump(c.params ?? {}, { lineWidth: 120 }).trimEnd());
    lines.push('```');
  } else {
    lines.push('内置定制 checker（按约束 id 注册，非参数化模板）。升级到通用层前需评审：');
    lines.push('改写为模板 + 参数，或作为通用规则保留定制实现。');
  }
  lines.push('');

  lines.push('## 使用统计（traces.log 聚合，只有计数）');
  lines.push('');
  lines.push(`- total: ${s.total}`);
  lines.push(`- evaluated: ${s.evaluated}（pass ${s.pass} / fail ${s.fail} / skip ${s.skip}）`);
  lines.push(`- 首次触发: ${formatDate(s.firstAt)}`);
  lines.push(`- 最近触发: ${formatDate(s.lastAt)}`);
  lines.push('');

  lines.push('## 升级理由');
  lines.push('');
  lines.push('> （请在此填写：为什么这条约束该进通用层——适用面、证据、与其他仓的相关性）');
  lines.push('');

  // 路径脱敏：项目根绝对路径一律替换
  return lines.join('\n').split(projectRoot).join('<repoRoot>');
}

/**
 * 收集提案材料（定义查找 + traces 使用统计聚合）；未知 id → undefined
 *
 * 与 renderProposalMarkdown 组合 = 不落盘的渲染通道（CLI --stdout）；
 * 要落盘产物走 packProposal。
 */
export function collectProposalMaterial(projectRoot: string, id: string): ProposalMaterial | undefined {
  const constraint = findConstraintDefinition(id, projectRoot);
  if (!constraint) return undefined;

  const usage = collectUsageByConstraint(readProjectTraces(projectRoot)).get(id);
  return {
    constraint,
    stats: {
      total: usage?.total ?? 0,
      pass: usage?.pass ?? 0,
      fail: usage?.fail ?? 0,
      skip: usage?.skip ?? 0,
      evaluated: (usage?.total ?? 0) - (usage?.skip ?? 0),
      firstAt: usage?.firstAt,
      lastAt: usage?.lastAt,
    },
  };
}

/**
 * 提案产物路径（命名规律单一来源）：`.harness/reports/proposal-<id>-<yyyymmdd>.md`
 *
 * 消费方拿产物路径一律经本函数（或 packProposal 的返回），不在库外拼字符串。
 */
export function proposalMaterialPath(projectRoot: string, id: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(projectRoot, '.harness', 'reports', `proposal-${id}-${date}.md`);
}

/**
 * 执行提案材料打包：渲染脱敏材料、落盘产物，返回 `{ materialPath, content }`
 *
 * 未知 id → undefined（不落盘），由调用方提示。
 */
export function packProposal(
  projectRoot: string,
  id: string,
  options: { now?: Date } = {}
): PackProposalResult | undefined {
  const material = collectProposalMaterial(projectRoot, id);
  if (!material) return undefined;

  const now = options.now ?? new Date();
  const content = renderProposalMarkdown(material, projectRoot, now);
  const materialPath = proposalMaterialPath(projectRoot, id, now);
  fs.mkdirSync(path.dirname(materialPath), { recursive: true });
  fs.writeFileSync(materialPath, content, 'utf-8');
  return { materialPath, content };
}
