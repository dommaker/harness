/**
 * 发布物完整性自检测试（harness#77，#75 N4 收编）
 *
 * 覆盖：声明面推导（main/exports/bin）、extras 清单守卫、包根向上解析、
 * 存在性校验、真实包根清单同步闸门。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HARNESS_PACKAGE_NAME,
  EXTRA_CRITICAL_ARTIFACTS,
  deriveCriticalArtifacts,
  resolvePackageRoot,
  getCriticalArtifacts,
  verifyReleaseArtifacts,
} from '../integrity';
import type { PackagePublishManifest } from '../integrity';

/** 建临时 fixture 包根：写 package.json + 按清单造文件/目录 */
function makeFixture(manifest: PackagePublishManifest, artifacts: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-release-integrity-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  for (const artifact of artifacts) {
    const abs = path.join(root, artifact);
    if (/\.[cm]?js$|\.d\.ts$/.test(artifact)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '');
    } else {
      fs.mkdirSync(abs, { recursive: true });
    }
  }
  return root;
}

describe('deriveCriticalArtifacts', () => {
  it('收集 main/exports/bin 声明的脚本入口，去 ./ 前缀、去重、排序，非脚本叶子剔除', () => {
    const manifest: PackagePublishManifest = {
      name: HARNESS_PACKAGE_NAME,
      main: './dist/index.js',
      bin: { harness: './bin/harness.js' },
      exports: {
        '.': {
          types: './dist/index.d.ts',
          require: './dist/index.js',
          import: './dist/index.js',
        },
        './core': './dist/core/index.js',
        './package.json': './package.json',
      },
    };
    expect(deriveCriticalArtifacts(manifest)).toEqual([
      'bin/harness.js',
      'dist/core/index.js',
      'dist/index.d.ts',
      'dist/index.js',
    ]);
  });

  it('exports 为字符串、bin 为字符串、null 条目（兜底禁用）安全', () => {
    const manifest: PackagePublishManifest = {
      name: HARNESS_PACKAGE_NAME,
      main: 'dist/index.js',
      bin: 'bin/harness.js',
      exports: { '.': './dist/index.js', './forbidden': null },
    };
    expect(deriveCriticalArtifacts(manifest)).toEqual(['bin/harness.js', 'dist/index.js']);
  });

  it('无声明字段返回空清单', () => {
    expect(deriveCriticalArtifacts({ name: HARNESS_PACKAGE_NAME })).toEqual([]);
  });
});

describe('EXTRA_CRITICAL_ARTIFACTS', () => {
  it('覆盖 bin 引导定义表与 tools 运行时数据目录（随源码维护，删改须同评审）', () => {
    expect(EXTRA_CRITICAL_ARTIFACTS).toEqual([
      'dist/cli/commands/definitions.js',
      'dist/gates/definitions.js',
      'dist/tools/definitions',
    ]);
  });
});

describe('resolvePackageRoot', () => {
  it('从源码位置向上解析到本仓包根', () => {
    const root = resolvePackageRoot(__dirname);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe(HARNESS_PACKAGE_NAME);
  });

  it('无匹配包根时抛错并提示显式传入 pkgRoot', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-no-pkg-root-'));
    const nested = path.join(bare, 'deep', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    expect(() => resolvePackageRoot(nested)).toThrow(/pkgRoot/);
  });
});

describe('getCriticalArtifacts / verifyReleaseArtifacts（fixture 包根）', () => {
  const FIXTURE_MANIFEST: PackagePublishManifest = {
    name: HARNESS_PACKAGE_NAME,
    main: './dist/index.js',
    bin: './bin/harness.js',
    exports: { '.': './dist/index.js' },
  };
  const FIXTURE_ARTIFACTS = [
    'dist/index.js',
    'bin/harness.js',
    ...EXTRA_CRITICAL_ARTIFACTS,
  ];

  it('清单 = 声明面推导 + extras', () => {
    const root = makeFixture(FIXTURE_MANIFEST, FIXTURE_ARTIFACTS);
    expect(getCriticalArtifacts(root)).toEqual([
      'bin/harness.js',
      'dist/cli/commands/definitions.js',
      'dist/gates/definitions.js',
      'dist/index.js',
      'dist/tools/definitions',
    ]);
  });

  it('全部就位 → ok:true', () => {
    const root = makeFixture(FIXTURE_MANIFEST, FIXTURE_ARTIFACTS);
    const result = verifyReleaseArtifacts(root);
    expect(result).toMatchObject({ ok: true, pkgRoot: root, missing: [] });
  });

  it('缺文件 → ok:false 且 missing 指名', () => {
    const root = makeFixture(FIXTURE_MANIFEST, FIXTURE_ARTIFACTS);
    fs.rmSync(path.join(root, 'dist', 'tools', 'definitions'), { recursive: true, force: true });
    const result = verifyReleaseArtifacts(root);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['dist/tools/definitions']);
  });
});

describe('真实包根清单同步闸门', () => {
  it('真实 package.json 推导覆盖全部声明入口 + extras（重构动声明面时本测试强制同步）', () => {
    const root = resolvePackageRoot(__dirname);
    const artifacts = getCriticalArtifacts(root);
    for (const required of [
      'dist/index.js',
      'dist/core/index.js',
      'dist/presets/index.js',
      'dist/context/index.js',
      'dist/gates/index.js',
      'bin/harness.js',
      ...EXTRA_CRITICAL_ARTIFACTS,
    ]) {
      expect(artifacts).toContain(required);
    }
  });
});
