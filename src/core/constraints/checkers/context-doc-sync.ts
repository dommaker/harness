/**
 * context_doc_sync：关键目录必须有 CONTEXT.md（工单 21）
 *
 * ADR-0001 存在性探测 + context_files 三态统一口径（工单 84）：
 * 未配置 / enabled 但无目标（required_dirs 缺失或空）→ 一律 'skip'，
 * 不计 pass/fail，与 docs_freshness 同构；判定只走 resolveContextFiles
 * 访问器，不做 governance 手写钻取。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { resolveContextFiles } from '../../project-config-loader';
import { formatEvidence, type ConstraintCheck } from './types';

export const contextDocSync: ConstraintCheck = {
  id: 'context_doc_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
    const resolution = resolveContextFiles(env);
    if (resolution.state !== 'enabled') {
      // 未配置或约定已立但无目标，跳过评估（harness#182：原因进结果面）
      return {
        skip: true,
        reason:
          resolution.state === 'enabled-empty'
            ? 'context_files 约定已启用但 required_dirs 为空'
            : '项目未配置 governance.context_files 约定',
      };
    }

    // 证据随判定一并返回（ADR-0016 补迁）：此前只回裸 false，
    // 多个 required_dirs 里到底哪个没落 CONTEXT.md，CLI 与 trace 两头都看不出来
    const missing = resolution.dirs
      .map(dir => join(dir, 'CONTEXT.md'))
      .filter(rel => !existsSync(join(projectPath, rel)));
    if (missing.length > 0) {
      return { pass: false, evidence: formatEvidence('关键目录缺 CONTEXT.md', missing) };
    }

    return true;
  },
};
