/**
 * 日志滚动（正本，ADR-0040 Phase 3）
 *
 * 两种保留语义各有一枚，消费方按既有口径选用——合并不意味着拉平保留策略：
 * - `rotateTimestamped`：时间戳改名 + 重建空当前文件，备份数量不设上限
 *   （超龄清理由调用方另走按龄剪枝）——monitoring/traces 口径；
 * - `rotateNumbered`：`.1`–`.N` 顺移、越界即删，份数有界——failure/recorder 口径。
 * 何时滚动（大小阈值判定）留在各调用方。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 时间戳制滚动：当前文件改名为带时间戳的备份，并重建空当前文件 */
export function rotateTimestamped(file: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = file.replace('.log', `-${timestamp}.log`);

  fs.renameSync(file, backupFile);
  fs.writeFileSync(file, '', 'utf-8');
}

/** 编号制滚动：最旧历史越界删除，`.i` → `.i+1` 顺移，当前文件落 `.1` */
export function rotateNumbered(file: string, maxHistoryFiles: number): void {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);

  const oldestHistory = path.join(dir, `${base}.${maxHistoryFiles}${ext}`);
  if (fs.existsSync(oldestHistory)) {
    fs.unlinkSync(oldestHistory);
  }

  for (let i = maxHistoryFiles - 1; i >= 1; i--) {
    const oldFile = path.join(dir, `${base}.${i}${ext}`);
    const newFile = path.join(dir, `${base}.${i + 1}${ext}`);
    if (fs.existsSync(oldFile)) {
      fs.renameSync(oldFile, newFile);
    }
  }

  fs.renameSync(file, path.join(dir, `${base}.1${ext}`));
}
