/**
 * Knowledge Store
 *
 * File-based storage for knowledge entries.
 * Each entry is a markdown file with YAML frontmatter.
 * An index.json provides fast listing without reading all files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { splitFrontmatter, joinFrontmatter } from '../utils/frontmatter';
import { readJsonDocIfExists } from '../utils/json-doc';
import { isoDate } from '../utils/date';
import { isEntryFile, SNAPSHOTS_DIR } from './tree-walker';
import { estimateTokens } from './token-estimate';
import type {
  KnowledgeEntry,
  IndexEntry,
  QueryFilter,
  ConsumptionStats,
  SnapshotSurvival,
  StoreUpdate,
} from './types';
import { MATURITY_LEVELS, STORAGE_LAYERS } from './types';

const DEFAULT_DIR = '.harness/knowledge';
const INDEX_FILE = 'index.json';
const CONSUMPTION_STATS_FILE = '.consumption-stats.json';

/**
 * D7：运行时 index.json 的内部扩展条目——公共 IndexEntry 不变，tokenCount 仅经
 * store 的写路径（toIndexEntry）落盘、读路径窄化取用，属包内私有交叉类型。
 * tokenCount = estimateTokens(content) + estimateTokens(title)（两次 ceil 的现有口径，
 * 写入时算好，普通 query 截断就不必为被排除条目回读全文）。
 */
export type IndexEntryTokens = IndexEntry & { tokenCount?: number };

/** 从 index 条目窄化取 tokenCount：非数字（旧格式/手改坏值）一律 undefined → 调用方走兼容路径 */
export function indexEntryTokenCount(entry: IndexEntry): number | undefined {
  const tokenCount = (entry as IndexEntryTokens).tokenCount;
  return typeof tokenCount === 'number' && Number.isFinite(tokenCount) ? tokenCount : undefined;
}

/**
 * D7：index 元数据过滤的唯一实现（QueryFilter 全字段）。
 * store.list 与 KnowledgeQuery.query 共用，不各写一套过滤正本。
 */
export function filterIndexEntries(entries: IndexEntry[], filter: QueryFilter): IndexEntry[] {
  return entries.filter(entry => {
    if (filter.types && filter.types.length > 0 && !filter.types.includes(entry.type)) return false;
    if (filter.maturity && filter.maturity.length > 0 && !filter.maturity.includes(entry.maturity)) return false;
    if (filter.layers && filter.layers.length > 0 && !filter.layers.includes(entry.layer)) return false;
    if (filter.tags && filter.tags.length > 0 && !filter.tags.some(t => (entry.tags ?? []).includes(t))) return false;
    if (filter.applicablePhases && filter.applicablePhases.length > 0 && !filter.applicablePhases.some(p => (entry.applicablePhases ?? []).includes(p))) return false;
    if (filter.excludeArchived !== false && (entry.maturity === 'archived' || entry.maturity === 'deprecated')) return false;
    if (filter.consumptionModes && filter.consumptionModes.length > 0 && !filter.consumptionModes.includes(entry.consumptionMode ?? 'reference')) return false;
    if (filter.origins && filter.origins.length > 0 && !filter.origins.includes(entry.origin ?? 'agent')) return false;
    return true;
  });
}

/**
 * KnowledgeStore interface — abstract contract for knowledge storage.
 */
export interface KnowledgeStore {
  getBaseDir(): string;
  get(id: string): KnowledgeEntry | undefined;
  list(filter?: QueryFilter): KnowledgeEntry[];
  save(entry: KnowledgeEntry): void;
  /**
   * 批量保存（harness#107）：循环内只更新内存索引，结束一次 writeIndex，
   * 消除逐条 save 的 O(K·N) 全量索引重写。空批为零读写 no-op。
   */
  saveAll(entries: KnowledgeEntry[]): void;
  /**
   * 按 id 批量部分更新（harness#134）：`update(id, partial)` 的批量形，语义与逐条一致
   * （读不到该 id 即跳过），循环内只更新内存索引、结束一次 writeIndex。空批零读写。
   *
   * D7 可选第二参 `bases`：调用方已持有的 id → 完整条目预载基线（引用记账复用
   * query 已物化条目时经此消除层间重复 get）。缺省/缺项走原 `get(id)` 读盘；
   * 外部自定义 store 的一参实现编译与运行均兼容（多余实参被忽略）。
   */
  applyAll(updates: StoreUpdate[], bases?: ReadonlyMap<string, KnowledgeEntry>): void;
  delete(id: string): boolean;
  update(id: string, partial: Partial<KnowledgeEntry>): KnowledgeEntry | undefined;
  rebuildIndex(): void;
  readIndex(): IndexEntry[];
  readEntriesFromDisk(): KnowledgeEntry[];
  snapshot(): string;
  getSnapshot(date: string): IndexEntry[] | undefined;
  getSurvivalRate(daysAgo: number): SnapshotSurvival | undefined;
  /**
   * 读 `.consumption-stats.json` 的当日消费计数（harness#134：打分核心的 IO 归 store 供给）；
   * 文件缺失或损坏 = undefined（无数据，不是零消费）
   */
  getConsumptionStats(): ConsumptionStats | undefined;
  /**
   * D7 按需物化可选能力：把 index 元数据条目回读为完整条目。
   * 普通 query 先经 `readIndex()` + `filterIndexEntries` 过滤/排序/截断，
   * 只对本方法传入最终返回子集——被过滤/截断排除的条目全文零读取。
   * 「索引在册但条目文件缺失」的漂移错误在此实现（与 list 同一正本）。
   * 外部自定义 store 未实现时，KnowledgeQuery 走 list+applyBudget 兼容路径。
   */
  materializeByIndex?(indexEntries: IndexEntry[]): KnowledgeEntry[];
}

/**
 * FileKnowledgeStore — file-based implementation of KnowledgeStore.
 * Each entry is a markdown file with YAML frontmatter.
 * An index.json provides fast listing without reading all files.
 */
export class FileKnowledgeStore implements KnowledgeStore {
  private baseDir: string;
  /**
   * index.json 解析结果的实例级缓存（harness#106）
   *
   * mtimeMs+size 指纹（实例级，作用域限于本 store 的一次 list()）：
   * 文件未变则复用解析结果，消除一次调用内 N+1 次全量重读；
   * 文件变更（含外部进程改写、删除）自动失效。
   */
  private indexCache: { mtimeMs: number; size: number; entries: IndexEntry[] } | undefined;
  /** 旧格式 index（无 tokenCount）提示的实例级 once 闸（D7）：不重复刷屏 */
  private oldIndexHintShown = false;

  constructor(config?: { baseDir?: string }) {
    this.baseDir = config?.baseDir || DEFAULT_DIR;
    this.ensureDirectory();
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  // ── CRUD ─────────────────────────────────────────────────

  get(id: string): KnowledgeEntry | undefined {
    const filePath = this.findFile(id);
    if (!filePath) return undefined;
    return this.readFile(filePath);
  }

  list(filter?: QueryFilter): KnowledgeEntry[] {
    const effectiveFilter: QueryFilter = { excludeArchived: true, ...filter };
    return this.materializeByIndex(filterIndexEntries(this.readIndex(), effectiveFilter));
  }

  /**
   * D7 按需物化：把 index 子集回读为完整条目（普通 query 截断后只物化最终返回集）。
   * 「索引在册但条目文件缺失/不可解析」的漂移错误只在此实现一份，list() 与本方法共用；
   * get 继续走 D6 entryPath（findFile → entryPath），不另起路径构造。
   */
  materializeByIndex(indexEntries: IndexEntry[]): KnowledgeEntry[] {
    return indexEntries.map(idx => {
      const full = this.get(idx.id);
      if (!full) {
        // 索引在册但条目文件缺失/不可解析 = 索引漂移：抛出让它暴露，
        // 不捏造 content 为空的空心条目（修复手段 = rebuildIndex）
        throw new Error(
          `[harness] 知识条目 "${idx.id}" 索引在册但条目文件缺失或不可解析（索引漂移），` +
          `修复：harness knowledge index（rebuildIndex）`
        );
      }
      return full;
    });
  }

  save(entry: KnowledgeEntry): void {
    this.assertEnumFields(entry);
    this.writeEntryFile(entry);
    this.updateIndexEntry(entry);
  }

  /**
   * 写入闸（E1 复盘修正 M1）：maturity/layer 是声明枚举（值域正本在 types.ts），
   * 未声明值拒写报错，不静默降级。save/saveAll/applyAll 三条落盘路径共用；
   * update 经 save 继承同一闸。存量脏条目（绕过本 store 直写文件的）在被
   * 任一写入路径触及时抛错——先修脏值再写。
   */
  private assertEnumFields(entry: KnowledgeEntry): void {
    if (!MATURITY_LEVELS.includes(entry.maturity)) {
      throw new Error(
        `[harness] 知识条目 ${entry.id} 的 maturity 值 "${entry.maturity}" 未声明` +
        `（允许: ${MATURITY_LEVELS.join(' | ')}），拒写`
      );
    }
    if (!STORAGE_LAYERS.includes(entry.layer)) {
      throw new Error(
        `[harness] 知识条目 ${entry.id} 的 layer 值 "${entry.layer}" 未声明` +
        `（允许: ${STORAGE_LAYERS.join(' | ')}），拒写`
      );
    }
  }

  saveAll(entries: KnowledgeEntry[]): void {
    if (entries.length === 0) return;
    // 整批预校验（写入闸）：任一脏值全批拒写，不落半个批次
    for (const entry of entries) {
      this.assertEnumFields(entry);
      this.assertEntryPathSafe(entry);
    }
    const index = this.readIndex();
    const position = new Map(index.map((e, i) => [e.id, i]));
    for (const entry of entries) {
      this.writeEntryFile(entry);
      const indexEntry = this.toIndexEntry(entry);
      const idx = position.get(entry.id);
      if (idx !== undefined) {
        index[idx] = indexEntry;
      } else {
        position.set(entry.id, index.length);
        index.push(indexEntry);
      }
    }
    this.writeIndex(index);
  }

  applyAll(updates: StoreUpdate[], bases?: ReadonlyMap<string, KnowledgeEntry>): void {
    if (updates.length === 0) return;
    // 先合并再整批预校验（写入闸）：任一合并结果脏值全批拒写，不落半个批次。
    // 批内同 id 多条按序累积合并（后者基于前者的合并结果，与逐条 update 同语义）。
    const merged: KnowledgeEntry[] = [];
    const pending = new Map<string, number>(); // id → merged 下标
    for (const { id, partial } of updates) {
      const idx = pending.get(id);
      const base = idx !== undefined ? merged[idx] : bases?.get(id) ?? this.get(id);
      if (!base) continue;
      const next: KnowledgeEntry = { ...base, ...partial, id };
      if (idx !== undefined) {
        merged[idx] = next;
      } else {
        pending.set(id, merged.length);
        merged.push(next);
      }
    }
    if (merged.length === 0) return;
    for (const entry of merged) {
      this.assertEnumFields(entry);
      this.assertEntryPathSafe(entry);
    }
    const index = this.readIndex();
    const position = new Map(index.map((e, i) => [e.id, i]));
    for (const entry of merged) {
      this.writeEntryFile(entry);
      const indexEntry = this.toIndexEntry(entry);
      const idx = position.get(entry.id);
      if (idx !== undefined) {
        index[idx] = indexEntry;
      } else {
        position.set(entry.id, index.length);
        index.push(indexEntry);
      }
    }
    this.writeIndex(index);
  }

  delete(id: string): boolean {
    const filePath = this.findFile(id);
    if (!filePath) return false;
    fs.unlinkSync(filePath);
    this.removeFromIndex(id);
    return true;
  }

  update(id: string, partial: Partial<KnowledgeEntry>): KnowledgeEntry | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...partial, id };
    this.save(updated);
    return updated;
  }

  // ── Index ────────────────────────────────────────────────

  rebuildIndex(): void {
    const files = this.listFiles();
    const entries: IndexEntry[] = [];
    for (const file of files) {
      const entry = this.readFile(file);
      if (entry) {
        entries.push(this.toIndexEntry(entry));
      }
    }
    this.writeIndex(entries);
  }

  /**
   * 从磁盘读取所有条目（不依赖索引）
   * 用于摄入去重等「不能在索引漂移现场先崩」的盘驱动枚举
   */
  readEntriesFromDisk(): KnowledgeEntry[] {
    const files = this.listFiles();
    const entries: KnowledgeEntry[] = [];
    for (const file of files) {
      const entry = this.readFile(file);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  // ── Internal ─────────────────────────────────────────────

  private ensureDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private entryPath(entry: { id: string; type: string }): string {
    this.assertEntryPathSafe(entry);
    return path.join(this.baseDir, `${entry.type}-${entry.id}.md`);
  }

  /** 条目 id/type 的路径分量预校验（saveAll/applyAll 整批预校验用；落盘时 entryPath 仍会复检） */
  private assertEntryPathSafe(entry: { id: string; type: string }): void {
    this.assertSafePathComponent('id', entry.id, '知识条目');
    this.assertSafePathComponent('type', entry.type, '知识条目');
  }

  /**
   * 非法路径分量判定（D6 唯一实现）：id/type 只允许 baseDir 内的单文件名分量——
   * 非空、非 '.'/'..'、不含路径分隔符（含 Windows 反斜杠）与 NUL。
   * entryPath/findFile/save 批量预校验与 readIndex 在册校验共用此规则，不各写一套。
   * 命中即 fail-fast 抛错，不做 basename 静默修正
   * （旧行为会把 "../../x" 修正成 "x" 写到库内另一位置，读删路径对不上）。
   */
  private isUnsafePathComponent(value: unknown): boolean {
    const s = String(value);
    return s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0');
  }

  /** 路径分量闸（写入/查询入口）：命中非法分量按条目错误风格 fail-fast 抛错 */
  private assertSafePathComponent(field: 'id' | 'type', value: unknown, where: string): void {
    if (this.isUnsafePathComponent(value)) {
      throw new Error(
        `[harness] ${where} ${field} 值 ${JSON.stringify(String(value))} 非法：` +
        `不允许为空、'.'、'..' 或含路径分隔符与 NUL 字符，拒绝构造文件路径`
      );
    }
  }

  /** 条目文件正文的唯一落盘写法（save / saveAll / applyAll 三条路径共用，#134） */
  private writeEntryFile(entry: KnowledgeEntry): void {
    fs.writeFileSync(
      this.entryPath(entry),
      joinFrontmatter(this.toFrontmatter(entry), entry.content),
      'utf-8'
    );
  }

  private findFile(id: string): string | undefined {
    // 0. 入参闸：查询 id 先过路径分量闸，非法值 fail-fast，不落入扫描/构造
    this.assertSafePathComponent('id', id, '知识条目');
    // 1. Fast path: index has id→type mapping, construct exact filename
    const index = this.readIndex();
    const idx = index.find(e => e.id === id);
    if (idx) {
      const exact = this.entryPath(idx);
      if (fs.existsSync(exact)) return exact;
    }
    // 2. Fallback: scan files, verify id from frontmatter
    const files = this.listFiles();
    for (const f of files) {
      if (!path.basename(f).includes(`-${id}.md`)) continue;
      const entry = this.readFile(f);
      if (entry?.id === id) return f;
    }
    return undefined;
  }

  private listFiles(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs.readdirSync(this.baseDir)
      .filter(isEntryFile)
      .map(f => path.join(this.baseDir, f));
  }

  private readFile(filePath: string): KnowledgeEntry | undefined {
    // fail-fast：文件来自 listFiles 的目录扫描，读到一半失败（IO/权限）直接抛；
    // 内容形状问题（frontmatter 损坏/缺失）由 parseFile 显式上报后返回 undefined
    const raw = fs.readFileSync(filePath, 'utf-8');
    return this.parseFile(raw, filePath);
  }

  private parseFile(raw: string, filePath: string): KnowledgeEntry | undefined {
    const fm = splitFrontmatter(raw);
    if (fm.state === 'malformed') {
      // 统一口径（harness#89）：损坏的 frontmatter 必须显式上报，不再静默丢条目
      console.error(`[harness] 知识条目 frontmatter ${fm.reason}（${fm.detail}），已跳过 ${filePath}`);
      return undefined;
    }
    if (fm.state === 'absent') return undefined;

    const meta = fm.meta;
    const content = fm.body;

    return {
      id: meta.id as string || path.basename(filePath, '.md'),
      type: meta.type as KnowledgeEntry['type'],
      title: meta.title as string,
      content,
      maturity: meta.maturity as KnowledgeEntry['maturity'],
      layer: meta.layer as KnowledgeEntry['layer'],
      created: meta.created as string,
      lastReferenced: meta.lastReferenced as string || '',
      contributors: (meta.contributors as string[]) || [],
      projects: (meta.projects as string[]) || [],
      tags: (meta.tags as string[]) || [],
      applicablePhases: (meta.applicablePhases as string[]) || [],
      sourceReferences: (meta.sourceReferences as KnowledgeEntry['sourceReferences']) || [],
      referencedBy: (meta.referencedBy as string[]) || [],
      executionResults: (meta.executionResults as import('./types').ExecutionResult[]) || [],
      decayAt: meta.decayAt as string | undefined,
      consumptionMode: (meta.consumptionMode as KnowledgeEntry['consumptionMode']) || 'reference',
      origin: (meta.origin as KnowledgeEntry['origin']) || 'agent',
      fullContentPath: meta.fullContentPath as string | undefined,
      skillId: meta.skillId as string | undefined,
    };
  }

  /** canonical 字段序是 store 的私有策略（harness#89 裁决 3），包裹格式交给 joinFrontmatter */
  private toFrontmatter(entry: KnowledgeEntry): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      id: entry.id,
      type: entry.type,
      title: entry.title,
      maturity: entry.maturity,
      layer: entry.layer,
      created: entry.created,
      lastReferenced: entry.lastReferenced,
      contributors: entry.contributors,
      projects: entry.projects,
      tags: entry.tags,
      applicablePhases: entry.applicablePhases,
      sourceReferences: entry.sourceReferences,
      referencedBy: entry.referencedBy,
      consumptionMode: entry.consumptionMode,
      origin: entry.origin,
    };
    if (entry.executionResults?.length > 0) meta.executionResults = entry.executionResults;
    if (entry.decayAt) meta.decayAt = entry.decayAt;
    if (entry.fullContentPath) meta.fullContentPath = entry.fullContentPath;
    if (entry.skillId) meta.skillId = entry.skillId;
    return meta;
  }

  private toIndexEntry(entry: KnowledgeEntry): IndexEntryTokens {
    return {
      id: entry.id,
      type: entry.type,
      title: entry.title,
      maturity: entry.maturity,
      layer: entry.layer,
      tags: entry.tags,
      applicablePhases: entry.applicablePhases,
      lastReferenced: entry.lastReferenced,
      created: entry.created,
      consumptionMode: entry.consumptionMode,
      origin: entry.origin,
      // D7：写入时算好正文+标题 token（现有两次 ceil 口径），普通 query 截断零回读
      tokenCount: estimateTokens(entry.content) + estimateTokens(entry.title),
    };
  }

  // ── Snapshots ────────────────────────────────────────────

  /**
   * 保存当日 index.json 快照
   */
  snapshot(): string {
    const snapDir = path.join(this.baseDir, SNAPSHOTS_DIR);
    if (!fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
    }
    const today = isoDate(new Date());
    const snapPath = path.join(snapDir, `index-${today}.json`);
    const indexPath = path.join(this.baseDir, INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      fs.copyFileSync(indexPath, snapPath);
    }
    return snapPath;
  }

  /**
   * 读取指定日期的快照
   */
  getSnapshot(date: string): IndexEntry[] | undefined {
    const snapPath = path.join(this.baseDir, SNAPSHOTS_DIR, `index-${date}.json`);
    // fail-fast：快照在场但损坏直接抛——吞成 undefined 会把损坏伪装成「没有快照」
    return readJsonDocIfExists<IndexEntry[]>(snapPath);
  }

  /**
   * 计算 N 天前快照中条目的存活率
   * 存活 = 当前 index 中存在且 maturity !== 'archived'
   */
  getSurvivalRate(daysAgo: number): SnapshotSurvival | undefined {
    const target = isoDate(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
    const snapshot = this.getSnapshot(target);
    if (!snapshot || snapshot.length === 0) return undefined;

    const currentIndex = this.readIndex();
    const currentMap = new Map(currentIndex.map(e => [e.id, e]));

    let survived = 0;
    for (const snapEntry of snapshot) {
      const current = currentMap.get(snapEntry.id);
      if (current && current.maturity !== 'archived' && current.maturity !== 'deprecated') survived++;
    }

    return {
      rate: Math.round((survived / snapshot.length) * 100),
      survived,
      total: snapshot.length,
      snapshotDate: target,
    };
  }

  /**
   * 读 `.consumption-stats.json` 的当日消费计数（打分核心唯一的消费统计取数口，harness#134）
   */
  getConsumptionStats(): ConsumptionStats | undefined {
    const statsPath = path.join(this.baseDir, CONSUMPTION_STATS_FILE);
    // fail-fast：统计文件在场但损坏直接抛，不装成「无统计」
    const stats = readJsonDocIfExists<{ dailyEvents?: number }>(statsPath);
    if (stats === undefined) return undefined;
    return { dailyEvents: stats.dailyEvents ?? 0 };
  }

  // ── Index I/O ────────────────────────────────────────────

  readIndex(): IndexEntry[] {
    const indexPath = path.join(this.baseDir, INDEX_FILE);
    if (!fs.existsSync(indexPath)) {
      this.indexCache = undefined;
      return [];
    }
    const stat = fs.statSync(indexPath);
    const cached = this.indexCache;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.entries;
    }
    // fail-fast：index 在场但损坏直接抛——吞成 [] 会让 store 误以为库是空的
    const entries = readJsonDocIfExists<IndexEntry[]>(indexPath);
    if (entries === undefined) {
      // existsSync 与读取之间的竞态删除：按缺失处理（同首个 guard 口径）
      this.indexCache = undefined;
      return [];
    }
    // fail-fast（D6）：index 在册条目的 id/type 必须先过路径分量闸——
    // 非法值会在 get/list/delete 的 index 驱动路径上被拼进文件路径，越出 baseDir
    this.assertIndexEntriesValid(entries);
    // D7：旧格式 index（任一条目无数字 tokenCount）——普通 query 将回退全量读取。
    // 与 query 回退判定同一份检测；实例内只提示一次，新索引路径零输出。
    if (!this.oldIndexHintShown && entries.some(e => indexEntryTokenCount(e) === undefined)) {
      this.oldIndexHintShown = true;
      console.error(
        '[harness] 知识库索引 index.json 为旧格式（无 tokenCount 元数据），普通 query 将回退全量读取；' +
        '运行 harness knowledge index（rebuildIndex）可恢复按需物化'
      );
    }
    this.indexCache = { mtimeMs: stat.mtimeMs, size: stat.size, entries };
    return entries;
  }

  /**
   * index.json 条目校验（D6）：任何非法 id/type 明确抛错，定位条目序号/字段/值，
   * 提示手工修正 index.json 或核对条目文件后 rebuildIndex。校验通过才进缓存。
   * 判定规则复用 isUnsafePathComponent，与写入/查询同一套。
   */
  private assertIndexEntriesValid(entries: IndexEntry[]): void {
    entries.forEach((entry, i) => {
      for (const field of ['id', 'type'] as const) {
        if (this.isUnsafePathComponent(entry[field])) {
          throw new Error(
            `[harness] 知识库索引 index.json 第 ${i + 1} 条目的 ${field} 值 ${JSON.stringify(String(entry[field]))} 非法` +
            `（不允许为空、'.'、'..' 或含路径分隔符与 NUL 字符）；` +
            `修复：手工修正 index.json 该字段，或核对对应条目文件后运行 harness knowledge index（rebuildIndex）`
          );
        }
      }
    });
  }

  private writeIndex(entries: IndexEntry[]): void {
    const indexPath = path.join(this.baseDir, INDEX_FILE);
    fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private updateIndexEntry(entry: KnowledgeEntry): void {
    const index = this.readIndex();
    const idx = index.findIndex(e => e.id === entry.id);
    const indexEntry = this.toIndexEntry(entry);
    if (idx >= 0) {
      index[idx] = indexEntry;
    } else {
      index.push(indexEntry);
    }
    this.writeIndex(index);
  }

  private removeFromIndex(id: string): void {
    const index = this.readIndex().filter(e => e.id !== id);
    this.writeIndex(index);
  }
}
