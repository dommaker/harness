/**
 * SessionStartup 测试
 */

import { SessionStartup } from '../startup';
import { exec } from 'child_process';
import * as fs from 'fs/promises';

// Mock dependencies
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;
const mockFs = fs as jest.Mocked<typeof fs>;

describe('SessionStartup', () => {
  let startup: SessionStartup;

  beforeEach(() => {
    jest.clearAllMocks();
    startup = new SessionStartup('/test/project', {
      required: ['pwd'],
      optional: [],
    });
  });

  describe('constructor', () => {
    it('should accept workDir and checkpoints', () => {
      expect(startup).toBeDefined();
    });
  });

  describe('run()', () => {
    it('should run required checkpoints', async () => {
      const result = await startup.run();

      expect(result.results.length).toBe(1);
      expect(result.results[0].type).toBe('pwd');
    });

    it('should return success when all required pass', async () => {
      const result = await startup.run();

      expect(result.success).toBe(true);
    });

    it('should run optional checkpoints', async () => {
      const s = new SessionStartup('/test', {
        required: ['pwd'],
        optional: ['git_status'],
      });

      mockExec.mockImplementation((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const result = await s.run();

      expect(result.results.length).toBe(2);
    });
  });

  describe('checkpoints', () => {
    describe('pwd', () => {
      it('should return workDir', async () => {
        const s = new SessionStartup('/my/project', {
          required: ['pwd'],
          optional: [],
        });

        const result = await s.run();

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].data).toBe('/my/project');
      });
    });

    describe('git_log', () => {
      it('should check git log', async () => {
        const s = new SessionStartup('/test', {
          required: ['git_log'],
          optional: [],
        });

        mockExec.mockImplementation((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Initial commit', stderr: '' });
        });

        const result = await s.run();

        expect(result.results[0].success).toBe(true);
      });
    });

    describe('git_status', () => {
      it('should check git status', async () => {
        const s = new SessionStartup('/test', {
          required: ['git_status'],
          optional: [],
        });

        mockExec.mockImplementation((cmd, opts, callback) => {
          if (cmd.includes('git status')) {
            callback(null, { stdout: 'On branch main\nnothing to commit', stderr: '' });
          } else {
            callback(null, { stdout: '', stderr: '' });
          }
        });

        const result = await s.run();

        expect(result.results[0].success).toBe(true);
      });
    });

    describe('read_progress', () => {
      it('should read progress file', async () => {
        const s = new SessionStartup('/test', {
          required: ['read_progress'],
          optional: [],
        });

        mockFs.readFile.mockResolvedValueOnce('# Progress\n- Task 1 done');

        const result = await s.run();

        expect(result.results[0].success).toBe(true);
      });

      it('should return null for missing file', async () => {
        const s = new SessionStartup('/test', {
          required: ['read_progress'],
          optional: [],
        });

        mockFs.readFile.mockRejectedValueOnce(new Error('Not found'));

        const result = await s.run();

        // read_progress returns null on error, but doesn't fail
        expect(result.results[0].success).toBe(true);
        expect(result.results[0].data).toBeNull();
      });
    });

    describe('read_task_list', () => {
      it('should read task list', async () => {
        const s = new SessionStartup('/test', {
          required: ['read_task_list'],
          optional: [],
        });

        mockFs.access.mockResolvedValueOnce(undefined);
        mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ tasks: [] }));

        const result = await s.run();

        expect(result.results[0].success).toBe(true);
      });
    });
  });
});