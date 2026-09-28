/**
 * no_completion_without_verification（harness#183 证据源重构）
 *
 * 旧证据源是语义循环：「验证证据」取自 traces.log 尾部 pass 记录，而 traces.log
 * 的唯一生产写入方是约束检查自身——「你验证过了吗」的回答是「你之前被检查过吗」。
 * 本 checker 把证据源换到独立链路：`.harness/evidence/` 目录
 * （PassesGate.runTests 真实跑项目声明的验证命令后落盘；消费方外部验证事件
 * 也写这里），判定与约束检查自身的 trace 彻底脱钩。
 *
 * 新鲜度口径：最新证据文件的 mtime ≥ 全部可读变更文件的最大 mtime
 * （验证跑在最新变更之后）。不用固定时间窗——与本次变更的因果关系才是口径。
 * 已知边界（保守方向，不修复）：git checkout 等刷新工作区 mtime 会误杀真证据
 * （误判过期 → fail，要求重跑验证）；证据只核存在性与时间，不读内容——防伪
 * 非本票口径（旧机制是自我指认，更弱）。
 *
 * 与 exec 口子（harness#181）的关系：本判定不依赖 exec 模板；业务仓若要自定义
 * 验证方式，用 exec checker 另行登记业务约束即可，与本铁律互不阻塞。
 *
 * 判定（显式三态，harness#182 语义）：
 * - 证据目录缺失/为空 → fail（从未验证）
 * - 证据旧于最新变更 → fail（证据过期，点名晚于证据的变更文件）
 * - 新鲜 → pass
 * - changedFiles 为 undefined（调用方未接线变更清单，如生产侧直调）→ 带原因的
 *   CheckSkip：新鲜度无所依不能放行（空数组 = 真无变更，不在此列，有证据即过）
 * - 证据位不可读（不是目录/全部 stat 失败）或全部变更文件 mtime 不可读
 *   → 带原因的 CheckSkip：证据源不可用 ≠ 对象合规，也不静默 skip
 *
 * flag 退役：此前经 ConstraintContext.hasVerificationEvidence 三态 flag 接线，
 * 只有 CLI 路径填充（生产调用点恒 skip）。判定收进 checker 体内后，凡走到
 * 编排层的调用方都按同一口径评估，flag 从 ConstraintContext 整体移除。
 */

import * as fs from 'fs';
import * as path from 'path';
import { EVIDENCE_DIR_REL } from '../../../types/passes-gate';
import type { ConstraintCheck } from './types';
import { formatEvidence } from './types';

/** 证据目录探测结果：最新证据 mtime / 无证据 / 不可读（三态） */
type EvidenceProbe = { mtime: number } | { missing: true } | { unreadable: string };

/** 探测证据目录的最新证据 mtime（只计文件；目录缺失/为空 → missing；不可读 → unreadable） */
function probeEvidence(evidenceDir: string): EvidenceProbe {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(evidenceDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true };
    return { unreadable: err instanceof Error ? err.message : String(err) };
  }
  const files = entries.filter(e => e.isFile());
  if (files.length === 0) return { missing: true };
  let newest = -Infinity;
  for (const entry of files) {
    try {
      const mtime = fs.statSync(path.join(evidenceDir, entry.name)).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch {
      // 单个证据文件 stat 失败不拖死判定：跳过该条，按其余证据判定
    }
  }
  if (newest === -Infinity) return { unreadable: '全部证据文件 stat 失败' };
  return { mtime: newest };
}

export const noCompletionWithoutVerification: ConstraintCheck = {
  id: 'no_completion_without_verification',
  evaluate(env) {
    const evidence = probeEvidence(path.join(env.projectPath, EVIDENCE_DIR_REL));

    if ('unreadable' in evidence) {
      return {
        skip: true,
        reason: `验证证据位 ${EVIDENCE_DIR_REL} 不可读（${evidence.unreadable}），本次未评估`,
      };
    }
    if ('missing' in evidence) {
      return {
        pass: false,
        evidence: formatEvidence('未运行验证：.harness/evidence 无测试输出记录', [
          '先真实运行项目声明的验证命令（harness passes-gate 或等价测试运行），证据落盘后重新提交',
        ]),
      };
    }

    // 变更清单未接线（undefined）≠ 真无变更（[]）：前者无法判定新鲜度，显式降级
    const changed = env.context.changedFiles;
    if (changed === undefined) {
      return {
        skip: true,
        reason: '变更清单未接线（context.changedFiles 缺失），无法判定证据新鲜度，本次未评估',
      };
    }

    // 新鲜度：变更文件 mtime 逐只取，不可读的跳过（删除文件是常态）；
    // 全部不可读才无法判定 → 显式降级
    let readable = 0;
    const laterThanEvidence: string[] = [];
    for (const file of changed) {
      try {
        const mtime = fs.statSync(path.join(env.projectPath, file)).mtimeMs;
        readable++;
        if (mtime > evidence.mtime) laterThanEvidence.push(file);
      } catch {
        // 变更文件不可读（如已删除）：不参与新鲜度判定
      }
    }
    if (changed.length > 0 && readable === 0) {
      return {
        skip: true,
        reason: '无法判定证据新鲜度（变更文件 mtime 均不可读），本次未评估',
      };
    }

    if (laterThanEvidence.length > 0) {
      return {
        pass: false,
        evidence: formatEvidence(
          '验证证据过期：最新证据早于本次变更，需重新运行项目声明的验证命令',
          laterThanEvidence.map(f => `晚于证据的变更: ${f}`)
        ),
      };
    }
    return true;
  },
};
