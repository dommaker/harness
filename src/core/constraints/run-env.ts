/**
 * 运行级观察面（ADR-0023 决策 1）
 *
 * 一次 `harness check` 一份、跑完即弃：把「本项目有哪些源码根」「最近的 trace 记录」
 * 「`.harness/config.yml` 与自定义约束文件写了什么」这类上行数据的读取收在此处，
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
import * as yaml from 'js-yaml';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { reconcileCapabilities, type CapabilityVerdict } from './capabilities-reconcile';
import { readJsonlWindow, type JsonlWindow, type JsonlReadResult } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../types/trace';
import type { CustomConstraintDefinition } from '../../types/project-config';

/** config.yml 在项目根下的相对路径（读取口径唯一落点） */
const CONFIG_FILE_REL = path.join('.harness', 'config.yml');

/** 能力表在项目根下的落点（checker 侧存在性探测与本读面共用此常量） */
export const CAPABILITIES_FILE_REL = 'CAPABILITIES.md';

/**
 * 尾部窗口上限 = 本 run 内最大的尾部消费方（有无失败记录看 20 条，见 context-builder）
 *
 * 更小的窗口（验证证据看 10 条）从同一份行文本上截，不再二次读文件。
 */
const TRACE_TAIL_WINDOW = 20;

export interface RunEnv {
  /** 项目根（生产代码的每个 IO 点都用它，不再各自取 cwd——harness#95） */
  readonly projectPath: string;
  /** 最近 limit 条 trace 记录（≤ TRACE_TAIL_WINDOW；一次运行内至多读文件一次） */
  traceTail(limit: number): JsonlReadResult<ExecutionTrace>;
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
   * `.harness/<fileName>` 里的自定义约束定义（一次运行内同名文件至多读一次）
   *
   * 文件名由消费方（ProjectConfigLoader）从合并后的 config 解析后传入——
   * 「`custom_constraints_file` 怎么写才算数」属加载器口径，不在读面上判。
   * 文件缺失或无 `custom_constraints` 段 → `{}`（与改前的直读逐字一致）。
   */
  customConstraints(fileName: string): Record<string, CustomConstraintDefinition>;
  /**
   * `CAPABILITIES.md` 的读取 + 解析 + 与代码实况的对照判定（ADR-0023 决策 4）
   *
   * 此前 capability_sync 与 docs_freshness 各读一遍文档、各跑一遍 `reconcileCapabilities`
   * （studio 量得单次 7.6–15.9ms，两边解析输入逐字节相同）。此处一次供给两消费方。
   * 文档缺失 → `undefined`（消费方据此 skip / 无幽灵）。
   *
   * **memo 只记第一次传入的 `populationFiles`**：同一 run 内两消费方必须给同一份代码实况清单。
   * 二者一律经 `collectPopulationFiles(projectPath, roots, scan)` 取数，形状由构造保证；
   * 出现第三个消费方且清单不同，就必须改成按输入分列的缓存而不是静默复用。
   */
  capabilities(populationFiles: string[]): ProjectCapabilities | undefined;
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
  const traceFile = path.join(projectPath, DEFAULT_TRACE_FILE);
  let window: JsonlWindow<ExecutionTrace> | null = null;
  let sourceRoots: string[] | null = null;
  let configLoaded = false;
  let configRaw: Record<string, unknown> | undefined;
  const customDefs = new Map<string, Record<string, CustomConstraintDefinition>>();
  /** 能力表 memo：undefined = 未算，null = 项目无 CAPABILITIES.md */
  let caps: ProjectCapabilities | null | undefined;

  return {
    projectPath,
    traceTail(limit: number) {
      if (!window) {
        // 计数去向：豁免（harness#100）——本观察面只供给「最近有无 fail / 有无 pass」两个
        // 布尔证据的消费方，它们不读 skippedLines；坏行占尾部槽位只会让证据变少（方向保守），
        // 告知需要改判定形状，属行为变更不在本票（口径与改前的两处独立 tail 读逐字一致）
        window = readJsonlWindow<ExecutionTrace>(traceFile, 'skip', TRACE_TAIL_WINDOW);
      }
      return window.take(limit);
    },
    sourceRoots: roots,
    rawConfig() {
      if (!configLoaded) {
        configRaw = readYamlFile(path.join(projectPath, CONFIG_FILE_REL));
        configLoaded = true;
      }
      return configRaw;
    },
    customConstraints(fileName: string) {
      let defs = customDefs.get(fileName);
      if (!defs) {
        defs = readCustomConstraints(path.join(projectPath, '.harness', fileName));
        customDefs.set(fileName, defs);
      }
      return defs;
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
 * 读一个自定义约束文件并取出 `custom_constraints` 段
 *
 * 缺失 → `{}`。文档解析成空值（空 yaml 文件）时取段会抛——改前直读就是这个行为，
 * 不在此新增兜底：畸形配置文件该炸在配置上，不该被读面抹平。
 */
function readCustomConstraints(absPath: string): Record<string, CustomConstraintDefinition> {
  if (!fs.existsSync(absPath)) return {};
  const loaded = yaml.load(fs.readFileSync(absPath, 'utf-8')) as {
    custom_constraints?: Record<string, CustomConstraintDefinition>;
  };
  return loaded.custom_constraints ?? {};
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

export { TRACE_TAIL_WINDOW };
