/**
 * Knowledge Index Generator
 *
 * 扫描知识库目录，生成 grep 友好的单文件索引。
 * 每行一条，包含 filename/id/type/title/maturity/tags/headings。
 *
 * 目标：Agent grep 索引替代 grep 全库，减少 ~96% 输出量。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const EXCLUDED_DIRS = ['.archive', 'archived', '.snapshots', 'resolutions'];
const INDEX_FILENAME = '_index.md';

interface IndexEntry {
  filename: string;
  id: string;
  type: string;
  title: string;
  maturity: string;
  tags: string[];
  headings: string[];
}

export class KnowledgeIndexGenerator {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 生成索引并写入 _index.md
   */
  regenerate(): string {
    const lines = this.generateIndexLines();
    const output = this.generate();
    fs.writeFileSync(path.join(this.baseDir, INDEX_FILENAME), output, 'utf-8');
    return output;
  }

  /**
   * 生成完整索引内容（含 header）
   */
  generate(): string {
    const lines = this.generateIndexLines();
    const byType: Record<string, number> = {};
    for (const line of lines) {
      const type = line.split('|')[2];
      byType[type] = (byType[type] || 0) + 1;
    }

    const header = [
      '# Knowledge Base Index',
      `# Auto-generated — run \`harness knowledge index\` to rebuild`,
      `# Total: ${lines.length} entries`,
      `# Types: ${Object.entries(byType).map(([t, n]) => `${t}:${n}`).join(' ')}`,
      `#`,
      `# Usage:`,
      `#   grep "<keyword>" ~/.studio/knowledge/_index.md`,
      `#   Then Read the matching file for full content.`,
      `#`,
      `# filename|id|type|title|maturity|tags|terms`,
    ].join('\n');

    return header + '\n' + lines.join('\n') + '\n';
  }

  /**
   * 扫描目录，返回索引数据行（无 header）
   */
  generateIndexLines(): string[] {
    const files = this.scanFiles(this.baseDir);
    const entries: IndexEntry[] = [];

    for (const filePath of files) {
      const entry = this.parseFile(filePath);
      if (entry) entries.push(entry);
    }

    // 按 type 分组排序：architecture > decision > guideline > pitfall > process > other
    const typeOrder: Record<string, number> = {
      architecture: 0, decision: 1, guideline: 2, pitfall: 3, process: 4, model: 5, pattern: 6, skill: 7,
    };
    entries.sort((a, b) => {
      const oa = typeOrder[a.type] ?? 9;
      const ob = typeOrder[b.type] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.filename.localeCompare(b.filename);
    });

    return entries.map(e => this.formatLine(e));
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private scanFiles(dir: string, relative: string = ''): string[] {
    const results: string[] = [];

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const item of items) {
      const name = item.name;
      const fullPath = path.join(dir, name);
      const relPath = relative ? path.join(relative, name) : name;

      if (item.isDirectory()) {
        if (EXCLUDED_DIRS.includes(name)) continue;
        if (name.startsWith('.')) continue;
        results.push(...this.scanFiles(fullPath, relPath));
      } else if (name.endsWith('.md') && name !== INDEX_FILENAME) {
        results.push(fullPath);
      }
    }

    return results;
  }

  private parseFile(filePath: string): IndexEntry | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const filename = path.relative(this.baseDir, filePath);

      // 跳过 ghost 文件（文件名为 .md）
      if (path.basename(filename) === '.md') return null;

      // 尝试解析 YAML frontmatter
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (fmMatch) {
        const meta = yaml.load(fmMatch[1]) as Record<string, unknown>;
        const body = fmMatch[2];
        const headings = this.extractHeadings(body);

        // 检测 skill schema（name/description 而非 id/type）
        const type = meta?.type
          ? String(meta.type)
          : meta?.name
            ? 'skill'
            : this.inferType(filename);

        return {
          filename,
          id: String(meta?.id ?? meta?.name ?? path.basename(filePath, '.md')),
          type,
          title: String(meta?.title ?? meta?.description ?? ''),
          maturity: String(meta?.maturity ?? 'unknown'),
          tags: Array.isArray(meta?.tags) ? (meta.tags as unknown[]).map(String) : [],
          headings,
        };
      }

      // 无 frontmatter — best effort
      const headings = this.extractHeadings(raw);
      const h1Match = raw.match(/^#\s+(.+)$/m);

      return {
        filename,
        id: path.basename(filePath, '.md'),
        type: this.inferType(filename),
        title: h1Match ? h1Match[1].trim() : '',
        maturity: 'unknown',
        tags: [],
        headings,
      };
    } catch {
      return null;
    }
  }

  /**
   * 从文件路径推断 type。优先级：目录名 > 特殊前缀 > 文件前缀 > 后缀模式
   */
  private inferType(filename: string): string {
    const base = path.basename(filename);
    const dir = path.dirname(filename);

    // 1. 目录推断
    if (dir === 'skills') return 'skill';
    if (dir === 'arch-patterns') return 'architecture';

    // 2. 特殊复合前缀（必须在通用前缀匹配前检查）
    if (/^(agent-network|superpowers)-/.test(base)) return 'architecture';
    if (/^AS-\d+/.test(base)) return 'spec';

    // 3. 文件名前缀（architecture-ARC-011.md → architecture）
    const prefixMatch = base.match(/^([a-z]+)-/);
    const knownPrefixes = ['architecture', 'decision', 'guideline', 'pitfall', 'process', 'pattern', 'model', 'skill', 'agent'];
    if (prefixMatch && knownPrefixes.includes(prefixMatch[1])) {
      return prefixMatch[1];
    }

    // 4. 后缀模式（*-pattern.md → pattern）
    if (/-pattern\.md$/.test(base)) return 'pattern';

    return 'unknown';
  }

  /**
   * 提取正文 H2 标题作为搜索词（最多 5 个）
   */
  private extractHeadings(body: string): string[] {
    const matches = body.match(/^##\s+(.+)$/gm);
    if (!matches) return [];

    return matches
      .slice(0, 5)
      .map(h => h.replace(/^##\s+/, '').replace(/[*_`#]/g, '').trim())
      .filter(h => h.length > 0 && h.length < 60);
  }

  private formatLine(entry: IndexEntry): string {
    const sanitize = (s: string) => s.replace(/[\n\r]/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    const tags = entry.tags.join(';');
    const terms = entry.headings.join(';');
    return [
      sanitize(entry.filename),
      sanitize(entry.id),
      sanitize(entry.type),
      sanitize(entry.title),
      sanitize(entry.maturity),
      sanitize(tags),
      sanitize(terms),
    ].join('|');
  }
}
