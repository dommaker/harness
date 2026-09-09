/**
 * @spec HZ-002
 * @implements HZ-002-C2
 * @acceptance AC-001-2
 * 
 * Token Budget Manager
 * 
 * Token 预算管理和估算工具
 */

/**
 * Token 估算器
 * 
 * 提供常用的 Token 估算方法
 */
export class TokenEstimator {
  /**
   * 估算文本的 Token 数（简化版）
   * 
   * 基于字符数估算，假设 1 token ≈ 4 字符（英文）
   * 中文按 1 token ≈ 1.5 字符计算
   * 
   * 注意：这是快速估算，不是精确值
   * 精确值需要使用 tokenizer（如 tiktoken）
   */
  static estimateText(text: string): number {
    if (!text) return 0;
    
    // 检测是否包含中文
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    
    if (hasChinese) {
      // 中文：1 token ≈ 1.5 字符
      return Math.ceil(text.length / 1.5);
    } else {
      // 英文：1 token ≈ 4 字符
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * 估算对象的 Token 数
   * 
   * 将对象转为 JSON 字符串后估算
   */
  static estimateObject(obj: any): number {
    try {
      const json = JSON.stringify(obj);
      return this.estimateText(json);
    } catch {
      return 0;
    }
  }

  /**
   * 估算数组的 Token 数
   */
  static estimateArray<T>(
    items: T[],
    itemEstimator?: (item: T) => number
  ): number {
    if (itemEstimator) {
      return items.reduce((sum, item) => sum + itemEstimator(item), 0);
    }
    return this.estimateObject(items);
  }

  /**
   * 创建自定义估算器
   */
  static createFieldEstimator<T>(
    fieldMap: Record<string, (value: any) => number>
  ): (item: T) => number {
    return (item: T) => {
      let total = 0;
      for (const [field, estimator] of Object.entries(fieldMap)) {
        const value = (item as any)[field];
        total += estimator(value);
      }
      return total;
    };
  }
}

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
