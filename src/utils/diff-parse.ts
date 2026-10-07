/**
 * unified diff 解析（正本）
 *
 * 三处手写解析合一（ADR-0040 Phase 3）：no-hardcoded-credentials 的新增行+新文件行号、
 * templated/regex-scan 的新增行、no-test-simplification 的增删行+旧文件名归属。
 * 差异以返回字段表达（kind / oldFile / newLineNo），不砍任何一方的判定能力。
 *
 * 行归属口径（三方并集）：
 * - `diff --git` 重置归属；`--- a/<path>` 记旧文件名；`+++ b/<path>` 记新文件名；
 * - `+++` 非 b/ 形态（整文件删除的 `+++ /dev/null`）归属回落旧文件名——
 *   删测试文件 = 对该文件的净删除（no-test-simplification 口径）；
 *   真实删除 diff 在 `+++ /dev/null` 之后只有 `-` 行，该回落不影响新增行采集；
 * - `@@ -n +m @@` 开启新文件行号计数（added/context 行递进，hunk 外 = 0）；
 * - `\` 行（No newline）忽略，不计数。
 */

/** 解析后的 diff 行 */
export interface ParsedDiffLine {
  /** added = `+` 行；deleted = `-` 行；context = 上下文行 */
  kind: 'added' | 'deleted' | 'context';
  /** 行文本（去掉首字符 +/-/空格） */
  text: string;
  /** 归属文件（新文件名；无文件归属 = ''） */
  file: string;
  /** 旧文件名（`--- a/<path>`；无 = ''） */
  oldFile: string;
  /** 新文件行号（added/context 行；hunk 未开启 = 0） */
  newLineNo: number;
}

/** 逐行解析 unified diff（文件头行不产出，只驱动归属状态） */
export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  const out: ParsedDiffLine[] = [];
  let file = '';
  let oldName = '';
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      file = '';
      oldName = '';
      newLine = 0;
      continue;
    }
    if (raw.startsWith('--- a/')) {
      oldName = raw.slice('--- a/'.length);
      continue;
    }
    if (raw.startsWith('---')) {
      oldName = '';
      continue;
    }
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length);
      continue;
    }
    if (raw.startsWith('+++')) {
      // 整文件删除（+++ /dev/null）：归属到被删文件
      file = oldName;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) {
      out.push({ kind: 'added', text: raw.slice(1), file, oldFile: oldName, newLineNo: newLine });
      if (newLine !== 0) newLine++;
      continue;
    }
    if (raw.startsWith('-')) {
      out.push({ kind: 'deleted', text: raw.slice(1), file, oldFile: oldName, newLineNo: 0 });
      continue;
    }
    out.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw, file, oldFile: oldName, newLineNo: newLine });
    if (newLine !== 0) newLine++;
  }
  return out;
}
