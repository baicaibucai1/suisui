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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dav_request])
        .run(tauri::generate_context!())
        .expect("启动桌面端失败");
}
