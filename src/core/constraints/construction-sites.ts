/**
 * CONTEXT.md 构造点计数标记判定（harness#202 / ADR-0039）
 *
 * ADR-0025 的判定面只钉「核心导出」节符号面，散文机械不可判。本模块是
 * 判定面的**标记化扩展**：文档在散文陈述旁附机器可读标记
 * `<!-- sync-docs:construction-sites X = N -->`（可选 `include: tests`），
 * 声明「类 X 的仓内直构造点恰为 N 处」；无标记的散文维持现状不判。
 *
 * 纯判定 module：标记解析、`new X(` 计数口径、期望/实际对撞全在此，
 * 不吃 fs——文件遍历与正文读取在调用方（cli 侧 sync-docs/context-syncer），
 * 与 context-reconcile 同一套「判定不吃 fs、清单由调用方组装」形状。
 *
 * 计数口径：
 * - 只数 `new X(` 直构造（含一层泛型实参 `new Map<string, boolean>()`）；
 *   工厂封装调用点（`openKnowledgeStore()` 等）不算构造点。
 * - 排除范围由采集侧按 DEFAULT_SKIP_DIRS 执行（node_modules/__tests__/dist），
 *   标记带 `include: tests` 时测试目录计入。
 * - 已知限度：正则解析源文本，嵌套泛型实参与字符串/注释里的 `new X(`
 *   字面出现都会计入（登记在 ADR-0039，不掩盖）。
 */

/** 构造点标记：`<!-- sync-docs:construction-sites X = N -->`，可带 `include: tests` */
const MARKER_REGEX =
  /<!--\s*sync-docs:construction-sites\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)(\s+include\s*:\s*tests)?\s*-->/g;

/** 直构造：`new X(` / `new X<T>(`（泛型实参只认一层，不嵌套） */
const CONSTRUCTION_REGEX = /new\s+([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\s*\(/g;

export interface ConstructionSiteMarker {
  /** 被计数的类名 */
  className: string;
  /** 文档声明的期望构造点数 */
  expected: number;
  /** 是否把测试目录计入（标记带 `include: tests`） */
  includeTests: boolean;
}

export interface ConstructionSiteDrift {
  className: string;
  expected: number;
  /** 采集到的实际构造点数 */
  actual: number;
  includeTests: boolean;
}

/**
 * 解析文档中的构造点标记；无标记的散文与普通注释不判，
 * 畸形标记（缺数字/缺类名/未知选项）整条跳过（不判优于误判）。
 */
export function parseConstructionSiteMarkers(content: string): ConstructionSiteMarker[] {
  const markers: ConstructionSiteMarker[] = [];
  for (const match of content.matchAll(MARKER_REGEX)) {
    markers.push({
      className: match[1],
      expected: Number(match[2]),
      includeTests: Boolean(match[3]),
    });
  }
  return markers;
}

/**
 * 单份源文本的直构造计数（口径正本）：类名 → 出现次数。
 * 采集侧逐文件调用后累加；测试与采集共用此函数，check/fix 口径必然一致。
 */
export function tallyConstructionSites(source: string): Map<string, number> {
  const tally = new Map<string, number>();
  for (const match of source.matchAll(CONSTRUCTION_REGEX)) {
    tally.set(match[1], (tally.get(match[1]) ?? 0) + 1);
  }
  return tally;
}

/**
 * 标记与采集计数的对撞判定：期望 ≠ 实际即漂移，点名类名/期望/实际。
 * countFor 由调用方组装（fs 采集在那侧），按标记的 includeTests 口径取数。
 */
export function reconcileConstructionSites(input: {
  markers: ConstructionSiteMarker[];
  countFor: (className: string, includeTests: boolean) => number;
}): { drift: ConstructionSiteDrift[] } {
  const drift: ConstructionSiteDrift[] = [];
  for (const marker of input.markers) {
    const actual = input.countFor(marker.className, marker.includeTests);
    if (actual !== marker.expected) {
      drift.push({
        className: marker.className,
        expected: marker.expected,
        actual,
        includeTests: marker.includeTests,
      });
    }
  }
  return { drift };
}
