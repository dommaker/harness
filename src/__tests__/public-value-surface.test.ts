/**
 * 已发布子路径值面全量冻结闸（ADR-0022 追记第 5 条收口）
 *
 * 补齐 `public-type-surface.test.ts` 的另一半：那道闸按 `package.json` 的 `exports` 逐入口冻
 * 结了**类型面**，但值面（运行时导出）只有包根一处被 `public-exports.test.ts` 钉住——
 * `Object.keys(await import('../index'))` 只看得到 `.` 一个入口。于是「这个函数不在公开面上、
 * 删它非 breaking」这类定级断言在子路径入口仍无闸可跑，只能靠人工逐条附「各入口源文件 +
 * 已发布产物 `.d.ts`」双证据（能防这一次，防不了下一次）。
 *
 * 落闸前实测的洞（五个入口的运行时键集合 106/29/4/4/24）：`./core` 有 7 个值导出、
 * `./presets` 有 4 个（即该入口全部）不在包根清单里——删掉它们当前**零测试变红**。
 * `./gates` 与 `./context` 的值导出恰好是包根的子集，删除会经 `src/index.ts` 的 barrel 链
 * 撞上包根那条闸，但红名报的是 `.`、不是真正被删的那个入口——定级时照样得再人肉查一遍。
 *
 * 口径与类型面闸一致：**公开面 = `exports` 映射，不是只有包根**，入口清单从 `exports` 派生
 * 而非硬编码，新增子路径未登记冻结清单即红。分工：
 * - `.` 的值面仍由 `public-exports.test.ts` 冻结（本闸刻意不重复钉——同一个入口两份清单
 *   必然漂移，且那条判定要逐字保留），本闸只管四个子路径；「两边都不漏」由登记闸与委派闸各钉一条。
 * - 类型面归 `public-type-surface.test.ts`，含导出写法白名单（堵 `export *` 与入口内联类型
 *   声明）。值面按运行时事实枚举，无按名字扫描漏算之虞，故本闸不重复那道写法检查。
 *
 * 本闸走运行时 `import`：值面的事实只有模块加载后才是真的（`Object.keys` 读到的正是 tsc
 * 产物出厂的那批键）。它与类型面改动互不影响——`public-exports.test.ts` 的编译期钉在类型面
 * 被改时会让那个套件「failed to run」（实测向 `src/index.ts` 注一条 `export type { DynamicTask }`
 * 得 TS2578），本闸在同一注入下 7 项照跑且全绿，值面的清单 diff 不会被类型面的编译期钉连带抹掉。
 *
 * 冻结清单不手抄：四子路径 + 包根的 `src` 侧 ts-jest 运行时键与各自 tsc 产物
 * （`dist/**\/index.js`）逐入口 `Object.keys` 对撞，106/29/4/4/24 全部逐字一致。改动入口清单
 * 文件时同步改本文件对应条目，diff 即 PR 评审材料；增删符号属公共面 breaking，须按
 * ADR-0003/0022 走发布级别裁决。
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');

/** 包根值面的既有归属，见文件头分工。 */
const PACKAGE_ROOT_SUBPATH = '.';

const EXPORTS_MAP = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
).exports as Record<string, unknown>;

const ENTRY_SUBPATHS: string[] = Object.keys(EXPORTS_MAP);

/** 每个已发布子路径入口的值面全量清单。增删任一项即公共面 breaking，见文件头。 */
const PUBLISHED_ENTRY_VALUES: Record<string, string[]> = {
  './core': [
    'CONSTRAINTS',
    'CSOValidator',
    'CheckCache',
    'CheckpointValidator',
    'ConstraintChecker',
    'ConstraintViolationError',
    'PassesGate',
    'ProjectConfigLoader',
    'SpecValidator',
    'checkBeforeExecution',
    'checkConstraint',
    'checkConstraints',
    'constraintChecker',
    'createPassesGate',
    'findConstraintsByTrigger',
    'getAllConstraints',
    'getCapabilitiesMode',
    'getConstraint',
    'getEffectiveConstraints',
    'getGovernanceConfig',
    'lintEffectiveConfig',
    'loadRawProjectConfig',
    'resolveContextFiles',
  ],
  './presets': [
    'PRESETS_BY_NAME',
    'RELAXED_PRESET',
    'STANDARD_PRESET',
    'STRICT_PRESET',
  ],
  './context': [
    'KnowledgeInjector',
    'SessionManager',
    'TokenBudget',
    'TokenEstimator',
  ],
  './gates': [
    'CommandGate',
    'ContractGate',
    'DEFAULT_COMMAND_BLACKLIST',
    'GATE_DEFINITIONS',
    'PerformanceGate',
    'ReviewGate',
    'SecurityGate',
    'SpecAcceptanceGate',
    'assertGateRegistryClosed',
    'createCheckerGate',
    'createCommandGate',
    'createContractGate',
    'createPerformanceGate',
    'createReviewGate',
    'createSecurityGate',
    'createSpecAcceptanceGate',
    'decisionFromResult',
    'getCommandGate',
    'getCommandRiskLevel',
    'getGate',
    'isCommandAllowed',
    'listRegisteredGates',
    'registeredGateCount',
    'runGates',
  ],
};

/** exports 子路径 → 承载它的显式清单源文件。形态对不上返回 null，由映射闸 fail-loud。 */
function sourceFileForSubpath(subpath: string): string | null {
  if (subpath === PACKAGE_ROOT_SUBPATH) return 'src/index.ts';
  const rest = subpath.replace(/^\.\//, '');
  return /^[a-z][a-z0-9-]*$/.test(rest) ? `src/${rest}/index.ts` : null;
}

/** 同上，但产 ts-jest 可解析的相对说明符（本包未自引用发布名，只能按源码路径 import）。 */
function moduleSpecifierForSubpath(subpath: string): string | null {
  const rel = sourceFileForSubpath(subpath);
  if (rel === null) return null;
  return `../${rel.replace(/^src\//, '').replace(/\.ts$/, '')}`;
}

async function runtimeKeysOf(subpath: string): Promise<string[]> {
  const specifier = moduleSpecifierForSubpath(subpath);
  expect(specifier).not.toBeNull();
  const mod: Record<string, unknown> = await import(specifier as string);
  return Object.keys(mod).sort();
}

describe('已发布子路径值面全量冻结（ADR-0022 追记 5）', () => {
  it('exports 的每个子路径都映射到存在的显式清单源文件（新增子路径不得绕过本闸）', () => {
    const unmapped = ENTRY_SUBPATHS.filter((sub) => {
      const rel = sourceFileForSubpath(sub);
      return rel === null || !fs.existsSync(path.join(REPO_ROOT, rel));
    });
    expect(unmapped).toEqual([]);
  });

  it('冻结清单覆盖除包根外的全部已发布子路径（新增入口须先登记清单）', () => {
    expect(Object.keys(PUBLISHED_ENTRY_VALUES).sort()).toEqual(
      ENTRY_SUBPATHS.filter((sub) => sub !== PACKAGE_ROOT_SUBPATH).sort(),
    );
  });

  it('包根值面确有既有归属（本闸委派 `.`，两边都不钉即公共面失控）', () => {
    const sibling = fs.readFileSync(path.join(__dirname, 'public-exports.test.ts'), 'utf-8');
    expect(sibling).toContain('Object.keys(mod)');
  });

  for (const sub of ENTRY_SUBPATHS) {
    if (sub === PACKAGE_ROOT_SUBPATH) continue; // 委派给 public-exports.test.ts，见文件头
    if (moduleSpecifierForSubpath(sub) === null) continue; // 映射闸已负责红，此处不重复报
    const frozen = PUBLISHED_ENTRY_VALUES[sub];
    if (frozen === undefined) continue; // 未登记入口由登记闸负责红，此处不重复报

    describe(`入口点 ${sub}`, () => {
      it('运行时导出键集合与冻结清单逐字一致（增删即 breaking，需发布级别裁决）', async () => {
        const actual = await runtimeKeysOf(sub);
        // 解析塌掉不得退化成空集合假绿；冻结清单自身不得有重复项（重复 + 缺失会互相抵掉 diff）
        expect(actual.length).toBeGreaterThan(0);
        expect(new Set(frozen).size).toBe(frozen.length);
        expect({
          entry: sub,
          missing: frozen.filter((key) => !actual.includes(key)),
          extra: actual.filter((key) => !frozen.includes(key)),
        }).toEqual({ entry: sub, missing: [], extra: [] });
        expect(actual.length).toBe(frozen.length);
      });
    });
  }
});
