/**
 * Knowledge Store
 *
 * File-based storage for knowledge entries.
 * Each entry is a markdown file with YAML frontmatter.
 * An index.json provides fast listing without reading all files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { KnowledgeEntry, IndexEntry, QueryFilter, StorageLayer } from './types';

const DEFAULT_DIR = '.harness/knowledge';
const INDEX_FILE = 'index.json';

interface StoreConfig {
  baseDir: string;
}

const DEFAULT_CONFIG: StoreConfig = {
  baseDir: DEFAULT_DIR,
};

export class KnowledgeStore {
  private baseDir: string;

  constructor(config?: Partial<StoreConfig>) {
    this.baseDir = config?.baseDir || DEFAULT_CONFIG.baseDir;
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
    const index = this.readIndex();
    const effectiveFilter: QueryFilter = { excludeArchived: true, ...filter };
    let entries = index.filter(e => this.matchesFilter(e, effectiveFilter));

    return entries.map(idx => {
      const full = this.get(idx.id);
      return full || this.indexToEntry(idx);
    });
  }

  save(entry: KnowledgeEntry): void {
    const filePath = this.entryPath(entry);
    const frontmatter = this.toFrontmatter(entry);
    const content = `---\n${frontmatter}---\n\n${entry.content}`;
    fs.writeFileSync(filePath, content, 'utf-8');
    this.updateIndexEntry(entry);
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
   * 用于 Lint 检查索引一致性
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

  private entryPath(entry: KnowledgeEntry): string {
    const safeType = path.basename(entry.type);
    const safeId = path.basename(entry.id);
    return path.join(this.baseDir, `${safeType}-${safeId}.md`);
  }

  private findFile(id: string): string | undefined {
    // 1. Fast path: index has id→type mapping, construct exact filename
    const index = this.readIndex();
    const idx = index.find(e => e.id === id);
    if (idx) {
      const exact = path.join(this.baseDir, `${idx.type}-${idx.id}.md`);
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
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(this.baseDir, f));
  }

  private readFile(filePath: string): KnowledgeEntry | undefined {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return this.parseFile(raw, filePath);
    } catch {
      return undefined;
    }
  }

  private parseFile(raw: string, filePath: string): KnowledgeEntry | undefined {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!match) return undefined;

    const meta = yaml.load(match[1]) as Record<string, unknown>;
    const content = match[2];

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

  private toFrontmatter(entry: KnowledgeEntry): string {
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
    return yaml.dump(meta, { lineWidth: 120 });
  }

  private toIndexEntry(entry: KnowledgeEntry): IndexEntry {
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
    };
  }

  private indexToEntry(idx: IndexEntry): KnowledgeEntry {
    return {
      id: idx.id,
      type: idx.type,
      title: idx.title,
      content: '',
      maturity: idx.maturity,
      layer: idx.layer,
      created: idx.created,
      lastReferenced: idx.lastReferenced,
      contributors: [],
      projects: [],
      tags: idx.tags ?? [],
      applicablePhases: idx.applicablePhases ?? [],
      sourceReferences: [],
      referencedBy: [],
      executionResults: [],
      consumptionMode: idx.consumptionMode || 'reference',
      origin: idx.origin || 'agent',
    };
  }

  private matchesFilter(entry: IndexEntry, filter: QueryFilter): boolean {
    if (filter.types && filter.types.length > 0 && !filter.types.includes(entry.type)) return false;
    if (filter.maturity && filter.maturity.length > 0 && !filter.maturity.includes(entry.maturity)) return false;
    if (filter.layers && filter.layers.length > 0 && !filter.layers.includes(entry.layer)) return false;
    if (filter.tags && filter.tags.length > 0 && !filter.tags.some(t => (entry.tags ?? []).includes(t))) return false;
    if (filter.applicablePhases && filter.applicablePhases.length > 0 && !filter.applicablePhases.some(p => (entry.applicablePhases ?? []).includes(p))) return false;
    if (filter.excludeArchived !== false && (entry.maturity === 'archived' || entry.maturity === 'deprecated')) return false;
    if (filter.consumptionModes && filter.consumptionModes.length > 0 && !filter.consumptionModes.includes(entry.consumptionMode ?? 'reference')) return false;
    if (filter.origins && filter.origins.length > 0 && !filter.origins.includes(entry.origin ?? 'agent')) return false;
    return true;
  }

  // ── Snapshots ────────────────────────────────────────────

  private static readonly SNAPSHOTS_DIR = '.snapshots';

  /**
   * 保存当日 index.json 快照
   */
  snapshot(): string {
    const snapDir = path.join(this.baseDir, KnowledgeStore.SNAPSHOTS_DIR);
    if (!fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
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
    const snapPath = path.join(this.baseDir, KnowledgeStore.SNAPSHOTS_DIR, `index-${date}.json`);
    if (!fs.existsSync(snapPath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(snapPath, 'utf-8')) as IndexEntry[];
    } catch {
      return undefined;
    }
  }

  /**
   * 计算 N 天前快照中条目的存活率
   * 存活 = 当前 index 中存在且 maturity !== 'archived'
   */
  getSurvivalRate(daysAgo: number): { rate: number; survived: number; total: number; snapshotDate: string } | undefined {
    const target = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  // ── Index I/O ────────────────────────────────────────────

  private readIndex(): IndexEntry[] {
    const indexPath = path.join(this.baseDir, INDEX_FILE);
    if (!fs.existsSync(indexPath)) return [];
    try {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(raw) as IndexEntry[];
    } catch {
      return [];
    }
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
