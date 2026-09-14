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
import { readJsonlWindow, type JsonlWindow, type JsonlReadResult } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../types/trace';
import type { CustomConstraintDefinition } from '../../types/project-config';

/** config.yml 在项目根下的相对路径（读取口径唯一落点） */
const CONFIG_FILE_REL = path.join('.harness', 'config.yml');

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
}

/**
 * 构造运行级观察面
 *
 * 懒建：没有消费方就不碰文件（`harness check` 在干净树与脏树上读的并不一样多）。
 */
export function createRunEnv(projectPath: string): RunEnv {
  const traceFile = path.join(projectPath, DEFAULT_TRACE_FILE);
  let window: JsonlWindow<ExecutionTrace> | null = null;
  let roots: string[] | null = null;
  let configLoaded = false;
  let configRaw: Record<string, unknown> | undefined;
  const customDefs = new Map<string, Record<string, CustomConstraintDefinition>>();

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
    sourceRoots() {
      if (!roots) {
        roots = detectSourceRoots(projectPath);
      }
      return roots;
    },
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
  };
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
