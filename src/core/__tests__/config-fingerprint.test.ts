/**
 * 配置指纹与观察期恢复（下游配置公共化）
 *
 * fingerprintConfig / restoreConfig 把消费方进化链路的「写前指纹 + 观察期备份 +
 * 条件恢复」收进 harness 公共接口：
 *
 * - 指纹 = config.yml 的 SHA-256（缺失 = null），目标路径由 harness 内部解析；
 * - 恢复契约（与消费方观察记录同形）：before/after hash + backupPath。
 *   当前 hash = after → 恢复（backupPath 在场则复制回来，null 则删除配置——
 *   写前本就不存在）；= before → 幂等 already_before；其余 → 拒绝第三方漂移；
 *   恢复后校验 before，不符报 verify_failed。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  fingerprintConfig,
  restoreConfig,
  backupConfigFile,
  hashConfigContent,
} from '../config-fingerprint';
import { createProjectFixture, writeProjectConfig } from '../../test-setup/project-fixture';

function configPath(root: string): string {
  return path.join(root, '.harness', 'config.yml');
}

describe('fingerprintConfig', () => {
  it('目标在场 → 返回路径与 SHA-256；缺失 → hash 为 null', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'harness:\n  version: 5.0.0\n' });

    const fp = fingerprintConfig(root);
    expect(fp.targetPath).toBe(configPath(root));
    expect(fp.hash).toBe(hashConfigContent('harness:\n  version: 5.0.0\n'));
    expect(fp.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('配置缺失 → 只读返回 null，不创建文件', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint' });
    const fp = fingerprintConfig(root);
    expect(fp.hash).toBeNull();
    expect(fs.existsSync(configPath(root))).toBe(false);
  });
});

describe('backupConfigFile', () => {
  it('在场 → 复制为 <path>.bak-<时间戳> 并返回备份路径；缺失 → null', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'a: 1\n' });
    const backup = backupConfigFile(configPath(root), new Date('2026-11-26T08:00:00.000Z'));
    expect(backup).toBe(configPath(root) + '.bak-2026-11-26T08-00-00-000Z');
    expect(fs.readFileSync(backup!, 'utf-8')).toBe('a: 1\n');

    const missing = createProjectFixture({ name: 'harness-fingerprint' });
    expect(backupConfigFile(configPath(missing))).toBeNull();
  });
});

describe('restoreConfig', () => {
  it('当前 = after（备份在场）→ 恢复备份内容并校验 before', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'before: 1\n' });
    const beforeHash = fingerprintConfig(root).hash;
    const backupPath = backupConfigFile(configPath(root))!;
    // 模拟 apply 改写
    writeProjectConfig(root, 'after: 2\n');
    const afterHash = fingerprintConfig(root).hash!;

    const result = restoreConfig(root, { beforeHash, afterHash, backupPath });

    expect(result.status).toBe('restored');
    expect(result.hash).toBe(beforeHash);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe('before: 1\n');
  });

  it('当前 = after 且 backupPath = null → 恢复 = 删除配置（写前本就不存在）', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint' });
    // 写前配置不存在（beforeHash = null）；apply 新建了配置
    writeProjectConfig(root, 'created: by-apply\n');
    const afterHash = fingerprintConfig(root).hash!;

    const result = restoreConfig(root, { beforeHash: null, afterHash, backupPath: null });

    expect(result.status).toBe('restored');
    expect(result.hash).toBeNull();
    expect(fs.existsSync(configPath(root))).toBe(false);
  });

  it('当前 = before → 幂等 already_before，零改动', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'before: 1\n' });
    const beforeHash = fingerprintConfig(root).hash;
    const beforeContent = fs.readFileSync(configPath(root), 'utf-8');

    const result = restoreConfig(root, { beforeHash, afterHash: 'aaa', backupPath: null });

    expect(result.status).toBe('already_before');
    expect(result.hash).toBe(beforeHash);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe(beforeContent);
  });

  it('当前既非 before 也非 after → 拒绝第三方漂移，目标不动', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'before: 1\n' });
    const beforeHash = fingerprintConfig(root).hash;
    const backupPath = backupConfigFile(configPath(root))!;
    writeProjectConfig(root, 'after: 2\n');
    const afterHash = fingerprintConfig(root).hash!;
    // 第三方又改了
    writeProjectConfig(root, 'third: party\n');

    const result = restoreConfig(root, { beforeHash, afterHash, backupPath });

    expect(result.status).toBe('refused_drift');
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe('third: party\n');
  });

  it('当前 = before 且目标已不存在（beforeHash = null）→ already_before', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint' });
    const result = restoreConfig(root, { beforeHash: null, afterHash: 'bbb', backupPath: null });
    expect(result.status).toBe('already_before');
    expect(result.hash).toBeNull();
  });
});

describe('restoreConfig 预期 I/O 失败（评审修复：不裸抛）', () => {
  it('备份缺失 → 不抛错，返回 verify_failed 与当前 hash，目标保持 after 内容不动', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'before: 1\n' });
    const beforeHash = fingerprintConfig(root).hash;
    // 模拟 apply 改写后、观察期备份已丢失（被清理/从未建成）
    writeProjectConfig(root, 'after: 2\n');
    const afterHash = fingerprintConfig(root).hash!;
    const missingBackup = path.join(root, '.harness', 'config.yml.bak-gone');

    const result = restoreConfig(root, { beforeHash, afterHash, backupPath: missingBackup });

    expect(result.status).toBe('verify_failed');
    expect(result.hash).toBe(afterHash);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe('after: 2\n');
  });

  it('备份不可读（backupPath 是目录）→ verify_failed，不误判为漂移也不删目标', () => {
    const root = createProjectFixture({ name: 'harness-fingerprint', config: 'before: 1\n' });
    const beforeHash = fingerprintConfig(root).hash;
    writeProjectConfig(root, 'after: 2\n');
    const afterHash = fingerprintConfig(root).hash!;

    const result = restoreConfig(root, { beforeHash, afterHash, backupPath: path.join(root, '.harness') });

    expect(result.status).toBe('verify_failed');
    expect(result.hash).toBe(afterHash);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe('after: 2\n');
  });
});
