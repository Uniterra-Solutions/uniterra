# dsh-skill-market

一个 DeepSeek Harness 插件：在 Web UI 的**设置页**里加一个「技能市场」——从 GitHub 搜索技能，一键安装到 `~/.dsh/skills`（即 `user-dsh` 技能根目录，模型侧的 `skill` 工具本来就会读取这里）。

- Node 半（`index.js`）：在宿主 `webServer` 上注册 `/skill-market/api/*` 前缀路由，负责 GitHub 仓库搜索、仓库结构检查、tarball 下载解压、技能安装/卸载。
- 浏览器半（`client.js`）：手写的 `__ModuleLoader__` bundle（无需构建），在设置面板注册一个 `settings.section` 条目「技能市场 / Skill Market」。

## 功能

- 从 GitHub 搜索技能仓库（优先 `dsh-skill` topic，关键字兜底）。
- 检查仓库技能布局（根目录 `SKILL.md` → 单个技能；`skills/<name>/SKILL.md` 或 `skills/<name>.md` → 多个技能）。
- 一键安装：从 `codeload.github.com` 下载仓库 tarball、解压、把每个技能复制进安装目录。
- 「已安装」标签页，支持逐个卸载（移入 `.trash-*`，可手动恢复）。
- 写操作带同源校验。

## 安装

```sh
# 从 GitHub 安装（生产使用建议 pin commit）
dsh plugin --profile web add "github:QQ-M/dsh-skill-market"

# 或从 tarball / 本地路径安装：
# dsh plugin --profile web add ./dsh-skill-market-0.1.0.tgz
```

然后重启 web profile（`dsh web`）——浏览器半会在启动时按 `dsh.client` 声明被加载。

## 配置

bundle 补丁（`cordis.patch.yml`）插入插件行，支持的 `config` 键：

| 键 | 默认值 | 含义 |
|---|---|---|
| `installDir` | `<DSH_HOME>/skills` | 已安装技能的写入目录 |
| `githubToken` | `''` | GitHub token，解除匿名搜索 10 次/分钟限制 |
| `githubTokenFile` | `''` | 存放 GitHub token 的文件路径 |
| `searchLimit` | `20` | 单次搜索最大结果数 |

两个 token 配置都没设时，会读环境变量 `GITHUB_TOKEN`。匿名搜索可用但有频率限制（约 10 次/分钟），频繁浏览建议配置 token。

在你的 profile `cordis.patch.yml` 里覆盖示例（按 `id` 整行替换，需重述所有键）：

```yaml
- insert:
    - id: skill-market
      name: dsh-skill-market
      config:
        installDir: /path/to/skills
        githubTokenFile: /path/to/gh-token
```

## API

全部为同源 JSON 接口，位于 `/skill-market/api/`：

- `GET /api/search?q=<query>` → `{ ok, items: [{ fullName, owner, repo, description, stars, updatedAt, url, topics }] }`
- `GET /api/repo?owner=&repo=` → `{ ok, defaultBranch, description, stars, url, skills: [{ name, path }] }`
- `POST /api/install` `{ owner, repo, ref? }` → `{ ok, branch, installed: [{ name, path, description }] }`
- `GET /api/installed` → `{ ok, installDir, items: [{ name, path, description }] }`
- `POST /api/uninstall` `{ name }` → `{ ok, message }`

## 开发

```sh
node --check index.js   # 语法检查 Node 半
node --check client.js  # 语法检查浏览器 bundle
```

Node 半只依赖 `node:*` 内建模块 + bare 的 `schemastery` schema 包（LOCAL PATCH：上游 import 的是 scoped 的 `@deepseek-ai/schemastery`，dsh profile 解析不到）；浏览器半只依赖模块表里的 `react`。
