/**
 * 已发布类型面全量冻结闸（ADR-0003 类型面补全 / ADR-0022 追记第 4 条）
 *
 * 存在的理由是一起**定级**错误，不是一起删除错误：本仓 breaking 定级长期挂在「这个符号在
 * 不在包根导出面」这句断言上（ADR-0010:5/31、ADR-0019:10、ADR-0022 皆以它定级），而这句话
 * 在删除动作之前没有任何闸可跑，全靠人 grep 记忆。`PassesGateResult`（评审 A2）与
 * `DynamicTask`（二次复审 B1）已在同一处错两次；B1 那次是复审方直接断言「不在包根」，而
 * 实测 v1.6.0 源 `src/index.ts:106` 与已发布 npm 产物 `dist/index.d.ts:38` 都在导出它。
 * 本闸让「在不在公开面上」变成跑一下就有答案的事实。
 *
 * **公开面 = `package.json` 的 exports 映射，不是只有包根。** 本包发布五个入口点
 * （`.` / `./core` / `./presets` / `./context` / `./gates`），`import type { X } from
 * '@dommaker/harness/core'` 与从包根导入同样是对外承诺。入口清单从 exports **派生**而非
 * 硬编码：新增子路径会立刻落进本闸（未登记冻结清单即红），免得重演「公开面的定义比现实窄」
 * 这个 B1 病因——`DynamicTask` 除包根外同时经 `./core` 可达，只冻包根会留同一个洞。
 *
 * 与 `public-exports.test.ts` 的分工：那边钉的是**删完之后**（已删类型 `@ts-expect-error`
 * 负钉 + 活类型正钉 + 四级 barrel 链残留扫描），且它 `import('../index')`。本闸只做源码文本
 * 分析、**刻意不 import 任何入口**——这是它单独立一个文件的原因：类型面一旦被改动，那边的
 * 编译期钉会让整套 suite「failed to run」（实测注入一条 `export type { DynamicTask }` 得
 * 0 tests），拿不到可执行的清单 diff；本闸在那种改动下必须仍然跑得动、报得出是哪个入口的
 * 哪个符号。
 *
 * 清单来源不是手抄：五个入口的 `src` 解析结果与 tsc 产物（各自 exports 的 types 指向，如
 * `dist/core/index.d.ts`）逐项对撞，152/32/1/12/18 全部逐字一致，产物侧同时零 `export *`。
 * 改动入口清单文件时同步改本文件对应条目，diff 即 PR 评审材料；增删符号属公共面 breaking，
 * 须按 ADR-0003/0022 走发布级别裁决。
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');

/**
 * 入口点合法的导出写法只有三种：
 * ① `export { 值 } from '...'`；② `export type { 类型 } from '...'`；③ 内联值声明
 * `export function|const|let|var`（如 `src/gates/index.ts` 的 5 个 `create*Gate`）——纯值面，
 * 不属类型清单管辖。
 * 清单归类按**说明符自身**而非块形式：`export { getEffectiveGates, type GatesConfig }` 里的
 * `GatesConfig` 按 TS 语义就是类型导出，必须进类型清单（本闸的职责是如实刻画公开面，不是管写法）。
 * 其余行首 `export` 一律记为违禁而非跳过：`export *` / `export type *` 会让按名字扫描静默
 * 漏算；内联 `export interface|type|enum|class|declare` 更必须红——它绕过类型清单，而
 * `enum`/`class` 同时占值面与类型面，按单一分类必错一面。这正是 B1「公开面的定义比现实窄」
 * 那个病因的形态来源。
 */
interface EntrySurface {
  types: string[];
  illegal: string[];
}

const INLINE_VALUE_DECL_RE = /^export\s+(?:async\s+)?(?:function|const|let|var)\b/;

function parseEntrySurface(source: string): EntrySurface {
  const stmtRe = /^export (type )?\{([^}]*)\}[^;]*;/gm;
  const types: string[] = [];
  const illegal: string[] = [];
  const starts = new Set<number>();

  let match: RegExpExecArray | null = stmtRe.exec(source);
  while (match !== null) {
    starts.add(match.index);
    const isTypeBlock = Boolean(match[1]);
    for (const raw of match[2].split(',')) {
      const spec = raw.trim();
      if (!spec) continue;
      // `A as B` 对外名字是 B；`type A as B` 对外名字是 B 且属类型面
      const isTypeSpec = /^(type|typeof)\s/.test(spec);
      if (isTypeBlock || isTypeSpec) {
        types.push(spec.replace(/^(type|typeof)\s+/, '').split(/\s+as\s+/).pop()!.trim());
      }
    }
    match = stmtRe.exec(source);
  }

  let offset = 0;
  for (const line of source.split('\n')) {
    if (/^export\b/.test(line) && !starts.has(offset) && !INLINE_VALUE_DECL_RE.test(line)) {
      illegal.push(line.trim());
    }
    offset += line.length + 1;
  }

  return { types, illegal };
}

/** exports 子路径 → 承载它的显式清单源文件。形态对不上返回 null，由映射闸 fail-loud。 */
function sourceFileForSubpath(subpath: string): string | null {
  if (subpath === '.') return 'src/index.ts';
  const rest = subpath.replace(/^\.\//, '');
  return /^[a-z][a-z0-9-]*$/.test(rest) ? `src/${rest}/index.ts` : null;
}

const EXPORTS_MAP = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
).exports as Record<string, { types?: string }>;

const ENTRY_SUBPATHS: string[] = Object.keys(EXPORTS_MAP);

/** 每个已发布入口的类型面全量清单。增删任一项即公共面 breaking，见文件头。 */
const PUBLISHED_ENTRY_TYPES: Record<string, string[]> = {
  '.': [
    'AcceptanceCriteria',
    'AcceptanceGateContext',
    'AgentConfig',
    'AgentEvent',
    'AgentState',
    'AgentStatus',
    'ArtifactIntegrityResult',
    'AuditAction',
    'AuditIssue',
    'AuditOptions',
    'AuditReport',
    'AuditRuleName',
    'BatchSpecValidationResult',
    'CSOIssue',
    'CSOValidationResult',
    'CapabilitiesConfig',
    'ChangelogConfig',
    'ChangelogVersionCheck',
    'CheckCacheConfig',
    'CheckConfig',
    'CheckConstraintsOptions',
    'CheckResult',
    'CheckSamplingConfig',
    'CheckType',
    'CheckerVerdict',
    'Checkpoint',
    'CheckpointCheck',
    'CheckpointContext',
    'CheckpointResult',
    'ClassificationResult',
    'CodeStructure',
    'CommandBlacklistRule',
    'CommandGateConfig',
    'CommitFileClassification',
    'CommitInput',
    'CommitVerdict',
    'CompactionConfig',
    'CompactionLevel',
    'CompletionCheckersConfig',
    'ConstCountActual',
    'Constraint',
    'ConstraintCheckResult',
    'ConstraintContext',
    'ConstraintId',
    'ConstraintKind',
    'ConstraintLevel',
    'ConstraintResult',
    'ConstraintTrigger',
    'ConsumptionEvent',
    'ConsumptionMode',
    'ContextAverages',
    'ContextDocsCheck',
    'ContextFilesConfig',
    'ContextSource',
    'ContextSourceType',
    'ContextUsageSnapshot',
    'ContractGateConfig',
    'ContractPresenceContext',
    'ContractPresenceResult',
    'CustomConstraintDefinition',
    'DecayConfig',
    'DecisionRecord',
    'DeclarationInfo',
    'DirCountActual',
    'DocDirCheck',
    'DocFreshnessCheck',
    'DocFreshnessConfig',
    'DocRegexCountCheck',
    'DocsSyncConfig',
    'EffectiveConfigLint',
    'ErrorClassificationRule',
    'ErrorClassifierConfig',
    'EventHandler',
    'ExecutionResult',
    'ExecutionTrace',
    'FailureRecord',
    'FailureRecorderConfig',
    'FallbackStrategy',
    'Gate',
    'GateContext',
    'GateDecision',
    'GateDecisionStatus',
    'GateDefinition',
    'GateResult',
    'GateRunResult',
    'GatesConfig',
    'GovernanceConfig',
    'GrepCountActual',
    'HarnessBootstrap',
    'HookConfig',
    'HookDefinition',
    'HookErrorStrategy',
    'HookExecutionRecord',
    'HookPhase',
    'HookResult',
    'ImportInfo',
    'IndexEntry',
    'IngestOptions',
    'InjectionConfig',
    'InjectionResult',
    'IronLawContext',
    'KnowledgeEntry',
    'KnowledgeOrigin',
    'KnowledgeReference',
    'KnowledgeStore',
    'KnowledgeSubsystem',
    'LintIssue',
    'LintIssueType',
    'MaturityChange',
    'MaturityLevel',
    'MergedConstraintsConfig',
    'PassesGateCheckResult',
    'PassesGateConfig',
    'PassesGateViolation',
    'PerformanceGateConfig',
    'PerformanceThresholds',
    'PhaseFormatResult',
    'PipelineResult',
    'ProjectConfig',
    'QueryBudget',
    'QueryFilter',
    'QueryResult',
    'ReferenceRecord',
    'RenderConstraintsByTriggerOptions',
    'ReviewGateConfig',
    'SchemaLoader',
    'SecurityGateConfig',
    'SessionCheckpoint',
    'SessionEvent',
    'SessionEventType',
    'SessionHandle',
    'SessionMessage',
    'SourceRef',
    'SpecAcceptanceGateConfig',
    'SpecSchemaDefinition',
    'SpecType',
    'SpecValidationError',
    'SpecValidationResult',
    'SpecValidatorConfig',
    'StepMeta',
    'StorageLayer',
    'TaskTestResult',
    'TddChainResult',
    'TestResult',
    'TestingGovernanceConfig',
    'ToolMeta',
    'TraceAnalyzerConfig',
    'TraceAnomaly',
    'TraceCollectorConfig',
    'TraceFilter',
    'TraceSummary',
    'WorkflowMeta',
  ],
  './core': [
    'BatchSpecValidationResult',
    'CSOIssue',
    'CSOValidationResult',
    'CapabilitiesMode',
    'CheckCacheConfig',
    'CheckConfig',
    'CheckConstraintsOptions',
    'CheckResult',
    'CheckSamplingConfig',
    'CheckType',
    'Checkpoint',
    'CheckpointCheck',
    'CheckpointContext',
    'CheckpointResult',
    'Constraint',
    'ConstraintCheckResult',
    'ConstraintContext',
    'ConstraintId',
    'ConstraintKind',
    'ConstraintLevel',
    'ConstraintResult',
    'ConstraintTrigger',
    'ContextFilesResolution',
    'EffectiveConfigLint',
    'IronLawContext',
    'PassesGateConfig',
    'RenderConstraintsByTriggerOptions',
    'SpecSchemaDefinition',
    'SpecType',
    'SpecValidationResult',
    'SpecValidatorConfig',
    'TaskTestResult',
  ],
  './presets': [
    'PresetConfig',
  ],
  './context': [
    'CompactionConfig',
    'CompactionLevel',
    'ContextSource',
    'ContextSourceType',
    'ContextUsageSnapshot',
    'InjectionConfig',
    'InjectionResult',
    'SessionCheckpoint',
    'SessionEvent',
    'SessionEventType',
    'SessionHandle',
    'SessionMessage',
  ],
  './gates': [
    'AcceptanceCriteria',
    'AcceptanceGateContext',
    'CommandBlacklistRule',
    'CommandGateConfig',
    'ContractGateConfig',
    'Gate',
    'GateContext',
    'GateDecision',
    'GateDecisionStatus',
    'GateDefinition',
    'GateResult',
    'GateRunResult',
    'GatesConfig',
    'PerformanceGateConfig',
    'PerformanceThresholds',
    'ReviewGateConfig',
    'SecurityGateConfig',
    'SpecAcceptanceGateConfig',
  ],
};

describe('已发布类型面全量冻结（ADR-0022 追记 4）', () => {
  it('exports 的每个子路径都映射到存在的显式清单源文件（新增子路径不得绕过本闸）', () => {
    const unmapped = ENTRY_SUBPATHS.filter((sub) => {
      const rel = sourceFileForSubpath(sub);
      return rel === null || !fs.existsSync(path.join(REPO_ROOT, rel));
    });
    expect(unmapped).toEqual([]);
  });

  it('冻结清单覆盖全部已发布子路径（新增入口须先登记清单）', () => {
    expect(Object.keys(PUBLISHED_ENTRY_TYPES).sort()).toEqual([...ENTRY_SUBPATHS].sort());
  });

  for (const sub of ENTRY_SUBPATHS) {
    const rel = sourceFileForSubpath(sub);
    if (rel === null) continue; // 映射闸已负责红，此处不重复报
    const surface = parseEntrySurface(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));

    describe(`入口点 ${sub}（${rel}）`, () => {
      it('只用白名单写法导出，无被漏算的导出面', () => {
        expect(surface.illegal).toEqual([]);
      });

      it('类型清单与冻结集逐字一致（增删即 breaking，需发布级别裁决）', () => {
        // 解析塌掉不得退化成空集合假绿
        expect(surface.types.length).toBeGreaterThan(0);
        expect([...surface.types].sort()).toEqual([...PUBLISHED_ENTRY_TYPES[sub]].sort());
      });
    });
  }
});
