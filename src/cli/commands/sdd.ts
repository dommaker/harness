// SDD CLI commands
import * as fs from 'fs';
import * as path from 'path';
import { SDDIndexGenerator } from '../../sdd/index-generator';

export interface SDDOptions {
  projectPath?: string;
  json?: boolean;
}

function getSDDDir(projectPath?: string): string {
  // Default: projectPath/docs or cwd/docs
  const base = projectPath || process.cwd();
  return base;
}

export function sddIndex(options: SDDOptions & { dir?: string }): void {
  const baseDir = options.dir || getSDDDir(options.projectPath);
  const gen = new SDDIndexGenerator(baseDir);

  const sddDir = path.join(baseDir, 'docs', 'sdd');
  const indexPath = path.join(sddDir, '_index.md');
  const beforeSize = fs.existsSync(indexPath) ? fs.statSync(indexPath).size : 0;

  const result = gen.regenerate();

  const afterSize = Buffer.byteLength(
    result.entries.map(e => `${e.slug}|${e.pmoNumber}|${e.status}|${e.title}|${e.tags}`).join('\n'),
    'utf-8',
  );

  if (options.json) {
    console.log(JSON.stringify({
      path: indexPath,
      entries: result.count,
      size: afterSize,
      previousSize: beforeSize,
    }));
  } else {
    console.log(`SDD Index regenerated: ${indexPath}`);
    console.log(`  Entries: ${result.count}`);
    console.log(`  Size: ${beforeSize} → ${afterSize} bytes`);
  }
}
