/**
 * 运行级观察面（ADR-0023 决策 1）
 *
 * 一次 `harness check` 一份、跑完即弃：把「本项目有哪些源码根」
 * 「`.harness/config.yml` 写了什么」这类上行数据的读取收在此处，
 * 同一次运行内每个文件至多读一次。
 *
 * 为什么不是一个对象而是两个：checker 拿到的 `CheckEnv` 里含 `context`，而 `context` 正是
 * context-builder **通过本对象读文件算出来的**——同一对象不能既是构造者的输入又是它的产物。
 * 故这里只放「不需要 context 就能造」的部分，`CheckEnv` 之后从它派生（见 checkers/types.ts）。
 *
 * 与 #87 的 git 证据同一形状：一次运行一份、经参数显式传下去，不做进程级单例——
 * 测试在同进程内反复改文件，常驻缓存会把「先改后读」读成老内容。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from '../../utils/yaml';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { findTsSourceFiles } from '../../utils/file-walk';
import { reconcileCapabilities, type CapabilityVerdict } from './capabilities-reconcile';
import { createProjectSnapshot, type ProjectSnapshot } from './project-snapshot';

/** config.yml 在项目根下的相对路径（读取口径唯一落点） */
const CONFIG_FILE_REL = path.join('.harness', 'config.yml');

/** 能力表在项目根下的落点（checker 侧存在性探测与本读面共用此常量） */
export const CAPABILITIES_FILE_REL = 'CAPABILITIES.md';

export interface RunEnv {
  /** 项目根（生产代码的每个 IO 点都用它，不再各自取 cwd——harness#95） */
  readonly projectPath: string;
  /** 源码根相对路径列表（一次运行内至多探测一次） */
  sourceRoots(): string[];
  /**
   * `.harness/config.yml` 的解析结果（一次运行内至多读一次）
   *
   * 口径与改前的 `loadRawProjectConfig` 逐字一致：文件缺失 → undefined；
   * 空文件 → `{}`；YAML 解析失败 → **抛出**（兜底与否属各消费方的判定，不在读面上替它决定）。
   */
  rawConfig(): Record<string, unknown> | undefined;
  /**
   * `CAPABILITIES.md` 的读取 + 解析 + 与代码实况的对照判定（ADR-0023 决策 4）
   *
   * 此前 capability_sync 与 docs_freshness 各读一遍文档、各跑一遍 `reconcileCapabilities`
   * （下游消费方量得单次 7.6–15.9ms，两边解析输入逐字节相同）。此处一次供给两消费方。
   * 文档缺失 → `undefined`（消费方据此 skip / 无幽灵）。
   *
   * **memo 只记第一次传入的 `populationFiles`**：同一 run 内两消费方必须给同一份代码实况清单。
   * 二者一律经 `collectPopulationFiles(projectPath, roots, scan)` 取数，形状由构造保证；
   * 出现第三个消费方且清单不同，就必须改成按输入分列的缓存而不是静默复用。
   */
  capabilities(populationFiles: string[]): ProjectCapabilities | undefined;
  /**
   * 源码根（相对路径）下的源文件清单（一次运行内同一根源码根至多扫描一次）
   *
   * 缓存挂在本观察面上（P1.1）：一次 run 一份、跑完即弃，跨 run 天然隔离——
   * 不再用 checker 实例上的 TTL 缓存 + 手工 invalidate 掩盖 run 边界。
   */
  srcScan(root: string): string[];
  /**
   * 运行级项目快照（P1.2）：文件清单 / 文件内容 / diff 解析的 run 内共享读取
   *
   * 懒建 + run 内 memo（createRunEnv 生产路径恒提供，多条约束靠它共享一次遍历）。
   * 与 srcScan 分工：srcScan 给「源码根下的 TS 源文件清单」（排除 dist/__tests__），
   * snapshot 给「项目级文件/目录清单 + 内容 + diff 解析」（精确排除 .git/node_modules，
   * 不排除 dist/coverage——构建产物是存在性约束的合法判定对象）。
   *
   * **optional 是兼容边界**：`CheckEnv` 经包根公开导出，外部旧式手写实现
   * 不含本成员也必须能编译——checker 一律经 `projectSnapshotFor()` 取快照
   * （提供 = 共享 env 的 memo；未提供 = 一次性 fallback，保持旧读取行为），
   * 不得把生产路径的快照切成每约束一份新缓存，也不要求外部实现方立刻补成员。
   */
  snapshot?(): ProjectSnapshot;
}

/**
 * 一次运行内的能力表面貌：原文 + 源码根 + 代码实况清单 + 对照判定
 *
 * `verdict.deadEntries` 按「文件系统中真实存在也算活」的严口径算（带存在性 oracle），
 * capability_sync 不读它、docs_freshness 只读它；`verdict.uncoveredChanges` 在此恒空
 * ——本观察面不收 git 变更清单（属证据面，#87），增量覆盖由 capability_sync 自己按
 * `coverageEntries` 算。直调 `reconcileCapabilities` 的消费方（如 sync-docs）仍可传 changedFiles。
 */
export interface ProjectCapabilities {
  readonly content: string;
  readonly sourceRoots: string[];
  readonly populationFiles: string[];
  readonly verdict: CapabilityVerdict;
}

/**
 * 构造运行级观察面
 *
 * 懒建：没有消费方就不碰文件（`harness check` 在干净树与脏树上读的并不一样多）。
 */
export function createRunEnv(projectPath: string): RunEnv {
  let sourceRoots: string[] | null = null;
  let configLoaded = false;
  let configRaw: Record<string, unknown> | undefined;
  /** 能力表 memo：undefined = 未算，null = 项目无 CAPABILITIES.md */
  let caps: ProjectCapabilities | null | undefined;
  /** 源码根扫描 memo：root → 相对路径清单（同 run 复用，跑完即弃） */
  const scans = new Map<string, string[]>();
  /** 项目快照 memo：undefined = 未建（懒建：无消费方不遍历） */
  let snap: ProjectSnapshot | undefined;

  return {
    projectPath,
    sourceRoots: roots,
    rawConfig() {
      if (!configLoaded) {
        configRaw = readYamlFile(path.join(projectPath, CONFIG_FILE_REL));
        configLoaded = true;
      }
      return configRaw;
    },
    capabilities(populationFiles: string[]) {
      if (caps === undefined) {
        const content = readCapabilitiesContent();
        caps = content === undefined
          ? null
          : {
              content,
              sourceRoots: roots(),
              populationFiles,
              verdict: reconcileCapabilities({
                content,
                populationFiles,
                sourceRoots: roots(),
                fileExists: rel => fs.existsSync(path.join(projectPath, rel)),
              }),
            };
      }
      return caps ?? undefined;
    },
    srcScan(root: string) {
      let cached = scans.get(root);
      if (!cached) {
        cached = findTsSourceFiles(path.join(projectPath, root), { skipIndex: true }).map((f) =>
          path.relative(projectPath, f)
        );
        scans.set(root, cached);
      }
      return cached;
    },
    snapshot() {
      if (!snap) {
        snap = createProjectSnapshot(projectPath);
      }
      return snap;
    },
  };

  /** 源根探测 memo（sourceRoots() 与能力表共用同一份） */
  function roots(): string[] {
    if (!sourceRoots) {
      sourceRoots = detectSourceRoots(projectPath);
    }
    return sourceRoots;
  }

  /** 读 CAPABILITIES.md 原文；缺失 → undefined（不算异常，未采用该约定的项目占多数） */
  function readCapabilitiesContent(): string | undefined {
    const file = path.join(projectPath, CAPABILITIES_FILE_REL);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
  }
}

/**
 * 读并解析一个 YAML 配置文件
 *
 * 缺失 → undefined、空文件 → `{}`，两者都不算异常；解析失败照抛（消费方各自兜底）。
 * 不判 mtime/size 指纹——ADR-0023 决策 2 撤销了那套进程级口径，新鲜度只由「一次运行一份」保证。
 */
function readYamlFile(absPath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(absPath)) return undefined;
  const loaded = yaml.load(fs.readFileSync(absPath, 'utf-8'));
  return (loaded ?? {}) as Record<string, unknown>;
}

/**
 * 运行级访问器的入参形状：观察面，或项目根路径
 *
 * 传路径 = 「只此一次」的便利形状：自造一枚用完即弃的观察面，读到的是当下的文件内容。
 * 想在本 run 内共享读取（`harness check` 的全部消费方）就把同一枚 RunEnv 传下去。
 */
export type RunTarget = RunEnv | string;

/** 归一 RunTarget（非 RunEnv 即按项目根自造一枚一次性观察面） */
export function resolveRunEnv(target?: RunTarget): RunEnv {
  if (typeof target === 'object' && target !== null) return target;
  return createRunEnv(target || process.cwd());
}

/**
 * 经 RunEnv 取项目快照——内置 checker 的唯一直达口（P1.2）
 *
 * - env 提供 `snapshot()`（生产路径，createRunEnv 恒提供）：共享其 run 级 memo——
 *   多条约束一次遍历 / 同一文件读取 / 同一 diff 解析靠这个共享成立；
 * - 未提供（外部旧式手写实现，兼容边界）：构造一枚**一次性**快照，
 *   「每次调用读当下内容」，与 RunTarget 传路径形状同口径——
 *   不为兼容路径引入跨调用缓存（env 复用跨 run 的旧式实现不会被悄悄钉住）。
 *
 * checker 不得绕过本 helper 各自 `createProjectSnapshot`——那会把生产路径的
 * 共享快照切成每约束一份新缓存，「同一文件至多读一次」随之失效。
 */
export function projectSnapshotFor(run: RunEnv): ProjectSnapshot {
  return run.snapshot?.() ?? createProjectSnapshot(run.projectPath);
}
