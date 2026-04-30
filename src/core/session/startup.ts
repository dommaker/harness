/**
 * SessionStartup - Session 启动检查点验证
 * 
 * 确保 Agent 启动时必须先读上下文，防止"失忆"乱搞。
 */

import { execAsync } from '../../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  StartupCheckpoints,
  StartupCheckpointResult,
  StartupCheckpointType,
  TaskListJson,
} from '../../types/session';


const DEFAULT_TIMEOUT = 30000; // 30 seconds

export class SessionStartup {
  private checkpoints: StartupCheckpoints;
  private workDir: string;

  constructor(workDir: string, checkpoints: StartupCheckpoints) {
    this.workDir = workDir;
    this.checkpoints = checkpoints;
  }

  async run(): Promise<{ success: boolean; results: StartupCheckpointResult[]; errors: string[] }> {
    const results: StartupCheckpointResult[] = [];
    const errors: string[] = [];

    // 1. Run required checkpoints
    for (const type of this.checkpoints.required) {
      const result = await this.runCheckpoint(type);
      results.push(result);
      if (!result.success) {
        errors.push(`Required checkpoint failed: ${type} - ${result.error}`);
      }
    }

    // 2. Run optional checkpoints (don't fail on error)
    for (const type of this.checkpoints.optional || []) {
      const result = await this.runCheckpoint(type);
      results.push(result);
    }

    return {
      success: errors.length === 0,
      results,
      errors,
    };
  }

  private async runCheckpoint(type: StartupCheckpointType): Promise<StartupCheckpointResult> {
    const start = Date.now();

    try {
      let data: any;

      switch (type) {
        case 'pwd':
          data = await this.checkPwd();
          break;
        case 'git_log':
          data = await this.checkGitLog();
          break;
        case 'git_status':
          data = await this.checkGitStatus();
          break;
        case 'read_progress':
          data = await this.checkProgress();
          break;
        case 'read_task_list':
          data = await this.checkTaskList();
          break;
        case 'init_sh':
          data = await this.checkInitSh();
          break;
        case 'basic_verification':
          data = await this.checkBasicVerification();
          break;
        case 'load_context':
          data = await this.checkLoadContext();
          break;
        default:
          throw new Error(`Unknown checkpoint type: ${type}`);
      }

      return { type, success: true, data, duration: Date.now() - start };
    } catch (error: any) {
      return { type, success: false, error: error.message, duration: Date.now() - start };
    }
  }

  private async checkPwd(): Promise<string> {
    return this.workDir;
  }

  private async checkGitLog(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git log --oneline -10', { cwd: this.workDir });
      return stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private async checkGitStatus(): Promise<{ staged: string[]; unstaged: string[]; untracked: string[] }> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.workDir });
      const staged: string[] = [], unstaged: string[] = [], untracked: string[] = [];
      
      for (const line of stdout.split('\n').filter(Boolean)) {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        if (status.includes('??')) untracked.push(file);
        else if (status.match(/[MADRC]/)) staged.push(file);
        else unstaged.push(file);
      }
      
      return { staged, unstaged, untracked };
    } catch {
      return { staged: [], unstaged: [], untracked: [] };
    }
  }

  private async checkProgress(): Promise<any> {
    const progressPath = path.join(this.workDir, '.agent', 'progress.yml');
    try {
      const content = await fs.readFile(progressPath, 'utf-8');
      return yaml.load(content) as any;
    } catch {
      return null;
    }
  }

  private async checkTaskList(): Promise<TaskListJson | null> {
    // Try tasks.yml first (existing format)
    const tasksPath = path.join(this.workDir, 'tasks.yml');
    try {
      const content = await fs.readFile(tasksPath, 'utf-8');
      return yaml.load(content) as TaskListJson;
    } catch {
      // Try tasks.json
      const jsonPath = path.join(this.workDir, 'tasks.json');
      try {
        const content = await fs.readFile(jsonPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    }
  }

  private async checkInitSh(): Promise<boolean> {
    const initPath = path.join(this.workDir, 'init.sh');
    try {
      await fs.access(initPath);
      return true;
    } catch {
      return false;
    }
  }

  private async checkBasicVerification(): Promise<{ hasPackageJson: boolean; hasTests: boolean; hasReadme: boolean }> {
    const [hasPackageJson, hasTests, hasReadme] = await Promise.all([
      fs.access(path.join(this.workDir, 'package.json')).then(() => true).catch(() => false),
      this.hasTestFiles(),
      fs.access(path.join(this.workDir, 'README.md')).then(() => true).catch(() => false),
    ]);
    return { hasPackageJson, hasTests, hasReadme };
  }

  private async hasTestFiles(): Promise<boolean> {
    const testPatterns = ['test', 'spec', '__tests__'];
    try {
      const files = await fs.readdir(this.workDir);
      return files.some(f => testPatterns.some(p => f.toLowerCase().includes(p)));
    } catch {
      return false;
    }
  }

  private async checkLoadContext(): Promise<any> {
    // Load AGENTS.md, USER.md, SOUL.md if present
    const context: Record<string, string> = {};
    const files = ['AGENTS.md', 'USER.md', 'SOUL.md', 'MEMORY.md'];
    
    for (const file of files) {
      try {
        context[file] = await fs.readFile(path.join(this.workDir, file), 'utf-8');
      } catch {}
    }
    
    return context;
  }

  /**
   * Get current task from task list
   */
  async getCurrentTask(): Promise<{ task: any; index: number } | null> {
    const taskList = await this.checkTaskList();
    if (!taskList?.tasks) return null;

    for (let i = 0; i < taskList.tasks.length; i++) {
      const task = taskList.tasks[i];
      if (task && !task.passes) {
        return { task, index: i };
      }
    }
    
    return null;
  }

  /**
   * Generate startup report
   */
  generateReport(results: StartupCheckpointResult[]): string {
    const lines: string[] = ['## Session Startup Report\n'];
    
    for (const result of results) {
      const icon = result.success ? '✅' : '❌';
      lines.push(`${icon} ${result.type} (${result.duration}ms)`);
      if (result.error) {
        lines.push(`   Error: ${result.error}`);
      }
    }
    
    return lines.join('\n');
  }
}

export const createSessionStartup = (workDir: string, checkpoints: StartupCheckpoints) => 
  new SessionStartup(workDir, checkpoints);

/**
 * Default startup checkpoints for code workflows
 */
export const DEFAULT_CODE_CHECKPOINTS: StartupCheckpoints = {
  required: ['pwd', 'git_log', 'read_task_list'],
  optional: ['read_progress', 'init_sh', 'basic_verification'],
  timeout: DEFAULT_TIMEOUT,
};

/**
 * Minimal startup checkpoints
 */
export const MINIMAL_CHECKPOINTS: StartupCheckpoints = {
  required: ['pwd', 'read_task_list'],
  optional: [],
  timeout: DEFAULT_TIMEOUT,
};
