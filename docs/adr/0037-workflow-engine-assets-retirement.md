# ADR-0037: workflow 引擎资产终局——tools/definitions 与 studio capabilities 链整删

- 日期：2026-09-29
- 状态：已接受
- 关联：2026-09-29 架构评审候选 1（studio⇄harness 职责排查，grilling 决策树走完，人类当场确认）；ADR-0031（第一性定位：harness 不做应用特有内容）；ADR-0033（两层模型：应用内容归应用）；ADR-0019（session-mining 迁出判例 + 两步走时序 + 净删无残留）；ADR-0022（零消费者修剪尺）；#40（1.0.0 删机制留数据）；harness#91（registry 一致性测试）

## 背景

`src/tools/definitions/`（113 yml + registry.json，760K）是 2026-05 harness「完整工作流引擎」定位时期（Phase 1-6 批量引入，commit `9ac4d04`）的能力单元数据——`std/README.md` 自述「Skills 是工作流引擎的能力单元层」。2026-08 #40（1.0.0 收窄）删除了 tools 的机制（core/registry/loader/types），**保留 paths.ts 与 definitions/**，因为当时 studio 经 `getRegistryPath` 消费数据。机制死、数据留，此后每轮定位收窄（ADR-0001/0029/0031）都只割代码与措辞，数据原地留守。

2026-09-29 架构评审事实核查：

- 数据自 2026-05 起冻结，四个月零新增；
- 执行机体（`builtin-handlers.ts` / `workflow.sh`）已不在任何仓——这是一台已死引擎的声明式数据残骸；
- 唯一消费链 = studio capabilities 模块 → `GET /api/v1/capabilities`，该接口**无真实消费者**（web 前端零调用，仅性能基线脚本逐个打端点）；`Capability` 类型为死类型；
- studio 自有技能体系（studio-skill 的 SKILL.md 库）与本数据格式、机制、命名全不同，零重叠；
- 760K 随 npm 包发两遍（`files` 含 `src` + build 脚本 `cp -r` 进 dist），每个安装者都在为无人消费的数据付体积。

删除测试在全链每一环通过：删掉后没有任何调用方需要吸收复杂度。

## 决策

1. **整链删除，不迁移。** harness 删数据与路径函数；studio 删 capabilities 模块与 `studio-capability` 包。
2. **净删无残留**（ADR-0019 决策 4 判例）。harness 删除面：`src/tools/` 整目录（definitions/、paths.ts、index.ts、`__tests__/registry.test.ts`、CONTEXT.md）、`src/index.ts` 导出行、`package.json` build 脚本 `cp -r` 段、`src/release/integrity.ts` 豁免行、CAPABILITIES.md/CONTEXT.md/公共导出冻结测试同步。
3. **breaking 随下一班 minor 发布**（ADR-0019 判例：同类 breaking 经裁决按 minor）。
4. **时序两步走（先断消费，再撤供给）**：studio 票先删消费面并上线 → harness 票删数据与导出 → studio 下次升级依赖自然归零。反序则 harness 发布后 studio 的 `^` 范围自动吃进新版本，import 断链、构建失败。
5. **本 ADR 即这份数据的墓碑**：未来架构评审如遇「迁回 / 复用 / 重建能力注册表」类提议，先读本文；若确有新需求，从 studio 侧按 studio-skill 正本重新设计，不从本数据续命。

## 否决的备选

- **迁往 studio**（评审候选原方案）：数据冻结且执行机体已死，迁移只是把死数据换个仓放；studio 技能体系另有正本，无需第二份。
- **归档降级到 docs/**：git 历史即归档，数据无额外的历史导航价值。
- **留 studio-capability 空包**：包的存在理由就是这条消费链，留壳即浅模块。

## 影响

- harness：公共面 −2 符号（`getRegistryPath`/`getToolsDir`），包体积 −1.5MB（src+dist 双份），`tools/` 目录整体消失。
- studio：删除面 = `apps/api/src/modules/capabilities/` 整目录、`packages/studio-capability` 整包、route-registry 挂载、两份性能基线端点条目、web 死类型 `Capability`、AGENTS.md 模块索引重建、`file-store.ts` 消费方注释连带更新。
- 两仓各一票，顺序执行；harness 票前置 = studio 票已上线。
