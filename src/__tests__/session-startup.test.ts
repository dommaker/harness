/**
 * SessionStartup 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SessionStartup, createSessionStartup, DEFAULT_CODE_CHECKPOINTS, MINIMAL_CHECKPOINTS } from '../core/session/startup';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('SessionStartup', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-session');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('run', () => {
    it('应该运行 pwd 检查点', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].type).toBe('pwd');
    });

    it('应该运行 git_status 检查点', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['git_status'],
        optional: [],
      });

      const result = await startup.run();

      expect(result.results.length).toBe(1);
      expect(result.results[0].type).toBe('git_status');
    });

    it('可选检查点失败不应该影响 success', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: ['git_log'],
      });

      const result = await startup.run();

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
    });

    it('必要检查点失败应该影响 success', async () => {
      const startup = new SessionStartup('/nonexistent/path', {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();

      expect(result.results.length).toBe(1);
    });
  });

  describe('检查点数据', () => {
    it('pwd 应该返回当前目录', async () => {
      const startup = new SessionStartup(tempDir, {
        required: ['pwd'],
        optional: [],
      });

      const result = await startup.run();
      const pwdResult = result.results.find(r => r.type === 'pwd');

      expect(pwdResult?.data).toBeDefined();
    });
  });

  describe('git_log 检查点', () => {
    it('应该返回 git log 数据', async () => {
      const startup = new SessionStartup(tempDir, { required: ['git_log'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].type).toBe('git_log');
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('read_task_list 检查点', () => {
    it('tasks.yml 存在应该解析 YAML', async () => {
      const tasksPath = path.join(tempDir, 'tasks.yml');
      const taskData = {
        tasks: [
          { id: 't1', name: 'task 1', passes: true },
          { id: 't2', name: 'task 2', passes: false },
        ],
      };
      fs.writeFileSync(tasksPath, yaml.dump(taskData));

      const startup = new SessionStartup(tempDir, { required: ['read_task_list'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toBeDefined();
      expect(result.results[0].data.tasks.length).toBe(2);

      fs.unlinkSync(tasksPath);
    });

    it('tasks.json 存在应该回退到 JSON', async () => {
      const tasksPath = path.join(tempDir, 'tasks.json');
      const taskData = {
        tasks: [
          { id: 't1', name: 'task 1', passes: true },
        ],
      };
      fs.writeFileSync(tasksPath, JSON.stringify(taskData));

      const startup = new SessionStartup(tempDir, { required: ['read_task_list'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data.tasks.length).toBe(1);

      fs.unlinkSync(tasksPath);
    });

    it('无任务文件应该返回 null', async () => {
      const noTasksDir = path.join(tempDir, 'no-tasks');
      fs.mkdirSync(noTasksDir, { recursive: true });

      const startup = new SessionStartup(noTasksDir, { required: ['read_task_list'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toBeNull();

      fs.rmSync(noTasksDir, { recursive: true, force: true });
    });
  });

  describe('read_progress 检查点', () => {
    it('progress.yml 存在应该解析', async () => {
      const agentDir = path.join(tempDir, '.agent');
      fs.mkdirSync(agentDir, { recursive: true });
      const progressPath = path.join(agentDir, 'progress.yml');
      fs.writeFileSync(progressPath, yaml.dump({ step: 3, total: 10 }));

      const startup = new SessionStartup(tempDir, { required: ['read_progress'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toEqual({ step: 3, total: 10 });

      fs.unlinkSync(progressPath);
      fs.rmdirSync(agentDir);
    });

    it('无 progress.yml 应该返回 null', async () => {
      const noProgressDir = path.join(tempDir, 'no-progress');
      fs.mkdirSync(noProgressDir, { recursive: true });

      const startup = new SessionStartup(noProgressDir, { required: ['read_progress'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toBeNull();

      fs.rmSync(noProgressDir, { recursive: true, force: true });
    });
  });

  describe('init_sh 检查点', () => {
    it('init.sh 存在应该返回 true', async () => {
      const initPath = path.join(tempDir, 'init.sh');
      fs.writeFileSync(initPath, '#!/bin/bash\necho "init"');

      const startup = new SessionStartup(tempDir, { required: ['init_sh'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toBe(true);

      fs.unlinkSync(initPath);
    });

    it('init.sh 不存在应该返回 false', async () => {
      const noInitDir = path.join(tempDir, 'no-init');
      fs.mkdirSync(noInitDir, { recursive: true });

      const startup = new SessionStartup(noInitDir, { required: ['init_sh'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data).toBe(false);

      fs.rmSync(noInitDir, { recursive: true, force: true });
    });
  });

  describe('basic_verification 检查点', () => {
    it('应该检测 package.json 和 README.md', async () => {
      const verDir = path.join(tempDir, 'verification');
      fs.mkdirSync(verDir, { recursive: true });
      fs.writeFileSync(path.join(verDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(verDir, 'README.md'), '# Test');

      const startup = new SessionStartup(verDir, { required: ['basic_verification'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data.hasPackageJson).toBe(true);
      expect(result.results[0].data.hasReadme).toBe(true);

      fs.rmSync(verDir, { recursive: true, force: true });
    });
  });

  describe('load_context 检查点', () => {
    it('应该加载存在的上下文文件', async () => {
      const ctxDir = path.join(tempDir, 'context-test');
      fs.mkdirSync(ctxDir, { recursive: true });
      fs.writeFileSync(path.join(ctxDir, 'AGENTS.md'), '# Agents');
      fs.writeFileSync(path.join(ctxDir, 'USER.md'), '# User');

      const startup = new SessionStartup(ctxDir, { required: ['load_context'], optional: [] });
      const result = await startup.run();
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].data['AGENTS.md']).toBe('# Agents');
      expect(result.results[0].data['USER.md']).toBe('# User');

      fs.rmSync(ctxDir, { recursive: true, force: true });
    });
  });

  describe('未知检查点类型', () => {
    it('应该返回失败结果', async () => {
      const startup = new SessionStartup(tempDir, { required: ['unknown_type' as any], optional: [] });
      const result = await startup.run();
      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('Unknown checkpoint type');
    });
  });

  describe('getCurrentTask', () => {
    it('应该返回第一个未通过的任务', async () => {
      const tasksPath = path.join(tempDir, 'tasks.yml');
      const taskData = {
        tasks: [
          { id: 't1', name: 'done', passes: true },
          { id: 't2', name: 'current', passes: false },
          { id: 't3', name: 'future', passes: false },
        ],
      };
      fs.writeFileSync(tasksPath, yaml.dump(taskData));

      const startup = new SessionStartup(tempDir, { required: [], optional: [] });
      const current = await startup.getCurrentTask();
      expect(current).not.toBeNull();
      expect(current!.task.id).toBe('t2');
      expect(current!.index).toBe(1);

      fs.unlinkSync(tasksPath);
    });

    it('所有任务通过应该返回 null', async () => {
      const tasksPath = path.join(tempDir, 'tasks.yml');
      const taskData = {
        tasks: [
          { id: 't1', name: 'done', passes: true },
        ],
      };
      fs.writeFileSync(tasksPath, yaml.dump(taskData));

      const startup = new SessionStartup(tempDir, { required: [], optional: [] });
      const current = await startup.getCurrentTask();
      expect(current).toBeNull();

      fs.unlinkSync(tasksPath);
    });

    it('无任务文件应该返回 null', async () => {
      const noTasksDir = path.join(tempDir, 'no-tasks-get');
      fs.mkdirSync(noTasksDir, { recursive: true });

      const startup = new SessionStartup(noTasksDir, { required: [], optional: [] });
      const current = await startup.getCurrentTask();
      expect(current).toBeNull();

      fs.rmSync(noTasksDir, { recursive: true, force: true });
    });
  });

  describe('generateReport', () => {
    it('应该生成报告', () => {
      const startup = new SessionStartup(tempDir, { required: [], optional: [] });
      const report = startup.generateReport([
        { type: 'pwd', success: true, data: '/tmp', duration: 5 },
        { type: 'git_log', success: false, error: 'not a git repo', duration: 10 },
      ]);

      expect(report).toContain('Session Startup Report');
      expect(report).toContain('pwd');
      expect(report).toContain('git_log');
      expect(report).toContain('not a git repo');
    });
  });

  describe('createSessionStartup 工厂函数', () => {
    it('应该创建 SessionStartup 实例', () => {
      const startup = createSessionStartup(tempDir, { required: ['pwd'], optional: [] });
      expect(startup).toBeInstanceOf(SessionStartup);
    });
  });

  describe('常量', () => {
    it('DEFAULT_CODE_CHECKPOINTS 应该有正确的结构', () => {
      expect(DEFAULT_CODE_CHECKPOINTS.required).toContain('pwd');
      expect(DEFAULT_CODE_CHECKPOINTS.required).toContain('git_log');
      expect(DEFAULT_CODE_CHECKPOINTS.required).toContain('read_task_list');
      expect(DEFAULT_CODE_CHECKPOINTS.optional).toContain('read_progress');
      expect(DEFAULT_CODE_CHECKPOINTS.timeout).toBe(30000);
    });

    it('MINIMAL_CHECKPOINTS 应该有正确的结构', () => {
      expect(MINIMAL_CHECKPOINTS.required).toContain('pwd');
      expect(MINIMAL_CHECKPOINTS.required).toContain('read_task_list');
      expect(MINIMAL_CHECKPOINTS.optional).toEqual([]);
    });
  });
});
