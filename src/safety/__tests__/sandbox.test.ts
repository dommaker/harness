/**
 * Sandbox 测试
 */

import { Sandbox } from '../sandbox';

describe('Sandbox', () => {
  describe('constructor', () => {
    it('应该使用默认 Level 3', () => {
      const sandbox = new Sandbox();
      expect(sandbox.getLevel()).toBe(3);
    });

    it('应该接受自定义级别', () => {
      const sandbox = new Sandbox({ level: 1 });
      expect(sandbox.getLevel()).toBe(1);
    });

    it('Level 4 应该默认需要确认', () => {
      const sandbox = new Sandbox({ level: 4 });
      expect(sandbox.needsConfirmation()).toBe(true);
    });
  });

  describe('check', () => {
    it('应该允许当前级别 >= 需要级别', () => {
      const sandbox = new Sandbox({ level: 3 });
      const result = sandbox.check(2);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('应该拒绝当前级别 < 需要级别', () => {
      const sandbox = new Sandbox({ level: 1 });
      const result = sandbox.check(3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Level 1');
      expect(result.reason).toContain('Level 3');
    });

    it('同级别应该允许', () => {
      const sandbox = new Sandbox({ level: 2 });
      const result = sandbox.check(2);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkFileWrite', () => {
    it('Level 1 应该禁止所有写入', () => {
      const sandbox = new Sandbox({ level: 1 });
      const result = sandbox.checkFileWrite('.harness/test.json');
      expect(result.allowed).toBe(false);
      expect(result.requiredLevel).toBe(2);
    });

    it('Level 2 应该允许写入限定目录', () => {
      const sandbox = new Sandbox({ level: 2, writableDirs: ['.harness/'] });
      const result = sandbox.checkFileWrite('.harness/knowledge/entry.md');
      expect(result.allowed).toBe(true);
    });

    it('Level 2 应该拒绝写入非限定目录', () => {
      const sandbox = new Sandbox({ level: 2, writableDirs: ['.harness/'] });
      const result = sandbox.checkFileWrite('src/index.ts');
      expect(result.allowed).toBe(false);
      expect(result.requiredLevel).toBe(3);
    });

    it('Level 3 应该允许所有写入', () => {
      const sandbox = new Sandbox({ level: 3 });
      const result = sandbox.checkFileWrite('src/index.ts');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkNetworkAccess', () => {
    it('Level 2 应该禁止网络访问', () => {
      const sandbox = new Sandbox({ level: 2 });
      const result = sandbox.checkNetworkAccess('example.com');
      expect(result.allowed).toBe(false);
    });

    it('Level 3 应该允许白名单内的 host', () => {
      const sandbox = new Sandbox({ level: 3, allowedHosts: ['registry.npmjs.org'] });
      const result = sandbox.checkNetworkAccess('registry.npmjs.org');
      expect(result.allowed).toBe(true);
    });

    it('Level 3 应该拒绝白名单外的 host', () => {
      const sandbox = new Sandbox({ level: 3, allowedHosts: ['registry.npmjs.org'] });
      const result = sandbox.checkNetworkAccess('evil.com');
      expect(result.allowed).toBe(false);
    });

    it('Level 4 应该允许所有网络访问', () => {
      const sandbox = new Sandbox({ level: 4 });
      const result = sandbox.checkNetworkAccess('any-host.com');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkShellAccess', () => {
    it('Level 1 应该禁止 shell', () => {
      const sandbox = new Sandbox({ level: 1 });
      const result = sandbox.checkShellAccess();
      expect(result.allowed).toBe(false);
    });

    it('Level 2 应该禁止 shell', () => {
      const sandbox = new Sandbox({ level: 2 });
      const result = sandbox.checkShellAccess();
      expect(result.allowed).toBe(false);
    });

    it('Level 3 应该允许 shell', () => {
      const sandbox = new Sandbox({ level: 3 });
      const result = sandbox.checkShellAccess();
      expect(result.allowed).toBe(true);
    });
  });

  describe('upgradeTo', () => {
    it('应该升级级别', () => {
      const sandbox = new Sandbox({ level: 1 });
      sandbox.upgradeTo(3);
      expect(sandbox.getLevel()).toBe(3);
    });

    it('升级到 Level 4 应该设置需要确认', () => {
      const sandbox = new Sandbox({ level: 2 });
      sandbox.upgradeTo(4);
      expect(sandbox.getLevel()).toBe(4);
      expect(sandbox.needsConfirmation()).toBe(true);
    });
  });

  describe('getDescription', () => {
    it('应该返回级别描述', () => {
      const sandbox = new Sandbox({ level: 1 });
      expect(sandbox.getDescription()).toContain('只读');

      const sandbox3 = new Sandbox({ level: 3 });
      expect(sandbox3.getDescription()).toContain('项目目录');
    });
  });

  describe('getConfig', () => {
    it('应该返回配置副本', () => {
      const sandbox = new Sandbox({ level: 2, writableDirs: ['.harness/'] });
      const config = sandbox.getConfig();
      expect(config.level).toBe(2);
      expect(config.writableDirs).toEqual(['.harness/']);
      // 应该是副本，修改不影响原配置
      config.level = 4;
      expect(sandbox.getLevel()).toBe(2);
    });
  });
});
