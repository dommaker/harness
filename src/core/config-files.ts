/**
 * harness 拥有的配置文件集合（harness#198）
 *
 * 「哪些文件算 harness 配置」这一知识在库内只有单一主人：`HARNESS_CONFIG_FILES`
 * （当前 = `.harness/config.yml` + `.harness/checkpoints.yml`）。
 *
 * `propagateConfig(srcRoot, dstRoot)` 把它从源目录铺到目标目录（覆盖写），消费方
 * （如下游的 worktree 装配器）不再手工 cp。刻意不做完整 init——
 * hooks/CI/CONTEXT.md 那套仍是 `harness init` 的职责。
 */

import * as fs from 'fs';
import * as path from 'path';

/** harness 拥有的配置文件（项目根相对路径，铺放/清点的唯一清单） */
export const HARNESS_CONFIG_FILES: readonly string[] = [
  path.join('.harness', 'config.yml'),
  path.join('.harness', 'checkpoints.yml'),
];

/**
 * 把 harness 配置文件集合从 srcRoot 铺到 dstRoot（覆盖已存在的同名文件）
 *
 * 源缺失的文件跳过不造；集合为空时目标零副作用（不创建 `.harness/`）。
 *
 * @returns 实际铺放的文件（项目根相对路径，顺序 = HARNESS_CONFIG_FILES 声明序）
 */
export function propagateConfig(srcRoot: string, dstRoot: string): string[] {
  const copied: string[] = [];
  for (const rel of HARNESS_CONFIG_FILES) {
    const from = path.join(srcRoot, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dstRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rel);
  }
  return copied;
}
