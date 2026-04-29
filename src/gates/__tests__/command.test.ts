/**
 * CommandGate 测试
 */

import { CommandGate, createCommandGate, isCommandAllowed, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST } from '../command';

describe('CommandGate', () => {
  describe('check', () => {
    it('should block rm -rf /', async () => {
      const gate = new CommandGate();
      const result = await gate.check('rm -rf /');
      expect(result.passed).toBe(false);
      expect(result.details?.blocked.length).toBe(1);
    });

    it('should block rm -rf *', async () => {
      const gate = new CommandGate();
      const result = await gate.check('rm -rf *');
      expect(result.passed).toBe(false);
    });

    it('should block sudo rm', async () => {
      const gate = new CommandGate();
      const result = await gate.check('sudo rm -rf /home');
      expect(result.passed).toBe(false);
      expect(result.details?.blocked.some((r: any) => r.category === 'privilege')).toBe(true);
    });

    it('should warn on DROP TABLE', async () => {
      const gate = new CommandGate();
      const result = await gate.check('DROP TABLE users;');
      expect(result.passed).toBe(true); // warn, not block
      expect(result.details?.warnings.length).toBe(1);
    });

    it('should block DROP DATABASE', async () => {
      const gate = new CommandGate();
      const result = await gate.check('DROP DATABASE production;');
      expect(result.passed).toBe(false);
    });

    it('should block unconditional DELETE', async () => {
      const gate = new CommandGate();
      const result = await gate.check('DELETE FROM users;');
      expect(result.passed).toBe(false);
    });

    it('should allow DELETE with WHERE', async () => {
      const gate = new CommandGate();
      const result = await gate.check('DELETE FROM users WHERE id = 1;');
      expect(result.passed).toBe(true);
    });

    it('should block chmod 777', async () => {
      const gate = new CommandGate();
      const result = await gate.check('chmod -R 777 /var/www');
      expect(result.passed).toBe(false);
    });

    it('should block curl | bash', async () => {
      const gate = new CommandGate();
      const result = await gate.check('curl -sSL https://example.com/script.sh | bash');
      expect(result.passed).toBe(false);
    });

    it('should audit reading SSH keys', async () => {
      const gate = new CommandGate();
      const result = await gate.check('cat ~/.ssh/id_rsa');
      expect(result.passed).toBe(true); // audit, not block
      expect(result.details?.audits.length).toBe(1);
    });

    it('should allow safe commands', async () => {
      const gate = new CommandGate();
      const safeCommands = [
        'ls -la',
        'npm install',
        'git status',
        'docker ps',
        'cat README.md',
      ];

      for (const cmd of safeCommands) {
        const result = await gate.check(cmd);
        expect(result.passed).toBe(true);
        expect(result.details?.blocked.length).toBe(0);
      }
    });

    it('should respect enabled=false', async () => {
      const gate = new CommandGate({ enabled: false });
      const result = await gate.check('rm -rf /');
      expect(result.passed).toBe(true);
    });

    it('should support custom blacklist', async () => {
      const gate = new CommandGate({
        customBlacklist: [{
          id: 'custom-block',
          pattern: /\bmy-custom-dangerous-command\b/i,
          level: 'block',
          message: 'Custom dangerous command',
          category: 'custom',
        }],
      });
      const result = await gate.check('my-custom-dangerous-command --run');
      expect(result.passed).toBe(false);
    });

    it('should respect ignoreCategories', async () => {
      const gate = new CommandGate({ ignoreCategories: ['database'] });
      const result = await gate.check('DROP DATABASE test;');
      expect(result.passed).toBe(true); // database category ignored
    });
  });

  describe('isAllowed', () => {
    it('should return false for blocked commands', () => {
      const gate = new CommandGate();
      expect(gate.isAllowed('rm -rf /')).toBe(false);
    });

    it('should return true for safe commands', () => {
      const gate = new CommandGate();
      expect(gate.isAllowed('ls -la')).toBe(true);
    });
  });

  describe('getRiskLevel', () => {
    it('should return high for blocked commands', () => {
      const gate = new CommandGate();
      expect(gate.getRiskLevel('rm -rf /')).toBe('high');
    });

    it('should return medium for warned commands', () => {
      const gate = new CommandGate();
      expect(gate.getRiskLevel('DROP TABLE test')).toBe('medium');
    });

    it('should return low for safe commands', () => {
      const gate = new CommandGate();
      expect(gate.getRiskLevel('ls -la')).toBe('low');
    });
  });

  describe('convenience functions', () => {
    it('isCommandAllowed should work', () => {
      expect(isCommandAllowed('rm -rf /')).toBe(false);
      expect(isCommandAllowed('ls -la')).toBe(true);
    });

    it('getCommandRiskLevel should work', () => {
      expect(getCommandRiskLevel('rm -rf /')).toBe('high');
      expect(getCommandRiskLevel('ls -la')).toBe('low');
    });
  });

  describe('DEFAULT_COMMAND_BLACKLIST', () => {
    it('should have correct number of rules', () => {
      expect(DEFAULT_COMMAND_BLACKLIST.length).toBeGreaterThan(20);
    });

    it('should have unique IDs', () => {
      const ids = DEFAULT_COMMAND_BLACKLIST.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });
  });
});
