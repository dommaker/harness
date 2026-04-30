/**
 * CleanStateManager - Session 结束状态管理
 * 
 * 确保 Agent 结束时必须"打扫干净"，不留烂代码。
 */

import { execAsync } from '../../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  CleanStateConfig,
  CleanStateResult,
  DetectedBug,
  SessionInfo,
} from '../../types/session';


const DEFAULT_CONFIG: Required<CleanStateConfig> = {
  enabled: true,
  autoCommit: true,
  detectBugs: true,
  updateProgress: true,
  commitMessageTemplate: '[{taskId}] {description} - {status}',
};

const BUG_PATTERNS = [
  { pattern: /console\.(error|warn)\(/, severity: 'low' as const, type: 'logic' as const },
  { pattern: /FIXME|HACK/i, severity: 'medium' as const, type: 'logic' as const },
  { pattern: /eval\s*\(/, severity: 'high' as const, type: 'security' as const },
  { pattern: /dangerouslySetInnerHTML/, severity: 'medium' as const, type: 'security' as const },
];

export class CleanStateManager {
  private config: Required<CleanStateConfig>;

  constructor(config: Partial<CleanStateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async onSessionEnd(workDir: string, sessionInfo: SessionInfo): Promise<CleanStateResult> {
    const result: CleanStateResult = { 
      isClean: true, 
      hasUncommittedChanges: false, 
      progressUpdated: false, 
      errors: [] 
    };
    
    if (!this.config.enabled) return result;

    try {
      // 1. 检查未提交变更
      result.hasUncommittedChanges = await this.hasUncommittedChanges(workDir);
      
      // 2. 自动提交（如果配置开启）
      if (result.hasUncommittedChanges && this.config.autoCommit) {
        result.committedFiles = await this.autoCommit(workDir, sessionInfo);
      }
      
      // 3. 检测 bug（如果配置开启）
      if (this.config.detectBugs) {
        result.bugs = await this.detectBugs(workDir);
        if (result.bugs.length > 0) result.isClean = false;
      }
      
      // 4. 更新 progress（如果配置开启）
      if (this.config.updateProgress) {
        result.progressUpdated = await this.updateProgress(workDir, sessionInfo, result);
      }
    } catch (e: any) { 
      result.errors?.push(e.message); 
      result.isClean = false; 
    }
    
    return result;
  }

  private async hasUncommittedChanges(workDir: string): Promise<boolean> {
    try { 
      const { stdout } = await execAsync('git status --porcelain', { cwd: workDir }); 
      return stdout.trim().length > 0; 
    } catch { 
      return false; 
    }
  }

  private async autoCommit(workDir: string, sessionInfo: SessionInfo): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: workDir });
      const files = stdout.split('\n').filter(Boolean).map(l => l.substring(3).trim());
      
      await execAsync('git add -A', { cwd: workDir });
      
      // 生成提交消息
      const msg = sessionInfo.task 
        ? `[${sessionInfo.task.id}] ${sessionInfo.task.name || sessionInfo.task.id}`
        : `[session] ${sessionInfo.workflowId}`;
      
      await execAsync(`git commit -m "${msg}"`, { cwd: workDir });
      return files;
    } catch { 
      return []; 
    }
  }

  private async detectBugs(workDir: string): Promise<DetectedBug[]> {
    const bugs: DetectedBug[] = [];
    try {
      // 获取最近变更的文件
      const { stdout } = await execAsync('git diff --name-only HEAD~1', { cwd: workDir });
      
      for (const file of stdout.split('\n').filter(Boolean)) {
        // 只检查代码文件
        if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.go'].some(e => file.endsWith(e))) continue;
        
        try {
          const content = await fs.readFile(path.join(workDir, file), 'utf-8');
          const lines = content.split('\n');
          
          lines.forEach((line, i) => {
            for (const { pattern, severity, type } of BUG_PATTERNS) {
              if (pattern.test(line)) {
                bugs.push({ 
                  file, 
                  line: i + 1, 
                  message: `Detected pattern: ${pattern.source}`, 
                  severity, 
                  type 
                });
              }
            }
          });
        } catch {
          // 文件读取失败，跳过
        }
      }
    } catch {}
    return bugs;
  }

  private async updateProgress(workDir: string, sessionInfo: SessionInfo, cleanResult: CleanStateResult): Promise<boolean> {
    const progressPath = path.join(workDir, '.agent', 'progress.yml');
    try {
      await fs.mkdir(path.dirname(progressPath), { recursive: true });
      
      // 读取现有 progress 或创建新的
      let data: any = { sessions: [], last_updated: new Date().toISOString() };
      try { 
        data = yaml.load(await fs.readFile(progressPath, 'utf-8')) as any || data; 
      } catch {}
      
      // 添加本次 session 记录
      data.sessions.push({
        id: sessionInfo.sessionId,
        workflow: sessionInfo.workflowId,
        task: sessionInfo.task?.id,
        timestamp: new Date().toISOString(),
        clean: cleanResult.isClean,
        bugs: cleanResult.bugs?.length || 0,
        committed: cleanResult.committedFiles?.length || 0,
      });
      
      data.last_updated = new Date().toISOString();
      
      await fs.writeFile(progressPath, yaml.dump(data));
      return true;
    } catch { 
      return false; 
    }
  }
}

export const createCleanStateManager = (config?: Partial<CleanStateConfig>) => 
  new CleanStateManager(config);
