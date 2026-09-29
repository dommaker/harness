/**
 * @spec HZ-002
 * @implements HZ-002-C2
 * @acceptance AC-001-2
 * 
 * Token Budget Manager
 * 
 * Token 预算管理工具（token 估算唯一正本是 `knowledge/query.ts` 的
 * `KnowledgeQuery.estimateTokens`，本目录不另存估算实现，harness#197）
 */

/**
 * Token 预算分配器
 * 
 * 管理 Token 预算的分配和使用
 */
export class TokenBudget {
  private totalBudget: number;
  private usedTokens: number = 0;
  private reservedTokens: number = 0;

  constructor(budget: number) {
    this.totalBudget = budget;
  }

  /**
   * 获取剩余预算
   */
  get remaining(): number {
    return this.totalBudget - this.usedTokens - this.reservedTokens;
  }

  /**
   * 获取已使用预算
   */
  get used(): number {
    return this.usedTokens;
  }

  /**
   * 获取总预算
   */
  get total(): number {
    return this.totalBudget;
  }

  /**
   * 预留预算
   * 
   * @returns 是否预留成功
   */
  reserve(amount: number): boolean {
    if (amount > this.remaining) {
      return false;
    }
    this.reservedTokens += amount;
    return true;
  }

  /**
   * 释放预留的预算
   */
  release(amount: number): void {
    this.reservedTokens = Math.max(0, this.reservedTokens - amount);
  }

  /**
   * 使用预算
   * 
   * @returns 是否使用成功
   */
  consume(amount: number): boolean {
    if (amount > this.remaining) {
      return false;
    }
    this.usedTokens += amount;
    return true;
  }

  /**
   * 强制使用（可能超预算）
   */
  forceConsume(amount: number): void {
    this.usedTokens += amount;
  }

  /**
   * 增加预算
   */
  addBudget(amount: number): void {
    this.totalBudget += amount;
  }

  /**
   * 检查是否有足够预算
   */
  canAfford(amount: number): boolean {
    return amount <= this.remaining;
  }

  /**
   * 获取预算使用比例
   */
  get usageRatio(): number {
    return this.usedTokens / this.totalBudget;
  }

  /**
   * 获取预算状态
   */
  get status(): 'healthy' | 'warning' | 'critical' {
    const ratio = this.usageRatio;
    if (ratio < 0.5) return 'healthy';
    if (ratio < 0.8) return 'warning';
    return 'critical';
  }

  /**
   * 重置预算
   */
  reset(newBudget?: number): void {
    this.usedTokens = 0;
    this.reservedTokens = 0;
    if (newBudget !== undefined) {
      this.totalBudget = newBudget;
    }
  }

  /**
   * 获取预算报告
   */
  getReport(): {
    total: number;
    used: number;
    reserved: number;
    remaining: number;
    usageRatio: number;
    status: 'healthy' | 'warning' | 'critical';
  } {
    return {
      total: this.totalBudget,
      used: this.usedTokens,
      reserved: this.reservedTokens,
      remaining: this.remaining,
      usageRatio: this.usageRatio,
      status: this.status
    };
  }
}
