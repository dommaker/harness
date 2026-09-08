/**
 * getHarnessPackageVersion 正本测试（#102，架构评审 A3）
 *
 * 钉住三件事：
 * 1. 读的是 harness 包自身的 package.json（与真实版本一致）
 * 2. cwd 兜底已删除：cwd 是装着 harness 的消费者项目时，绝不误读消费者版本
 * 3. 仓内不再有第二份「harness 自身 package.json」版本读取（防回潮扫描）
 */

import * as fs from 'fs';
import * as path from 'path';
import { getHarnessPackageVersion } from '../package-version';

const REAL_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')
).version as string;

describe('getHarnessPackageVersion', () => {
  it('返回 harness 包真实版本（与包根 package.json 一致）', () => {
    expect(getHarnessPackageVersion()).toBe(REAL_VERSION);
  });

  it('cwd 是消费者项目时仍读 harness 版本，不误读消费者 package.json', () => {
    const consumerDir = path.join(process.cwd(), 'temp-test-pkg-version-consumer');
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'consumer-app', version: '9.9.9' })
    );
    const prevCwd = process.cwd();
    try {
      process.chdir(consumerDir);
      expect(getHarnessPackageVersion()).toBe(REAL_VERSION);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(consumerDir, { recursive: true, force: true });
    }
  });

  it('package.json 读取失败（缺失/损坏）时返回 unknown', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        readFileSync: () => { throw new Error('ENOENT'); },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fresh = require('../package-version') as typeof import('../package-version');
      expect(fresh.getHarnessPackageVersion()).toBe('unknown');
      jest.dontMock('fs');
    });
  });

  it('package.json 无 version 字段时返回 unknown', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        readFileSync: () => JSON.stringify({ name: '@dommaker/harness' }),
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fresh = require('../package-version') as typeof import('../package-version');
      expect(fresh.getHarnessPackageVersion()).toBe('unknown');
      jest.dontMock('fs');
    });
  });
});

describe('版本读取正本收口（防回潮扫描）', () => {
  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('src/ 内只有 utils/package-version.ts 读取 harness 自身 package.json', () => {
    const srcRoot = path.join(__dirname, '..', '..');
    const canonical = path.join(srcRoot, 'utils', 'package-version.ts');
    // harness 自身清单的三类历史读法：__dirname 相对 / require / cwd 兜底
    const selfPkgReadRe = /(__dirname[^\n]*package\.json|require\(['"][^'"]*package\.json['"]\)|process\.cwd\(\)[^\n]*package\.json)/;
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcRoot)) {
      if (file === canonical) continue;
      const hits = fs.readFileSync(file, 'utf-8')
        .split('\n')
        .filter(line => selfPkgReadRe.test(line));
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
