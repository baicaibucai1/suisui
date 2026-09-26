// 桌面端的入口。
//
// 为什么要这一层：**坚果云的 WebDAV 不返回 CORS 头，浏览器直连一定被拦**
// （PROPFIND 是非简单请求，浏览器会先发一个不带凭据的 OPTIONS 预检，
//  坚果云照样要鉴权 → 预检永远失败；官方对此的答复是"我们实现的是标准 WebDAV"）。
// Rust 这边没有同源策略，请求想怎么发就怎么发 —— 所以 WebDAV 的那条路只在桌面端开。
//
// 目前只暴露一个命令 `dav_request`：前端把 method / url / headers / body 递过来，
// 这里发完把 status 和 body 原样送回去。**不在这里解释 WebDAV 语义** ——
// 那些逻辑（解析 PROPFIND、算指纹、三路比对）都在前端的 providers/webdav.ts 里，
// 一份代码三种端共用，才是这个设计的目的。

// 窗口标题栏走系统自带的，不画自绘标题栏
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
// `.path()` 是 Manager 这个 trait 给的（AppHandle 自己没有这个方法）——
// 出厂仓库要问程序的数据目录在哪，就得把它引进来
use tauri::Manager;

#[derive(serde::Serialize)]
struct DavReply {
    status: u16,
    text: String,
    /// 只在 `binary` 那趟才有：响应体的 base64。
    /// 为什么不直接塞进 text —— 那是一根 UTF-8 字符串管道，二进制过它会变成 U+FFFD，
    /// 附件当场就毁了（见前端 lib/binary.ts）。
    #[serde(skip_serializing_if = "Option::is_none")]
    base64: Option<String>,
}

/*
 * 下面这两个 base64 编解码是手写的：只为这一条通道用，加一个 crate 不值当
 * （而且离线机器上拉 crates.io 未必拉得到）。
 */
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn b64_val(c: u8) -> Result<u32, String> {
    match c {
        b'A'..=b'Z' => Ok((c - b'A') as u32),
        b'a'..=b'z' => Ok((c - b'a') as u32 + 26),
        b'0'..=b'9' => Ok((c - b'0') as u32 + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(format!("不是 base64 字符：{}", c as char)),
    }
}

fn b64_decode(input: &str) -> Result<Vec<u8>, String> {
    let s: Vec<u8> = input
        .bytes()
        // 空格和换行是手工编辑留下的，'=' 是补位，都不是数据
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out: Vec<u8> = Vec::with_capacity(s.len() / 4 * 3 + 3);
    for chunk in s.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= b64_val(c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

/// 一次 WebDAV 请求。出错就把原因说清楚 —— 前端那句"连不上"必须能指导行动。
#[tauri::command]
async fn dav_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    // 这一趟是附件：请求体走 body_base64，响应体走 DavReply::base64。
    // ⚠️ 这里只能用普通注释：Rust 的**函数参数上不允许写 /** 文档注释 */，
    // 只有 cfg / allow 那几个内置属性可以挂在参数上。
    binary: Option<bool>,
    body_base64: Option<String>,
) -> Result<DavReply, String> {
    let verb = method
        .parse::<reqwest::Method>()
        .map_err(|e| format!("不支持的请求方法 {method}：{e}"))?;

    let client = reqwest::Client::builder()
        // 坚果云偶尔 301 到别的节点，不跟随就拿到一段 HTML
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("建 HTTP 客户端失败：{e}"))?;

    let mut req = client.request(verb, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let is_binary = binary.unwrap_or(false);
    if is_binary {
        if let Some(b64) = body_base64 {
            req = req.body(b64_decode(&b64).map_err(|e| format!("附件内容不是合法 base64：{e}"))?);
        }
    } else if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| {
        let raw = e.to_string();
        if e.is_connect() {
            format!("连不上 {url} —— 检查网络或代理（{raw}）")
        } else if e.is_timeout() {
            format!("请求 {url} 超时（{raw}）")
        } else {
            format!("请求 {url} 失败（{raw}）")
        }
    })?;

    let status = res.status().as_u16();
    if is_binary {
        let bytes = res.bytes().await.unwrap_or_default();
        return Ok(DavReply {
            status,
            text: String::new(),
            base64: Some(b64_encode(&bytes)),
        });
    }
    let text = res.text().await.unwrap_or_default();
    Ok(DavReply { status, text, base64: None })
}

/*
 * ───────────────── 仓库：本机的一个文件夹 ─────────────────
 *
 * 这一组命令把「仓库」落到磁盘上：笔记就是仓库里的 .md 文件，书是 `<仓库>/books/` 下的 epub。
 * 前端拿到的是一堆相对路径 + 内容，跟原来 localStorage 里那份结构一模一样 ——
 * 所以同步（三路比对 / 推远端）那套逻辑一行都不用改。
 *
 * ⚠️ 三条硬规矩：
 *   ① **所有路径都先过 `inside()`**：拼出来的绝对路径必须仍在仓库根里面。
 *      路径是从前端传来的字符串，`..` 这种东西不挡住就是一个任意文件读写漏洞。
 *   ② **读写都不解释内容**：文本按 UTF-8 存，二进制走 base64（跟 `dav_request` 同一套
 *      手写 base64），Rust 这边不认识 md / epub，那是前端的事。
 *   ③ 出错就把原因说清楚（"没有这个目录" / "不是 UTF-8"），前端那句提示必须能指导行动。
 */

/// 仓库里一个文件的名字和大小（前端拿它建左侧那棵树）
#[derive(serde::Serialize)]
struct RepoEntry {
    path: String,
    size: u64,
}

/// 把「仓库根 + 相对路径」拼成绝对路径，并**确认它没跑出仓库**。
fn inside(root: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    let base = std::fs::canonicalize(root).map_err(|e| format!("仓库目录打不开 {root}：{e}"))?;
    // 空的相对路径 = 仓库根自己
    let joined = if rel.is_empty() {
        base.clone()
    } else {
        base.join(rel)
    };
    let full = if joined.exists() {
        std::fs::canonicalize(&joined).map_err(|e| format!("打不开 {rel}：{e}"))?
    } else {
        // 还不存在的文件（新建）无法 canonicalize —— 那就规范化它的父目录再接上文件名
        let parent = joined
            .parent()
            .ok_or_else(|| format!("路径不合法：{rel}"))?;
        let canonical_parent =
            std::fs::canonicalize(parent).map_err(|e| format!("目录 {} 还不存在：{e}", parent.display()))?;
        let name = joined
            .file_name()
            .ok_or_else(|| format!("路径不合法：{rel}"))?;
        canonical_parent.join(name)
    };
    if !full.starts_with(&base) {
        return Err(format!("路径跑出仓库了：{rel}"));
    }
    Ok(full)
}

/// 仓库里现在有哪些文件（相对路径）。目录和隐藏目录（`.suisui`）不列 ——
/// 那是书的存放处和程序自己的东西，不该进左边的笔记列表。
#[tauri::command]
fn repo_list(root: String) -> Result<Vec<RepoEntry>, String> {
    let base = inside(&root, "")?;
    let mut out = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        let rd = std::fs::read_dir(&dir).map_err(|e| format!("读不了目录 {}: {e}", dir.display()))?;
        for entry in rd.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // ⚠️ `.folder` 是**我们自己的目录标识文件**（空目录靠它留下来），
            // 按"点开头就是隐藏文件"滤掉它的表现是"刷新之后自建的空目录全没了"。
            if name == "books" || (name.starts_with('.') && name != ".folder") {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                let rel = path
                    .strip_prefix(&base)
                    .map_err(|_| "路径算不出相对名".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(RepoEntry {
                    path: rel,
                    size: entry.metadata().map(|m| m.len()).unwrap_or(0),
                });
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// 读一个文本文件（笔记正文）。不是合法 UTF-8 就说清楚，别悄悄替换成问号。
#[tauri::command]
fn repo_read(root: String, path: String) -> Result<String, String> {
    let full = inside(&root, &path)?;
    let bytes = std::fs::read(&full).map_err(|e| format!("读不了 {path}：{e}"))?;
    String::from_utf8(bytes).map_err(|_| format!("「{path}」不是 UTF-8 文本（多半是 GBK 写成的老文件）"))
}

/// 写文本文件。父目录自动建 —— 新笔记落在新建的文件夹里是常事。
#[tauri::command]
fn repo_write(root: String, path: String, text: String) -> Result<(), String> {
    let full = inside(&root, &path)?;
    if let Some(p) = full.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("建目录失败：{e}"))?;
    }
    std::fs::write(&full, text).map_err(|e| format!("写不了 {path}：{e}"))
}

/// 读二进制（epub）。走 base64 回来，跟 `dav_request` 一个道理。
#[tauri::command]
fn repo_read_bytes(root: String, path: String) -> Result<String, String> {
    let full = inside(&root, &path)?;
    let bytes = std::fs::read(&full).map_err(|e| format!("读不了 {path}：{e}"))?;
    Ok(b64_encode(&bytes))
}

#[tauri::command]
fn repo_write_bytes(root: String, path: String, base64: String) -> Result<(), String> {
    let full = inside(&root, &path)?;
    if let Some(p) = full.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("建目录失败：{e}"))?;
    }
    let bytes = b64_decode(&base64).map_err(|e| format!("内容不是合法 base64：{e}"))?;
    std::fs::write(&full, bytes).map_err(|e| format!("写不了 {path}：{e}"))
}

#[tauri::command]
fn repo_remove(root: String, path: String) -> Result<(), String> {
    let full = inside(&root, &path)?;
    if !full.exists() {
        return Ok(());
    }
    if full.is_dir() {
        std::fs::remove_dir_all(&full).map_err(|e| format!("删不了目录 {path}：{e}"))
    } else {
        std::fs::remove_file(&full).map_err(|e| format!("删不了 {path}：{e}"))
    }
}

/// 改名 / 搬家（目录连里面的一起走）
#[tauri::command]
fn repo_move(root: String, from: String, to: String) -> Result<(), String> {
    let src = inside(&root, &from)?;
    let dst = inside(&root, &to)?;
    if !src.exists() {
        return Err(format!("没有这个文件：{from}"));
    }
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("建目录失败：{e}"))?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("挪不动 {from} → {to}：{e}"))
}

/// 出厂目录：程序自己的数据目录下的 `repo`。
/// 「默认为程序目录」—— 用户不挑的时候就用它，之后随时能换。
#[tauri::command]
fn repo_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到程序数据目录：{e}"))?
        .join("repo");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建默认仓库失败：{e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// 校验一个目录能不能当仓库（存在 / 是目录 / 可写）。前端换仓库前先问一次。
#[tauri::command]
fn repo_check(root: String) -> Result<bool, String> {
    let full = inside(&root, "")?;
    if !full.is_dir() {
        return Err(format!("这不是一个文件夹：{root}"));
    }
    // 真写一下才知道有没有权限（磁盘满、只读、权限不足都会在这一步现形）
    let probe = full.join(".suisui-probe");
    std::fs::write(&probe, b"").map_err(|e| format!("这个文件夹写不进去（换一个吧）：{e}"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            dav_request,
            repo_list,
            repo_read,
            repo_write,
            repo_read_bytes,
            repo_write_bytes,
            repo_remove,
            repo_move,
            repo_default_dir,
            repo_check
        ])
        .run(tauri::generate_context!())
        .expect("启动桌面端失败");
}
