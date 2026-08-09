/**
 * extend_exceptions 功能测试
 */

import { ProjectConfigLoader } from '../core/project-config-loader';
import * as fs from 'fs';

// Mock 文件系统
jest.mock('fs');

describe('extend_exceptions', () => {
  let loader: ProjectConfigLoader;

  beforeEach(() => {
    loader = new ProjectConfigLoader('/test/project');
    jest.clearAllMocks();
  });

  it('应该追加例外到内置约束', () => {
    // 模拟配置文件存在
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('config.yml')) {
        return 'preset: standard\n';
      }
      if (filePath.includes('custom-constraints.yml')) {
        return `
custom_constraints:
  no_fix_without_root_cause:
    extend_exceptions:
      - MY_CUSTOM_EXCEPTION_1
      - MY_CUSTOM_EXCEPTION_2
`;
      }
      return '';
    });

    loader.load();
    const merged = loader.mergeConstraints();

    // 注意：no_fix_without_root_cause 是 prompt 层约束（ADR-0001）
    const constraint = merged.prompts!['no_fix_without_root_cause'];
    expect(constraint).toBeDefined();
    // 应该包含内置例外
    expect(constraint?.exceptions).toContain('simple_typo');
    expect(constraint?.exceptions).toContain('config_value_error');
    // 应该包含新增例外
    expect(constraint?.exceptions).toContain('MY_CUSTOM_EXCEPTION_1');
    expect(constraint?.exceptions).toContain('MY_CUSTOM_EXCEPTION_2');
    // 总数应该是 5（3 内置 + 2 新增）
    expect(constraint?.exceptions?.length).toBe(5);
  });

  it('应该支持 exceptions + extend_exceptions', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('config.yml')) {
        return 'preset: standard\n';
      }
      if (filePath.includes('custom-constraints.yml')) {
        return `
custom_constraints:
  no_fix_without_root_cause:
    exceptions:
      - MY_EXCEPTION
    extend_exceptions:
      - MY_EXTENDED
`;
      }
      return '';
    });

    loader.load();
    const merged = loader.mergeConstraints();

    const constraint = merged.guidelines['no_fix_without_root_cause'];
    // 应该包含内置例外（因为有 extend_exceptions）
    expect(constraint?.exceptions).toContain('simple_typo');
    // 应该包含自定义例外
    expect(constraint?.exceptions).toContain('MY_EXCEPTION');
    // 应该包含扩展例外
    expect(constraint?.exceptions).toContain('MY_EXTENDED');
    // 总数应该是 5（3 内置 + 1 exceptions + 1 extend_exceptions）
    expect(constraint?.exceptions?.length).toBe(5);
  });

  it('没有 extend_exceptions 时应该完全覆盖', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('config.yml')) {
        return 'preset: standard\n';
      }
      if (filePath.includes('custom-constraints.yml')) {
        return `
custom_constraints:
  no_fix_without_root_cause:
    level: guideline
    rule: Do not fix without root cause
    message: 禁止没有根因分析就修复
    trigger: bug_fix
    exceptions:
      - MY_EXCEPTION
`;
      }
      return '';
    });

    loader.load();
    const merged = loader.mergeConstraints();

    const constraint = merged.guidelines['no_fix_without_root_cause'];
    // 应该只包含自定义例外
    expect(constraint?.exceptions).toEqual(['MY_EXCEPTION']);
    // 内置例外不应该保留
    expect(constraint?.exceptions).not.toContain('simple_typo');
  });

  it('纯扩展模式应该保留内置约束的其他属性', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('config.yml')) {
        return 'preset: standard\n';
      }
      if (filePath.includes('custom-constraints.yml')) {
        return `
custom_constraints:
  no_fix_without_root_cause:
    extend_exceptions:
      - MY_PATTERN
`;
      }
      return '';
    });

    loader.load();
    const merged = loader.mergeConstraints();

    const constraint = merged.prompts!['no_fix_without_root_cause'];
    expect(constraint).toBeDefined();
    // 应该保留内置约束的 rule
    expect(constraint?.rule).toBeTruthy();
    // 应该保留内置约束的 message
    expect(constraint?.message).toBeTruthy();
    // 应该包含新增的例外
    expect(constraint?.exceptions).toContain('MY_PATTERN');
    // 应该保留内置例外
    expect(constraint?.exceptions).toContain('simple_typo');
  });
});
