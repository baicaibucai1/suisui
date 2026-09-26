// 编辑器上方的常驻格式工具栏。
//
// 它自己不碰文档：只把「用户点了什么」交给 EditorPane，由 EditorPane 决定是走
// Milkdown 命令（所见即所得）还是走 mdkit 的字符串改写（源码）。两种模式共用同一份
// Active，所以按钮的高亮规则只有一套。
import { useEffect, useRef, useState } from 'react';
import type { Active, ToolId } from '../lib/mdkit';
import {
  Bold,
  CodeBlock,
  Divider,
  InlineCode,
  Italic,
  Link,
  ListBullet,
  ListOrdered,
  Quote,
  Strike,
} from './icons';

type Props = {
  active: Active;
  onRun: (id: ToolId, payload?: string) => void;
  /** 光标处已有的链接地址，打开输入框时预填 */
  currentHref?: string;
};

const HEADINGS: { id: ToolId; label: string; level: number }[] = [
  { id: 'text', label: '正文', level: 0 },
  { id: 'h1', label: 'H1', level: 1 },
  { id: 'h2', label: 'H2', level: 2 },
  { id: 'h3', label: 'H3', level: 3 },
];

export default function MdToolbar({ active, onRun, currentHref }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [composing, setComposing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) inputRef.current?.focus();
  }, [linkOpen]);

  // 点别处 / 按 Esc 关掉输入框，别让它一直挂在正文上面
  useEffect(() => {
    if (!linkOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setLinkOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [linkOpen]);

  const openLink = () => {
    setHref(currentHref ?? '');
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!href.trim()) return;
    onRun('link', href.trim());
    setLinkOpen(false);
  };

  const btn = (
    id: ToolId,
    title: string,
    node: React.ReactNode,
    isOn: boolean,
    onClick?: () => void,
  ) => (
    <button
      key={id}
      type="button"
      data-md={id}
      title={title}
      aria-label={title}
      aria-pressed={isOn}
      // 别让按钮抢走焦点：编辑器一失焦，两种模式的光标位置都得费劲找回来
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick ?? (() => onRun(id))}
      className={`tool-btn px-[5px] ${
        isOn
          ? 'bg-accent-soft text-accent ring-1 ring-accent-line'
          : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
      }`}
    >
      {node}
    </button>
  );

  return (
    /*
     * 工具栏是"工具架"，比正文那张纸深一档（surface-2）——
     * 它不属于正文，也不该抢纸的位置。
     */
    <div ref={boxRef} className="relative shrink-0 border-b border-line bg-surface-2">
      <div
        data-md-toolbar
        className="mx-auto flex max-w-[46rem] flex-wrap items-center gap-[3px] px-6 py-[6px]"
      >
        {HEADINGS.map((h) =>
          btn(
            h.id,
            h.level === 0 ? '正文' : `标题 ${h.level}`,
            <span
              className={`text-[11.5px] ${h.level ? 'font-semibold' : ''}`}
              style={h.level ? { letterSpacing: '-0.02em' } : undefined}
            >
              {h.label}
            </span>,
            active.h === h.level,
          ),
        )}

        <Sep />

        {btn('bold', '加粗（Ctrl+B）', <Bold size={15} strokeWidth={1.6} />, active.bold)}
        {btn('italic', '斜体（Ctrl+I）', <Italic size={15} strokeWidth={1.6} />, active.italic)}
        {btn('strike', '删除线', <Strike size={15} strokeWidth={1.6} />, active.strike)}
        {btn('inlineCode', '行内代码', <InlineCode size={15} strokeWidth={1.6} />, active.inlineCode)}
        {btn(
          'link',
          '链接',
          <Link size={15} strokeWidth={1.6} />,
          active.link || linkOpen,
          linkOpen ? () => setLinkOpen(false) : openLink,
        )}

        <Sep />

        {btn('bullet', '无序列表', <ListBullet size={15} strokeWidth={1.6} />, active.bullet)}
        {btn('ordered', '有序列表', <ListOrdered size={15} strokeWidth={1.6} />, active.ordered)}
        {btn('quote', '引用', <Quote size={15} strokeWidth={1.6} />, active.quote)}
        {btn('codeBlock', '代码块', <CodeBlock size={15} strokeWidth={1.6} />, active.codeBlock)}
        {btn('hr', '分割线', <Divider size={15} strokeWidth={1.6} />, false)}
      </div>

      {linkOpen && (
        <div
          data-md-link-pop
          className="absolute left-1/2 top-full z-30 flex -translate-x-1/2 items-center gap-2 rounded-b-pop border border-t-0 border-line bg-surface px-3 py-2.5 shadow-pop"
        >
          <span className="text-[12px] text-ink-3">链接地址</span>
          <input
            ref={inputRef}
            data-md-link-input
            value={href}
            placeholder="https://…"
            onChange={(e) => setHref(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              // 中文输入法用回车选词也会冒泡出 Enter，不挡就会把半截地址提交上去
              if (composing || e.keyCode === 229) return;
              if (e.key === 'Enter') applyLink();
            }}
            className="h-7 w-64 rounded-[8px] border border-line bg-surface px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <button
            type="button"
            data-md-link-apply
            onClick={applyLink}
            disabled={!href.trim()}
            className="btn-primary h-7 rounded-[8px] bg-accent px-3 text-[12px] font-medium text-white transition-[box-shadow,opacity] duration-150 hover:opacity-90 disabled:opacity-40"
          >
            插入
          </button>
        </div>
      )}
    </div>
  );
}

function Sep() {
  return <span className="mx-[4px] h-[16px] w-px shrink-0 bg-line-2" />;
}
