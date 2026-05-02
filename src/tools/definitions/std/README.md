# Skills - 能力单元层

Skills 是工作流引擎的**能力单元层**，定义可复用的可调用能力（原名为 Steps，v0.8 重命名为 Skills）。

---

## 核心定义

**Skill = 能力单元，可调用 Agent / Tools / 脚本，用户可直接触发**

| 特征 | 说明 |
|------|------|
| 执行方式 | Agent / Tool / Script / Builtin |
| Agent 调用 | ✅ 可选 |
| 复用范围 | 跨项目复用 |
| 用户可直接调用 | ✅ 支持（通过命令）|

---

## 命名说明

- **v0.7 及之前**: 叫 `Step` - 执行单元
- **v0.8 及之后**: 叫 `Skill` - 能力单元（用户可直接调用）
- 工作流内部的执行步骤仍叫 `Step`，概念不变

| 特征 | 说明 |
|------|------|
| 执行方式 | Agent / Tool / Script / Builtin |
| Agent 调用 | ✅ 可选 |
| 复用范围 | 项目内复用 |
| 创建文件 | ✅ 可选（可内联定义） |

---

## Step 类型

### 1. Agent Step（智能决策）

调用 Agent 进行智能决策和代码生成。

```yaml
# steps/quality/run-tests.yml
name: run-tests
agent: codex              # 调用 Agent
temperature: 0.2

prompt: |
  运行项目测试并报告结果...
```

**适用场景**：
- 需要 AI 理解上下文
- 需要智能决策
- 代码生成/修改

---

### 2. Tool Step（复用能力）

引用 Tools 层定义的能力。

```yaml
# Workflow 中引用
steps:
  - id: start-container
    tool: docker/run      # 引用 tools/docker/run.yml
    input:
      image_name: "myapp"
```

**适用场景**：
- 复用已定义的 Tool
- 跨项目共享能力

---

### 3. Script Step（一次性脚本）

在 Workflow 中内联脚本。

```yaml
steps:
  - id: check-files
    script: |
      #!/bin/bash
      ls -la
      echo "Done"
```

**适用场景**：
- 一次性脚本
- 无需复用
- 简单操作

---

### 4. Builtin Step（内置处理器）

调用运行时内置处理器。

```yaml
steps:
  - id: generate-report
    step: evolution/report-gap    # 内置处理器
    input:
      execution_id: "xxx"
```

**适用场景**：
- 高频调用
- 需要高性能
- 核心功能

---

## 目录结构

```
skills/
├── quality/             # 质量相关
│   ├── run-tests.yml    # 运行测试（agent）
│   └── lint.yml         # 代码检查
│
├── evolution/           # 进化相关
│   ├── report-gap.yml   # 生成 Gap Report（builtin）
│   ├── prioritize.yml   # 优先级排序（builtin）
│   └── implement.yml    # 实现建议（agent）
│
├── governance/          # 治理相关
│   ├── multi-stance-review.yml
│   └── audit.yml
│
├── analysis/            # 分析相关
│   ├── detect-context.yml
│   └── parse-code.yml
│
├── design/              # 设计相关
│   ├── generate-spec.yml # 生成 Spec 约束文档
│
└── ...
```

---

## Skill 文件格式

```yaml
# skills/<category>/<name>.yml
id: unique-id           # 唯一标识 (可选，默认从路径生成)
name: Skill 名称        # 人类可读名称
description: 详细描述   # Skill 做什么
category: category-name # 分类
version: 1.0.0

# 开放调用配置（用户可直接调用）
openclaw:
  userInvocable: true   # 是否允许用户直接调用
  command: "!command"  # 触发命令
  emoji: "🔍"           # 显示 emoji

# 关键词（用于意图匹配）
keywords: ["分析", "架构", "关键词"]

# 默认工作流（用户调用时自动执行）
defaultWorkflow: wf-analyze

# Agent 配置（可选）
agent: codex
temperature: 0.3

# 可用工具（agent 类型时）
tools:
  - file-read
  - file-write
  - bash

# 输入定义
inputs:
  - name: param1
    type: string
    required: true
    description: 参数说明

# 输出定义
outputs:
  - name: result1
    type: string
    description: 输出说明

# Prompt（agent 类型时）
prompt: |
  执行任务...
  
  ## 输入
  {{param1}}

# 或执行配置（builtin 类型时）
execute:
  type: builtin
  handler: category/handler-name
```

---

## 与 Tools 的边界

### 判断标准

```
需要跨项目复用？
    │
    ├── 是 → 创建 Tool 文件（tools/xxx.yml）
    │
    └── 否 → 在 Workflow 中用 script step

需要 Agent 智能决策？
    │
    ├── 是 → 创建 Step 文件（agent 类型）
    │
    └── 否 → 用 Tool 或 script step
```

### 示例对比

| 场景 | 用 Tool | 用 Step |
|------|:-------:|:-------:|
| 运行 Docker 容器 | ✅ docker/run | - |
| 浏览器操作 | ✅ browser/automate | - |
| 运行测试（需 AI 判断） | - | ✅ quality/run-tests |
| 分析代码（需 AI 理解） | - | ✅ analysis/parse-code |
| 简单脚本（一次性） | - | script step |

---

## 在 Workflow 中使用

### 引用 Step 文件

```yaml
# workflows/wf-evolution.yml
steps:
  - id: prioritize
    step: evolution/prioritize    # 引用 steps/evolution/prioritize.yml
    input:
      project_path: "/path/to/project"
```

### 内联定义

```yaml
# workflows/xxx.yml
steps:
  # 引用 Tool
  - id: start
    tool: docker/run
    input:
      image_name: "myapp"
  
  # 内联脚本
  - id: check
    script: |
      curl http://localhost:3000/health
  
  # 引用 Step 文件
  - id: test
    step: quality/run-tests
    input:
      project_path: "${inputs.project_path}"
  
  # 调用 Agent
  - id: fix
    agent: codex
    prompt: |
      修复发现的错误...
```

---

## 设计原则

### 1. 可复用性

Step 文件应该是可复用的执行单元，不绑定特定项目。

```yaml
# ✅ 好的设计：参数化
inputs:
  - name: project_path
    type: path
    required: true

# ❌ 坏的设计：硬编码
script: |
  cd /fixed/path/to/project
```

### 2. 单一职责

每个 Step 文件只做一件事。

### 3. 明确输入输出

```yaml
inputs:
  - name: project_path
    type: path
    required: true

outputs:
  - name: test_results
    type: object
```

---

## Skill vs Tool vs Workflow vs Step

| 概念 | 职责 | Agent | 用户可调用 | 文件 |
|------|------|:-----:|:---------:|------|
| **Tool** | 纯脚本能力 | ❌ | - | tools/xxx.yml |
| **Skill** | 可调用能力单元 | ✅ 可选 | ✅ | skills/xxx.yml |
| **Workflow** | 流程编排 | - | ✅ | workflows/xxx.yml |
| **Step** | 工作流内部执行步骤 | - | - | 内联在 Workflow 中 |

**层级关系：**

```
Skill（能力单元层）
    │
    ├── 可被用户直接调用
    │   ↓
    └── 触发 Workflow（编排层）
        │
        ├── Step 执行（执行单元）
        │   ├── agent 类型 → 调用 Agent
        │   ├── tool 引用 → 调用 Tool
        │   └── builtin → 内置处理器
        │
        ├── Tool 引用（复用能力）
        │
        └── script step（一次性脚本）
```

---

## 相关文档

- [Tools 能力层](../tools/README.md)
- [Workflow 编排](../workflows/README.md)
- [Skill 开发指南](../docs/skill-development-guide.md)
