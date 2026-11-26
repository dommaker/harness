/**
 * ensureHarnessConfig（下游配置公共化）：消费方 prepare 入口的公共初始化同步
 *
 * 下游消费方 prepare 脚本原先自己直读 package.json 版本 +
 * 配置 `harness.version` 并 execSync 起 `harness init` 子进程；本函数把这条链收进
 * 公共接口：版本一致零写盘直接返回，缺失或不一致时复用裸 `harness init`
 * （standard preset、hooks、CI 与非受管配置保留行为原样，见 ./index.ts），
 * init 失败显式抛出。住 cli/commands/init 是因为 init 组合根本身在 cli 层
 * （分层闸禁止 core 值导入 cli）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from '../../../utils/yaml';
import { getHarnessPackageVersion } from '../../../utils/package-version';
import { processIO, type CommandIO } from '../../command-contract';
import { init } from './index';

export interface EnsureHarnessConfigResult {
  /** config.yml 的绝对路径（harness 内部解析，消费方不拼 `.harness/` 布局） */
  configPath: string;
  /** 本包版本 */
  version: string;
  /** 本次同步后的配置版本（已初始化 = 本包版本；一致未写盘 = 原配置值） */
  configVersion: string;
  /** 是否本次执行了初始化写盘 */
  initialized: boolean;
}

/** 读现有配置里的 harness.version；缺失 / 非字符串 / 不可解析 → null（视为需初始化） */
function readConfigVersion(configPath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const config = yaml.load(content) as Record<string, unknown> | null;
    const harness = config?.harness;
    if (harness === null || typeof harness !== 'object' || Array.isArray(harness)) return null;
    const version = (harness as Record<string, unknown>).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * 同步项目 harness 配置到本包版本：一致零写盘；缺失或不一致执行裸 `harness init`
 * （standard preset）；init 返回非 ok 时抛错，不回退不覆盖。
 */
export async function ensureHarnessConfig(
  projectRoot: string,
  io?: CommandIO
): Promise<EnsureHarnessConfigResult> {
  const configPath = path.join(projectRoot, '.harness', 'config.yml');
  const version = getHarnessPackageVersion();
  const configVersion = readConfigVersion(configPath);
  if (configVersion === version) {
    return { configPath, version, configVersion, initialized: false };
  }

  const result = await init({ projectPath: projectRoot, preset: 'standard' }, io ?? processIO);
  if (result.kind !== 'ok') {
    const reason = 'reason' in result ? result.reason : String(result.kind);
    throw new Error(`harness init 失败（${configPath}）：${reason}`);
  }
  return { configPath, version, configVersion: version, initialized: true };
}
