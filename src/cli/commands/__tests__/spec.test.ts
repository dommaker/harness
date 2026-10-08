/**
 * spec 命令测试
 */

import { specValidate, listSpecTypes } from '../spec';
import { captureIO, type CapturingIO } from '../../command-contract';
import { SpecValidator } from '../spec/validator';
import type { BatchSpecValidationResult, SpecValidationResult } from '../../../types/spec';

// Mock SpecValidator
jest.mock('../spec/validator', () => ({
  SpecValidator: jest.fn(),
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

const MockSpecValidator = SpecValidator as unknown as jest.Mock;

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('spec command', () => {
  let mockValidator: {
    validateFile: jest.Mock;
    validateAll: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockValidator = {
      validateFile: jest.fn(),
      validateAll: jest.fn(),
    };
    MockSpecValidator.mockImplementation(() => mockValidator);
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

        await specValidate({ file: 'test.yml' }, io);
        expect(io.outText()).toContain('验证通过');
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

        const result = await specValidate({ file: 'test.yml' }, io);
        expect(io.outText()).toContain('验证失败');
        expect(io.outText()).toContain('错误');
        expect(result).toEqual({ kind: 'fail', reason: 'Spec 文件验证失败: test.yml' });
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

        await specValidate({ file: 'test.yml' }, io);
        expect(io.outText()).toContain('警告');
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

        await specValidate({ file: 'test.yml', verbose: true }, io);
        expect(io.outText()).toContain('指标');
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
        mockValidator.validateAll.mockResolvedValue(mockResult);

        await specValidate({}, io);
        expect(io.outText()).toContain('所有 Spec 文件验证通过');
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
        mockValidator.validateAll.mockResolvedValue(mockResult);

        await specValidate({}, io);
        expect(io.outText()).toContain('失败: 2');
      });

      it('应该处理无 Spec 文件情况', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 0,
          passed: 0,
          failed: 0,
          warnings: 0,
          results: [],
        };
        mockValidator.validateAll.mockResolvedValue(mockResult);

        await specValidate({}, io);
        expect(io.outText()).toContain('没有找到 Spec 文件');
      });

      it('批量验证有失败：fail + 失败数原因', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 2,
          passed: 1,
          failed: 1,
          warnings: 0,
          results: [],
        };
        mockValidator.validateAll.mockResolvedValue(mockResult);

        const result = await specValidate({}, io);
        expect(result).toEqual({ kind: 'fail', reason: '1 个 Spec 文件验证失败' });
      });

      it('--staged 有失败：fail（与非 staged 同口径，staged 不再是免 fail 通道）', async () => {
        const mockResult: BatchSpecValidationResult = {
          total: 2,
          passed: 1,
          failed: 1,
          warnings: 0,
          results: [],
        };
        mockValidator.validateAll.mockResolvedValue(mockResult);

        const result = await specValidate({ staged: true }, io);
        expect(result).toEqual({ kind: 'fail', reason: '1 个 Spec 文件验证失败' });
      });
    });

    describe('Schema 配置', () => {
      it('自定义 Schema 路径在组合根锚定到项目根（不按进程 cwd）', async () => {
        mockValidator.validateAll.mockResolvedValue({
          total: 0, passed: 0, failed: 0, warnings: 0, results: [],
        });

        await specValidate({ schema: 'custom-schema.ts', projectPath: '/proj' }, io);
        expect(MockSpecValidator).toHaveBeenCalledWith({
          schemaPath: '/proj/custom-schema.ts',
        });
      });

      it('缺省 Schema 路径同样锚定项目根', async () => {
        mockValidator.validateAll.mockResolvedValue({
          total: 0, passed: 0, failed: 0, warnings: 0, results: [],
        });

        await specValidate({ projectPath: '/proj' }, io);
        expect(MockSpecValidator).toHaveBeenCalledWith({
          schemaPath: '/proj/specs/schemas',
        });
      });
    });
  });

  describe('listSpecTypes', () => {
    it('应该列出支持的 Spec 类型', () => {
      listSpecTypes({}, io);
      expect(io.outText()).toContain('支持的 Spec 类型');
    });
  });
});
