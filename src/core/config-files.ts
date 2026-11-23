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
