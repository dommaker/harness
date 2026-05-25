# spec/

## 职责
代码注释规范检查：验证代码中的 @spec 注释是否符合规范。

## 核心导出
- `annotation-checker.ts` — AnnotationChecker: 检查 @spec 注释规范(有效/无效/警告)

## 依赖关系
- 依赖 `fs` / `path` 文件系统操作
- 被 `src/cli/commands/spec.ts` CLI 命令消费

## 约定
- Spec 注释格式由 @spec 标签定义
- 检查结果包含 valid: boolean + errors + warnings

## 注意事项
- 无 index.ts 统一导出，独立模块导入
- 扫描指定目录下所有 TS 文件的 @spec 注释
