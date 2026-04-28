# Progressive Content Loader

渐进式内容加载器 - 在 Token 预算范围内智能加载内容。

## 概述

HZ-002 提供通用的内容分片加载和 Token 预算管理能力，可用于：
- 大数据集分片加载
- Agent 上下文渐进式披露
- 流式内容处理
- Token 预算控制

## 安装

```bash
npm install @dommaker/harness
# 或
npm install @dommaker/agent-runtime
```

## 核心概念

### Token 估算

使用 `TokenEstimator` 快速估算内容 Token 数：

```typescript
import { TokenEstimator } from '@dommaker/harness';

// 估算文本（中英文自适应）
TokenEstimator.estimateText('Hello World');        // ~3 tokens
TokenEstimator.estimateText('你好世界');            // ~3 tokens

// 估算对象
TokenEstimator.estimateObject({ foo: 'bar' });

// 估算数组
TokenEstimator.estimateArray(items, item => item.content.length);
```

### Token 预算管理

```typescript
import { TokenBudget, AdaptiveTokenBudget } from '@dommaker/harness';

// 基础预算管理
const budget = new TokenBudget(1000);
budget.reserve(200);        // 预留 200 tokens
budget.consume(100);        // 使用 100 tokens
console.log(budget.remaining);  // 700
console.log(budget.status);     // 'healthy' | 'warning' | 'critical'

// 自适应预算（基于历史使用调整）
const adaptive = new AdaptiveTokenBudget(1000);
adaptive.recordActualUsage(850);
adaptive.suggestBudgetAdjustment();  // { action: 'increase', ... }
```

### 分片加载

```typescript
import { ProgressiveLoader } from '@dommaker/harness';

const loader = new ProgressiveLoader();
const largeData = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

// 分片加载
await loader.loadInChunks(largeData, {
  chunkSize: 100,
  onChunk: async (chunk, index) => {
    console.log(`Loaded chunk ${index}: ${chunk.length} items`);
  },
  onProgress: (loaded, total) => {
    console.log(`Progress: ${loaded}/${total}`);
  }
});

// Token 预算加载
const result = await loader.loadWithBudget(items, {
  budget: 1000,
  estimator: (item) => item.content.length,
  onBudgetExceeded: 'truncate',  // 'truncate' | 'error' | 'skip'
  minItems: 3  // 至少保留 3 项
});

console.log(result.items.length);   // 实际加载的项数
console.log(result.truncated);      // 是否被截断
```

## Agent 上下文披露

```typescript
import { ProgressiveDisclosure } from '@dommaker/agent-runtime';

const disclosure = new ProgressiveDisclosure();

const context = {
  messages: [
    { role: 'system', content: 'You are a helpful assistant', timestamp: new Date() },
    { role: 'user', content: 'Hello', timestamp: new Date() },
  ],
  tools: [{ name: 'search', description: '...', parameters: {} }],
  memories: [{ id: '1', content: '...', relevance: 0.9, timestamp: new Date() }],
  files: []
};

const disclosed = await disclosure.discloseContext(context, {
  tokenBudget: 2000,
  minMessages: 3,
  includeFiles: true,
  memoryThreshold: 0.5
});

console.log(disclosed.disclosureSummary);
// "Token 使用: 450/2000 (22.5%); 消息: 2/2; 工具: 1/1; 记忆: 1/1; 文件: 0/0"
```

## 披露优先级

Agent 上下文按以下优先级披露：

1. **系统消息** - 最高优先级，必须包含
2. **工具定义** - 通常不大，优先级高
3. **对话消息** - 按优先级和时间排序，最近优先
4. **相关记忆** - 按相关度排序
5. **文件内容** - 可选，预算允许时包含

## API 参考

### ProgressiveLoader

| 方法 | 描述 |
|------|------|
| `loadInChunks(items, options)` | 分片加载 |
| `loadWithBudget(items, options)` | 预算内加载 |
| `createStream(source, chunkSize)` | 创建流式加载器 |
| `processBatch(items, processor, concurrency)` | 批量处理 |

### TokenBudget

| 属性/方法 | 描述 |
|-----------|------|
| `remaining` | 剩余预算 |
| `used` | 已使用 |
| `total` | 总预算 |
| `status` | 状态 ('healthy'/'warning'/'critical') |
| `reserve(amount)` | 预留预算 |
| `consume(amount)` | 使用预算 |
| `canAfford(amount)` | 检查是否足够 |

## 性能目标

- Token 消耗减少 30%+
- 支持 10万+ 项数据分片加载
- 流式披露延迟 < 100ms

## License

MIT
