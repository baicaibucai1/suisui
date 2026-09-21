fn main() {
    /*
     * ⚠️ 没有下面这行 rerun-if-changed 时，cargo 的默认规则是"包内任何文件变了就重跑
     * build.rs"—— 但 dist/ 在包外（../dist），vite build 重打前端 cargo 根本看不见，
     * 结果 exe 里永远嵌着上一次打包时的旧页面。声明之后 dist 一变就触发重编 + 重嵌。
     */
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
