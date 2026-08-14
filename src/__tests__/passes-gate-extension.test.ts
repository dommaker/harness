/**
 * PassesGate 扩展点测试
 * 
 * 注意：不调用真实的 runAllTests()，只测试扩展注册/注销逻辑
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { PassesGate, createPassesGate } from '../core/validators/passes-gate';
import type { PassesGateExtension } from '../types/passes-gate';

describe('PassesGate Extension', () => {
  let passesGate: PassesGate;
  
  beforeEach(() => {
    passesGate = createPassesGate({ enabled: true });
  });
  
  describe('registerExtension', () => {
    
    it('应能注册扩展', () => {
      const mockExtension: PassesGateExtension = {
        name: 'mock',
        run: async () => ({
          passed: true,
          command: 'mock-test',
        }),
      };
      
      passesGate.registerExtension('mock', mockExtension);
      
      const names = passesGate.getExtensionNames();
      expect(names).toContain('mock');
    });
    
    it('应能注册多个扩展', () => {
      const ext1: PassesGateExtension = {
        name: 'puppeteer',
        run: async () => ({ passed: true, command: 'puppeteer' }),
      };
      const ext2: PassesGateExtension = {
        name: 'playwright',
        run: async () => ({ passed: true, command: 'playwright' }),
      };
      
      passesGate.registerExtension('puppeteer', ext1);
      passesGate.registerExtension('playwright', ext2);
      
      const names = passesGate.getExtensionNames();
      expect(names).toContain('puppeteer');
      expect(names).toContain('playwright');
      expect(names.length).toBe(2);
    });
    
    it('应能注销扩展', () => {
      const mockExtension: PassesGateExtension = {
        name: 'mock',
        run: async () => ({
          passed: true,
          command: 'mock-test',
        }),
      };
      
      passesGate.registerExtension('mock', mockExtension);
      expect(passesGate.getExtensionNames()).toContain('mock');
      
      const result = passesGate.unregisterExtension('mock');
      expect(result).toBe(true);
      expect(passesGate.getExtensionNames()).not.toContain('mock');
    });
    
    it('注销不存在的扩展应返回 false', () => {
      const result = passesGate.unregisterExtension('nonexistent');
      expect(result).toBe(false);
    });
  });
  
  describe('getExtensionNames', () => {
    
    it('初始应返回空数组', () => {
      const names = passesGate.getExtensionNames();
      expect(names).toEqual([]);
    });
    
    it('注册后应返回扩展名称列表', () => {
      const ext: PassesGateExtension = {
        name: 'test',
        run: async () => ({ passed: true, command: 'test' }),
      };
      
      passesGate.registerExtension('test', ext);
      
      const names = passesGate.getExtensionNames();
      expect(names).toEqual(['test']);
    });
  });
  
  describe('PassesGateExtension 接口', () => {
    
    it('扩展应包含必要的字段', () => {
      const extension: PassesGateExtension = {
        name: 'puppeteer',
        description: 'Puppeteer E2E tests',
        run: async (_workDir) => ({
          passed: true,
          command: 'puppeteer',
          output: 'E2E passed',
          timestamp: new Date(),
        }),
      };
      
      expect(extension.name).toBe('puppeteer');
      expect(extension.description).toBe('Puppeteer E2E tests');
      expect(typeof extension.run).toBe('function');
    });
    
    it('扩展 run 方法应返回 TaskTestResult', async () => {
      const extension: PassesGateExtension = {
        name: 'mock',
        run: async (_workDir, _task) => {
          // 模拟测试运行
          return {
            passed: true,
            command: 'mock-command',
            output: 'Test output',
            duration: 100,
            timestamp: new Date(),
          };
        },
      };
      
      const result = await extension.run('/tmp', undefined);
      
      expect(result.passed).toBe(true);
      expect(result.command).toBe('mock-command');
      expect(result.output).toBe('Test output');
    });
  });
  
  describe('扩展类型检查', () => {
    
    it('ExtensionTestResult 应包含 type 字段', () => {
      const result: any = {
        passed: true,
        command: 'test',
        type: 'puppeteer',
      };
      
      expect(result.type).toBe('puppeteer');
    });
  });
});