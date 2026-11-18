/**
 * 运行级项目快照（P1.2）
 *
 * 一次 `harness check` 一份、跑完即弃（ADR-0023 同形：入口构造、沿调用链显式传递、
 * 不做进程级全局）。把 run 内反复发生的项目读取收拢到一枚惰性快照上：
 *
 * - **文件清单**：`files()` 一次遍历收齐项目内文件与目录（相对项目根、正斜杠口径），
 *   同 run 内多条约束（file-exists 等）共享，不再每约束各走一遍。
 * - **目录排除口径**：精确跳过 `.git`（仓库元数据，任何层级都不下钻）与
 *   `node_modules`（依赖）。**不设 skipHidden**——`.harness` 等受管隐藏目录是
 *   file-exists 的合法判定对象，必须可匹配。dist/coverage 等构建产物**不排除**：
 *   它们同样是约束的合法目标（如「禁止 dist 入库」），排除与否的分层语义是——
 *   源码清单（`RunEnv.srcScan` / findTsSourceFiles 的 DEFAULT_SKIP_DIRS）排除
 *   dist/__tests__，项目快照不排除；两边各司其职，不互相借用名单。
 * - **文件内容**：`content(rel)` 同 run 内同一文件至多读一次；缺失/不可读 → undefined
 *   （消费方按「跳过该文件」兜底，与旧 try/catch 口径一致）。
 * - **diff 解析**：`parseDiff(diff)` 同一份 diff 至多彩一次（staged diff 全文经
 *   GitEvidence memo 本就一份，解析此前每条解析约束各跑一遍）。
 *
 * 清单与内容都是「本 run 的一份视图」：run 中途落盘的文件不进本枚快照，
 * 跨 run 隔离由「一次 run 一枚」保证（同 RunEnv 其余观察口）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { walkFiles } from '../../utils/file-walk';
import { parseUnifiedDiff, type ParsedDiffLine } from '../../utils/diff-parse';

/** 项目快照遍历的排除名单：仓库元数据 + 依赖。dist/coverage 刻意不在内（见文件头） */
const SNAPSHOT_SKIP_DIRS = ['.git', 'node_modules'];

export interface ProjectSnapshot {
  /**
   * 项目内文件与目录的相对路径清单（正斜杠，含目录本身；只读，勿改返回的数组）
   *
   * 首次调用时遍历一次，之后本 run 内返回同一份缓存。
   */
  files(): string[];
  /**
   * 读文件内容（相对项目根）；缺失/不可读 → undefined
   *
   * 同 run 内同一文件至多读一次；结果含「读不出」结论本身（memo 不区分成败）。
   */
  content(rel: string): string | undefined;
  /**
   * 解析 unified diff；同一份 diff 文本至多彩一次（返回共享数组，只读勿改）
   */
  parseDiff(diff: string): ParsedDiffLine[];
}

/** 构造运行级项目快照（由 createRunEnv 懒建；也可单独用于一次性读取） */
export function createProjectSnapshot(projectPath: string): ProjectSnapshot {
  /** 文件清单 memo：undefined = 未遍历 */
  let listing: string[] | undefined;
  /** 文件内容 memo：rel → 内容（undefined = 读不出） */
  const contents = new Map<string, string | undefined>();
  /** diff 解析 memo：单份缓存——一个 run 只有一份 staged diff */
  let parsed: { source: string; lines: ParsedDiffLine[] } | null = null;

  return {
    files() {
      if (!listing) {
        listing = walkFiles(projectPath, {
          skipDirs: SNAPSHOT_SKIP_DIRS,
          includeDirs: true,
        }).map(p => path.relative(projectPath, p).split(path.sep).join('/'));
      }
      return listing;
    },
    content(rel) {
      if (!contents.has(rel)) {
        let text: string | undefined;
        try {
          text = fs.readFileSync(path.join(projectPath, rel), 'utf-8');
        } catch {
          text = undefined; // 已删除/二进制/权限 → 跳过该文件
        }
        contents.set(rel, text);
      }
      return contents.get(rel);
    },
    parseDiff(diff) {
      if (!parsed || parsed.source !== diff) {
        parsed = { source: diff, lines: parseUnifiedDiff(diff) };
      }
      return parsed.lines;
    },
  };
}
