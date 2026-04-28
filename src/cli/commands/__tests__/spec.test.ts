/**
 * spec 命令测试
 */

import { specValidate, listSpecTypes } from '../spec';
import { SpecValidator, validateAllSpecs } from '../../../core/spec/validator';
import type { BatchSpecValidationResult, SpecValidationResult } from '../../../types/spec';

// Mock SpecValidator
jest.mock('../../../core/spec/validator', () => ({
  SpecValidator: {
    getInstance: jest.fn(),
  },
  validateAllSpecs: jest.fn(),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
  bold: jest.fn((str: string) => str),
}));

const MockSpecValidator = SpecValidator as jest.Mocked<typeof SpecValidator>;
const mockValidateAllSpecs = validateAllSpecs as jest.MockedFunction<typeof validateAllSpecs>;

describe('spec command', () => {
  let consoleSpy: jest.SpyInstance;
  let mockValidator: {
    setConfig: jest.Mock;
    validateFile: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    process.exitCode = 0;

    mockValidator = {
      setConfig: jest.fn(),
      validateFile: jest.fn(),
    };
    (MockSpecValidator.getInstance as jest.Mock).mockReturnValue(mockValidator);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('specValidate', () => {
    describe('单文件验证', () => {
      it('应该验证单个文件', async () => {
        const mockResult: SpecValidationResult = {
          file: 'test.yml',
          type: 'custom',
          valid: true,
          errors: [],
          warnings: [],
        };
        mockValidator.validateFile.mockResolvedValue(mockResult);

        await specValidate({ file: 'test.yml' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验证通过'));
      });

      it('应该显示验证错误', async () => {
        const mockResult: SpecValidationResult = {
          file: 'test.yml',
          type: 'custom',
          valid: false,
          errors: [{ path: 'name', message: 'required', severity: 'error' }],
          warnings: [],
        };
        mockValidator.validateFile.mockResolvedValue(mockResult);

        await specValidate({ file: 'test.yml' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验证失败'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('错误'));
      });

      it('应该显示警告', async () => {
        const mockResult: SpecValidationResult = {
          file: 'test.yml',
          type: 'custom',
          valid: true,
          errors: [],
          warnings: [{ path: 'version', message: 'deprecated', severity: 'warning' }],
        };
        mockValidator.validateFile.mockResolvedValue(mockResult);

        await specValidate({ file: 'test.yml' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('警告'));
      });

      it('应该显示详细指标', async () => {
        const mockResult: SpecValidationResult = {
          file: 'test.yml',
          type: 'custom',
          valid: true,
          errors: [],
          warnings: [],
          metrics: { lines: 100, sections: 5 },
        };
        mockValidator.validateFile.mockResolvedValue(mockResult);

        await specValidate({ file: 'test.yml', verbose: true });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指标'));
      });
    });

    describe('批量验证', () => {
      it('应该验证所有 Spec 文件', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 5,
          passed: 5,
          failed: 0,
          warnings: 0,
          results: [],
        };
        mockValidateAllSpecs.mockResolvedValue(mockResult);

        await specValidate({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('所有 Spec 文件验证通过'));
      });

      it('应该显示失败统计', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 5,
          passed: 3,
          failed: 2,
          warnings: 1,
          results: [
            { file: 'fail1.yml', type: 'custom', valid: false, errors: [{ path: 'x', message: 'err', severity: 'error' }], warnings: [] },
          ],
        };
        mockValidateAllSpecs.mockResolvedValue(mockResult);

        await specValidate({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('失败: 2'));
      });

      it('应该处理无 Spec 文件情况', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 0,
          passed: 0,
          failed: 0,
          warnings: 0,
          results: [],
        };
        mockValidateAllSpecs.mockResolvedValue(mockResult);

        await specValidate({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有找到 Spec 文件'));
      });

      it('应该设置退出码当有失败', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 2,
          passed: 1,
          failed: 1,
          warnings: 0,
          results: [],
        };
        mockValidateAllSpecs.mockResolvedValue(mockResult);

        await specValidate({});
        expect(process.exitCode).toBe(1);
      });
    });

    describe('Schema 配置', () => {
      it('应该设置自定义 Schema 路径', async () => {
        mockValidateAllSpecs.mockResolvedValue({
          total: 0, passed: 0, failed: 0, warnings: 0, results: [],
        });

        await specValidate({ schema: 'custom-schema.ts' });
        expect(mockValidator.setConfig).toHaveBeenCalled();
      });
    });
  });

  describe('listSpecTypes', () => {
    it('应该列出支持的 Spec 类型', () => {
      listSpecTypes();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('支持的 Spec 类型'));
    });
  });
});
