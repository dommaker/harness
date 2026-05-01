/**
 * SessionManager 测试
 */

import { SessionManager } from '../session-manager';
import * as fs from 'fs';

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  readdirSync: jest.fn().mockReturnValue([]),
  writeFileSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SessionManager('/test');
  });

  describe('createSession', () => {
    it('应该创建会话', () => {
      const handle = manager.createSession('session-1');
      expect(handle.id).toBe('session-1');
      expect(handle.events).toEqual([]);
      expect(handle.createdAt).toBeDefined();
    });

    it('应该创建会话目录', () => {
      manager.createSession('session-1');
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('appendToSession', () => {
    it('应该追加事件', () => {
      manager.createSession('session-1');
      manager.appendToSession('session-1', {
        type: 'user_message',
        id: 'evt-1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      });

      const handle = manager.getSession('session-1');
      expect(handle!.events.length).toBe(1);
      expect(handle!.events[0].content).toBe('hello');
    });

    it('应该持久化事件到 JSONL', () => {
      manager.createSession('session-1');
      manager.appendToSession('session-1', {
        type: 'user_message',
        id: 'evt-1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      });

      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });

    it('应该抛出当会话不存在', () => {
      expect(() => {
        manager.appendToSession('nonexistent', {
          type: 'user_message',
          id: 'evt-1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        });
      }).toThrow('不存在');
    });
  });

  describe('getWindowView', () => {
    it('应该生成窗口视图', () => {
      manager.createSession('session-1');
      manager.appendToSession('session-1', {
        type: 'system',
        id: 'sys-1',
        content: 'You are helpful.',
        timestamp: 't1',
      });
      manager.appendToSession('session-1', {
        type: 'user_message',
        id: 'msg-1',
        content: 'Hello',
        timestamp: 't2',
      });

      const output = manager.getWindowView('session-1', {
        total: 8000,
        systemPrompt: 1000,
        toolDefinitions: 500,
        knowledge: 600,
        notes: 300,
        history: 5600,
      });

      expect(output.prompt).toContain('You are helpful.');
      expect(output.prompt).toContain('Hello');
      expect(output.snapshot).toBeDefined();
    });

    it('应该抛出当会话不存在', () => {
      expect(() => {
        manager.getWindowView('nonexistent', {
          total: 8000,
          systemPrompt: 1000,
          toolDefinitions: 500,
          knowledge: 600,
          notes: 300,
          history: 5600,
        });
      }).toThrow('不存在');
    });
  });

  describe('checkpointSession', () => {
    it('应该生成 checkpoint', () => {
      manager.createSession('session-1');
      manager.appendToSession('session-1', {
        type: 'user_message',
        id: 'msg-1',
        content: 'hello',
        timestamp: 't1',
      });

      const checkpoint = manager.checkpointSession('session-1');
      expect(checkpoint.id).toContain('cp-');
      expect(checkpoint.sessionId).toBe('session-1');
      expect(checkpoint.eventCount).toBe(1);
      expect(checkpoint.summary).toContain('1');
    });

    it('应该持久化 checkpoint', () => {
      manager.createSession('session-1');
      manager.checkpointSession('session-1');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('应该抛出当会话不存在', () => {
      expect(() => {
        manager.checkpointSession('nonexistent');
      }).toThrow('不存在');
    });
  });

  describe('restoreSession', () => {
    it('应该从 checkpoint 恢复会话', () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('checkpoints')) return true;
        if (p.includes('events.jsonl')) return true;
        return false;
      });
      (mockFs.readdirSync as jest.Mock).mockReturnValue(['session-1']);
      (mockFs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('checkpoint')) {
          return JSON.stringify({
            id: 'cp-123',
            sessionId: 'session-1',
            timestamp: 't1',
            eventCount: 2,
            summary: 'test',
          });
        }
        if (p.includes('events.jsonl')) {
          return JSON.stringify({ type: 'user_message', id: '1', content: 'a', timestamp: 't1' }) + '\n' +
                 JSON.stringify({ type: 'assistant_message', id: '2', content: 'b', timestamp: 't2' });
        }
        return '';
      });

      const handle = manager.restoreSession('cp-123');
      expect(handle.id).toBe('session-1');
      expect(handle.events.length).toBe(2);
    });

    it('应该抛出当 checkpoint 不存在', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([]);

      expect(() => {
        manager.restoreSession('nonexistent');
      }).toThrow('不存在');
    });
  });

  describe('getSession', () => {
    it('应该返回会话', () => {
      manager.createSession('session-1');
      const handle = manager.getSession('session-1');
      expect(handle).toBeDefined();
      expect(handle!.id).toBe('session-1');
    });

    it('应该返回 undefined 当会话不存在', () => {
      const handle = manager.getSession('nonexistent');
      expect(handle).toBeUndefined();
    });
  });

  describe('getTracker', () => {
    it('应该返回 tracker', () => {
      const tracker = manager.getTracker();
      expect(tracker).toBeDefined();
    });
  });
});
