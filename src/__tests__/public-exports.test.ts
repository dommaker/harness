/**
 * 公共导出防回归（ADR-0003）
 *
 * 包根导出收敛为显式清单后，任何增删公共符号都必须显式评审：
 * 改动 src/index.ts 导出清单时同步更新本文件的 EXPECTED_RUNTIME_EXPORTS，
 * diff 即 PR 评审材料。
 *
 * 类型面共三道闸，本文件占前两道：① 运行时（值）导出由 Object.keys 逐字冻结；② 下方「包根
 * 类型面」闸钉的是**删完之后**——编译期 `@ts-expect-error` 钉已删类型 + 源形状钉整条 barrel 链
 * （`PassesGateResult` 曾从 #125「关联类型导出随迁」漏删且无测试可捕获，review A2 据此补钉）。
 * 第 ③ 道是类型面**全量清单**冻结，在 `public-type-surface.test.ts`（ADR-0022 追记 4）；它刻意
 * 不 import 包根，因为本文件的编译期钉在类型面被改动时会让整套 suite「failed to run」（实测注入
 * 一条 `export type { DynamicTask }` 得 0 tests），拿不到可执行的清单 diff——定级阶段那句
 * 「这个符号在不在包根导出面」由第 ③ 道回答，不由人的 grep 记忆回答。
 */

import * as fs from 'fs';
import * as path from 'path';

const EXPECTED_RUNTIME_EXPORTS = [
  'AgentLifecycle',
  'CANDIDATE_KIND_LABEL',
  'CONSTRAINTS',
  'CSOValidator',
  'CheckpointValidator',
  'ColdStartImporter',
  'ConstraintViolationError',
  'DEFAULT_CLASSIFICATION_RULES',
  'DEFAULT_DECAY_CONFIG',
  'DEFAULT_DIAGNOSE_THRESHOLDS',
  'DEFAULT_FAILURE_LOG_FILE',
  'DEFAULT_LEVEL_MAPPING',
  'DEFAULT_NONCODE_GLOBS',
  'DEFAULT_TEST_GLOBS',
  'DEFAULT_TRACE_FILE',
  'ErrorClassifier',
  'ErrorType',
  'FailureLevel',
  'FailureRecorder',
  'FileKnowledgeStore',
  'HARNESS_CONFIG_FILES',
  'KnowledgeAudit',
  'KnowledgeHealthScorer',
  'KnowledgeIngest',
  'KnowledgeInjector',
  'KnowledgeLifecycle',
  'KnowledgeLinter',
  'KnowledgeQuery',
  'PHASE_SUBJECT_RE',  'PassesGate',
  'ReferenceTracker',
  'SessionManager',
  'TESTED_BY_RE',
  'TESTS_NONE_RE',
  'TraceAnalyzer',
  'TraceCollector',
  'bootstrapHarness',
  'bootstrapHarnessSync',
  'buildCheckEnv',
  'buildConstraintsUsageReport',
  'checkBeforeExecution',
  'checkConstraint',
  'checkConstraints',
  'classifyCommitFiles',
  'classifyError',
  'collectConstraints',
  'collectProposalMaterial',
  'collectUsageByConstraint',
  'contextEvidenceFlag',
  'contextFlag',
  'createErrorClassifier',
  'createFailureRecorder',
  'createPassesGate',
  'diagnoseRetireCandidates',
  'disableConstraint',
  'estimateTokens',
  'findConstraintsByTrigger',
  'formatEvidence',
  'getAllConstraints',
  'getConstraint',
  'getConstraintsMeta',
  'getCriticalArtifacts',
  'getEffectiveConstraints',
  'getFailureLevel',
  'listRetiredConstraints',
  'matchAnyGlob',
  'matchGlob',
  'normalizeCheckOutcome',
  'packProposal',
  'propagateConfig',
  'proposalMaterialPath',
  'pruneTraceLogs',
  'reactivateConstraint',
  'readProjectTraces',
  'readProjectTracesReport',
  'renderProposalMarkdown',
  'resolveGlobs',
  'retireConstraint',
  'sanitizeExternalContent',
  'verifyContractPresence',
  'verifyPhaseFormat',
  'verifyReleaseArtifacts',
  'verifyTddChain',
];

describe('公共导出清单（ADR-0003）', () => {
  it('包根运行时导出键集合与显式清单一致', async () => {
    const mod = await import('../index');
    expect(Object.keys(mod).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
  });
});

/**
 * 包根类型面闸（review A2）
 *
 * 上一闸的 `Object.keys(mod)` 只看得到运行时（值）导出，类型面历史上无对等闸——
 * `PassesGateResult`（已删 `setPasses` 的返回形状）正是这样从 #125 的「关联类型导出随迁」
 * 里漏掉、经四级 barrel 存活为公开类型。手法同 #125 的 AC-007：编译期 `@ts-expect-error`
 * 钉住删除 + 源形状钉住整条链，活类型正钉防删多。
 *
 * `DynamicTask` 是同案的第二个漏收项（二次复审 B1）：它是 `setPasses(taskId, workDir, task?)`
 * 的入参形状，#125 删掉 setPasses 后只剩私有 `runTest` 那个从不读取的 `_task` 形参在供养它，
 * 而包根同名导出取自 `./types/passes-gate`（见 5959b79），所以它是**公开的**死类型。
 */
describe('包根类型面（ADR-0022 关联类型随迁）', () => {
  const BARREL_CHAIN = [
    '../types/passes-gate.ts',
    '../core/validators/index.ts',
    '../core/index.ts',
    '../index.ts',
  ];

  function expectAbsentAcrossBarrelChain(typeName: string): void {
    for (const rel of BARREL_CHAIN) {
      const source = fs.readFileSync(path.join(__dirname, rel), 'utf-8');
      expect({ file: rel, mentions: source.includes(typeName) }).toEqual({
        file: rel,
        mentions: false,
      });
    }
  }

  it('PassesGateResult 在整条 barrel 链四级都已消失', () => {
    expectAbsentAcrossBarrelChain('PassesGateResult');
  });

  it('DynamicTask 在整条 barrel 链四级都已消失', () => {
    expectAbsentAcrossBarrelChain('DynamicTask');
  });

  it('PassesGateResult 不再是包根可导入类型（编译期钉）', () => {
    // @ts-expect-error 该类型是已删 setPasses 的返回形状，随 ADR-0022 关联类型口径删除
    const removedType: import('../index').PassesGateResult | undefined = undefined;
    expect(removedType).toBeUndefined();
  });

  it('DynamicTask 不再是包根可导入类型（编译期钉）', () => {
    // @ts-expect-error 该类型是已删 setPasses 的 task 入参形状，消费者净删后随 A2 同案收口
    const removedType: import('../index').DynamicTask | undefined = undefined;
    expect(removedType).toBeUndefined();
  });

  it('活类型仍可经包根导入（防止删多）', () => {
    const liveCheck: import('../index').PassesGateCheckResult = { allowed: true };
    const liveTask: import('../index').TaskTestResult = { passed: true, command: 'npm test' };
    expect(liveCheck.allowed).toBe(true);
    expect(liveTask.command).toBe('npm test');
  });

  /**
   * ADR-0027（#170）管线面删除的可达性负钉：4 值符号 + 8 类型。
   *
   * 两道全量清单闸钉的是「码与名单不符」，本钉直接钉「barrel 源里不再出现这些名字」——
   * 回灌时红名指到 barrel 本身，不必从清单 diff 反推。barrel 源形状即全可达面：
   * `export *` 已被 `sub-barrels-explicit.test.ts` 禁到 src 下全部目录 barrel，
   * 且 `./hooks` 不在 `package.json` 的 `exports` 内（无子路径入口可绕）。
   */
  const ADR0027_DELETED_SYMBOLS = [
    'HookRegistry',
    'HookPipeline',
    'assertHookRegistryClosed',
    'toErrorStrategy',
    'HookDefinition',
    'HookConfig',
    'EffectiveHook',
    'HookErrorStrategy',
    'HookExecutionRecord',
    'HookPhase',
    'HookResult',
    'PipelineResult',
  ];

  for (const rel of ['../hooks/index.ts', '../index.ts']) {
    it(`${rel} 不再提及 ADR-0027 已删的管线面符号（保留面 bootstrapHarness* 不受影响）`, () => {
      const source = fs.readFileSync(path.join(__dirname, rel), 'utf-8');
      expect(ADR0027_DELETED_SYMBOLS.filter((name) => source.includes(name))).toEqual([]);
    });
  }

  /**
   * #199（ADR-0038「CLI 可达 ≠ 导出理由」）公共面复评第三轮的可达性负钉。
   * A 桶 = 实现连删；B 桶 = 实现保留、仅收回公共导出（内部经实现文件直引）。
   * 机制同上：编译期 `@ts-expect-error` 钉包根类型面 + 源形状钉 barrel 不再提名。
   */
  const ISSUE199_A_DELETED_SYMBOLS = [
    'TokenBudget',
    'ContextTracker',
    'ContextAverages',
    'ContextUsageSnapshot',
    'extractCodeStructure',
    'CodeStructure',
    'DeclarationInfo',
    'ImportInfo',
    'runGates',
    'GateRunResult',
    'getCommandGate',
    'isCommandAllowed',
    'getCommandRiskLevel',
    'getTraceCollector',
    'configureTraceCollector',
    'createAnalyzer',
  ];

  const ISSUE199_B_RETRACTED_SYMBOLS = [
    'decisionFromResult',
    'GATE_DEFINITIONS',
    'getGate',
    'listRegisteredGates',
    'registeredGateCount',
    'assertGateRegistryClosed',
    'createCheckerGate',
    'ReviewGate',
    'SecurityGate',
    'PerformanceGate',
    'ContractGate',
    'SpecAcceptanceGate',
    'CommandGate',
    'createCommandGate',
    'DEFAULT_COMMAND_BLACKLIST',
    'createReviewGate',
    'createSecurityGate',
    'createPerformanceGate',
    'createContractGate',
    'createSpecAcceptanceGate',
    'GateResult',
    'GateContext',
    'GateDecision',
    'GateDecisionStatus',
    'GateDefinition',
    'PerformanceThresholds',
    'ReviewGateConfig',
    'SecurityGateConfig',
    'PerformanceGateConfig',
    'ContractGateConfig',
    'SpecAcceptanceGateConfig',
    'AcceptanceGateContext',
    'AcceptanceCriteria',
    'CommandBlacklistRule',
    'CommandGateConfig',
    'lintEffectiveConfig',
    'EffectiveConfigLint',
    'CheckCache',
    'CheckCacheConfig',
    'CheckSamplingConfig',
    'SpecValidator',
    'validateSpec',
    'validateAllSpecs',
    'SpecValidatorConfig',
    'SpecValidationResult',
    'BatchSpecValidationResult',
    'SpecSchemaDefinition',
    'SpecType',
    'SpecValidationError',
    'SchemaLoader',
    'migrateKnowledgeEntries',
  ];

  it('包根 barrel 不再提及 #199 A 桶（删除）与 B 桶（收回）符号', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf-8');
    const all = [...ISSUE199_A_DELETED_SYMBOLS, ...ISSUE199_B_RETRACTED_SYMBOLS];
    // 子串扫描的误报面逐个核过：留存符号（PassesGateCheckResult 等）不含上列任一名称
    expect(all.filter((name) => source.includes(name))).toEqual([]);
  });

  it('#199 A 桶删除的类型不再是包根可导入类型（编译期钉）', () => {
    // @ts-expect-error 随 ContextTracker 连删（#199 A2）
    const t1: import('../index').ContextAverages | undefined = undefined;
    // @ts-expect-error 随 ContextTracker 连删（#199 A2）
    const t2: import('../index').ContextUsageSnapshot | undefined = undefined;
    // @ts-expect-error 随 extractCodeStructure 连删（#199 A3）
    const t3: import('../index').CodeStructure | undefined = undefined;
    // @ts-expect-error 随 extractCodeStructure 连删（#199 A3）
    const t4: import('../index').DeclarationInfo | undefined = undefined;
    // @ts-expect-error 随 extractCodeStructure 连删（#199 A3）
    const t5: import('../index').ImportInfo | undefined = undefined;
    // @ts-expect-error 随 runGates 连删（#199 A4）
    const t6: import('../index').GateRunResult | undefined = undefined;
    expect([t1, t2, t3, t4, t5, t6]).toEqual(Array(6).fill(undefined));
  });

  it('#199 B 桶收回的类型不再是包根可导入类型（编译期钉；实现保留，CLI 直引）', () => {
    // @ts-expect-error gates 面收回（#199 B）
    const t1: import('../index').GateResult | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t2: import('../index').GateContext | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t3: import('../index').Gate | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t4: import('../index').GateDecision | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t5: import('../index').GateDecisionStatus | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t6: import('../index').GateDefinition | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t7: import('../index').PerformanceThresholds | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t8: import('../index').ReviewGateConfig | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t9: import('../index').SecurityGateConfig | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t10: import('../index').PerformanceGateConfig | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t11: import('../index').ContractGateConfig | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t12: import('../index').SpecAcceptanceGateConfig | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t13: import('../index').AcceptanceGateContext | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t14: import('../index').AcceptanceCriteria | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t15: import('../index').CommandBlacklistRule | undefined = undefined;
    // @ts-expect-error gates 面收回（#199 B）
    const t16: import('../index').CommandGateConfig | undefined = undefined;
    // @ts-expect-error 随 lintEffectiveConfig 收回（#199 B）
    const t17: import('../index').EffectiveConfigLint | undefined = undefined;
    // @ts-expect-error 随 CheckCache 收回（#199 B）
    const t18: import('../index').CheckCacheConfig | undefined = undefined;
    // @ts-expect-error 随 CheckCache 收回（#199 B）
    const t19: import('../index').CheckSamplingConfig | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t20: import('../index').SpecValidatorConfig | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t21: import('../index').SpecValidationResult | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t22: import('../index').BatchSpecValidationResult | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t23: import('../index').SpecSchemaDefinition | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t24: import('../index').SpecType | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t25: import('../index').SpecValidationError | undefined = undefined;
    // @ts-expect-error 随 SpecValidator 收回（#199 B）
    const t26: import('../index').SchemaLoader | undefined = undefined;
    expect([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13]).toEqual(Array(13).fill(undefined));
    expect([t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, t25, t26]).toEqual(Array(13).fill(undefined));
  });

  it('#199 保留面仍可经包根导入（防止删多：下游仓真实消费的三类 + spec 面相邻活类型）', () => {
    const liveCollector: import('../index').TraceCollectorConfig = {};
    const liveAnalyzer: import('../index').TraceAnalyzerConfig = { summaryFile: 'x', periodMs: 1 };
    const liveTrace: import('../index').ExecutionTrace = {
      constraintId: 'c',
      severity: 'error',
      timestamp: 0,
      result: 'pass',
    };
    expect(liveCollector).toEqual({});
    expect(liveAnalyzer.periodMs).toBe(1);
    expect(liveTrace.result).toBe('pass');
  });

  /**
   * #196（ADR-0037 workflow 引擎资产终局）删除符号的可达性负钉：
   * `src/tools/` 整目录连删，机制同 ADR-0027 钉（barrel 源形状钉）。
   */
  it('包根 barrel 不再提及 #196 已删的 tools 路径函数', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf-8');
    expect(['getRegistryPath', 'getToolsDir'].filter((name) => source.includes(name))).toEqual([]);
  });
});
