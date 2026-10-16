/**
 * 单 JSON 文档读取正本（重构班次 3 Phase 3）
 *
 * 「损坏 ≠ 缺失」口径（ADR-0040）：文件不存在 → undefined（合法空）；
 * 存在但读失败 / JSON 损坏 → 原样抛出 fail-fast，不吞成 undefined
 * （吞掉会把损坏伪装成「没有数据」）。
 *
 * JSONL（多行追加格式）不归本模块，见 `utils/jsonl`。
 */

import * as fs from 'fs';

/**
 * 读取单 JSON 文档；不存在返回 undefined，存在但损坏/读失败抛出
 */
export function readJsonDocIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}
