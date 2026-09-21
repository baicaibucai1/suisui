// 「稿纸」的格式工具栏。
//
// 和 md 的工具栏（MdToolbar）分工一样：它自己不碰文档，只把「点了什么」交给
// RichPane 去执行。区别是这边多了一整组**样式**命令 —— 颜色、底色、字号、字体、
// 卡片，这些 markdown 语法层面根本没有，只能落到 CSS 上。这也是稿纸存在的理由。
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Card,
  CodeBlock,
  Divider,
  Highlighter,
  Indent,
  InlineCode,
  Italic,
  Link,
  ListBullet,
  ListOrdered,
  Outdent,
  Quote,
  Strike,
  TextColor,
  TextSize,
  Underline,
} from './icons';
import { BG_SWATCHES, INK_SWATCHES, RICH_FONTS, RICH_SIZES, toRgb } from '../lib/rich';
import type { RichActive, RichCmd } from '../lib/rich';

type Pop = 'ink' | 'bg' | 'type' | 'link' | null;

type Props = {
  active: RichActive;
  onRun: (cmd: RichCmd, payload?: string) => void;
  cssOpen: boolean;
  onToggleCss: () => void;
  /** 光标所在链接的地址，打开输入框时预填 */
  currentHref?: string;
};

export default function RichToolbar({ active, onRun, cssOpen, onToggleCss, currentHref }: Props) {
  const [pop, setPop] = useState<Pop>(null);
  const [href, setHref] = useState('');
  const [composing, setComposing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPop = (next: Exclude<Pop, null>) => setPop((cur) => (cur === next ? null : next));

  useEffect(() => {
    if (pop !== 'link') return;
    inputRef.current?.focus();
  }, [pop]);

  // 点别处 / 按 Esc 收起，别让面板一直压在正文上
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPop(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);

  const applyLink = () => {
    if (!href.trim()) return;
    onRun('link', href.trim());
    setPop(null);
  };

  const btn = (
    id: RichCmd | 'css',
    title: string,
    node: ReactNode,
    isOn: boolean,
    onClick: () => void,
  ) => (
    <button
      key={id}
      type="button"
      data-rich={id}
      title={title}
      aria-label={title}
      aria-pressed={isOn}
      // 别让按钮抢走焦点：contenteditable 一失焦，选区就没了，命令会落空
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`tool-btn px-[5px] ${
        isOn
          ? 'bg-accent-soft text-accent ring-1 ring-accent-line'
          : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
      }`}
    >
      {node}
    </button>
  );

  const run = (id: RichCmd) => () => onRun(id);

  const head = (id: RichCmd, label: string, level: number) =>
    btn(
      id,
      level === 0 ? '正文' : `标题 ${level}`,
      <span
        className={`text-[11.5px] ${level ? 'font-semibold' : ''}`}
        style={level ? { letterSpacing: '-0.02em' } : undefined}
      >
        {label}
      </span>,
      active.block === (level === 0 ? 'p' : (`h${level}` as RichActive['block'])),
      run(id),
    );

  return (
    /* 同 md 的工具栏：工具架比纸深一档 */
    <div ref={boxRef} className="relative shrink-0 border-b border-line bg-surface-2">
      <div
        data-rich-toolbar
        className="mx-auto flex max-w-[46rem] flex-wrap items-center gap-[3px] px-6 py-[6px]"
      >
        {head('p', '正文', 0)}
        {head('h1', 'H1', 1)}
        {head('h2', 'H2', 2)}
        {head('h3', 'H3', 3)}
        {btn('quote', '引用', <Quote size={15} strokeWidth={1.6} />, active.block === 'quote', run('quote'))}
        {btn('code', '代码块', <CodeBlock size={15} strokeWidth={1.6} />, active.block === 'pre', run('code'))}
        {btn('hr', '分割线', <Divider size={15} strokeWidth={1.6} />, false, run('hr'))}

        <Sep />

        {btn('bold', '加粗（Ctrl+B）', <Bold size={15} strokeWidth={1.6} />, active.bold, run('bold'))}
        {btn('italic', '斜体（Ctrl+I）', <Italic size={15} strokeWidth={1.6} />, active.italic, run('italic'))}
        {btn('underline', '下划线（Ctrl+U）', <Underline size={15} strokeWidth={1.6} />, active.underline, run('underline'))}
        {btn('strike', '删除线', <Strike size={15} strokeWidth={1.6} />, active.strike, run('strike'))}
        {btn('inlineCode', '行内代码', <InlineCode size={15} strokeWidth={1.6} />, active.inlineCode, run('inlineCode'))}
        {btn('link', '链接', <Link size={15} strokeWidth={1.6} />, active.link || pop === 'link', () => {
          setHref(currentHref ?? '');
          openPop('link');
        })}

        <Sep />

        {btn('left', '左对齐', <AlignLeft size={15} strokeWidth={1.6} />, active.align === 'left', run('left'))}
        {btn('center', '居中', <AlignCenter size={15} strokeWidth={1.6} />, active.align === 'center', run('center'))}
        {btn('right', '右对齐', <AlignRight size={15} strokeWidth={1.6} />, active.align === 'right', run('right'))}
        {btn('ul', '无序列表', <ListBullet size={15} strokeWidth={1.6} />, active.ul, run('ul'))}
        {btn('ol', '有序列表', <ListOrdered size={15} strokeWidth={1.6} />, active.ol, run('ol'))}
        {btn('outdent', '减少缩进', <Outdent size={15} strokeWidth={1.6} />, false, run('outdent'))}
        {btn('indent', '增加缩进', <Indent size={15} strokeWidth={1.6} />, false, run('indent'))}

        <Sep />

        {btn(
          'color',
          '文字颜色',
          <TextColor size={15} strokeWidth={1.6} swatch={active.color || 'currentColor'} />,
          pop === 'ink',
          () => openPop('ink'),
        )}
        {btn(
          'bg',
          '底色高亮',
          <Highlighter size={15} strokeWidth={1.6} swatch={active.bg || 'currentColor'} />,
          pop === 'bg',
          () => openPop('bg'),
        )}
        {btn('size', '字号与字体', <TextSize size={15} strokeWidth={1.6} />, pop === 'type', () => openPop('type'))}
        {btn('card', '卡片块', <Card size={15} strokeWidth={1.6} />, active.card, run('card'))}
        {btn('css', '这篇的 CSS', <Braces size={15} strokeWidth={1.6} />, cssOpen, onToggleCss)}
      </div>

      {pop === 'ink' && (
        <Panel>
          <Legend>文字颜色</Legend>
          <Swatches
            colors={INK_SWATCHES}
            current={active.color}
            onPick={(c) => {
              onRun('color', c);
              setPop(null);
            }}
          />
          <ClearRow
            label="恢复默认（交给这篇的 CSS 决定）"
            onClick={() => {
              onRun('color', '');
              setPop(null);
            }}
          />
        </Panel>
      )}

      {pop === 'bg' && (
        <Panel>
          <Legend>底色高亮</Legend>
          <Swatches
            colors={BG_SWATCHES}
            current={active.bg}
            onPick={(c) => {
              onRun('bg', c);
              setPop(null);
            }}
          />
          <ClearRow
            label="去掉底色"
            onClick={() => {
              onRun('bg', '');
              setPop(null);
            }}
          />
        </Panel>
      )}

      {pop === 'type' && (
        <Panel>
          <Legend>字号</Legend>
          <div className="flex flex-wrap gap-1">
            {RICH_SIZES.map((s) => (
              <Opt
                key={s.label}
                kind="size"
                value={s.value}
                label={s.label}
                onClick={() => {
                  onRun('size', s.value);
                  setPop(null);
                }}
              />
            ))}
          </div>
          <Legend className="mt-3">字体</Legend>
          <div className="flex flex-wrap gap-1">
            {RICH_FONTS.map((f) => (
              <Opt
                key={f.label}
                kind="font"
                value={f.value}
                label={f.label}
                // 每个选项用自己那套字体渲染，选之前就能看出差别
                style={f.value ? { fontFamily: f.value } : undefined}
                onClick={() => {
                  onRun('font', f.value);
                  setPop(null);
                }}
              />
            ))}
          </div>
        </Panel>
      )}

      {pop === 'link' && (
        <Panel row>
          <span className="text-[12px] text-ink-3">链接地址</span>
          <input
            ref={inputRef}
            data-rich-link-input
            value={href}
            placeholder="https://…"
            onChange={(e) => setHref(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              // 中文输入法回车选词也会冒泡出 Enter，不挡就会把半截地址提交上去
              if (composing || e.keyCode === 229) return;
              if (e.key === 'Enter') applyLink();
            }}
            className="h-7 w-64 rounded-[8px] border border-line bg-surface px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <button
            type="button"
            data-rich-link-apply
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyLink}
            disabled={!href.trim()}
            className="btn-primary h-7 rounded-[8px] bg-accent px-3 text-[12px] font-medium text-white transition-[box-shadow,opacity] duration-150 hover:brightness-[1.06] disabled:opacity-40"
          >
            插入
          </button>
        </Panel>
      )}
    </div>
  );
}

function Sep() {
  return <span className="mx-[4px] h-[16px] w-px shrink-0 bg-line-2" />;
}

function Panel({ children, row }: { children: ReactNode; row?: boolean }) {
  return (
    <div
      data-rich-pop
      className={`absolute left-1/2 top-full z-30 -translate-x-1/2 rounded-b-pop border border-t-0 border-line bg-surface px-3 py-2.5 shadow-pop ${
        row ? 'flex items-center gap-2' : ''
      }`}
    >
      {children}
    </div>
  );
}

function Legend({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow mb-2 ${className}`}>{children}</div>;
}

function Swatches({
  colors,
  current,
  onPick,
}: {
  colors: string[];
  current: string;
  onPick: (c: string) => void;
}) {
  const now = toRgb(current);
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          data-rich-swatch={c}
          title={c}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          style={{ background: c }}
          className={`h-[18px] w-[18px] rounded-[6px] border border-line-2 transition-transform duration-100 hover:scale-110 ${
            now === toRgb(c) ? 'ring-2 ring-accent ring-offset-1' : ''
          }`}
        />
      ))}
    </div>
  );
}

function ClearRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-rich-clear
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="mt-2 w-full rounded-[8px] border border-line bg-surface-2 px-2 py-[5px] text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
    >
      {label}
    </button>
  );
}

/** 字号 / 字体里的一个选项。`data-rich-opt` 给 e2e 用。 */
function Opt({
  label,
  kind,
  value,
  style,
  onClick,
}: {
  label: string;
  kind: 'size' | 'font';
  /** 空串 = 恢复默认 */
  value: string;
  style?: CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-rich-opt={value || 'none'}
      data-opt-kind={kind}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-[8px] border border-line bg-surface px-2 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent"
    >
      <span style={style}>{label}</span>
    </button>
  );
}