# release/

## 职责
发布物完整性自检：harness 自己声明并校验自己发布了什么。关键发布物清单的单一来源，替代外部（studio publishPackage）与本仓 release 命令各自的 dist 文件硬编码（harness#77，#75 N4 收编）。

## 核心导出
- `deriveCriticalArtifacts(manifest)`（`integrity.ts`）——从包声明面（package.json `main`/`exports`/`bin`）推导脚本入口清单（.js/.cjs/.mjs/.d.ts，去 `./` 前缀、剔除非脚本叶子、去重排序）；纯函数
- `EXTRA_CRITICAL_ARTIFACTS`——声明面推导之外的运行时关键发布物（bin/harness.js 引导期 require 的命令/门禁定义表、`dist/tools/definitions` 数据目录）；与其描述的文件同仓同评审，删改须同步
- `resolvePackageRoot(fromDir?)`——从模块位置向上按包名解析本包根（源码仓与 node_modules 安装态均可达）
- `getCriticalArtifacts(pkgRoot?)` / `verifyReleaseArtifacts(pkgRoot?)`——公开 API；pkgRoot 缺省自动解析，外部消费者零参数即自检已安装的 harness

## 依赖关系
- 无内部依赖（只依赖 node fs/path）

## 约定
- 清单维护模型：声明面推导为主（目录重构动到 package.json 时清单自动跟随）+ extras 随源码维护；**不新增第三处硬编码清单**
- 覆盖口径（有意裁决，#77）：深度内部文件（tsc 产出的 dist/knowledge/*、core/constraints/checker.js 等）**不在清单**——非公开契约，存在性由 tsc 构建成功保证；历史上外部硬编码它们正是重构误判（studio 6cf3c329）的根因。旧 studio 清单 checker.js/doctor.js、旧 release 清单 13 项均被本清单取代，覆盖收窄是裁决而非遗漏
- `__tests__/integrity.test.ts` 的「真实包根清单同步闸门」是重构同步闸门：动 exports/main/bin 或 extras 时该测试强制同步
- bin 新增引导期 require 的 dist 文件 → extras 加一条 + 测试同步

## 注意事项
- 挂载点：`harness release` 命令第 4 步（tsc 后校验 dist）；studio publishPackage dist 校验改调本能力（studio#425 配套切换）
- 公开面只收 `getCriticalArtifacts` / `verifyReleaseArtifacts` + `ArtifactIntegrityResult`（ADR-0003）；derive/resolve 属内部 seam
