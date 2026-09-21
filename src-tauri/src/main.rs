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
}

/// 一次 WebDAV 请求。出错就把原因说清楚 —— 前端那句"连不上"必须能指导行动。
#[tauri::command]
async fn dav_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
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
    if let Some(b) = body {
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
    let text = res.text().await.unwrap_or_default();
    Ok(DavReply { status, text })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dav_request])
        .run(tauri::generate_context!())
        .expect("启动桌面端失败");
}
