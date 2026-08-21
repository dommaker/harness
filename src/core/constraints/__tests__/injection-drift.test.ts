/**
 * 注入漂移校验测试（ADR-0001 决策 7，P6）
 *
 * - 三类漂移各自检出：版本 / 内容（条目级 missing/extra）/ 重复章节
 * - 无漂移静默；无标记段 = 未注入不算漂移；CLAUDE.md 不存在不算漂移
 * - 落点路由（studio #307）：AGENTS.md PRESERVE:governance 内注入段同样校验；
 *   两文件均有标记段时 CLAUDE.md 优先（旧模型仓豁免）
 * - config.yml 变更后未重跑 init → 内容漂移（extra）
 *
 * 使用真实临时目录（getEffectiveConstraints 读真实 fs）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectInjectionDrift, INJECTION_DRIFT_FIX_HINT } from '../injection-drift';
import {
  renderConstraintsSection,
  CONSTRAINTS_START_MARKER,
} from '../injection-renderer';
import { getEffectiveConstraints } from '../../effective-constraints';

const TEST_VERSION = '9.9.9-test';

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-drift-test-'));
}

/** 写入与当前生效集完全一致的注入段（版本 TEST_VERSION） */
function writeSyncedClaudeMd(root: string, extra = ''): string {
  const section =
    '## Governance Rules\n' + renderConstraintsSection(getEffectiveConstraints(root), TEST_VERSION);
  const content = `# Test Project\n\n${section}${extra}`;
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), content, 'utf-8');
  return content;
}

/** 新模型仓注入段：AGENTS.md `PRESERVE:governance` 段内含标记段（版本 TEST_VERSION） */
function writeSyncedAgentsMd(root: string, extra = ''): string {
  const section =
    '<!-- PRESERVE:governance -->\n## Governance Rules\n' +
    renderConstraintsSection(getEffectiveConstraints(root), TEST_VERSION) +
    '<!-- /PRESERVE:governance -->\n';
  const content = `# AGENTS.md\n\n${section}${extra}`;
  fs.writeFileSync(path.join(root, 'AGENTS.md'), content, 'utf-8');
  return content;
}

describe('detectInjectionDrift', () => {
  it('无漂移：注入段与期望渲染一致 → hasDrift=false', () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root);

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.notInjected).toBe(false);
    expect(drift.hasDrift).toBe(false);
    expect(drift.versionDrift).toBeUndefined();
    expect(drift.contentDrift).toBeUndefined();
    expect(drift.duplicateHeading).toBe(false);
    expect(drift.fixHint).toContain('npx @dommaker/harness init');
    expect(drift.fixHint).toBe(INJECTION_DRIFT_FIX_HINT);
  });

  it('版本漂移：标记段版本号改旧 → versionDrift', () => {
    const root = makeTmpProject();
    const synced = writeSyncedClaudeMd(root);
    fs.writeFileSync(
      path.join(root, 'CLAUDE.md'),
      synced.replace(`<!-- version: ${TEST_VERSION} -->`, '<!-- version: 0.0.1-old -->'),
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.hasDrift).toBe(true);
    expect(drift.versionDrift).toEqual({ expected: TEST_VERSION, actual: '0.0.1-old' });
    expect(drift.contentDrift).toBeUndefined();
  });

  it('内容漂移：手改标记段内一条 → 原条目 missing、改后条目 extra', () => {
    const root = makeTmpProject();
    const synced = writeSyncedClaudeMd(root);
    const originalLine = synced.split('\n').find(l => l.startsWith('- **'))!;
    const editedLine = originalLine.replace(/: .+$/, ': 手工篡改的注入文本');
    fs.writeFileSync(
      path.join(root, 'CLAUDE.md'),
      synced.replace(originalLine, editedLine),
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.hasDrift).toBe(true);
    expect(drift.versionDrift).toBeUndefined();
    expect(drift.contentDrift).toBeDefined();
    expect(drift.contentDrift!.missing).toEqual([originalLine]);
    expect(drift.contentDrift!.extra).toEqual([editedLine]);
  });

  it('内容漂移：config.yml 变更后未重跑 init → 被禁条目成为 extra', () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root);
    // 注入后禁用一条 prompt，但不重跑 init
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.harness', 'config.yml'),
      'constraints:\n  no_fuzzy_completion_claim:\n    enabled: false\n',
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.hasDrift).toBe(true);
    expect(drift.contentDrift).toBeDefined();
    expect(drift.contentDrift!.missing).toEqual([]);
    expect(drift.contentDrift!.extra).toHaveLength(1);
    expect(drift.contentDrift!.extra[0]).toContain('no_fuzzy_completion_claim');
  });

  it('重复章节：标记段之外还有一个 ## Governance Rules 标题 → duplicateHeading', () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root, '\n## Governance Rules\n\n旧版遗留的同名章节\n');

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.duplicateHeading).toBe(true);
    expect(drift.hasDrift).toBe(true);
  });

  it('无标记段 = 未注入，不算漂移', () => {
    const root = makeTmpProject();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Test Project\n\n## Governance Rules\n\n用户自写内容\n', 'utf-8');

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.notInjected).toBe(true);
    expect(drift.hasDrift).toBe(false);
  });

  it('CLAUDE.md 不存在 = 未注入，不算漂移', () => {
    const root = makeTmpProject();

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.notInjected).toBe(true);
    expect(drift.hasDrift).toBe(false);
  });

  it('默认版本参数读 package.json：与真实版本一致的注入段无版本漂移', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realVersion = require('../../../../package.json').version as string;
    const root = makeTmpProject();
    const section =
      '## Governance Rules\n' + renderConstraintsSection(getEffectiveConstraints(root), realVersion);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), section, 'utf-8');

    const drift = detectInjectionDrift(root);

    expect(drift.versionDrift).toBeUndefined();
    expect(drift.hasDrift).toBe(false);
  });

  it('标记段含 ' + CONSTRAINTS_START_MARKER + ' 但版本行缺失 → versionDrift actual=(缺失)', () => {
    const root = makeTmpProject();
    const synced = writeSyncedClaudeMd(root);
    fs.writeFileSync(
      path.join(root, 'CLAUDE.md'),
      synced.replace(`<!-- version: ${TEST_VERSION} -->\n`, ''),
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.versionDrift).toEqual({ expected: TEST_VERSION, actual: '(缺失)' });
  });

  it('新模型仓：AGENTS.md PRESERVE:governance 注入段一致 → 无漂移，injectionFile=AGENTS.md', () => {
    const root = makeTmpProject();
    writeSyncedAgentsMd(root);

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.notInjected).toBe(false);
    expect(drift.injectionFile).toBe('AGENTS.md');
    expect(drift.hasDrift).toBe(false);
    expect(drift.duplicateHeading).toBe(false);
  });

  it('新模型仓：版本漂移与内容漂移照常检出', () => {
    const root = makeTmpProject();
    const synced = writeSyncedAgentsMd(root);
    const originalLine = synced.split('\n').find(l => l.startsWith('- **'))!;
    const editedLine = originalLine.replace(/: .+$/, ': 手工篡改的注入文本');
    fs.writeFileSync(
      path.join(root, 'AGENTS.md'),
      synced
        .replace(`<!-- version: ${TEST_VERSION} -->`, '<!-- version: 0.0.1-old -->')
        .replace(originalLine, editedLine),
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.injectionFile).toBe('AGENTS.md');
    expect(drift.hasDrift).toBe(true);
    expect(drift.versionDrift).toEqual({ expected: TEST_VERSION, actual: '0.0.1-old' });
    expect(drift.contentDrift!.missing).toEqual([originalLine]);
    expect(drift.contentDrift!.extra).toEqual([editedLine]);
  });

  it('新模型仓：PRESERVE 段之外还有 ## Governance Rules 标题 → duplicateHeading', () => {
    const root = makeTmpProject();
    writeSyncedAgentsMd(root, '\n## Governance Rules\n\n旧版遗留的同名章节\n');

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.injectionFile).toBe('AGENTS.md');
    expect(drift.duplicateHeading).toBe(true);
    expect(drift.hasDrift).toBe(true);
  });

  it('两文件均有标记段：旧模型仓豁免，CLAUDE.md 优先（AGENTS.md 漂移不影响判定）', () => {
    const root = makeTmpProject();
    writeSyncedClaudeMd(root);
    const agents = writeSyncedAgentsMd(root);
    // AGENTS.md 注入段手改出漂移，CLAUDE.md 保持一致
    fs.writeFileSync(
      path.join(root, 'AGENTS.md'),
      agents.replace(`<!-- version: ${TEST_VERSION} -->`, '<!-- version: 0.0.1-old -->'),
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.injectionFile).toBe('CLAUDE.md');
    expect(drift.hasDrift).toBe(false);
  });

  it('两处均无标记段但 AGENTS.md 有重复 Governance Rules 标题 → notInjected + duplicateHeading', () => {
    const root = makeTmpProject();
    fs.writeFileSync(
      path.join(root, 'AGENTS.md'),
      '# AGENTS.md\n\n## Governance Rules\n\n甲\n\n## Governance Rules\n\n乙\n',
      'utf-8'
    );

    const drift = detectInjectionDrift(root, TEST_VERSION);

    expect(drift.notInjected).toBe(true);
    expect(drift.hasDrift).toBe(false);
    expect(drift.duplicateHeading).toBe(true);
  });
});
