/**
 * Knowledge Migration Utilities
 *
 * Migrates existing knowledge entries to add new fields
 * introduced in AS-021 (consumptionMode, origin, fullContentPath, skillId).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

/**
 * Migrate all knowledge .md files in a directory to include
 * consumptionMode and origin fields if missing.
 *
 * Existing files without these fields get defaults:
 * - consumptionMode: 'reference'
 * - origin: 'agent'
 *
 * This is idempotent — running it multiple times is safe.
 */
export function migrateKnowledgeEntries(baseDir: string): MigrationResult {
  const result: MigrationResult = { total: 0, migrated: 0, skipped: 0, errors: [] };

  if (!fs.existsSync(baseDir)) {
    return result;
  }

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.md'));
  result.total = files.length;

  for (const file of files) {
    const filePath = path.join(baseDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
      if (!match) {
        result.errors.push(`${file}: no frontmatter found`);
        continue;
      }

      const meta = yaml.load(match[1]) as Record<string, unknown>;
      const content = match[2];

      // Check if migration needed
      if (meta.consumptionMode && meta.origin) {
        result.skipped++;
        continue;
      }

      // Add missing fields with defaults
      if (!meta.consumptionMode) meta.consumptionMode = 'reference';
      if (!meta.origin) meta.origin = 'agent';

      // Write back
      const newFrontmatter = yaml.dump(meta, { lineWidth: 120 });
      const newContent = `---\n${newFrontmatter}---\n\n${content}`;
      fs.writeFileSync(filePath, newContent, 'utf-8');
      result.migrated++;
    } catch (err) {
      result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
