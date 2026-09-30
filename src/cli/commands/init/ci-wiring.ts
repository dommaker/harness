/**
 * init 的服务端 CI 接线（harness#143 平台维度；Phase 3 自 init.ts 拆出，纯移位）
 *
 * gitlab 只有一个 `.gitlab-ci.yml`（治理任务已在正文里）；github 的冲突判定
 * 宽到整个 workflows 目录，需先扫一遍。
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type { CiPlatform } from '../../../types/project-config';
import { type CommandIO } from '../../command-contract';
import { runPlan, harnessCheckCiFile } from '../scaffold';

/**
 * 设置服务端 CI 接线（站点形状与冲突面由 scaffold 按平台给）
 *
 * gitlab 只有一个 `.gitlab-ci.yml`，治理任务已在正文里（`governanceLevel` 传给工厂）；
 * github 的冲突判定宽到整个 workflows 目录，需先扫一遍。
 */
export async function setupCiWiring(
  projectPath: string,
  platform: CiPlatform,
  governanceLevel: string | undefined,
  io: CommandIO,
): Promise<void> {
  if (platform === 'gitlab') {
    await runPlan([harnessCheckCiFile(projectPath, 'gitlab', [], governanceLevel)], io);
    return;
  }
  const workflowsDir = path.join(projectPath, '.github', 'workflows');
  await runPlan(
    [harnessCheckCiFile(projectPath, 'github', await findCiWorkflows(workflowsDir))],
    io,
  );
}

/**
 * 查找已存在的 CI 工作流文件
 */
export async function findCiWorkflows(workflowsDir: string): Promise<string[]> {
  if (!existsSync(workflowsDir)) return [];
  const files = await fs.readdir(workflowsDir);
  // 过滤出可能是 CI 配置的文件
  return files.filter(f =>
    f.endsWith('.yml') || f.endsWith('.yaml')
  );
}
