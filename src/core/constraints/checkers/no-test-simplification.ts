/**
 * no_test_simplification：检查 staged diff 是否简化/删除了测试（工单 21，
 * harness#185 按规则意图重写启发式）
 *
 * 判定口径：
 * - 限定测试文件（路径含 `.test.`/`.spec.`/`__tests__/`），非测试文件不判——
 *   重命名变量、删除普通源码里形如 `test(` 的行不再误报
 * - 配对豁免：同一测试文件内同类行（测试用例/断言/注释测试）删增等量视为
 *   重命名或改写，净删除（删 > 增）才判违规
 * - 新增 `.skip(`/`.only(`/`xit(`/`xdescribe(` 直接判违规（无配对豁免）
 * - 无文件归属的裸行（截断/合成 diff）fail-closed 照判：真 git diff 恒有
 *   文件头，归属缺失时无法证明该行不在测试文件
 *
 * 输入契约（harness#182）：声明 needs.stagedDiff——git 取证失败（非 git 仓库 /
 * 超 maxBuffer）时编排层产出带原因的 skipped，不再对空 diff 假 pass
 * （「检查器失效 ≠ 对象合规」）。catch 兜底只服务绕过编排层的直接 evaluate。
 */

import { formatEvidence, type CheckDetail, type ConstraintCheck } from './types';

/** 测试文件判定：`.test.`/`.spec.` 后缀段或 `__tests__/` 目录段 */
function isTestFile(path: string): boolean {
  return /__tests__\//.test(path) || /\.(?:test|spec)\.[^/]+$/.test(path);
}

/** 跳过/独占形态（只查新增行，无配对豁免） */
const SKIP_ONLY_PATTERN = /(?:\.(?:skip|only)\s*\(|\bx(?:it|describe)\s*\()/;

/** 净删除配对类别：删 > 增 才判 */
const NET_DELETE_CATEGORIES = [
  { label: '测试用例', pattern: /\b(?:test|it|describe)\s*\(/ },
  { label: '断言', pattern: /\bexpect\s*\(/ },
  { label: '注释测试', pattern: /\/\/\s*test/ },
] as const;

interface FileTally {
  /** 新增行中命中的跳过/独占形态 */
  skipOnlyLines: string[];
  /** 各类别 [删除数, 新增数] */
  counts: { deleted: number; added: number }[];
}

/** 无归属行挂的兜底键（证据行措辞用） */
const UNATTRIBUTED = '(无文件归属的 diff 行)';

/**
 * 按文件归集 diff 增删行：`-`/`+` 行计入当前文件，文件头按 `--- a/`（删除
 * 文件时 `+++ /dev/null` 回落到它）与 `+++ b/` 归属；`\` 行（No newline）忽略。
 */
function tallyDiff(diff: string): Map<string, FileTally> {
  const tallies = new Map<string, FileTally>();
  let file = '';
  let oldName = '';

  const tally = (): FileTally => {
    const key = file || UNATTRIBUTED;
    let t = tallies.get(key);
    if (!t) {
      t = { skipOnlyLines: [], counts: NET_DELETE_CATEGORIES.map(() => ({ deleted: 0, added: 0 })) };
      tallies.set(key, t);
    }
    return t;
  };

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      file = '';
      oldName = '';
      continue;
    }
    if (raw.startsWith('--- a/')) {
      oldName = raw.slice('--- a/'.length);
      continue;
    }
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length);
      continue;
    }
    if (raw.startsWith('+++')) {
      // 整文件删除（+++ /dev/null）：归属到被删文件，删测试文件 = 净删除
      file = oldName;
      continue;
    }
    const added = raw.startsWith('+');
    const deleted = raw.startsWith('-');
    if (!added && !deleted) continue;
    const text = raw.slice(1);
    const t = tally();
    if (added && SKIP_ONLY_PATTERN.test(text)) t.skipOnlyLines.push(text.trim());
    NET_DELETE_CATEGORIES.forEach((cat, i) => {
      if (!cat.pattern.test(text)) return;
      if (deleted) t.counts[i].deleted++;
      else t.counts[i].added++;
    });
  }
  return tallies;
}

/** 汇总违规证据；空数组 = 通过 */
function violations(diff: string): string[] {
  const out: string[] = [];
  for (const [file, t] of tallyDiff(diff)) {
    if (file !== UNATTRIBUTED && !isTestFile(file)) continue;
    for (const line of t.skipOnlyLines) {
      out.push(`${file}: 新增跳过/独占测试 — ${line}`);
    }
    NET_DELETE_CATEGORIES.forEach((cat, i) => {
      const { deleted, added } = t.counts[i];
      if (deleted > added) {
        out.push(`${file}: 净删除${cat.label} ${deleted - added} 条（删 ${deleted} / 增 ${added}）`);
      }
    });
  }
  return out;
}

function failDetail(items: string[]): CheckDetail {
  return {
    pass: false,
    evidence: formatEvidence(
      '检测到测试简化（净删除测试/断言或新增跳过/独占形态）；若是重命名或改写请保持删增配对，测试困难应解决而非绕过',
      items
    ),
  };
}

export const noTestSimplification: ConstraintCheck = {
  id: 'no_test_simplification',
  needs: { evidence: ['stagedDiff'] },
  async evaluate(env) {
    try {
      const items = violations(await env.stagedDiff());
      return items.length > 0 ? failDetail(items) : true;
    } catch (err) {
      // 输入不可得 = 未评估（fail-open 但不假 pass）：原因进结果面与 trace，可统计
      const reason = err instanceof Error ? err.message : String(err);
      return { skip: true, reason: `staged diff 取证失败：${reason}` };
    }
  },
};
