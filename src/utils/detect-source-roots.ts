/**
 * detectSourceRoots — 自动检测工程源码根目录
 *
 * 统一所有源码目录发现逻辑:
 *   1. monorepo: packages/下各包的 src 或 lib 子目录
 *   2. monorepo: apps/下各应用的 src/modules 子目录
 *   3. 单 repo: src/ lib/ 目录
 *
 * 返回相对 projectPath 的路径数组。全都不存在时返回空数组。
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export function detectSourceRoots(projectPath: string): string[] {
  const roots: string[] = [];

  // 1. monorepo: packages/*
  const packagesDir = join(projectPath, 'packages');
  if (existsSync(packagesDir)) {
    try {
      const entries = readdirSync(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__')) continue;
        const pkgDir = join(packagesDir, entry.name);
        // 检查常见的源码子目录
        let hasSubDir = false;
        for (const sub of ['src', 'lib']) {
          const subDir = join(pkgDir, sub);
          if (existsSync(subDir) && hasSourceFiles(subDir)) {
            roots.push(`packages/${entry.name}/${sub}`);
            hasSubDir = true;
          }
        }
        // 仅当无 src/lib 子目录时，包根目录才作为源码目录
        if (!hasSubDir && hasSourceFiles(pkgDir)) {
          roots.push(`packages/${entry.name}`);
        }
      }
    } catch { /* skip */ }
  }

  // 2. monorepo: apps/*
  const appsDir = join(projectPath, 'apps');
  if (existsSync(appsDir)) {
    try {
      const entries = readdirSync(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__')) continue;
        const appDir = join(appsDir, entry.name);

        // apps/api/src/modules/* 的子目录
        const modulesDir = join(appDir, 'src', 'modules');
        if (existsSync(modulesDir)) {
          try {
            const modEntries = readdirSync(modulesDir, { withFileTypes: true });
            for (const mod of modEntries) {
              if (!mod.isDirectory() || mod.name.startsWith('.') || mod.name.startsWith('__')) continue;
              const modPath = join(modulesDir, mod.name);
              if (hasSourceFiles(modPath)) {
                roots.push(`apps/${entry.name}/src/modules/${mod.name}`);
              }
            }
          } catch { /* skip */ }
        }

        // apps/xxx/src 本身
        const appSrcDir = join(appDir, 'src');
        if (existsSync(appSrcDir) && hasSourceFiles(appSrcDir)) {
          // 避免重复（modules 已覆盖子目录）
          if (!roots.some(r => r.startsWith(`apps/${entry.name}/src/`))) {
            roots.push(`apps/${entry.name}/src`);
          }
        }
      }
    } catch { /* skip */ }
  }

  // 3. 单 repo: src/, lib/
  for (const dir of ['src', 'lib']) {
    const absDir = join(projectPath, dir);
    if (existsSync(absDir) && hasSourceFiles(absDir)) {
      roots.push(dir);
    }
  }

  return roots;
}

/**
 * 检查目录（递归）中是否包含 .ts 源文件（排除 __tests__, node_modules, dist）
 */
function hasSourceFiles(dir: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
      if (name === '__tests__' || name === '__mocks__') continue;

      const fullPath = join(dir, name);
      if (entry.isFile()) {
        if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
          return true;
        }
      } else if (entry.isDirectory()) {
        if (hasSourceFiles(fullPath)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
