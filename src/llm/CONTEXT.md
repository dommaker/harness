# llm/

## 职责
LLM 适配层：统一的 LLM 调用接口(Adapter 模式)，支持多模型切换。

## 核心导出
- `types.ts` — LLM 相关类型定义
- `adapter.ts` — LLM Adapter: 统一调用接口

## 依赖关系
- 依赖 `src/types/` 公共类型
- 被上层需要 LLM 调用的模块消费

## 约定
- Adapter 模式：统一接口屏蔽底层模型差异
- 不直接依赖特定 LLM SDK
- 类型定义与实现分离

## 注意事项
- 轻量模块，提供 LLM 调用抽象
- 具体模型配置由环境变量/配置文件提供
