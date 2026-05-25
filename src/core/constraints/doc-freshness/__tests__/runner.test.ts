/**
 * FreshnessRunner 测试
 *
 * 验证四种检查类型的配置驱动行为：纯文件系统操作，零 LLM 调用。
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { FreshnessRunner } from '../runner';
import type { DocFreshnessConfig } from '../../../../types/project-config';

const TEST_ROOT = join(__dirname, '__test_fixtures__');

function setupFixture(dir: string, files: Record<string, string>) {
  const abs = join(TEST_ROOT, dir);
  if (existsSync(abs)) rmSync(abs, { recursive: true });
  mkdirSync(abs, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = join(abs, relPath);
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }
}

function cleanup() {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
}

describe('FreshnessRunner', () => {
  let runner: FreshnessRunner;

  beforeEach(() => {
    runner = new FreshnessRunner();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // ─── changelog_version ─────────────────────────────────────────

  describe('changelog_version', () => {
    it('passes when versions match', () => {
      setupFixture('changelog-ok', {
        'CHANGELOG.md': '## [1.2.3]\n\n- Some change\n',
        'package.json': JSON.stringify({ version: '1.2.3' }),
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'changelog_version' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'changelog-ok'));
      expect(results).toHaveLength(1);
      expect(results[0].pass).toBe(true);
    });

    it('fails when versions mismatch', () => {
      setupFixture('changelog-mismatch', {
        'CHANGELOG.md': '## [1.2.3]\n\n- Some change\n',
        'package.json': JSON.stringify({ version: '2.0.0' }),
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'changelog_version' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'changelog-mismatch'));
      expect(results).toHaveLength(1);
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('1.2.3');
      expect(results[0].message).toContain('2.0.0');
    });

    it('passes when CHANGELOG does not exist', () => {
      setupFixture('changelog-missing', {
        'package.json': JSON.stringify({ version: '1.0.0' }),
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'changelog_version' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'changelog-missing'));
      expect(results[0].pass).toBe(true);
    });

    it('supports custom file paths', () => {
      setupFixture('changelog-custom', {
        'docs/CHANGES.md': '## [3.0.0]\n\n- Breaking\n',
        'pkg.json': JSON.stringify({ version: '3.0.0' }),
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'changelog_version',
          changelog: 'docs/CHANGES.md',
          package_json: 'pkg.json',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'changelog-custom'));
      expect(results[0].pass).toBe(true);
    });
  });

  // ─── context_docs ──────────────────────────────────────────────

  describe('context_docs', () => {
    it('passes when all dirs have CONTEXT.md', () => {
      setupFixture('ctx-ok', {
        'src/core/CONTEXT.md': '# Core Context',
        'src/cli/CONTEXT.md': '# CLI Context',
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'context_docs', dirs: ['src/core', 'src/cli'] }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'ctx-ok'));
      expect(results[0].pass).toBe(true);
    });

    it('fails when a dir is missing CONTEXT.md', () => {
      setupFixture('ctx-missing', {
        'src/core/CONTEXT.md': '# Core Context',
        // src/cli/ exists but no CONTEXT.md
      });
      mkdirSync(join(TEST_ROOT, 'ctx-missing', 'src', 'cli'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'context_docs', dirs: ['src/core', 'src/cli'] }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'ctx-missing'));
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('src/cli');
    });

    it('passes when no dirs configured', () => {
      setupFixture('ctx-empty', {});

      const config: DocFreshnessConfig = {
        checks: [{ type: 'context_docs' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'ctx-empty'));
      expect(results[0].pass).toBe(true);
    });

    it('uses requiredDirs from context when no explicit dirs', () => {
      setupFixture('ctx-from-context', {
        'app/src/CONTEXT.md': '# App Context',
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'context_docs' }],
      };
      const results = runner.runAll(
        config,
        join(TEST_ROOT, 'ctx-from-context'),
        { requiredDirs: ['app/src'] }
      );
      expect(results[0].pass).toBe(true);
    });

    it('supports custom doc_name', () => {
      setupFixture('ctx-custom-doc', {
        'src/core/README.md': '# Core Readme',
      });

      const config: DocFreshnessConfig = {
        checks: [{ type: 'context_docs', dirs: ['src/core'], doc_name: 'README.md' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'ctx-custom-doc'));
      expect(results[0].pass).toBe(true);
    });
  });

  // ─── doc_dir_check ─────────────────────────────────────────────

  describe('doc_dir_check', () => {
    it('passes when doc dirs match filesystem', () => {
      setupFixture('dirdir-ok', {
        'CLAUDE.md': [
          '## Key Subsystems',
          '',
          '| Directory | Purpose |',
          '|-----------|---------|',
          '| `src/core/` | Core engine |',
          '| `src/cli/` | CLI tools |',
        ].join('\n'),
        // create actual dirs
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-ok', 'src', 'core'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-ok', 'src', 'cli'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-ok'));
      expect(results[0].pass).toBe(true);
    });

    it('fails when doc references non-existent dir', () => {
      setupFixture('dirdir-doc-missing', {
        'CLAUDE.md': [
          '## Key Subsystems',
          '',
          '| `src/core/` | Core engine |',
          '| `src/nonexistent/` | Ghost |',
        ].join('\n'),
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-doc-missing', 'src', 'core'), { recursive: true });
      // src/nonexistent/ NOT created

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-doc-missing'));
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('nonexistent');
    });

    it('fails when filesystem has uncovered dir', () => {
      setupFixture('dirdir-fs-extra', {
        'CLAUDE.md': [
          '## Key Subsystems',
          '',
          '| `src/core/` | Core |',
        ].join('\n'),
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-fs-extra', 'src', 'core'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-fs-extra', 'src', 'unlisted'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-fs-extra'));
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('unlisted');
    });

    it('passes for uncovered dir when skip_reverse_check is set', () => {
      setupFixture('dirdir-skip-reverse', {
        'CLAUDE.md': [
          '## Key Architecture Paths',
          '',
          '| `packages/studio-shared/src/` | Shared |',
        ].join('\n'),
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-skip-reverse', 'packages', 'studio-shared', 'src'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-skip-reverse', 'packages', 'studio-web', 'src'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Architecture Paths',
          skip_reverse_check: true,
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-skip-reverse'));
      expect(results[0].pass).toBe(true);
    });

    it('passes when section not found in doc', () => {
      setupFixture('dirdir-no-section', {
        'CLAUDE.md': '## Different Section\n\nSome content',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-no-section'));
      expect(results[0].pass).toBe(true);
    });

    it('passes when doc does not exist', () => {
      setupFixture('dirdir-no-doc', {});

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-no-doc'));
      expect(results[0].pass).toBe(true);
    });

    it('respects exclude list', () => {
      setupFixture('dirdir-exclude', {
        'CLAUDE.md': [
          '## Key Subsystems',
          '',
          '| `src/core/` | Core |',
        ].join('\n'),
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-exclude', 'src', 'core'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-exclude', 'src', '__tests__'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-exclude', 'src', 'node_modules'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
          exclude: ['__tests__', 'node_modules'],
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-exclude'));
      expect(results[0].pass).toBe(true);
    });

    it('handles subdir coverage (e.g. src/cli covered by src/cli/commands)', () => {
      setupFixture('dirdir-subdir', {
        'CLAUDE.md': [
          '## Key Subsystems',
          '',
          '| `src/core/` | Core |',
          '| `src/cli/commands/` | Commands |',
        ].join('\n'),
      });
      mkdirSync(join(TEST_ROOT, 'dirdir-subdir', 'src', 'core'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-subdir', 'src', 'cli'), { recursive: true });
      mkdirSync(join(TEST_ROOT, 'dirdir-subdir', 'src', 'cli', 'commands'), { recursive: true });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_dir_check',
          doc: 'CLAUDE.md',
          section: 'Key Subsystems',
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'dirdir-subdir'));
      // src/cli should be covered by src/cli/commands subdir entry
      expect(results[0].pass).toBe(true);
    });
  });

  // ─── doc_regex_count ───────────────────────────────────────────

  describe('doc_regex_count', () => {
    it('passes when doc count matches actual (dir_count)', () => {
      setupFixture('regex-dir-ok', {
        'CAPABILITIES.md': '# Capabilities\n\nCLI Commands (2)\n',
        'src/cli/commands/check.ts': '// check command',
        'src/cli/commands/validate.ts': '// validate command',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'CLI Commands',
          pattern: 'CLI Commands\\s*\\((\\d+)\\)',
          actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts' },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-dir-ok'));
      expect(results[0].pass).toBe(true);
      expect(results[0].detail?.docCount).toBe(2);
      expect(results[0].detail?.actualCount).toBe(2);
    });

    it('fails when doc count mismatches actual (dir_count)', () => {
      setupFixture('regex-dir-mismatch', {
        'CAPABILITIES.md': '# Capabilities\n\nCLI Commands (5)\n',
        'src/cli/commands/check.ts': '// check',
        'src/cli/commands/validate.ts': '// validate',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'CLI Commands',
          pattern: 'CLI Commands\\s*\\((\\d+)\\)',
          actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts' },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-dir-mismatch'));
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('5');
      expect(results[0].message).toContain('2');
    });

    it('handles const_count actual', () => {
      setupFixture('regex-const', {
        'CAPABILITIES.md': '# Capabilities\n\nIron Laws (13)\n',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'Iron Laws',
          pattern: 'Iron Laws\\s*\\((\\d+)\\)',
          actual: { kind: 'const_count', value: 13 },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-const'));
      expect(results[0].pass).toBe(true);
    });

    it('fails when const_count mismatches', () => {
      setupFixture('regex-const-mismatch', {
        'CAPABILITIES.md': '# Capabilities\n\nIron Laws (10)\n',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'Iron Laws',
          pattern: 'Iron Laws\\s*\\((\\d+)\\)',
          actual: { kind: 'const_count', value: 13 },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-const-mismatch'));
      expect(results[0].pass).toBe(false);
    });

    it('handles grep_count actual', () => {
      setupFixture('regex-grep', {
        'README.md': '# Readme\n\nPackages (0)\n',
        'modules/a/index.ts': '// module a',
        'modules/b/index.ts': '// module b',
        'modules/c/index.ts': 'export class Foo {}',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'README.md',
          label: 'Packages',
          pattern: 'Packages\\s*\\((\\d+)\\)',
          actual: {
            kind: 'grep_count',
            glob: 'modules/c/*.ts',
            pattern: 'export class',
          },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-grep'));
      expect(results[0].pass).toBe(false);
      expect(results[0].message).toContain('0');
      expect(results[0].message).toContain('1');
    });

    it('passes when pattern not found in doc', () => {
      setupFixture('regex-no-match', {
        'CAPABILITIES.md': '# Capabilities\n\nNo counts here\n',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'CLI Commands',
          pattern: 'CLI Commands\\s*\\((\\d+)\\)',
          actual: { kind: 'const_count', value: 5 },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-no-match'));
      expect(results[0].pass).toBe(true);
    });

    it('passes when doc does not exist', () => {
      setupFixture('regex-no-doc', {});

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'CLI Commands',
          pattern: 'CLI Commands\\s*\\((\\d+)\\)',
          actual: { kind: 'const_count', value: 5 },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-no-doc'));
      expect(results[0].pass).toBe(true);
    });

    it('respects exclude list in dir_count', () => {
      setupFixture('regex-exclude', {
        'CAPABILITIES.md': '# Capabilities\n\nCLI Commands (1)\n',
        'src/cli/commands/check.ts': '// check',
        'src/cli/commands/index.ts': '// barrel',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'CLI Commands',
          pattern: 'CLI Commands\\s*\\((\\d+)\\)',
          actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts', exclude: ['index.ts'] },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-exclude'));
      expect(results[0].pass).toBe(true);
    });

    it('supports regex with optional formatting (Iron Laws pattern)', () => {
      setupFixture('regex-format', {
        'CAPABILITIES.md': '# Capabilities\n\n**Iron Laws** (13)\n',
      });

      const config: DocFreshnessConfig = {
        checks: [{
          type: 'doc_regex_count',
          doc: 'CAPABILITIES.md',
          label: 'Iron Laws',
          pattern: '\\*{0,2}Iron Laws?\\*{0,2}\\s*\\((\\d+)\\)',
          actual: { kind: 'const_count', value: 13 },
        }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'regex-format'));
      expect(results[0].pass).toBe(true);
    });
  });

  // ─── enabled flag ──────────────────────────────────────────────

  describe('enabled flag', () => {
    it('returns empty results when enabled is false', () => {
      setupFixture('disabled', {});

      const config: DocFreshnessConfig = {
        enabled: false,
        checks: [{ type: 'changelog_version' }],
      };
      const results = runner.runAll(config, join(TEST_ROOT, 'disabled'));
      expect(results).toHaveLength(0);
    });
  });
});
