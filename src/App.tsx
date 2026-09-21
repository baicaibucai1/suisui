import { Suspense, lazy, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import TopBar from './components/TopBar';
import FileTree from './components/FileTree';
import ChangeList from './components/ChangeList';
import { EditorLoading, EmptyState } from './components/EmptyState';
import StatusBar from './components/StatusBar';
import { useStore } from './lib/store';
import { isWallpaperOn, wallpaperFileUrl, wallpaperVars } from './lib/wallpaper';

/*
 * 编辑器**按需加载**。它带着 Milkdown / Crepe / KaTeX，压缩后 1.4MB ——
 * 而首屏真正需要的只有文件列表和顶栏。静态 import 的话，主包里就会多出这 1.4MB，
 * 手机在局域网/4G 上打开要白等好几秒，只为了看一个文件列表。
 * 拆开之后：主包只有几百 KB，点开第一篇笔记时才去下编辑器。
 * ⚠️ 别把 EditorPane 改成静态 import —— 首屏包体会当场涨回 1.7MB。
 */
const EditorPane = lazy(() => import('./components/EditorPane'));
// 设置面板同理：只有点开齿轮的人才需要它
const SettingsSheet = lazy(() => import('./components/SettingsSheet'));

const BASE = import.meta.env.BASE_URL;

export default function App() {
  const token = useStore((s) => s.token);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const current = useStore((s) => s.current);
  const wall = useStore((s) => s.wallpaper);
  const settings = useStore((s) => s.settings);

  /*
   * 壁纸**先下完再铺**。直接把 url 塞给 CSS 的话，切换时台面会先闪一下空白
   * （那一瞬背景图还没解码完），看着像页面重绘了一次。
   */
  const [wallUrl, setWallUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isWallpaperOn(wall) || !wall.id) {
      setWallUrl(null);
      return;
    }
    const u = wallpaperFileUrl(wall.id, BASE);
    let alive = true;
    const img = new Image();
    // 图没了（比如包里没带、被清掉）就退回纸纹，不要留一片空白的台面
    img.onload = () => alive && setWallUrl(u);
    img.onerror = () => alive && setWallUrl(null);
    img.src = u;
    return () => {
      alive = false;
    };
  }, [wall.enabled, wall.id]);

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
    <div
      className="desk flex h-full flex-col"
      data-wall={wallUrl ? '1' : '0'}
      style={wallpaperVars(wall, wallUrl) as CSSProperties}
    >
      {/*
        壁纸层：贴在台面最底下的一张画，**不参与布局、也不吃点击**。
        分两层是因为「模糊」只该作用在图上 —— 遮罩跟着一起糊的话，
        压暗的边缘会出现一圈模糊的硬边。
      */}
      {wallUrl && (
        <div className="desk-wall" aria-hidden="true">
          <div key={wall.id ?? 'none'} className="desk-wall-img wall-in" />
          <div className="desk-wall-veil" />
        </div>
      )}
      <TopBar />
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
        </aside>
        <main className="min-w-0 flex-1">
          {/*
            没选文件时不挂编辑器 —— 空态是个纯静态的提示，让它去拉编辑器那 1.4MB 是纯浪费。
            Suspense 的 fallback 只在「第一次点开文件、包还在路上」时出现，
            之后再切文件都是瞬间的（模块已经载入了）。
          */}
          {current ? (
            <Suspense fallback={<EditorLoading path={current} />}>
              <EditorPane />
            </Suspense>
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
      <StatusBar />
      {settings && (
        <Suspense fallback={null}>
          <SettingsSheet />
        </Suspense>
      )}
    </div>
  );
}
