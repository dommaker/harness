/**
 * context_docs 检查（自 runner.ts 拆出，重构班次 3 Phase 4）
 *
 * 指定目录集合逐一存在 CONTEXT.md（缺省取 governance.context_files 的 requiredDirs）。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { ContextDocsCheck } from '../../../types/project-config';
import type { FreshnessCheckResult, RunContext } from './runner';

export function checkContextDocs(
  check: ContextDocsCheck,
  ctx: RunContext
): FreshnessCheckResult {
  const dirs = check.dirs || ctx.requiredDirs;
  if (!dirs || dirs.length === 0) {
    return { type: 'context_docs', label: 'CONTEXT.md', pass: true };
  }

  const docName = check.doc_name || 'CONTEXT.md';
  const missing: string[] = [];

  for (const dir of dirs) {
    const docPath = join(ctx.projectPath, dir, docName);
    if (!existsSync(docPath)) {
      missing.push(dir);
    }
  }

  const pass = missing.length === 0;
  return {
    type: 'context_docs',
    label: 'CONTEXT.md',
    pass,
    message: pass ? undefined : `缺少 ${docName}: ${missing.join(', ')}`,
    detail: { missing, doc_name: docName },
  };
}
