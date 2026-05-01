import { CORE_TOOLS, FILE_TOOLS, GIT_TOOLS, NPM_TOOLS, SHELL_TOOLS } from '../index';

describe('CORE_TOOLS', () => {
  describe('FILE_TOOLS', () => {
    it('包含 4 个文件工具', () => {
      expect(FILE_TOOLS).toHaveLength(4);
    });

    it('包含 read_file', () => {
      const tool = FILE_TOOLS.find(t => t.id === 'read_file');
      expect(tool).toBeDefined();
      expect(tool!.sandboxLevel).toBe(1);
      expect(tool!.parameters.required).toContain('path');
    });

    it('包含 write_file', () => {
      const tool = FILE_TOOLS.find(t => t.id === 'write_file');
      expect(tool).toBeDefined();
      expect(tool!.sandboxLevel).toBe(3);
      expect(tool!.parameters.required).toContain('path');
      expect(tool!.parameters.required).toContain('content');
    });

    it('包含 edit_file', () => {
      const tool = FILE_TOOLS.find(t => t.id === 'edit_file');
      expect(tool).toBeDefined();
      expect(tool!.sandboxLevel).toBe(3);
    });

    it('包含 list_directory', () => {
      const tool = FILE_TOOLS.find(t => t.id === 'list_directory');
      expect(tool).toBeDefined();
      expect(tool!.sandboxLevel).toBe(1);
    });
  });

  describe('GIT_TOOLS', () => {
    it('包含 4 个 git 工具', () => {
      expect(GIT_TOOLS).toHaveLength(4);
    });

    it('git_commit 需要确认', () => {
      const tool = GIT_TOOLS.find(t => t.id === 'git_commit');
      expect(tool).toBeDefined();
      expect(tool!.requiresConfirmation).toBe(true);
      expect(tool!.sandboxLevel).toBe(3);
    });

    it('只读 git 工具 sandbox level 1', () => {
      const status = GIT_TOOLS.find(t => t.id === 'git_status');
      const diff = GIT_TOOLS.find(t => t.id === 'git_diff');
      const log = GIT_TOOLS.find(t => t.id === 'git_log');
      expect(status!.sandboxLevel).toBe(1);
      expect(diff!.sandboxLevel).toBe(1);
      expect(log!.sandboxLevel).toBe(1);
    });
  });

  describe('NPM_TOOLS', () => {
    it('包含 3 个 npm 工具', () => {
      expect(NPM_TOOLS).toHaveLength(3);
    });

    it('npm_install 有速率限制', () => {
      const tool = NPM_TOOLS.find(t => t.id === 'npm_install');
      expect(tool).toBeDefined();
      expect(tool!.rateLimit).toBe(10);
    });

    it('npm_test 有 sandbox level 3', () => {
      const tool = NPM_TOOLS.find(t => t.id === 'npm_test');
      expect(tool).toBeDefined();
      expect(tool!.sandboxLevel).toBe(3);
    });
  });

  describe('SHELL_TOOLS', () => {
    it('包含 1 个 shell 工具', () => {
      expect(SHELL_TOOLS).toHaveLength(1);
    });

    it('shell_exec 有速率限制', () => {
      const tool = SHELL_TOOLS[0];
      expect(tool.id).toBe('shell_exec');
      expect(tool.rateLimit).toBe(30);
      expect(tool.sandboxLevel).toBe(3);
    });
  });

  describe('CORE_TOOLS 汇总', () => {
    it('包含所有子工具', () => {
      expect(CORE_TOOLS).toHaveLength(FILE_TOOLS.length + GIT_TOOLS.length + NPM_TOOLS.length + SHELL_TOOLS.length);
    });

    it('所有工具都有 category: core', () => {
      for (const tool of CORE_TOOLS) {
        expect(tool.category).toBe('core');
      }
    });

    it('所有工具都有 id、name、description', () => {
      for (const tool of CORE_TOOLS) {
        expect(tool.id).toBeTruthy();
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
      }
    });

    it('所有工具都有 parameters', () => {
      for (const tool of CORE_TOOLS) {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      }
    });

    it('所有工具都有 sandboxLevel', () => {
      for (const tool of CORE_TOOLS) {
        expect([1, 2, 3, 4]).toContain(tool.sandboxLevel);
      }
    });
  });
});
