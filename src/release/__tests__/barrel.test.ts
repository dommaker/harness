/**
 * release barrel 导出面守卫（harness#92，ADR-0003 一致性收口）
 *
 * barrel 只再导出包根公开面：`getCriticalArtifacts` / `verifyReleaseArtifacts` /
 * `ArtifactIntegrityResult`。构件清单助手（HARNESS_PACKAGE_NAME、
 * EXTRA_CRITICAL_ARTIFACTS、deriveCriticalArtifacts、resolvePackageRoot +
 * PackagePublishManifest、PackageExports 类型）属 integrity.ts 内部 seam，
 * 唯一消费方 integrity.test.ts 直接 `from '../integrity'`，不经 barrel。
 * 值面靠下面的运行时键集合断言；类型面无运行时痕迹，靠两条 @ts-expect-error
 * 在编译期把关——barrel 一旦恢复再导出，指令失效即报错。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  HARNESS_PACKAGE_NAME,
  EXTRA_CRITICAL_ARTIFACTS,
  deriveCriticalArtifacts,
  resolvePackageRoot,
} from '../integrity';
import type { PackagePublishManifest as InternalManifest } from '../integrity';
// @ts-expect-error PackagePublishManifest 属 integrity.ts 内部类型，不经 barrel 导出（harness#92）
import type { PackagePublishManifest } from '../index';
// @ts-expect-error PackageExports 属 integrity.ts 内部类型，不经 barrel 导出（harness#92）
import type { PackageExports } from '../index';

describe('release barrel 导出面（harness#92）', () => {
  it('barrel 运行时只再导出包根公开的两个函数', async () => {
    const mod = await import('../index');
    expect(Object.keys(mod).sort()).toEqual(['getCriticalArtifacts', 'verifyReleaseArtifacts']);
  });

  it('barrel 导出面不含内部清单符号与清单类型名', async () => {
    const mod = await import('../index');
    for (const internal of [
      'HARNESS_PACKAGE_NAME',
      'EXTRA_CRITICAL_ARTIFACTS',
      'deriveCriticalArtifacts',
      'resolvePackageRoot',
      'PackagePublishManifest',
      'PackageExports',
    ]) {
      expect(mod).not.toHaveProperty(internal);
    }
    // 两个清单类型只能在编译期证伪，此处消费导入名让上面的 @ts-expect-error 进入生效路径
    const manifestFromBarrel = null as PackagePublishManifest | null;
    const exportsFromBarrel = null as PackageExports | null;
    expect([manifestFromBarrel, exportsFromBarrel]).toEqual([null, null]);
  });

  it('收回私有不等于删除：内部 seam 仍在 integrity.ts 就地可达', () => {
    const manifest: InternalManifest = { name: HARNESS_PACKAGE_NAME };
    expect(deriveCriticalArtifacts(manifest)).toEqual([]);
    expect(EXTRA_CRITICAL_ARTIFACTS.length).toBeGreaterThan(0);
    const pkgRoot = resolvePackageRoot(__dirname);
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    expect(pkg.name).toBe(HARNESS_PACKAGE_NAME);
  });
});
