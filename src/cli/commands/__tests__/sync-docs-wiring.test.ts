/**
 * sync-docs 采集与判定收口接线闸（handoff P2 第 4 项 / P2.8）
 *
 * 裁决方向：文档同步模块（core/docs-sync/）负责采集与判定，CLI 只保留
 * 输出（与写入/gate/compact 形态）。判定与输出契约不变，因此本切片的行为
 * 就是「职责落位」——落位用源形状闸逐轮钉住（照 status-analysis-wiring
 * 先例），用户可见契约由既有 syncDocs 行为测试全程当安全网。
 *
 * 分四轮落位，每轮一枚 it：R1 源码清单 + CONTEXT 采集；R2 CAPABILITIES
 * file-table 文本判定；R3 AGENTS.md 生成 + PRESERVE 组合；R4 采集/判定
 * 主入口 collectSyncState/judgeSyncState。每轮先红（旧实现）后绿（移位后）。
 */

import * as fs from 'fs';
import * as path from 'path';

const SYNC_DOCS_DIR = path.join(__dirname, '..', 'sync-docs');
const CORE_DOCS_SYNC_DIR = path.join(__dirname, '..', '..', '..', 'core', 'docs-sync');

/** sync-docs 生产文件（排 __tests__） */
function productionFiles(): string[] {
  return fs
    .readdirSync(SYNC_DOCS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(SYNC_DOCS_DIR, name));
}

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('sync-docs 采集与判定收口（P2.8）', () => {
  it('R1 源码清单与 CONTEXT 采集住在 core/docs-sync，CLI 侧不再自采', () => {
    // 采集实现已落位 core 文档同步模块
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'project-reader.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'context-collector.ts'))).toBe(true);

    // CLI sync-docs 生产文件不得再从本目录采集源码清单（含 type-only 落点）
    for (const file of productionFiles()) {
      const src = readSource(file);
      expect(src).not.toMatch(/from\s+'\.\/project-reader'/);
    }

    // context-syncer 只剩写侧 createContextMd：采集函数全部迁出本层
    const contextSyncer = readSource(path.join(SYNC_DOCS_DIR, 'context-syncer.ts'));
    expect(contextSyncer).not.toMatch(
      /export\s+(async\s+)?function\s+(findExistingContextFiles|getLatestTsMtime|collectContextExportSurface|createConstructionSiteCounter)/
    );
  });

  it('R2 CAPABILITIES file-table 文本判定住在 core/docs-sync', () => {
    // 解析/排版判定/compact 折叠正本已落位 core
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'capabilities-table.ts'))).toBe(true);

    // CLI 侧 capabilities-syncer 只剩写侧 updateCapabilitiesFile
    const capsSyncer = readSource(path.join(SYNC_DOCS_DIR, 'capabilities-syncer.ts'));
    expect(capsSyncer).not.toMatch(
      /export\s+(async\s+)?function\s+(parseCapabilitiesFiles|normalizeCapabilitiesTableLayout|compactCapabilitiesContent)/
    );
  });

  it('R3 AGENTS.md 生成与 PRESERVE 组合住在 core/docs-sync', () => {
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'agents-syncer.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'preserve-block.ts'))).toBe(true);

    // CLI sync-docs 生产文件不得再从本目录生成 AGENTS.md / 组合 PRESERVE 块
    for (const file of productionFiles()) {
      const src = readSource(file);
      expect(src).not.toMatch(/from\s+'\.\/agents-syncer'/);
      expect(src).not.toMatch(/from\s+'\.\/preserve-block'/);
    }
  });

  it('R4 采集/判定主入口住在 core/docs-sync，命令流只编排与输出', () => {
    expect(fs.existsSync(path.join(CORE_DOCS_SYNC_DIR, 'sync-state.ts'))).toBe(true);

    // 命令流（入口 + 主流程）不得再从本目录取采集/判定
    for (const name of ['index.ts', 'main-flow.ts']) {
      const src = readSource(path.join(SYNC_DOCS_DIR, name));
      expect(src).not.toMatch(/from\s+'\.\/sync-state'/);
    }

    // 主流程的采集/判定必须来自 core 文档同步模块（防 import 删成死码的反向闸）
    const mainFlow = readSource(path.join(SYNC_DOCS_DIR, 'main-flow.ts'));
    expect(mainFlow).toMatch(/collectSyncState/);
    expect(mainFlow).toMatch(/judgeSyncState/);
    expect(mainFlow).toMatch(/from\s+'[^']*core\/docs-sync\/sync-state'/);
  });
});
