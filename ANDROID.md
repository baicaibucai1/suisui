# 安卓端

分两块：**手机上怎么用**（现在就能用），和**怎么打出 apk**（要先装三样东西）。

---

## 一、现在就能用：手机浏览器打开

电脑上跑着预览服务，手机连同一个 WiFi 就能打开：

```
http://192.168.1.246:5184
```

> `192.168.1.246` 是这台电脑当前的局域网地址，**换网络就会变**。
> 变了就在电脑上重新查一次（`ipconfig`），端口 `5184` 不变。

两个端口的分工：

| 地址 | 是什么 | 什么时候用 |
| --- | --- | --- |
| `:5184` | 构建产物（`vite preview`），带离线外壳 | **平时就用这个** |
| `:5183` | 开发服务（`vite`），代码一改立刻生效 | 我改东西给你看的时候 |

手机上的变化：侧栏收进抽屉（左上角 ☰ 拉开，**选完文件自动收起**）；工具栏横向滚动而不是换行；
按钮放大到 36px 的手指尺寸；地址栏收放不会切掉正文；软键盘弹起时压缩视口，不盖住光标。

在手机上第一次打开要**重新填一次访问凭据**（点右上角钥匙图标）。token 存在浏览器本地，
按「地址 + 端口」隔离 —— 电脑上填过，不代表手机上填过。

> 局域网走的是 http，浏览器不把 `http://192.168.x.x` 当安全上下文，所以这里的
> **「添加到主屏幕」只是一个快捷方式**，离线缓存也不生效（只有 `localhost` 才给完整的 PWA 能力）。
> 想要真正装上去、断网也能写的那个，就是下面这个 apk。

---

## 二、打出 apk：先装三样东西

用的还是 **Tauri 2** —— 和将来的 Windows 端 exe 共用同一个壳，一份前端代码两端复用。

这台机器的实测状态：

| 需要 | 现状 |
| --- | --- |
| Rust | ✅ 1.98.1（但工具链是 `stable-x86_64-pc-windows-gnu`，见下面的提醒） |
| JDK 17 | ❌ 没有 |
| Android SDK + NDK | ❌ 没有 |
| Rust 的 4 个安卓 target | ❌ 没装 |
| Microsoft C++ Build Tools | ❌ 没有（Windows 端 exe 也要它） |

### 1) Android Studio（把 JDK 和 SDK / NDK 一起装上）

从 https://developer.android.com/studio 下载安装。装完打开 **SDK Manager**
（More Actions → SDK Manager），勾上这几项：

- Android SDK Platform
- Android SDK Platform-Tools
- Android SDK Build-Tools
- NDK (Side by side)
- Android SDK Command-line Tools

加起来大概 4~5 GB。

### 2) 环境变量

系统属性 → 环境变量，新建这三条：

```
JAVA_HOME      C:\Program Files\Android\Android Studio\jbr
ANDROID_HOME   C:\Users\Sogap\AppData\Local\Android\Sdk
NDK_HOME       %ANDROID_HOME%\ndk\27.2.12479018
```

`NDK_HOME` 末尾那串版本号，要看 `%ANDROID_HOME%\ndk\` 目录里**真实存在的那一个**，
别照抄 —— 每次 NDK 发版都会变。

### 3) Rust 的安卓 target

```
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

> ⚠️ 顺带一件迟早要处理的事：这台机器的 rustc 现在是 **gnu** 工具链，而 Tauri 在 Windows 上
> 官方走的是 **MSVC**。要出 Windows 端 exe 就得换：
>
> ```
> rustup toolchain install stable-x86_64-pc-windows-msvc
> rustup default stable-x86_64-pc-windows-msvc
> ```
>
> 换之前先装 Microsoft C++ Build Tools（安装时勾「使用 C++ 的桌面开发」）。

### 4) 出 apk

装好之后（这几步跑起来就行，我来做）：

```
npm i -D @tauri-apps/cli@latest      # 装 Tauri CLI
npx tauri android init                # 生成 src-tauri/gen/android（Gradle 工程）
npx tauri android build --apk         # 出包，第一次要十几分钟
```

产物在：

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

调试阶段用 `npx tauri android dev`，连着 USB 的手机上直接跑，改代码热重载。

---

## 还没做的事（说清楚，免得以为已经有了）

- **`src-tauri/` 还没建。** 上面那条 `android init` 会生成它。在 SDK 装好之前建它是白建 ——
  没法编译验证，等于摆一堆跑不通的配置，坏了也看不出来。
- **手机端现在靠 localStorage 存内容、靠 GitHub API 同步。** Tauri 版会换成写**真实文件**，
  复用同一套 `lib/sync.ts`（三路判定、只拉不删、删除要确认，这些已经写好并测过了）。
- **安卓端的自动更新还没接。** 桌面端的 updater 也还没接 —— 这两件是一起的。
- **没在真机上跑过。** 目前所有验证都在桌面 Edge 的手机视口里做的（Pixel 7 尺寸 +
  `isMobile` + `hasTouch`）。真机的手感、字体、输入法还得摸一遍。
