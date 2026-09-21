# suisui-app · 碎碎（demo）

读写**真实 md 文件**并与 GitHub 双向同步的客户端。目标形态：一份 Tauri 2 代码出 Windows exe + Android apk。
**当前阶段**：桌面端 web demo + 移动端（手机浏览器直接可用，带 PWA 外壳）。还没打包。

> 本仓库 = 程序源码。**它同步的那个仓库是另一个**（默认 `baicaibucai1/ramblings`，见下「凭据」），
> 两者别搞混。

## 跑起来

```bash
node node_modules/vite/bin/vite.js            # dev  → http://localhost:5183
node scripts/build.mjs                        # 构建（别直接 vite build，见下）
node node_modules/vite/bin/vite.js preview    # 产物 → http://localhost:5184
```

（受限终端里 `npm run dev` 不可用，直接跑 vite 的 JS 入口更稳。）

**构建走 `scripts/build.mjs`，不要直接 `vite build`。** 它先把产物建到暂存目录、自检通过后再换掉
`dist` —— 因为本机有两个 Windows 怪脾气，直接构建会在**把上一份产物删到一半时失败**：
目录级 `rename` 被拒（EPERM），递归删 180+ 文件的目录会**永不返回**（不是报错，是卡住）。
脚本两条都绕开了，并在最后报出首屏引用了哪些文件、各 chunk 多大。

两个服务都配了 `host: true`，所以**手机连同一个 WiFi 也能打开**（用电脑的局域网 IP，端口不变）。
手机上的用法和 apk 的打包步骤见 [`ANDROID.md`](./ANDROID.md)。

> Service Worker 只在构建产物上验，所以 `:5184` 那个（preview）才带离线能力；`:5183` 是内存模块图，没有可缓存的文件。

### 在电脑上看手机效果：手机壳预览页

```
http://localhost:5184/mobile.html        # dev（:5183）上也有同一份
```

把应用塞进**真机尺寸的 iframe**。关键在：iframe 有自己的视口，所以里面的
`@media (width < 48rem)` 是按**壳的宽度**求值的 —— 渲染出来的是真手机布局，
不是把桌面版缩小（e2e 直接断言 iframe 内 `window.innerWidth === 412`）。

顶部可切机型（Pixel 7 / iPhone 15 Pro / SE / Galaxy A54 / iPad mini / 临界 767 / 临界 768 / 桌面 1280）、
旋转、缩放，另有「清缓存重载」（注销 SW + 清 Cache Storage，改完产物看的是旧的时用它）。
脚注实时报出当前视口尺寸、DPR 和**落在断点哪一侧**。

⚠️ **iframe 没有触摸模拟** —— 布局能验，真触摸手势和软键盘还得用手机。
地址栏支持 `?url=…&w=…&h=…`，可以直接指向别的地址或尺寸。

## 凭据

`.env.local`（已在 .gitignore 里，不进版本库）：

```
VITE_GH_TOKEN=...
VITE_GH_OWNER=baicaibucai1
VITE_GH_REPO=ramblings
VITE_GH_BRANCH=main
```

凭据在**设置面板的「同步」分区**里配（设置入口在左下角 dock 的齿轮上；
没配凭据时齿轮顶一颗红点）。demo 存 localStorage，正式版进系统凭据库。
⚠️ 凭据按「地址 + 端口」隔离 —— 电脑上填过不代表手机上填过，换设备要重填一次。

## 已实现

- **GitHub Git Data API 直连**：api.github.com 放行 CORS，纯浏览器调用，不需要任何后端
- **三路比对**：本地 blob sha1 × 上次同步快照 × 远端 sha → 新增 / 修改 / 删除 / 冲突
- **一次同步一个 commit**：blobs → trees → commits → refs，四步走完
- **删除可推**：tree 条目 `sha: null`
- **创建笔记**：左下角「创建笔记」→ 只问标题 + 落哪个目录（碎念 / 随笔 / 摘抄 / 草稿），
  路径 `thoughts/2026-09-21-雨天.md` 由 `note.ts` 生成（中文原样进文件名、挡非法字符、超长按码点截断、
  重名加 `-2` 绝不覆盖）。回车即建，建完自动展开目录、打开编辑器、**把光标放到正文末尾**
- **删远端要点确认**：见下面「坑 4」——删除是不可逆的，默认只拉不删
- **不假装同步好了**：本地一改，顶栏立刻切成「有本地改动，还没比对」。
  原先它会继续显示上一次比对的结果 —— 刚建完笔记却写着「与远端一致」，是误导
- **左侧只列文字文件**：`.gitignore`、`update.bat`、`scripts/*`、根目录 README 这类程序文件默认不展示，
  标题栏的眼睛图标可切换「显示全部」。⚠️ **过滤只在展示层** —— 同步永远走全量 `files`，
  否则这些文件在本地"不存在"会被三路判定当成"你删了它们"，一次同步就把仓库清空
- **冲突不丢字**：远端版本另存 `xxx.conflict-日期.md`，本地版本保留
- **格式工具栏**（常驻一行，14 个）：正文 / H1 / H2 / H3 ｜ 加粗 / 斜体 / 删除线 / 行内代码 / 链接 ｜
  无序列表 / 有序列表 / 引用 / 代码块 / 分割线。**按钮跟着光标实时高亮**（H2 里光标一落，H2 就亮）。
  两种模式共用一套按钮，但实现不同：所见即所得调 Milkdown 命令，源码模式走 `mdkit.ts` 的字符串改写
  （这样源码框里的操作也完全可单测）。再点一次相同的块级工具会**取消**（列表/引用走 `lift`，标题走 `paragraph`）
- **所见即所得编辑**（Milkdown / Crepe）＋ 源码模式切换
- **文本纪律**：统一 LF + 无 BOM，否则每次保存 sha 都变，同步永远"脏"
- **第二种格式「稿纸」**（`.rich`）：和 md **并列，不互转**。文件本身就是一份合法 HTML ——
  顶部可选一个 `<style>` 承载**这篇自己的 CSS**，下面是正文 HTML；改名成 `.html` 用浏览器打开
  也是对的，不会被锁死在这个程序里。渲染时那段 CSS 被包进 `@scope (.rich-scope)`，只作用于这一篇。
  25 个工具分四组，第四组是 md 语法层面根本做不到的**样式命令**：文字色 / 底色高亮 / 字号 / 字体 /
  卡片块 / 缩进。另有「这篇的 CSS」抽屉（可手写，也可一键套 5 套主题预设）和源码模式。
  创建笔记时选格式，后缀、初始正文、文件树图标都会跟着变
- **编辑器按需加载**：编辑器带着 Milkdown / Crepe / KaTeX，压缩后 **1.1MB**，而首屏真正需要的
  只有顶栏和文件列表。所以 `App.tsx` 里 `lazy(() => import('./components/EditorPane'))`，
  没选文件时渲染轻量的空态（`components/EmptyState.tsx`，**不能把它写回 EditorPane**）。
  首屏 JS 从 **1.72MB 降到 260KB**。加载中给路径栏 + 三条骨架（手机上那 1.1MB 是能感觉到的，
  不给骨架就像"点了没反应"）。`tests/lazy-e2e.mjs` 拿断言钉住这件事 —— 改回静态 import 功能全对，
  只有包体悄悄涨回去，不测根本看不出来
- **移动端（< 48rem）**：侧栏收进抽屉（左上角 ☰ 拉开，**选完文件自动收起**，点空白或按 Esc 关掉）；
  两个工具栏**横向滚动而不是换行**（换行会把正文挤下去）；触摸目标放大到 36px；
  弹层改成贴边（桌面上居中的浮层在手机上会有一半在屏外）；`100dvh` + `interactive-widget=resizes-content`
  让软键盘压缩视口而不是盖住光标；底部加安全区内边距。**桌面端一行都没改** —— 布局级规则集中在
  `styles.css` 的一个 `@media (width < 48rem)` 块里，其余是就地 `max-md:` 变体
- **PWA 外壳**：`manifest.webmanifest` + 四种尺寸图标 + 手写 Service Worker。
  导航请求 network-first（**用 cache-first 的话发新版后永远升不了级**），静态资源 stale-while-revalidate，
  `api.github.com` 一律放行到网络（缓存住实时数据等于把用户锁在旧快照上）。
  实测断网后照样打开、本地笔记还在

## 双链与标签

正文里写 `[[笔记名]]` 就是一条链接，`#标签` 就是一个标签。**落盘的还是这几个字**
（markdown 里 `[[ ]]` 没有任何语法含义），所以别的软件打开照样读得懂，同步到 GitHub 也不脏。

| 写法 | 意思 |
|---|---|
| `[[开张]]` | 链到「开张」那篇 |
| `[[开张#第二段]]` | 链到那篇的「第二段」小节，跳过去并滚到那儿闪一下 |
| `[[开张|去看]]` | 显示成「去看」，仍指向开张（`|` 只影响显示，不影响指向） |
| `#灵感` / `#读书/笔记` | 标签，可点（侧栏只留带它的篇） |

- **怎么点**：桌面是 **Ctrl / ⌘ + 单击**（单击是"把光标放进去改字"，这是编辑器不是阅读器）；
  手机上没有修饰键，退化成单击就跳。
- **指到了没有一眼看得出来**：有那篇是实线，没有是**虚线 + 灰字**。点虚线的会当场把那篇建出来
  （建在引用它的那篇所在目录），建完链接自动变实线。
- **打 `[[` 弹补全**（↑↓ 选、回车确认、Esc 收起），最后一项永远是「创建《你打的字》」。
- **反向链接面板**：正文下面那条，显示这篇的标签、**谁引用了这篇**（带那一句的上下文，可点回去）、
  以及这篇指向但还没建的篇。三样都空时整块不渲染 —— 一个空面板占着正文的位置是浪费。
- **标签筛选**：点 `#标签`，侧栏顶部出现 `#标签 × N 篇`，列表切成**一列平铺的篇**
  （同一个标签下的几篇往往散在不同目录，套回树里反而找不到）。再点一次或按 × 退出。
- **名字解析放宽四档**：全路径 → 路径去后缀 → 文件名 → **标题**（文件名是 `2026-09-21-开张`，
  但人写链接只会写 `[[开张]]`）。同名多篇时优先**同目录**的那篇。

⚠️ **保存前必须把 `[[` 的转义吃回去**（`lib/links.ts` 的 `unescapeWiki`）：
markdown 序列化器会把 `[[` 写成 `\[\[`，不还原的话磁盘上那串字就不再是链接了 ——
反向链接会整片失效，别的软件打开只看到一串反斜杠。这是踩过的，不是理论风险。

源码模式（textarea）里没有高亮也没有补全 —— 它是纯文本框，没法给一段字套 span。
反链面板不受影响，两种模式都在。

## 同步后端：GitHub / 坚果云 / OneDrive

比对引擎（`lib/sync.ts`）**只认一个接口** `Remote`（`lib/providers/types.ts`）：

```ts
list(): Promise<{ path, sha }[]>      // 列全部文件
read(path): Promise<string>           // 读原文
write(changes, message): Promise<void>// 落一批改动（content = null 是删除）
```

三家的差别只在实现里：

| 后端 | 协议 | 状态 |
| --- | --- | --- |
| GitHub | Git Data API（一个仓库当库，一次同步一个 commit） | 可用（一直是它） |
| 坚果云 | WebDAV（`dav.jianguoyun.com/dav/`） | **要在桌面端跑** —— 见下 |
| OneDrive | Microsoft Graph | 读写就位，**授权待接入**（要 Azure 应用的 client_id） |

两条绕不开的限制，都是查证过的，不是猜想：

- **坚果云的 WebDAV 不返回 CORS 头**，浏览器的 PROPFIND 预检连鉴权都过不去，官方对此的答复是
  "我们实现的是标准 WebDAV 服务端协议"（即不打算支持）。所以这条路的请求**走注入的 transport**：
  桌面端（Tauri）在 Rust 侧发（`src-tauri/src/main.rs` 的 `dav_request`），没有同源策略这一说。
  网页版没有 transport，界面上照实标「要用桌面端」。
- **OneDrive 的 Graph 放 CORS**，浏览器直连没问题，缺的是授权：OAuth 需要一个 Azure 应用的
  client_id 走 PKCE 换 token，注册应用得账号主人去做。所以 `onedrive.ts` 只接 token，
  留空就是「待接入」，界面上 disabled + 标出来（不放假按钮）。

### 一个不那么显然的取舍：`list()` 的 sha 必须是**内容指纹**

三路比对（`decide.ts`）比的是「本地 sha × 上次快照 × 远端 sha」，三个值必须**同一种算法**，
同步完两边内容相同 → 指纹相同，才能用一个值代表"基线"。

GitHub 的 blob sha 正好就是 git 的 blob 哈希，本地算得出来。网盘没有这个：WebDAV 给 ETag、
OneDrive 给 quickXorHash，算法跟本地不同 —— 直接拿来当基线，"本地没动"会被判成"本地改了"
（两边永远不相等）。所以**非 Git 后端在 `list()` 时把内容取回来现算指纹**，内容顺手缓存住给
`read()` 用。代价是列目录要下载全部内容；换来的好处是判定表、快照格式、冲突处理一家都不用改。

## 文件夹

文件夹**不是"一个空壳"**：git 里空目录根本不存在，而网盘里空目录又确实存在 —— 同一个工作副本
要在几种后端之间换来换去，行为必须一致。所以统一成：目录里放一个隐藏的标识文件 `.folder`
（和 Obsidian 在每个库里放 `.obsidian` 是同一个思路）。它点开头，左侧列表本来就隐藏这类路径段，
用户看不见它，而它在任何后端上都是一个真实的文件 —— 目录因此"真的存在"了。

规则都在 `lib/folders.ts`：目录名清洗（`..` 不许跳出库、Windows 非法字符、每段截断 60 字）、
建/删目录、嵌套建树。文件树是真正的多级树（原来只有一层分组），空目录也显示，
"创建笔记"的去处里会带上自己建的目录。

## 还没做

- **打真正的包**：Android apk 和 Windows exe 都还没出。缺 JDK / Android SDK+NDK / MSVC 工具链，
  清单和步骤写在 [`ANDROID.md`](./ANDROID.md) 里。
  桌面端骨架（`src-tauri/`）已经搭起来，目前只提供一个 `dav_request` 命令给坚果云用
- 真实文件系统（现在工作副本在 localStorage；桌面版要落到 `C:\AI_Production\碎碎`）
- 系统凭据库（现在 token / 坚果云应用密码都在 localStorage）
- OneDrive 的 OAuth 授权（要 Azure 应用的 client_id 走 PKCE）
- 安卓端的坚果云（同样卡在 CORS，需要原生插件走 Kotlin 发 WebDAV）
- 冲突的三路自动合并（现在只留副本）
- 图片等二进制
- 双链还差几件事：**改名不断链**（现在改名了，别人引的还是旧名字）、
  **未创建链接的批量创建**、标签的全局列表视图（现在只能从某篇里点进去筛）、
  `![[嵌入]]`（把另一篇的正文嵌进来）、源码模式下的链接高亮与补全（textarea 做不到）

## 测试

```bash
node tests/decide.test.mjs        # 三路判定 14 例（Node 24 直接跑 .ts）
node tests/note.test.mjs          # 笔记命名规则 31 例（非法字符 / 超长 / 重名 / 本地日期）
node tests/visible.test.mjs       # 左侧「哪些不该显示」25 例
node tests/mdkit.test.mjs         # md 工具栏源码模式 67 例（标题 / 列表 / 行内包裹 / 选区映射）
node tests/rich.test.mjs          # 稿纸格式内核 50 例（拆合 / 圈作用域 / 清洗 / 主题预设）
node tests/folder.test.mjs        # 文件夹 58 例（目录名清洗 / 标识文件 / 空目录推导 / 嵌套建树）
node tests/davxml.test.mjs        # WebDAV 的 PROPFIND 解析 15 例（编码 / 库根剥离 / 各家写法差异）
node tests/links.test.mjs         # 双链与标签 78 例（解析 / 代码块不算 / 标题去日期前缀 / 转义还原）
node tests/link-e2e.mjs           # 浏览器：高亮 → Ctrl+点跳转 → 点没有的就建 → 补全 → 标签筛选 → 反链面板
node tests/folder-e2e.mjs         # 浏览器：建多层文件夹 → 空目录看得见 → 往里写笔记 → 删（含确认）
node tests/smoke.mjs              # 浏览器：拉取 → 打开文章 → 创建笔记 → md 工具栏 → 截图
node tests/rich-e2e.mjs           # 浏览器：创建稿纸 → 工具栏改字 → 写这篇的 CSS → 源码往返 → 截图
node tests/settings-e2e.mjs       # 设置面板 29 例（入口在左下角 / 凭据跟着后端走 / 后端不放假按钮 / Esc / 手机全宽 / 壁纸已移除）
node tests/mobile-e2e.mjs         # 手机视口 57 例（抽屉 / 工具栏横滚 / 触摸尺寸 / 顶栏精简 / 手机壳页 / 桌面不回归）
node tests/pwa-e2e.mjs            # 产物上的 PWA 15 例（SW 注册 → 断开网络仍能打开）
node tests/lazy-e2e.mjs           # 编辑器按需加载 21 例（入口包里没有编辑器 / 首屏不拉 / 加载中给骨架）
node tests/push-roundtrip.mjs     # 端到端：新建 → 推送 → 删除 → 确认 → 再推送（会真的动仓库）
node scripts/gen-icons.mjs        # 重新生成主屏图标（用本机 Edge 渲染，不引原生依赖）
```

稿纸那套 e2e 里最要紧的一条不是"按钮亮没亮"，而是**用户写的 CSS 真的能生效**：
测完预设直接读 `getComputedStyle(文档根)`，断言背景是预设里那个颜色。这条同时验证了
`@scope` 被支持、以及 `@layer base` 的让路是真的（见坑 7）。

工具栏那节**不是在 DOM 上点按钮看它变不变色**，而是点完真的敲字进去、再从 store 读回 markdown 断言
（`点加粗后敲的字被 ** 包住`）—— 只有这样才同时证明「命令跑通了」和「焦点还给编辑器了」。

`mobile-e2e.mjs` 用 Pixel 7 的视口并带 `isMobile` + `hasTouch` —— 少了这两个，浏览器不按移动端处理，
媒体查询和触摸行为都验不到。它最后还会把视口切回 1500px，断言**桌面端没被改动**（侧栏仍是常驻 272px、
汉堡按钮隐藏、按钮文字回来、工具栏仍可换行）。

同一个脚本还守 `public/mobile.html` 那个壳页（它是**会随包发布的文件**，没有断言就会烂掉）：
断言 iframe 内视口真是 412×915、里面渲染的真是手机布局、切到「桌面 1280」后侧栏变回常驻 272px，
并在断点两侧各测一档。⚠️ 断点是 `width < 48rem`，**768 本身算桌面** —— 按「768 算手机」的直觉
写期望会假红（我第一版就是这么红的）。

`pwa-e2e.mjs` 必须跑在构建产物上（`:5184`）：开发期是 Vite 的内存模块图，没有可缓存的静态文件，
在 dev 上测 Service Worker 等于什么都没测。

`push-roundtrip.mjs` **每一步都有断言，不符预期就 exit 1**（它原来只 `console.log`，
网络一抖就"假绿"：顶栏写着「与远端一致」、远端文件还在，脚本照样退出 0）。
它开头先探一次 `api.github.com`，网络不通就直接告诉你"这是环境问题，别在这条线索上查 bug"。

几个脚本在 `chromium.launch` 之前会**清掉 `http_proxy` 等环境变量**并带 `--no-proxy-server`（坑 3）。
`smoke.mjs` 在左侧没有 md 时会跳过「打开 / 源码」两节，好让**纯本地的「创建笔记」在断网时也测得到**。

## 踩过的十个坑（都不报错，是测试抓出来的）

**1. GitHub `/git/ref/heads/{branch}` 有 CDN 缓存（约 60 秒）。**
推完立刻再比对，会拿回**推送前**的 HEAD → 远端 tree 里看不到刚推上去的文件 →
`decide()` 判成"无变化"，界面显示「与远端一致」，可文件其实已经推成功了。
手动点两次同步撞不见它（中间隔了几十秒缓存就过期了），只在"推完马上比对"时复现。
修法：`gh.ts` 的 `doFetch` 统一带 `cache: 'no-store'`。

**2. e2e 的「等空闲」不能等 DOM。**
原来等 `[data-sync]` 变成不 disabled，可 React 还没把 `busy` 渲染成 disabled 它就返回了 ——
断言全跑在任务**开始之前**，表现成随机假红/假绿。改成先等 `store.busy !== null`、
再等 `store.busy === null`。这也是为什么值得留一个 DEV 专用的 `window.__suisui`：
测试读真实状态，不靠猜 DOM。

**3. Playwright 会把 `http_proxy` / `https_proxy` 透传给浏览器。**
本机有这么一组环境变量，端口还会变（见过 56154 和 50606）。于是同一个
`api.github.com`，node 的 `fetch` 一路 200，浏览器却间歇性
`net::ERR_CONNECTION_CLOSED` / `ERR_TIMED_OUT` —— 这两件事看起来像玄学，其实是代理。
之前把一堆问题误判成"网络抖动"，就栽在这。
修法：测试里 `delete process.env.http_proxy`（含大小写各变体）+ `--no-proxy-server`。
⚠️ 改完这一条，之前"时红时绿"的用例全都稳定通过 —— **以后再遇到"浏览器连不上、某个进程连得上"，
先查代理透传，别急着怪网络。**

**4. 「本地没有 + 上次快照有 + 远端没动」= 本地删除 —— 这条判定会成片删远端文件。**
只要本地工作副本对某个文件"不知情"（拉取半途失败、状态被清过、脚本动过手），
三路判定就会认为你删了它，下次同步把远端对应文件一起删掉。**远端删除不可逆，且它只写进
一次 commit，很容易没注意。**（真实发生过：`notes/2026-09-21-随手.md`、`thoughts/2026-09-21-开张.md`
被这样删掉，已从历史提交恢复。）
修法：`syncOnce` 默认**只拉不删** —— 把要删的路径放进 `pendingDeletes`，顶栏弹一条红色确认条
（「这轮同步要从远端删掉 N 个文件：…」+「先不删 / 确认删除」），点过确认才真的删。
同时给 store 的异步操作加了序号（旧操作回来时发现号被顶掉就直接不写状态），
否则启动时那次自动比对会把手动同步的 `busy` 清成 null —— 界面显示"不忙"、请求还在飞，按钮还能再点一次。

**5. 所见即所得有 700ms 防抖窗口，切模式/切文件会在这段窗口里丢字。**
实测：在所即所得里敲完字**立刻**切「源码」，源码框显示的还是旧稿，在那儿改一下就把刚写的整个顶掉。
两个成因叠在一起：① `draft` 只在 `[current, lastSyncAt]` 变化时从 store 同步，**切模式不在依赖里**；
② store 的更新被 700ms 防抖压着，`content` 本身就是旧的。
修法：切模式前先 `flushEditor()`（把编辑器缓冲立刻写回 store）+ 编辑器卸载时兜底冲一次。
⚠️ 兜底那一次要跳过两种情形，否则修一个坏一个：**同步拉完那次重建**（缓冲区是拉取前的旧文本，
冲回去等于把刚拉下来的顶掉）、**文件已被删除**（不然"删除当前文件"会当场把它救回来 —— 这个是我
第一版改完立刻在 `smoke.mjs` 的清理步骤上撞到的）。

**6. `# 标题\n\n` 里的末尾空段落会被 markdown 解析吃掉。**
「创建笔记」的初始正文模板是 `# 标题\n\n`，但 remark 不会为结尾的 `\n\n` 生成空段落 —— 文档只剩一个 `<h1>`。
于是"把光标送进正文"实际落在标题里，一打字就接在标题后面（标题变成 `# 雨天 散步粗体测试`）。
修法：聚焦前先看一眼文档末尾，若是标题就补一个空 `paragraph`（`EditorPane.ensureTrailingParagraph`）。

**7. `@scope` 里的选择器不加特异性 —— 默认排版会反过来压死用户样式。**
稿纸想让用户自己写 CSS，范围用 `@scope (.rich-scope)` 圈住。但按 CSS Cascade 6，
**`@scope` 不给里面的选择器加特异性**：用户写 `h1 { color: … }` 就是 `(0,0,1)`，
而默认排版若写成 `.rich-scope h1` 就是 `(0,1,1)` —— 用户不写 `!important` 永远改不动标题颜色，
「这篇的 CSS」当场变成摆设。而这件事**不报错、不警告**，界面上只是"我写的怎么没反应"。
修法：稿纸的默认排版整块塞进 `@layer base`。未分层样式一律压过分层样式，用户怎么写都赢。
⚠️ 加默认样式时**别搬出那个图层**，也别改成 `.rich-scope h1` 那种前缀（那等于把用户锁死）。
e2e 里专门为此留了断言：套完「夜读」预设后读 `getComputedStyle(文档根)`，颜色必须是预设里那个。

**8. 回车提交时，这个回车的"默认动作"会漏进刚打开的编辑器。**
新建笔记是回车提交 → 提交里同步改 store → 新文件当场打开、正文编辑器挂载并抢到焦点；
可**按键的默认动作是在事件处理完之后才执行的**，此时焦点已经不在那个输入框上了，
于是这个回车落进正文，在文首插了一个空块。表现：新建的稿纸凭空多出 `<h1><br></h1>`，
而且它还会触发一次 `input`，把污染过的内容写回 store —— 看起来像"初始正文模板写错了"。
点「创建」按钮不会复现，只有回车会，所以特别容易漏。
修法：`FileTree` 里两个输入框的 Enter 分支都先 `e.preventDefault()` 再执行提交。
**"用键盘提交 + 提交后焦点会转移"这个组合，默认动作一律要掐掉。**

**9. Tailwind v4 的 `-translate-x-1/2` 走的是 `translate` 属性，不是 `transform`。**
手机上要让桌面居中弹层改成贴边，写了 `transform: none` —— **没生效，而且不报错**。
Tailwind v4 生成的是 `--tw-translate-x: -50%` + `translate: var(--tw-translate-x) …`，
它作用在 CSS 的独立变换属性上，`transform: none` 跟它压根不是同一个属性。
表现：弹层 `left/right` 都对了，却仍然往左偏了半个屏（量出来 `x = -182`，正好是 `12 - 194`）。
修法：媒体查询里 `translate: none` 和 `transform: none` 一起写。
⚠️ 同理，`scale` / `rotate` 也是独立属性 —— 覆盖 Tailwind v4 的变换时别只写 `transform`。

**10. 直接 `vite build` 会失败，而且失败得很脏 —— 本机有两个 Windows 怪脾气。**
构建第一步是清空 `dist/`，于是先撞上 `EPERM, Permission denied`（`vite:prepare-out-dir`）。
要命的是它**删到一半才失败**：`dist/assets/` 已经被删掉，`dist/index.html` 却还是旧的 ——
于是**正在跑的 preview 立刻变成一个白屏应用**（旧 html 指向已被删掉的新 hash 文件），
而构建日志只报一句权限错误，看的人容易以为没事。

两个独立的脾气（都不是"权限不足"四个字能解释的）：
- **目录级 `rename` 会被拒**：EPERM，换成别的目标名也一样；可同一个名字 `mkdir` / `rmdir`
  却是好的。所以"先建到暂存目录再整体换名"这种最常见的写法，在这台机器上直接不可用。
- **递归删目录（180+ 文件）会永不返回**：不是报错，是**卡住**（`rmSync` 挂在那儿几个小时都不会回来）。
  表现最迷惑：构建日志已经打完"改用拷贝"，进程就再也没动静了。逐个 `unlink` 反而一切正常。

修法：`scripts/build.mjs` 把这两条都绕开 —— 先建到暂存目录、自检引用的 `/assets/...` 都在、
再「删旧的 + 整目录拷贝」；暂存目录用逐个 unlink 清，且全程 best-effort（清不掉就留着，
它已 gitignore），绝不让"上一轮的残留"或"清理失败"拖住构建。
⚠️ **别把 `rename` 或 `rmSync(dir, {recursive:true})` 加回来。**

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/lib/gh.ts` | GitHub API 封装、git blob sha 计算、LF 归一 |
| `src/lib/decide.ts` | 三路判定纯函数（零依赖，可单测） |
| `src/lib/note.ts` | 笔记命名规则：`notePath` / `slugifyNoteTitle` / `dedupePath`（零依赖，可单测） |
| `src/lib/visible.ts` | 「哪些文件不该显示在左侧」的展示层规则（零依赖，可单测） |
| `src/lib/mdkit.ts` | md 工具栏**源码模式**的 md 语法改写（零依赖，可单测）＋ 两种模式共用的 `ToolId` / `Active` |
| `src/lib/rich.ts` | 稿纸格式内核：拆合「这篇的 CSS / 正文」、`scopedCss` 圈作用域、HTML 清洗、主题预设（零依赖，可单测） |
| `src/lib/folders.ts` | 文件夹：目录名清洗、标识文件、目录推导、嵌套建树（零依赖，可单测） |
| `src/lib/links.ts` | 双链与标签：解析、名字→路径、反向链接 / 标签索引、补全候选、`unescapeWiki`（零依赖，可单测） |
| `src/lib/pm-links.ts` | ProseMirror 插件：`[[ ]]` / `#tag` 的装饰（**不动 schema，只加 span**）、`[[` 补全的触发与插入 |
| `src/lib/providers/types.ts` | 同步后端的统一接口 `Remote` + 各家元数据（含"浏览器能不能直连 / 做完没有"） |
| `src/lib/providers/github.ts` | GitHub 实现（Git Data API，一个 commit） |
| `src/lib/providers/webdav.ts` | 坚果云实现（WebDAV）。请求走注入的 transport —— 浏览器没有，桌面端才有 |
| `src/lib/providers/onedrive.ts` | OneDrive 实现（Microsoft Graph）。只接 token，授权留位 |
| `src/lib/providers/davxml.ts` | PROPFIND 响应解析（零依赖，可单测 —— 用正则而非 DOMParser） |
| `src-tauri/` | 桌面端骨架。目前只提供 `dav_request`：让坚果云绕开 CORS |
| `src/lib/sync.ts` | 同步编排（先拉 → 冲突留副本 → 确认后才删 → 再推） |
| `src/lib/store.ts` | Zustand 状态（本地工作副本 + 快照）。**异步操作带序号，防止旧操作覆盖新状态** |
| `src/components/RichPane.tsx` | 稿纸编辑器（contenteditable，非受控）＋ 落盘时机控制 |
| `src/components/RichToolbar.tsx` | 稿纸的 25 个工具 + 色板 / 字号字体弹层 |
| `src/components/EditorShell.tsx` | 编辑器外壳（台面 → 纸面 → 路径栏 / 模式开关 / 面包屑）。md 与稿纸共用，**必须留在主包里** |
| `src/components/EmptyState.tsx` | 编辑区的两种"还没有编辑器"状态（空态 / 加载骨架）。**必须在主包里** —— 见「已实现」里的按需加载 |
| `src/components/WikiHints.tsx` | `[[` 补全浮层（跟着 `[[` 那个字符定位，mousedown 掐默认动作以保住编辑器焦点） |
| `src/components/BacklinkPane.tsx` | 正文下方的反向链接 / 标签 / 待建笔记面板（有关系才出现） |
| `src/components/` | 顶栏（含移动端抽屉开关） / **左下角 dock（同步 + 设置）** / 文件树（含「创建笔记」、标签筛选） / 编辑器 / **格式工具栏** / 差异列表 / 状态栏 / 图标集 |
| `src/main.tsx` | 入口。DEV 下把 store 挂到 `window.__suisui`；**只在 PROD 注册 Service Worker** |
| `public/manifest.webmanifest` | PWA 清单（standalone / 图标 / 语言） |
| `public/sw.js` | 离线外壳：导航 network-first，静态资源 SWR，跨域一律放行 |
| `public/mobile.html` | 手机壳预览页（真机尺寸 iframe，纯演示，不参与应用逻辑） |
| `public/icons/` | 主屏图标（`scripts/gen-icons.mjs` 生成，别手改） |
| `scripts/build.mjs` | 生产构建（暂存目录 + 自检 + 换目录）＋ 报首屏引用与 chunk 体积 |
| `scripts/gen-icons.mjs` | 生成 PWA 主屏图标（用本机 Edge 渲染，不引原生依赖） |

## 界面约定

一套「暖纸 + 墨 + 一枚黄铜」的视觉。台面（`desk`）是带极淡纸纹的暖灰底，
正文是摊在台面上的一张白纸（`sheet`，圆角 + 落影 + hairline，手机上退化为满屏）。
令牌全在 `src/styles.css` 的 `@theme` / `:root` 里，组件里**只用语义名**
（`bg-surface` / `text-ink-2` / `border-line` / `shadow-pop`…），不写裸 hex、不写裸阴影。

| 令牌 | 用途 |
| --- | --- |
| `paper` → `surface` → `surface-2` → `surface-3` | 台面 → 纸面 → 工具架/次级块 → 悬停 |
| `ink` / `ink-2` / `ink-3` | 三级文字 |
| `accent`（钢蓝） | 主按钮、当前选中、待拉取 |
| `craft`（黄铜） | 稿纸专属：稿纸图标、稿纸徽标 —— 「这张纸是你自己排的」的记号 |
| `ok` / `warn` / `danger` | 待推送 / 有未同步改动 / 冲突与错误 |
| `shadow-xs/sm/md/lg/pop/sheet` | 五级阴影，各对应一种语义（贴面控件 / 手里按钮 / 浮纸 / 压正文卡片 / 弹层 / 摊开的纸），**别跳级用** |
| `font-serif` | 只给"名字"：应用名、正文 h1/h2、空态主句。小字号（<14px）一律不用衬线 —— 中文衬线小字会点阵化发虚 |

- 编辑器外壳统一走 `src/components/EditorShell.tsx`（路径栏面包屑 + 模式开关 + 纸面）。
  md 和稿纸共用一套，**别再在各自的 Pane 里手写路径栏** —— 那正是之前两边漂移的原因。
  它必须留在主包里（EmptyState 的骨架也用它），所以它一个编辑器依赖都不能 import。
- 图标统一走 `src/components/icons.tsx`（16 格、`currentColor`、1.5 描边），不用 `●`、`×` 这类字符当图标。
- **正文测量宽度 = 46rem 居中**（`.editor-sheet`）。改这个宽度时，工具栏和提示条的
  `max-w-[46rem] px-6` 要一起改，否则左边界会错开。
- Milkdown 通过 `--crepe-color-*` / `--crepe-font-*` 映射到上面这套令牌（见 `.milkdown-wrap`），换主题只改一处。
- 关键控件保留 `data-*` 钩子（`data-sync` / `data-refresh` / `data-new` / `data-file` / `data-toggle-all`
  / `data-new-note` / `data-note-kind` / `data-note-title` / `data-note-dir` / `data-note-submit` / `data-delete-confirm`
  / `data-delete-ok` / `data-mode` / `data-md-toolbar` / `data-md="<工具id>"` / `data-md-link-pop`
  / `data-md-link-input` / `data-md-link-apply` / `data-source`
  / `data-rich-toolbar` / `data-rich="<命令>"` / `data-rich-pop` / `data-rich-swatch` / `data-rich-opt`
  / `data-rich-mode` / `data-rich-preset` / `data-rich-css` / `data-rich-css-panel` / `data-rich-doc`
  / `data-rich-source` / `data-rich-style`
  / `data-drawer` / `data-drawer-toggle` / `data-drawer-mask`
  / `data-dock` / `data-sync-count` / `data-cred-dot` / `data-sync-now` / `data-token`
  / `data-settings` / `data-settings-panel` / `data-settings-mask` / `data-settings-close` / `data-toggle="showall"`
  / `data-provider="<后端>"` / `data-dav-url` / `data-dav-user` / `data-dav-pass` / `data-dav-warn` / `data-od-token` / `data-od-base`
  / `data-new-folder` / `data-folder-name` / `data-folder-submit` / `data-dir="<目录>"` / `data-dir-del="<目录>"`
  / `data-folder-del-confirm` / `data-folder-del-ok` / `data-folder-del-cancel`
  / `data-wiki`（装饰 span，带 `data-heading`） / `data-tag` / `data-wiki-hints` / `data-wiki-hint="<序号>"` / `data-wiki-kind`
  / `data-backlinks` / `data-backlink-tag` / `data-backlink-from` / `data-backlink-create`
  / `data-tag-filter` / `data-tag-clear` / `data-tag-empty`
  / `data-editor-empty` / `data-editor-loading`），e2e 依赖它们。
- ⚠️ **点正文里的链接必须带 Ctrl / ⌘**（`click({ modifiers: ['Control'] })`），
  单击是"把光标放进去改字"；只有窄屏（≤768px）是单击就跳。测试里漏了 modifiers 会一直点不动。
- ⚠️ **文件树选中行的 `bg-surface` 不能换**：`tests/mobile-e2e.mjs` 靠
  `className.includes('bg-surface ')` 把当前行挑出来，再断言其余行没有常显删除按钮。
  换成别的底色（比如 bg-accent-soft）那条断言会当场假红。
- **工具栏按钮统一 `onMouseDown` preventDefault**：不放行的话按钮会抢走焦点，编辑器一失焦，
  两种模式的光标位置都得费劲找回来。
- **输入框里的回车要挡输入法组字**：中文输入法用回车"选词"时也会冒泡出 Enter，
  不挡的话打拼音一选字就把笔记建了（`FileTree.tsx` 的 `isComposing()`，判 `isComposing || keyCode === 229`）。
- 左侧过滤规则全在 `src/lib/visible.ts`：点开头的任意路径段、程序类后缀、`scripts`/`src`/`tests`/`assets`
  等目录、根目录的 README/License。想放开某个目录，改那个文件的 `PROGRAM_DIR` 集合即可。
  它**不是安全边界**，只是「眼不见为净」；被藏起来的文件在本地照常持有、照常同步。
  ⚠️ **`.rich` 刻意不在名单里** —— 稿纸文件要出现在左侧（当初就是为此没用 `.html` 当后缀）。
- 判断「看起来没对齐」这类视觉问题时，用 `getBoundingClientRect()` 量，别靠看截图 —— 截图缩放会骗眼睛。
- **稿纸的默认排版写在 `styles.css` 的 `@layer base` 块里**，锚点是 `.rich-scope`（= 正文容器，
  也是 `@scope` 的锚点）。想加默认样式加在那个块里；**想让它可被用户覆盖，就别搬出这个图层**（坑 7）。
  `.rich-scope` 在编辑态就是那个 contenteditable，所以默认排版和用户样式看到的是同一个盒子，
  不存在"编辑时和导出后长得不一样"。
- **移动端断点只有 `48rem` 一个**（对齐 Tailwind 的 `md`，别另外写 `768px`）。
  分界线是：**会改变定位 / 滚动行为的规则写进 `styles.css` 那个 `@media (width < 48rem)` 块**
  （抽屉、工具栏横滚、触摸尺寸、弹层贴边、安全区），**间距字号这类微调就地写 `max-md:` 变体**。
  理由是前者散在 JSX 里就看不出整体布局怎么变，后者贴着用它的地方更好改。
  那个块里用的是 `[data-*]` 钩子，和 e2e 同一批，不额外发明类名。
- **做旧式响应式时先量 `getBoundingClientRect()`，别信截图。** 这轮的两个真 bug 都是这么抓到的：
  遮罩"点不着"（其实点在了盖住屏幕中央的抽屉上）、弹层偏出半屏（Tailwind v4 的 `translate` 属性，坑 9）。
