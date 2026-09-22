import { Suspense, lazy, useEffect } from 'react';
import FileTree from './components/FileTree';
import ChangeList from './components/ChangeList';
import SideDock from './components/SideDock';
import RightPane from './components/RightPane';
import DeleteBanner from './components/DeleteBanner';
import { EditorLoading, EmptyState } from './components/EmptyState';
import StatusBar from './components/StatusBar';
import { useStore } from './lib/store';
import { isBinaryPath } from './lib/binary';
import { PanelRight } from './components/icons';

/*
 * 编辑器**按需加载**。它带着 Milkdown / Crepe / KaTeX，压缩后 1.4MB ——
 * 而首屏真正需要的只有文件列表和顶栏。静态 import 的话，主包里就会多出这 1.4MB，
 * 手机在局域网/4G 上打开要白等好几秒，只为了看一个文件列表。
 * 拆开之后：主包只有几百 KB，点开第一篇笔记时才去下编辑器。
 * ⚠️ 别把 EditorPane 改成静态 import —— 首屏包体会当场涨回 1.7MB。
 */
const EditorPane = lazy(() => import('./components/EditorPane'));
// 附件预览（图片 / PDF）。它自己很轻，里面的 pdf.js 是三级懒加载 ——
// 打开一张图不该为"也许以后要看 PDF"付 1MB
const PreviewPane = lazy(() => import('./components/PreviewPane'));
// 设置面板同理：只有点开齿轮的人才需要它
const SettingsSheet = lazy(() => import('./components/SettingsSheet'));

export default function App() {
  const token = useStore((s) => s.token);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const current = useStore((s) => s.current);
  const settings = useStore((s) => s.settings);
  const rightOpen = useStore((s) => s.rightOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);

  useEffect(() => {
    if (token) void refreshPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc 收抽屉。手机上没键盘，但桌面缩窄窗口时它就是个正常的浮层，
  // 而且「按 Esc 关掉浮层」是用户的第一直觉。
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, setDrawer]);

  return (
    <div className="desk flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1">
        {/*
          手机上侧栏是浮层，得有一层能点的东西把它收回去。
          桌面端这层是 display:none，等于不存在。
        */}
        {drawer && (
          <div
            data-drawer-mask
            onClick={() => setDrawer(false)}
            className="absolute inset-0 z-30 hidden bg-ink/25 backdrop-blur-[1px] max-md:block"
          />
        )}
        {/*
          侧栏本体两种形态共用同一个节点：桌面端是常驻的 272px 列，
          ≤768px 时由 styles.css 把它变成从左侧推入的抽屉（data-open 控制位置）。
          这样切窗口宽度不会重建文件树，滚动位置和折叠状态都留着。

          桌面端这列是**透明的**：文件列表直接坐在台面上，只有"当前打开的那篇"
          才是一张白纸 —— 一边是散着的纸，一边是摊开的那张，层次就出来了。
        */}
        <aside
          data-drawer
          data-open={drawer ? '1' : '0'}
          className="flex w-[272px] shrink-0 flex-col border-r border-line bg-paper md:bg-transparent"
        >
          <FileTree />
          <ChangeList />
          {/*
            左下角 dock：同步 + 设置。
            放在这一列的最后一层 = 永远贴在左下角；手机上这一列是抽屉，
            dock 跟着抽屉一起滑进来，同步就在手指够得着的地方。
          */}
          <SideDock />
        </aside>
        <main className="min-w-0 flex-1">
          {/*
            没选文件时不挂编辑器 —— 空态是个纯静态的提示，让它去拉编辑器那 1.4MB 是纯浪费。
            Suspense 的 fallback 只在「第一次点开文件、包还在路上」时出现，
            之后再切文件都是瞬间的（模块已经载入了）。
          */}
          {current ? (
            <Suspense fallback={<EditorLoading path={current} />}>
              {isBinaryPath(current) ? <PreviewPane /> : <EditorPane />}
            </Suspense>
          ) : (
            <EmptyState />
          )}
        </main>
        {/*
          右栏：大纲 + 关系（布局对齐 Obsidian 的第三条柱子）。
          手机上整条不渲染（组件内部用同一条媒体查询自己摘自己，
          关系面板那会儿回正文底部）；桌面可用顶栏的按钮收起。
        */}
        {rightOpen ? (
          <aside
            data-rightpane
            className="hidden w-[250px] shrink-0 flex-col border-l border-line bg-paper-2/30 md:flex"
          >
            <RightPane />
          </aside>
        ) : (
          /*
            收起之后原地留一条 12px 的窄轨：它是把右栏叫回来的唯一入口 ——
            开关长在右栏自己头上，栏没了开关也跟着没了，得有个人一直站在外面。
            桌面才有（手机上右栏本来就不出现，给它留轨是白占宽度）。
          */
          <button
            data-right-toggle
            onClick={() => setRightOpen(true)}
            aria-label="展开右栏"
            title="展开右栏（大纲 / 关系）"
            className="hidden w-3 shrink-0 items-center justify-center border-l border-line bg-paper-2/30 transition-colors hover:bg-surface-2 md:flex"
          >
            <PanelRight size={11} className="text-ink-3" />
          </button>
        )}
      </div>
      {/*
        删除确认横跨整屏、压在状态栏上面：它不能被收进左栏 ——
        手机上左栏是抽屉，关上就再也点不到「确认」了。
      */}
      <DeleteBanner />
      <StatusBar />
      {settings && (
        <Suspense fallback={null}>
          <SettingsSheet />
        </Suspense>
      )}
    </div>
  );
}
