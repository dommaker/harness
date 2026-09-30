/**
 * init 的 CLAUDE.md Output Style 段写入（Phase 3 自 init.ts 拆出，纯移位）
 *
 * Output Style 段标记与正文正本在 `scaffold-templates.ts`
 * （ADR-0001：init 只写标记区间内，标记外只读）。
 * marker-range 替换收口在 `core/constraints/injection-writer`（ADR-0011）：
 * 本文件是「渲染 body + 调 writer」，半标记（单边/乱序）一律拒写告警。
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { replaceStandaloneRange } from '../../../core/constraints/injection-writer';
import { log, type CommandIO } from '../../command-contract';
import {
  OUTPUT_STYLE_START,
  OUTPUT_STYLE_END,
  renderOutputStyleSection,
} from '../scaffold-templates';

/** 旧版 harness 无标记 Output Style 段的特征串（用于区分 harness 写入 vs 用户自写） */
const LEGACY_OUTPUT_STYLE_FINGERPRINT = 'Terse like caveman';

/**
 * 在 CLAUDE.md 顶部写入 Output Style 段（标记化、幂等）
 *
 * - 已有 HARNESS_OUTPUT_STYLE 标记：替换标记间内容
 * - 无标记但存在旧版 harness 写入的无标记段（特征串匹配）：原位置换为标记版
 * - 无标记且 `## Output Style` 段为用户自写（特征串不匹配）：跳过并提示，不重复追加
 * - 完全没有该段：在文件顶部插入标记版
 */
export async function setupClaudeMdOutputStyle(projectPath: string, io: CommandIO): Promise<void> {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  // CLAUDE.md 不存在——无人持有该文件，跳过 Output Style 段
  if (!existsSync(claudeMdPath)) return;
  const content = await fs.readFile(claudeMdPath, 'utf-8');

  const section = renderOutputStyleSection();
  const write = replaceStandaloneRange(content, OUTPUT_STYLE_START, OUTPUT_STYLE_END, section);

  if (write.kind === 'updated') {
    // 尾部换行规范化在 writer 内（幂等）。
    if (write.content !== content) {
      await fs.writeFile(claudeMdPath, write.content, 'utf-8');
      log(io, chalk.green('✅ 已更新 CLAUDE.md Output Style 段'));
    }
    return;
  }
  if (write.kind === 'half') {
    log(io, chalk.yellow('⚠️  CLAUDE.md 中 HARNESS_OUTPUT_STYLE 标记残缺（单边或乱序），跳过 Output Style 注入，请人工修复'));
    return;
  }

  // 检测旧版无标记 `## Output Style` 段
  const legacyMatch = /^## Output Style[ \t]*$/m.exec(content);
  if (legacyMatch) {
    const sectionStart = legacyMatch.index;
    const afterHeading = sectionStart + legacyMatch[0].length;
    const nextHeadingOffset = content.slice(afterHeading).search(/^#{1,6} /m);
    const sectionEnd = nextHeadingOffset === -1 ? content.length : afterHeading + nextHeadingOffset;
    const legacySection = content.slice(sectionStart, sectionEnd);

    if (!legacySection.includes(LEGACY_OUTPUT_STYLE_FINGERPRINT)) {
      // 用户自写的同名 section：不动，也不追加（避免重复）
      log(io, chalk.yellow('⚠️  CLAUDE.md 已存在自定义 "## Output Style" 段，跳过 harness Output Style 注入'));
      return;
    }

    // 旧版 harness 写入：原位置换为标记版
    const before = content.slice(0, sectionStart);
    const after = content.slice(sectionEnd);
    const newContent = before + section + (after.length > 0 ? '\n' + after : '');
    await fs.writeFile(claudeMdPath, newContent, 'utf-8');
    log(io, chalk.green('✅ 已将 CLAUDE.md Output Style 段迁移为标记化管理'));
    return;
  }

  // 完全没有该段：插入文件顶部
  await fs.writeFile(claudeMdPath, section + '\n' + content, 'utf-8');
  log(io, chalk.green('✅ 已在 CLAUDE.md 顶部写入 Output Style 段'));
}
