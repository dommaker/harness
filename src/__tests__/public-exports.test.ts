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
  'CONSTRAINTS_END_MARKER',
  'CONSTRAINTS_START_MARKER',
  'CSOValidator',
  'CheckCache',
  'CheckpointValidator',
  'ColdStartImporter',
  'CommandGate',
  'ConstraintViolationError',
  'ContextTracker',
  'ContractGate',
  'DEFAULT_CLASSIFICATION_RULES',
  'DEFAULT_COMMAND_BLACKLIST',
  'DEFAULT_DECAY_CONFIG',
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
  'GATE_DEFINITIONS',
  'GUIDELINES',
  'HookPipeline',
  'HookRegistry',
  'IRON_LAWS',
  'KnowledgeAudit',
  'KnowledgeHealthScorer',
  'KnowledgeIngest',
  'KnowledgeInjector',
  'KnowledgeLifecycle',
  'KnowledgeLinter',
  'KnowledgeQuery',
  'PHASE_SUBJECT_RE',
  'PROMPTS',
  'PassesGate',
  'PerformanceGate',
  'ReferenceTracker',
  'ReviewGate',
  'SecurityGate',
  'SessionManager',
  'SpecAcceptanceGate',
  'SpecValidator',
  'TESTED_BY_RE',
  'TESTS_NONE_RE',
  'TokenBudget',
  'TokenEstimator',
  'TraceAnalyzer',
  'TraceCollector',
  'assertGateRegistryClosed',
  'assertHookRegistryClosed',
  'bootstrapHarness',
  'bootstrapHarnessSync',
  'checkBeforeExecution',
  'checkConstraint',
  'checkConstraints',
  'classifyCommitFiles',
  'classifyError',
  'configureTraceCollector',
  'createAnalyzer',
  'createCheckerGate',
  'createCommandGate',
  'createContractGate',
  'createErrorClassifier',
  'createFailureRecorder',
  'createPassesGate',
  'createPerformanceGate',
  'createReviewGate',
  'createSecurityGate',
  'createSpecAcceptanceGate',
  'decisionFromResult',
  'extractCodeStructure',
  'findConstraintsByTrigger',
  'getAllConstraints',
  'getCommandGate',
  'getCommandRiskLevel',
  'getConstraint',
  'getCriticalArtifacts',
  'getEffectiveConstraints',
  'getEffectiveGates',
  'getFailureLevel',
  'getGate',
  'getRegistryPath',
  'getToolsDir',
  'getTraceCollector',
  'isCommandAllowed',
  'lintEffectiveConfig',
  'listRegisteredGates',
  'matchAnyGlob',
  'matchGlob',
  'migrateKnowledgeEntries',
  'registeredGateCount',
  'renderConstraintsByTrigger',
  'renderConstraintsSection',
  'resolveGlobs',
  'runGates',
  'sanitizeExternalContent',
  'toErrorStrategy',
  'validateAllSpecs',
  'validateSpec',
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
});
