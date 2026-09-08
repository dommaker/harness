/**
 * skip 读点的「计数去向」守护（harness#100）
 *
 * 契约原则（正本见 `src/monitoring/CONTEXT.md` 与 `src/cli/commands/CONTEXT.md`「约定」段）：
 * **凡以 `skip` 策略读 JSONL，坏行计数必须到达该消费面的用户可见输出，或在该调用点
 * 显式记名豁免并写明理由。** 静默吞掉「数据不全」不是一种可选项。
 *
 * 本文件把这句原则变成机器可检面，三道闸：
 * 1. 每个 `readJsonl` 调用点都判得出坏行策略——判不出（策略走变量、参数形状超出识别窗口）
 *    即形状逃逸，失败并交人裁决，不给静默漏判留口子
 * 2. skip 读点集合冻结（`EXPECTED_SKIP_READ_SITES`）：新增读点即失败；
 *    读点消失却不删条目也失败（豁免不烂成化石，与 #95 同一手法）
 * 3. 每个读点上方 6 行内必须有 `计数去向：` 声明（透传到哪儿 / 为何豁免），且声明与本读点
 *    之间不得夹着另一个读点——邻居的声明不顶替，缺失即失败
 *
 * `throw` 策略不产计数，故不要求去向声明；但新增 throw 调用点必须在下文那条断言里逐个点名
 * 裁决——否则「改成 throw 就免掉告知」成了原则的绕行通道。`src/utils/jsonl.ts` 本身是策略
 * 定义处，排除。
 * `readJsonlEnds`（首尾读取）同样是 skip 读点，纳入同一识别正则——否则它成为本契约的
 * 绕行通道（harness#114）。
 * `countJsonlLines` 的纯行数站点（如 `check` 的提示计数）不 parse、不产坏行计数，也不在本表内
 * ——它把损坏行算进条数的问题属口径变更，#100 明确不做。
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..');

/** 读点上方声明计数去向的标记（写在坏行策略注释里，与调用点同一处） */
const DISPOSITION_MARKER = /计数去向[:：]/;

/** 声明与读点的最大距离（行数）：只认紧贴读点的那段注释 */
const DECLARATION_LOOKBACK_LINES = 6;

/** 判定策略时从读点行向下拼几行（覆盖参数换行的调用形状） */
const POLICY_WINDOW_LINES = 6;

/**
 * 冻结的 skip 读点集合：文件（仓库相对路径）→ 读点数。
 * 每个读点的去向理由在调用点注释里，此表只钉「有哪些点、各几处」。
 */
const EXPECTED_SKIP_READ_SITES: Record<string, number> = {
  'src/cli/commands/status.ts': 1,
  'src/cli/session-mining/transcript.ts': 1,
  'src/context/session-manager.ts': 2,
  'src/core/constraints/context-builder.ts': 2,
  'src/core/constraints/usage-report.ts': 1,
  'src/failure/recorder.ts': 1,
  'src/knowledge/reference-tracker.ts': 1,
  'src/monitoring/context-tracker.ts': 1,
  'src/monitoring/traces.ts': 2,
};

function listTsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found.sort();
}

/** 仓库相对路径（跨机器稳定） */
function repoPath(abs: string): string {
  return path.relative(path.join(SRC_ROOT, '..'), abs).split(path.sep).join('/');
}

interface CallSite {
  /** 1-based 行号 */
  line: number;
  snippet: string;
  /** 策略判不出 = unknown（形状超出本守卫的识别能力，必须由人裁决而非静默漏判） */
  policy: 'skip' | 'throw' | 'unknown';
}

/**
 * 找出一个文件里所有 readJsonl 调用点并判出坏行策略。
 * 调用参数可能换行，故从 `readJsonl` 起拼若干行再判：先遇到 `'skip'` 记 skip、
 * 先遇到 `'throw'` 记 throw，两者都不出现记 unknown。
 */
function callSites(file: string): CallSite[] {
  const raw = fs.readFileSync(file, 'utf-8').split('\n');
  const sites: CallSite[] = [];

  for (let i = 0; i < raw.length; i++) {
    const trimmed = raw[i].trim();
    if (!/readJsonl(?:Ends)?\s*[<(]/.test(trimmed)) continue;
    // 注释行里的示例不是站点（策略定义处 src/utils/jsonl.ts 已整体排除）
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    const joined = raw.slice(i, i + POLICY_WINDOW_LINES).join(' ');
    const skipIdx = joined.indexOf("'skip'");
    const throwIdx = joined.indexOf("'throw'");
    const policy: CallSite['policy'] =
      skipIdx === -1 && throwIdx === -1
        ? 'unknown'
        : throwIdx !== -1 && (skipIdx === -1 || throwIdx < skipIdx)
          ? 'throw'
          : 'skip';

    sites.push({ line: i + 1, snippet: trimmed, policy });
  }
  return sites;
}

describe('skip 读点的计数去向契约（harness#100）', () => {
  const sourceFiles = listTsFiles(SRC_ROOT).filter(
    f => repoPath(f) !== 'src/utils/jsonl.ts'
  );
  const sitesByFile = new Map<string, CallSite[]>();
  for (const file of sourceFiles) {
    const sites = callSites(file);
    if (sites.length > 0) sitesByFile.set(repoPath(file), sites);
  }

  it('每个 readJsonl 调用点都判得出策略（判不出即形状逃逸，需人来补识别规则）', () => {
    const unknown = [...sitesByFile.entries()].flatMap(([rel, sites]) =>
      sites.filter(s => s.policy === 'unknown').map(s => `${rel}:${s.line}  ${s.snippet}`)
    );

    expect(unknown).toEqual([]);
  });

  it('skip 读点集合 = 冻结表（新增即失败；站点消失却不删条目也失败）', () => {
    const expected = Object.entries(EXPECTED_SKIP_READ_SITES)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const observed = [...sitesByFile.entries()]
      .map(([rel, sites]) => [rel, sites.filter(s => s.policy === 'skip').length] as [string, number])
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));

    expect(observed).toEqual(expected);
  });

  it('每个 skip 读点都记名声明计数去向（透传目标或豁免理由）', () => {
    const undeclared: string[] = [];

    for (const [rel, sites] of sitesByFile) {
      const raw = fs.readFileSync(path.join(SRC_ROOT, '..', rel), 'utf-8').split('\n');
      for (const site of sites.filter(s => s.policy === 'skip')) {
        const windowStart = Math.max(0, site.line - 1 - DECLARATION_LOOKBACK_LINES);
        // 邻居读点的声明不得顶替：声明之后到本读点之间不能再有其它 readJsonl 调用点
        const prevSiteLine = sites
          .filter(s => s.line < site.line)
          .map(s => s.line)
          .reduce((max, line) => Math.max(max, line), 0);
        const searchFrom = Math.max(windowStart, prevSiteLine);
        const above = raw.slice(searchFrom, site.line - 1).join('\n');

        if (!DISPOSITION_MARKER.test(above)) {
          undeclared.push(`${rel}:${site.line}  ${site.snippet}`);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('策略为 throw 的调用点不产计数，目前为零（出现即需逐个裁决）', () => {
    const throwSites = [...sitesByFile.entries()].flatMap(([rel, sites]) =>
      sites.filter(s => s.policy === 'throw').map(s => `${rel}:${s.line}`)
    );

    // 'throw' 是 #82 裁决 1 保留的显式选项，但全仓当前无调用点；
    // 新增时必须在此逐个点名裁决，不允许悄悄多出一条「不需要告知」的策略
    expect(throwSites).toEqual([]);
  });
});
