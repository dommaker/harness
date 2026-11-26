/**
 * ensureHarnessConfig（下游配置公共化）：消费方 prepare 入口的公共初始化同步
 *
 * - 配置 harness.version 与本包版本一致 → 零写盘直接返回（current）；
 * - 缺失 / 版本不一致 → 复用裸 `harness init`（standard preset、hooks、CI 与
 *   非受管配置保留行为原样），显式返回 initialized；
 * - init 失败（如旧配置不可解析）→ 抛错，不吞。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from '../../../utils/yaml';
import { getHarnessPackageVersion } from '../../../utils/package-version';
import { ensureHarnessConfig } from '../init/ensure-config';
import { captureIO, type CapturingIO } from '../../command-contract';
import { createProjectFixture, writeProjectConfig } from '../../../test-setup/project-fixture';

const PKG_VERSION = getHarnessPackageVersion();

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

function configPath(root: string): string {
  return path.join(root, '.harness', 'config.yml');
}

function readConfig(root: string): any {
  return yaml.load(fs.readFileSync(configPath(root), 'utf-8'));
}

describe('ensureHarnessConfig', () => {
  it('配置缺失 → 执行初始化：config.yml 落盘、版本为本包版本、返回 initialized:true', async () => {
    const root = createProjectFixture({ name: 'harness-ensure-config' });

    const result = await ensureHarnessConfig(root, io);

    expect(result.initialized).toBe(true);
    expect(result.version).toBe(PKG_VERSION);
    expect(result.configVersion).toBe(PKG_VERSION);
    expect(result.configPath).toBe(configPath(root));
    expect(readConfig(root).harness.version).toBe(PKG_VERSION);
  });

  it('版本一致 → 零写盘直接返回：内容、mtime、目录清单全部不变', async () => {
    const root = createProjectFixture({ name: 'harness-ensure-config' });
    writeProjectConfig(root, `harness:\n  version: ${PKG_VERSION}\n`);
    const beforeContent = fs.readFileSync(configPath(root), 'utf-8');
    const beforeMtime = fs.statSync(configPath(root)).mtimeMs;

    const result = await ensureHarnessConfig(root, io);

    expect(result.initialized).toBe(false);
    expect(result.version).toBe(PKG_VERSION);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe(beforeContent);
    expect(fs.statSync(configPath(root)).mtimeMs).toBe(beforeMtime);
    // 零写盘：连 init 会创建的 .github 等受管文件也未出现
    expect(fs.readdirSync(root)).toEqual(['.harness']);
  });

  it('版本不一致 → 重新初始化：版本更新，非受管键原样保留', async () => {
    const root = createProjectFixture({ name: 'harness-ensure-config' });
    writeProjectConfig(root, [
      'harness:',
      '  version: 0.0.1-old',
      '  custom_ext: 保留我',
      'custom_key: 也保留我',
      '',
    ].join('\n'));

    const result = await ensureHarnessConfig(root, io);

    expect(result.initialized).toBe(true);
    const config = readConfig(root);
    expect(config.harness.version).toBe(PKG_VERSION);
    expect(config.harness.custom_ext).toBe('保留我');
    expect(config.custom_key).toBe('也保留我');
  });

  it('版本字段非字符串 → 视为不一致，重新初始化', async () => {
    const root = createProjectFixture({ name: 'harness-ensure-config' });
    writeProjectConfig(root, 'harness:\n  version: 5.0\n');

    const result = await ensureHarnessConfig(root, io);

    expect(result.initialized).toBe(true);
    expect(readConfig(root).harness.version).toBe(PKG_VERSION);
  });

  it('旧配置不可解析 → init 失败显式抛出（不吞、不回退覆盖）', async () => {
    const root = createProjectFixture({ name: 'harness-ensure-config' });
    writeProjectConfig(root, 'harness: [broken\n');

    await expect(ensureHarnessConfig(root, io)).rejects.toThrow(/harness init 失败/);
  });
});
