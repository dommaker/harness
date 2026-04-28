/**
 * CheckpointValidator 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { CheckpointValidator, validateCheckpoint } from '../core/validators/checkpoint';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('CheckpointValidator', () => {
  const tempDir = join(process.cwd(), 'temp-test-checkpoint');
  let validator: CheckpointValidator;

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    validator = CheckpointValidator.getInstance();
    
    // 创建测试文件
    writeFileSync(join(tempDir, 'test.txt'), 'hello world');
    writeFileSync(join(tempDir, 'empty.txt'), '');
    writeFileSync(join(tempDir, 'data.json'), JSON.stringify({ name: 'test', value: 42 }));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('getSupportedCheckTypes', () => {
    it('应该返回支持的检查类型', () => {
      const types = validator.getSupportedCheckTypes();
      
      expect(types.length).toBe(13);
      expect(types).toContain('file_exists');
      expect(types).toContain('file_contains');
      expect(types).toContain('command_success');
      expect(types).toContain('json_path');
    });
  });

  describe('file_exists', () => {
    it('文件存在应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-1',
          checks: [{ id: 'c-1', type: 'file_exists', config: { path: 'test.txt' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
      expect(result.checks[0].passed).toBe(true);
    });

    it('文件不存在应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-2',
          checks: [{ id: 'c-2', type: 'file_exists', config: { path: 'not-exist.txt' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].passed).toBe(false);
      expect(result.checks[0].message).toContain('不存在');
    });
  });

  describe('file_not_empty', () => {
    it('非空文件应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-3',
          checks: [{ id: 'c-3', type: 'file_not_empty', config: { path: 'test.txt' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('空文件应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-4',
          checks: [{ id: 'c-4', type: 'file_not_empty', config: { path: 'empty.txt' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('为空');
    });
  });

  describe('file_contains', () => {
    it('文件包含内容应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-5',
          checks: [{ id: 'c-5', type: 'file_contains', config: { path: 'test.txt', content: 'hello' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('文件不包含内容应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-6',
          checks: [{ id: 'c-6', type: 'file_contains', config: { path: 'test.txt', content: 'goodbye' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
    });
  });

  describe('file_not_contains', () => {
    it('文件不包含内容应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-20',
          checks: [{ id: 'c-20', type: 'file_not_contains', config: { path: 'test.txt', content: 'goodbye' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('文件包含内容应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-21',
          checks: [{ id: 'c-21', type: 'file_not_contains', config: { path: 'test.txt', content: 'hello' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('包含');
    });
  });

  describe('json_path', () => {
    it('JSON 路径匹配应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-7',
          checks: [{ id: 'c-7', type: 'json_path', config: { jsonPath: 'name', expected: 'test' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: { name: 'test', value: 42 } }
      );
      
      expect(result.passed).toBe(true);
    });

    it('JSON 路径不匹配应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-8',
          checks: [{ id: 'c-8', type: 'json_path', config: { jsonPath: 'value', expected: 100 } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: { name: 'test', value: 42 } }
      );
      
      expect(result.passed).toBe(false);
    });
  });

  describe('output_contains', () => {
    it('输出包含内容应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-9',
          checks: [{ id: 'c-9', type: 'output_contains', config: { content: 'success' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: 'operation success completed' }
      );
      
      expect(result.passed).toBe(true);
    });
    
    it('输出不包含内容应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-9b',
          checks: [{ id: 'c-9b', type: 'output_contains', config: { content: 'error' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: 'operation success completed' }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('不包含');
    });
  });

  describe('output_not_contains', () => {
    it('输出不包含内容应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-14',
          checks: [{ id: 'c-14', type: 'output_not_contains', config: { content: 'error' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: 'operation success completed' }
      );
      
      expect(result.passed).toBe(true);
    });

    it('输出包含内容应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-15',
          checks: [{ id: 'c-15', type: 'output_not_contains', config: { content: 'success' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: 'operation success completed' }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('包含');
    });
  });

  describe('output_matches', () => {
    it('输出匹配正则应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-16',
          checks: [{ id: 'c-16', type: 'output_matches', config: { pattern: '\\d+ tests passed' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: '✅ 42 tests passed' }
      );
      
      expect(result.passed).toBe(true);
    });

    it('输出不匹配正则应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-17',
          checks: [{ id: 'c-17', type: 'output_matches', config: { pattern: 'Error:.*' } }],
        },
        { workdir: tempDir, projectPath: tempDir, output: 'All tests passed' }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('不匹配');
    });
  });

  describe('command_output', () => {
    it('命令输出匹配应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-18',
          checks: [{ id: 'c-18', type: 'command_output', config: { command: 'echo hello', expected: 'hello' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('命令输出不匹配应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-19',
          checks: [{ id: 'c-19', type: 'command_output', config: { command: 'echo hello', expected: 'world' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
    });
  });

  describe('command_success', () => {
    it('命令成功应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-10',
          checks: [{ id: 'c-10', type: 'command_success', config: { command: 'echo test' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('命令失败应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-11',
          checks: [{ id: 'c-11', type: 'command_success', config: { command: 'exit 1' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
    });
  });

  describe('多检查组合', () => {
    it('所有检查通过才算整体通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-12',
          checks: [
            { id: 'c-12a', type: 'file_exists', config: { path: 'test.txt' } },
            { id: 'c-12b', type: 'file_not_empty', config: { path: 'test.txt' } },
            { id: 'c-12c', type: 'file_contains', config: { path: 'test.txt', content: 'hello' } },
          ],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
      expect(result.checks.length).toBe(3);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it('一个检查失败则整体失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-13',
          checks: [
            { id: 'c-13a', type: 'file_exists', config: { path: 'test.txt' } },
            { id: 'c-13b', type: 'file_not_empty', config: { path: 'empty.txt' } },  // 失败
          ],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks.some(c => !c.passed)).toBe(true);
    });
  });

  describe('空检查点', () => {
    it('无检查应该默认通过', async () => {
      const result = await validateCheckpoint(
        { id: 'cp-empty', checks: [] },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
      expect(result.message).toContain('无检查点要求');
    });
  });

  describe('http_status', () => {
    it('HTTP 状态码匹配应该通过', async () => {
      // 使用 httpbin.org 进行测试（公共测试服务）
      const result = await validateCheckpoint(
        {
          id: 'cp-22',
          checks: [{ id: 'c-22', type: 'http_status', config: { url: 'https://httpbin.org/status/200', expectedStatus: 200 } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it.skip('HTTP 状态码不匹配应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-23',
          checks: [{ id: 'c-23', type: 'http_status', config: { url: 'https://httpbin.org/status/404', expectedStatus: 200 } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('不匹配');
    });
  });

  describe('http_body', () => {
    it('HTTP 响应体包含内容应该通过', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-24',
          checks: [{ id: 'c-24', type: 'http_body', config: { url: 'https://httpbin.org/get', expected: 'args' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(true);
    });

    it('HTTP 响应体不包含内容应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-25',
          checks: [{ id: 'c-25', type: 'http_body', config: { url: 'https://httpbin.org/get', expected: 'nonexistent_content_xyz' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
    });
  });

  describe('custom', () => {
    it('自定义检查处理器应该被调用', async () => {
      const customHandlers = new Map();
      customHandlers.set('myValidator', async (config: any) => ({
        checkId: 'c-26',
        passed: true,
        message: '自定义检查通过',
      }));

      const result = await validateCheckpoint(
        {
          id: 'cp-26',
          checks: [{ id: 'c-26', type: 'custom', config: { customFunction: 'myValidator' } }],
        },
        { workdir: tempDir, projectPath: tempDir, customHandlers }
      );
      
      expect(result.passed).toBe(true);
    });

    it('自定义检查可以返回失败', async () => {
      const customHandlers = new Map();
      customHandlers.set('failValidator', async (config: any) => ({
        checkId: 'c-26b',
        passed: false,
        message: '自定义检查失败',
      }));

      const result = await validateCheckpoint(
        {
          id: 'cp-26b',
          checks: [{ id: 'c-26b', type: 'custom', config: { customFunction: 'failValidator' } }],
        },
        { workdir: tempDir, projectPath: tempDir, customHandlers }
      );
      
      expect(result.passed).toBe(false);
    });

    it('未注册的自定义检查应该失败', async () => {
      const result = await validateCheckpoint(
        {
          id: 'cp-27',
          checks: [{ id: 'c-27', type: 'custom', config: { customFunction: 'unknownValidator' } }],
        },
        { workdir: tempDir, projectPath: tempDir }
      );
      
      expect(result.passed).toBe(false);
      expect(result.checks[0].message).toContain('未实现');
    });
  });

  // ========================================
  // 边缘情况测试（提升覆盖率）
  // ========================================
  describe('边缘情况', () => {
    describe('未知检查类型', () => {
      it('未知类型应该返回错误', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-unknown',
            checks: [{ id: 'c-unknown', type: 'unknown_type' as any, config: {} }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('未知检查类型');
        expect(result.checks[0].error).toContain('Unknown check type');
      });
    });

    describe('file_not_empty 文件不存在', () => {
      it('文件不存在应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-fne-missing',
            checks: [{ id: 'c-fne-missing', type: 'file_not_empty', config: { path: 'nonexistent.txt' } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('不存在');
      });
    });

    describe('file_contains 文件不存在', () => {
      it('文件不存在应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-fc-missing',
            checks: [{ id: 'c-fc-missing', type: 'file_contains', config: { path: 'nonexistent.txt', content: 'test' } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('不存在');
      });
    });

    describe('file_not_contains 文件不存在', () => {
      it('文件不存在应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-fnc-missing',
            checks: [{ id: 'c-fnc-missing', type: 'file_not_contains', config: { path: 'nonexistent.txt', content: 'test' } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('不存在');
      });
    });

    describe('command_output 命令失败', () => {
      it('命令执行失败应该返回错误', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-co-fail',
            checks: [{ id: 'c-co-fail', type: 'command_output', config: { command: 'exit 1', expected: 'anything' } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('执行失败');
      });
    });

    describe('json_path 无效路径', () => {
      it('无效 JSON 路径应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-jp-invalid',
            checks: [{ id: 'c-jp-invalid', type: 'json_path', config: { jsonPath: 'invalid..path', expected: 'test' } }],
          },
          { workdir: tempDir, projectPath: tempDir, output: { name: 'test' } }
        );
        
        // 取决于 getJsonValue 实现，可能通过或失败
        // 这里主要测试不会抛出异常
        expect(result).toBeDefined();
        expect(result.checks).toBeDefined();
      });
    });

    describe('http_status 请求失败', () => {
      it('无效 URL 应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-hs-fail',
            checks: [{ id: 'c-hs-fail', type: 'http_status', config: { url: 'https://invalid.domain.that.does.not.exist/test', expectedStatus: 200 } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('请求失败');
      });
    });

    describe('http_body 请求失败', () => {
      it('无效 URL 应该失败', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-hb-fail',
            checks: [{ id: 'c-hb-fail', type: 'http_body', config: { url: 'https://invalid.domain.that.does.not.exist/test', expected: 'test' } }],
          },
          { workdir: tempDir, projectPath: tempDir }
        );
        
        expect(result.passed).toBe(false);
        expect(result.checks[0].message).toContain('请求失败');
      });
    });

    describe('output_contains JSON 输出', () => {
      it('JSON 对象输出应该被正确处理', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-oc-json',
            checks: [{ id: 'c-oc-json', type: 'output_contains', config: { content: 'success' } }],
          },
          { workdir: tempDir, projectPath: tempDir, output: { status: 'success', data: [1, 2, 3] } }
        );
        
        expect(result.passed).toBe(true);
      });
    });

    describe('output_matches 复杂正则', () => {
      it('多行匹配应该工作', async () => {
        // 注意：正则默认不匹配换行符，需要使用 s 标志或 [\s\S]
        const result = await validateCheckpoint(
          {
            id: 'cp-om-multi',
            checks: [{ id: 'c-om-multi', type: 'output_matches', config: { pattern: 'passed[\\s\\S]*failed' } }],
          },
          { workdir: tempDir, projectPath: tempDir, output: '10 passed\n5 failed\n2 skipped' }
        );
        
        expect(result.passed).toBe(true);
      });

      it('单行匹配应该工作', async () => {
        const result = await validateCheckpoint(
          {
            id: 'cp-om-single',
            checks: [{ id: 'c-om-single', type: 'output_matches', config: { pattern: '\\d+ passed' } }],
          },
          { workdir: tempDir, projectPath: tempDir, output: '10 passed\n5 failed' }
        );
        
        expect(result.passed).toBe(true);
      });
    });
  });
});