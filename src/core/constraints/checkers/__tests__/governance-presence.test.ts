/**
 * governance_presence 检查器旁测（studio #302，ADR 2026-08-21 落点模型）
 *
 * 在场守护：PRESERVE 只保「存在」不保「在场」——治理契约段被删除/掏空后
 * sync-docs 重新生成会静默丢失，本 checker 在 harness check 时校验在场性。
 * 测试面 = evaluate(env)（架构评审候选4，自 src/__tests__/ 就近迁入）。
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  governancePresence,
  hasGovernancePreserveBlock,
  hasClaudeGovernance,
} from '../governance-presence';
import { detectInjectionDrift } from '../../injection-drift';
import type { CheckEnv } from '../types';

function makeEnv(projectPath: string): CheckEnv {
  return {
    context: { operation: 'commit', projectPath },
    projectPath,
    stagedDiff: async () => '',
    stagedDiffNames: async () => '',
    srcScan: () => [],
  };
}

const GOVERNANCE_BLOCK = [
  '<!-- PRESERVE:governance -->',
  '## Governance Rules',
  '',
  '<!-- HARNESS_CONSTRAINTS_START -->',
  '- **law_a**: 描述 a',
  '<!-- HARNESS_CONSTRAINTS_END -->',
  '<!-- /PRESERVE:governance -->',
].join('\n');

describe('governance_presence checker', () => {
  let tempDir: string;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  const writeConfig = () => {
    fs.mkdirSync(path.join(tempDir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.harness', 'config.yml'), 'preset: standard\n');
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-gov-presence-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('未采用 harness 治理（无 .harness/config.yml）→ skip', async () => {
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe('skip');
  });

  it('新模型：AGENTS.md 有非空 PRESERVE:governance 段 → pass', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), `# AGENTS.md\n\n${GOVERNANCE_BLOCK}\n`);
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
  });

  it('旧模型豁免：CLAUDE.md 有 Governance Rules 块（无 AGENTS.md）→ pass', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# CLAUDE.md\n\n## Governance Rules\n\n条款\n');
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
  });

  it('旧模型豁免：CLAUDE.md 标题双空格变体也认（宽松谓词，fail-open）→ pass', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# CLAUDE.md\n\n##  Governance Rules\n\n条款\n');
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
  });

  it('旧模型豁免：CLAUDE.md 有 HARNESS_CONSTRAINTS 标记 → pass', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '<!-- HARNESS_CONSTRAINTS_START -->\nx\n');
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
  });

  it('两处都没有治理契约 → fail 并报警（防静默丢失）', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# AGENTS.md\n\n只有机器生成内容\n');
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# CLAUDE.md\n\n@AGENTS.md\n');
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('治理契约缺失'));
  });

  it('PRESERVE:governance 段为空（被掏空）且 CLAUDE.md 无治理块 → fail', async () => {
    writeConfig();
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      '# AGENTS.md\n\n<!-- PRESERVE:governance -->\n\n<!-- /PRESERVE:governance -->\n'
    );
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(false);
  });

  it('PRESERVE:governance 标记未闭合视为不在场 → fail', async () => {
    writeConfig();
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      '# AGENTS.md\n\n<!-- PRESERVE:governance -->\n## Governance Rules\n内容\n'
    );
    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(false);
  });
});

describe('hasGovernancePreserveBlock / hasClaudeGovernance 判定函数', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-gov-helpers-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('文件不存在 → false', () => {
    expect(hasGovernancePreserveBlock(path.join(tempDir, 'AGENTS.md'))).toBe(false);
    expect(hasClaudeGovernance(path.join(tempDir, 'CLAUDE.md'))).toBe(false);
  });

  it('块体仅空白/注释外无内容 → false；有内容 → true', () => {
    const p = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(p, '<!-- PRESERVE:governance -->\n   \n<!-- /PRESERVE:governance -->\n');
    expect(hasGovernancePreserveBlock(p)).toBe(false);
    fs.writeFileSync(p, `<!-- PRESERVE:governance -->\n条款一\n<!-- /PRESERVE:governance -->\n`);
    expect(hasGovernancePreserveBlock(p)).toBe(true);
  });

  it('结束标记嵌在行中 = 畸形块 → false（显式收紧，#83：按契约丢失报警）', () => {
    const p = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      p,
      '<!-- PRESERVE:governance -->\n条款一 <!-- /PRESERVE:governance --> 尾注\n'
    );
    expect(hasGovernancePreserveBlock(p)).toBe(false);
  });
});

describe('governance_presence × detectInjectionDrift 同 fixture 一致性（#83）', () => {
  let tempDir: string;

  const writeConfig = () => {
    fs.mkdirSync(path.join(tempDir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.harness', 'config.yml'), 'preset: standard\n');
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-gov-consistency-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('双空格标题：presence 认在场（pass），drift 严格计数 0 不报重复——两层不再互相矛盾', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# CLAUDE.md\n\n##  Governance Rules\n\n条款\n');

    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
    const drift = detectInjectionDrift(tempDir);
    expect(drift.notInjected).toBe(true);
    expect(drift.duplicateHeading).toBe(false);
    expect(drift.hasDrift).toBe(false);
  });

  it('精确拼写单标题：presence pass，drift 不报重复', async () => {
    writeConfig();
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# CLAUDE.md\n\n## Governance Rules\n\n条款\n');

    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
    const drift = detectInjectionDrift(tempDir);
    expect(drift.notInjected).toBe(true);
    expect(drift.duplicateHeading).toBe(false);
  });

  it('精确拼写双标题：presence 认在场，drift 报重复章节（计数是 drift 的独立职责）', async () => {
    writeConfig();
    fs.writeFileSync(
      path.join(tempDir, 'CLAUDE.md'),
      '# CLAUDE.md\n\n## Governance Rules\n\n甲\n\n## Governance Rules\n\n乙\n'
    );

    expect(await governancePresence.evaluate(makeEnv(tempDir))).toBe(true);
    const drift = detectInjectionDrift(tempDir);
    expect(drift.notInjected).toBe(true);
    expect(drift.duplicateHeading).toBe(true);
  });
});
