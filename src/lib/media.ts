import { useEffect, useState } from 'react';

/*
 * 一条媒体查询的订阅。
 *
 * 布局有两处「按宽度决定挂不挂组件」的地方（右栏的关系面板、正文底部的关系面板，
 * 同一个组件只能存在一份，不然 Playwright 的 strict 选择器当场冲突）。
 * CSS 的 hidden 只藏 DOM 不摘 DOM，所以得用 JS 判断 —— 这个 Hook 就是那句
 * `window.matchMedia(...).matches` 的订阅版：宽度跨过分界时跟着重渲染。
 */
export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return hit;
}

/** 桌面（>768px，侧栏常驻的那档）。跟 styles.css 里侧栏抽屉的分界保持一致。 */
export const WIDE = '(min-width: 769px)';
