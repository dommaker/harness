/**
 * capability_sync：CAPABILITIES.md 与代码同步检查（工单 21）
 *
 * 两步验证，归因不同（harness#119）：
 *   1. Git diff 增量 — 本次变更的非测试文件是否在文档中有记录 → **判违规**（有因果）
 *   2. 全量扫描（T-058）— 源码根下所有源文件是否都在 CAPABILITIES.md 中 → **只出提示**
 *
 * Step 2 不判违规的理由：它是仓库级完备性不变量，与正在被评估的那次变更无因果——
 * 一处历史漏登会让此后每次 module_* 评估恒红（studio 实测 22/22 fail，且因 fail
 * 零证据而无人能定位）。本处保留缺口输出是为了让人看得见、能自己修，而不是为了拦。
 *
 * 已知缺口（ADR-0016「影响」①）：降级后仓库级漏登**没有自动拦截点**。`sync-docs --check`
 * 单独跑会点名并 exit 1，但 CI/ship 都按「先 sync-docs 写入、后 --check」的顺序跑
 * （2026-08-08 CI 4 连红固化的顺序），而 file 模式的写入正给缺登记自动补行
 * （`capabilities-syncer` 的 `mode !== 'module'` 分支）、那份写入又不回提——于是流水线里
 * 永远查不到漏登。补这个牙齿归流水线侧（sync 后 git diff 非空即失败），不在本约束里做。
 *
 * 例外：「有表格但零条目」= 文档被清空，判违规（历史门，此前靠 Step 2 兜，现显式化）。
 *
 * 覆盖/漏登判定不在本文件实现：全量对照（解析文档 + 代码实况 + 覆盖/幽灵）由
 * capabilities-reconcile 一次算好并与 docs_freshness 共用（ADR-0009 + ADR-0023 决策 4），
 * 本文件只按导出的唯一覆盖规则 `isCoveredByEntries` 算「本次变更」那一维（增量清单属 git 证据）。
 * 目录条目（以 / 结尾）前缀匹配，文件条目精确匹配或路径边界后缀匹配；
 * module 模式下目录条目参与覆盖，未覆盖文件按源码根下第一级子目录聚合。
 *
 * 清单格式（计数行，mode=listing 或嗅探命中）无文件表可核对，直接放行；
 * 无表格的散文文档保持历史放行；检查异常时 fail-open 但输出 console.warn 保留可观测性。
 *
 * ADR-0001 存在性探测：项目根无 CAPABILITIES.md（未采用该约定）时返回 'skip'，
 * 不计 pass/fail，避免在未采用约定的项目上全量误报。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { getCapabilitiesMode } from '../../project-config-loader';
import {
  collectPopulationFiles,
  isCoveredByEntries,
  significantCodeChanges,
} from '../capabilities-reconcile';
import { CAPABILITIES_FILE_REL } from '../run-env';
import { formatEvidence, type ConstraintCheck } from './types';

export const capabilitySync: ConstraintCheck = {
  id: 'capability_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
    // ADR-0001 存在性探测：项目未采用 CAPABILITIES.md 约定 → skip（不计 pass/fail）
    if (!existsSync(join(projectPath, CAPABILITIES_FILE_REL))) {
      return 'skip';
    }
    try {
      const capabilitiesMode = getCapabilitiesMode(env);
      // 文档原文 + 源码根 + 代码实况 + 对照判定 = run 内一份，与 docs_freshness 共用（ADR-0023 决策 4）
      const caps = env.capabilities(
        collectPopulationFiles(projectPath, env.sourceRoots(), (root) => env.srcScan(root))
      );
      if (!caps) return 'skip'; // 探测与取数之间文档消失：与上方同一语义
      const verdict = caps.verdict;

      // 清单格式（计数行）没有文件表可核对，计数由 sync-docs 维护，直接放行
      if (capabilitiesMode === 'listing' || verdict.listingFormat) {
        return true;
      }

      const diffNames = (await env.stagedDiffNames()).split('\n').filter(Boolean);
      // 增量覆盖判定留在本文件：变更清单属 git 证据（#87），不在上行数据面
      const uncoveredChanges = significantCodeChanges(diffNames).filter(
        (f) => !isCoveredByEntries(verdict.coverageEntries, f)
      );

      // 无表格的散文文档：历史放行语义
      if (!verdict.hasTable) return true;

      // 文档退化门：有表格却什么都没登记（限定「源码根下确有文件」——空仓 + 空表没有可登记
      // 对象，历史行为是放行，本票不顺手扩大 fail 面）
      if (verdict.coverageEntries.length === 0 && caps.populationFiles.length > 0) {
        return {
          pass: false,
          evidence: ['CAPABILITIES.md 有表格但零条目登记，运行 harness sync-docs 或直接补登记'],
        };
      }

      // ── Step 1: Git diff 增量检查（与本次变更有因果，每个变更文件都必须被覆盖）──
      if (uncoveredChanges.length > 0) {
        return {
          pass: false,
          evidence: formatEvidence(
            `本次变更有 ${uncoveredChanges.length} 个文件未登记进 CAPABILITIES.md`,
            uncoveredChanges
          ),
        };
      }

      // ── Step 2: 全量源码根扫描（T-058）——仓库级漂移，只提示不判违规，见文件头 ──
      const gaps = capabilitiesMode === 'module' ? verdict.uncoveredDirs : verdict.uncoveredFiles;
      if (gaps.length > 0) {
        const kind = capabilitiesMode === 'module' ? '未登记模块目录' : '未登记源文件';
        return {
          pass: true,
          evidence: formatEvidence(
            `CAPABILITIES.md ${kind} ${gaps.length} 项（仓库级漂移，与本次变更无关；修复: harness sync-docs）`,
            gaps
          ),
        };
      }

      return true;
    } catch (err) {
      // fail-open 语义保留，但异常放行也要落地可见：warn 只进本地 stderr，
      // 进不了 trace——静默吞错会让解析 bug 变成「永远通过」（harness#119 同族问题）
      const reason = err instanceof Error ? err.message : String(err);
      console.warn('[capability_sync] 检查执行异常，默认放行：', err);
      return {
        pass: true,
        evidence: [`检查异常，按 fail-open 放行: ${reason}（本次结果不代表文档已同步）`],
      };
    }
  },
};
