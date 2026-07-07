// SDD Index Generator
// Scans docs/sdd/*/requirement.md, generates docs/sdd/_index.md
// Format: slug|pmoNumber|status|title|tags

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const INDEX_FILENAME = '_index.md';

interface SDDIndexEntry {
  slug: string;
  pmoNumber: string;
  status: string;
  title: string;
  tags: string;
}

export interface SDDIndexResult {
  count: number;
  entries: SDDIndexEntry[];
}

export class SDDIndexGenerator {
  private sddDir: string;

  constructor(baseDir: string) {
    this.sddDir = path.join(baseDir, 'docs', 'sdd');
  }

  regenerate(): SDDIndexResult {
    if (!fs.existsSync(this.sddDir)) {
      throw new Error(`SDD directory not found: ${this.sddDir}`);
    }

    const entries = this.scanEntries();
    entries.sort((a, b) => a.slug.localeCompare(b.slug));

    const content = this.buildContent(entries);
    const indexPath = path.join(this.sddDir, INDEX_FILENAME);
    fs.writeFileSync(indexPath, content, 'utf-8');

    return { count: entries.length, entries };
  }

  private scanEntries(): SDDIndexEntry[] {
    const entries: SDDIndexEntry[] = [];
    const dirs = fs.readdirSync(this.sddDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      const reqPath = path.join(this.sddDir, dir, 'requirement.md');
      if (!fs.existsSync(reqPath)) continue;

      const content = fs.readFileSync(reqPath, 'utf-8');
      const fm = this.parseFrontmatter(content);
      if (!fm) continue;

      // Skip stale SDDs
      const status = String(fm.status || 'unknown');
      if (status === 'stale') continue;

      entries.push({
        slug: String(fm.slug || dir),
        pmoNumber: String(fm.pmoNumber || ''),
        status,
        title: this.sanitize(String(fm.title || dir)),
        tags: Array.isArray(fm.tags) ? fm.tags.join(',') : '',
      });
    }

    return entries;
  }

  private parseFrontmatter(content: string): Record<string, unknown> | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    try {
      return yaml.load(match[1]) as Record<string, unknown> || null;
    } catch {
      return null;
    }
  }

  private sanitize(s: string): string {
    return s.replace(/\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  }

  private buildContent(entries: SDDIndexEntry[]): string {
    const header = [
      '# SDD Index',
      '# Auto-generated — run `harness sdd index` to rebuild',
      `# Total: ${entries.length} entries`,
      '#',
      '# Usage:',
      '#   grep "<pmoNumber>" docs/sdd/_index.md',
      '#   Then Read the matching SDD directory for full content.',
      '#',
      '# slug|pmoNumber|status|title|tags',
    ].join('\n');

    const lines = entries.map(e =>
      `${e.slug}|${e.pmoNumber}|${e.status}|${e.title}|${e.tags}`
    );

    return header + '\n' + lines.join('\n') + '\n';
  }
}
