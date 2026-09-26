import { useStore } from '../lib/store';
import type { Side } from '../lib/store';
import { Book, Pen } from './icons';

/*
 * 「书写 / 阅读」切换 —— 顶栏最左边那条分段控件。
 *
 * 为什么非得是它、而不是在文件标题栏里塞一颗 24px 的书图标：
 * 这两个功能共享同一块主区和同一条左栏，但它们**不是同一个地方** ——
 * 笔记会同步、书不进仓库也不进同步；在这两边来回走的时候，
 * 得有一眼就看得出"我现在在哪儿"的东西。图标按钮做不到这件事：
 * 它的意思是"你可以点我"，不是"你在哪儿"。
 *
 * ⚠️ 它原先长在左栏最顶上，现在归**顶栏最左**：那是这一屏的"身份位"，
 * 不是左栏的私有物 —— 左栏收起来之后它还得在（不然人就不知道自己在哪一半了）。
 */

const TABS: { id: Side; label: string; hint: string }[] = [
  { id: 'write', label: '书写', hint: '笔记 · 会同步' },
  { id: 'read', label: '阅读', hint: '书架 · 存本机，不同步' },
];

export default function ModeSwitch() {
  const side = useStore((s) => s.side);
  const setSide = useStore((s) => s.setSide);

  /*
   * 尺寸按**顶栏那条 42px** 定：外面不再包一层 padding（间距归顶栏管），
   * 高度压到 28px —— 34px 会顶到顶栏的上下边，看着像把那条撑裂了。
   */
  return (
    <div
      data-mode={side}
      role="tablist"
      aria-label="切换书写与阅读"
      className="grid shrink-0 grid-cols-2 gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[2px]"
    >
      {TABS.map((t) => {
        const on = side === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-mode-tab={t.id}
            onClick={() => setSide(t.id)}
            title={t.hint}
            className={`flex h-[26px] w-[62px] items-center justify-center gap-1.5 rounded-[7px] text-[12px] transition-colors ${
              on
                ? 'bg-surface font-medium text-ink shadow-xs'
                : 'text-ink-3 hover:bg-surface hover:text-ink-2'
            }`}
          >
            {t.id === 'write' ? <Pen size={12.5} /> : <Book size={12.5} />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
