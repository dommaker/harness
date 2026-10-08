/**
 * SessionManager 测试
 */

import { SessionManager } from '../session-manager';
import * as fs from 'fs';

jest.mock('fs', () => {
  // jsonl 有界读链的四件替身随夹具带上（readJsonl 的 head/tail 分支需要）；
  // 内容仍由下面按路径分派的 readFileSync 提供，两条读入口同源（夹具说明见其文件头）
  const { jsonlBoundedReadChain } = require('../../test-setup/jsonl-fake-fs');
  const readFileSync = jest.fn().mockReturnValue('');
  return {
    mkdirSync: jest.fn(),
    appendFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync,
    readdirSync: jest.fn().mockReturnValue([]),
    writeFileSync: jest.fn(),
    statSync: jest.fn().mockReturnValue({
      birthtime: new Date(),
      mtime: new Date(),
    }),
    ...jsonlBoundedReadChain((p: string) => readFileSync(p, 'utf-8')),
  };
});

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

  describe('getSessionInfo', () => {
    it('应该抛出当会话不存在', () => {
      expect(() => {
        manager.getSessionInfo('nonexistent');
      }).toThrow('不存在');
    });

    it('应该返回已存在的会话信息', () => {
      manager.createSession('info-test');
      const info = manager.getSessionInfo('info-test');
      expect(info.id).toBe('info-test');
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

  describe('loadSession (disk loading via getSession)', () => {
    it('loads session from disk when events.jsonl exists', () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('events.jsonl')) return true;
        return false;
      });
      (mockFs.readFileSync as jest.Mock).mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('events.jsonl')) {
          return JSON.stringify({ type: 'user_message', id: '1', content: 'hello', timestamp: 't1' }) + '\n';
        }
        return '';
      });

      const handle = manager.getSession('disk-loaded');
      expect(handle).toBeDefined();
      expect(handle!.events).toHaveLength(1);
      expect(handle!.events[0].content).toBe('hello');
    });
  });

});
