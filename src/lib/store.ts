import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Change } from './decide';
import type { FileMap, Snapshot } from './sync';
import { planSync, syncOnce } from './sync';
import { dedupePath, noteBody, notePath } from './note';
import { RICH_EXT, richBody } from './rich';
import type { NoteKind } from './rich';
import type { GhConfig } from './gh';
import { DEFAULT_WALLPAPER, normalizeWallpaper } from './wallpaper';
import type { WallpaperConfig } from './wallpaper';

const ENV_TOKEN = (import.meta.env.VITE_GH_TOKEN as string | undefined) ?? '';

export const OWNER = (import.meta.env.VITE_GH_OWNER as string | undefined) ?? 'baicaibucai1';
export const REPO = (import.meta.env.VITE_GH_REPO as string | undefined) ?? 'ramblings';
export const BRANCH = (import.meta.env.VITE_GH_BRANCH as string | undefined) ?? 'main';

type Busy = null | 'plan' | 'sync';

/**
 * 每次「比对 / 同步」领一个号。异步回来时号被顶掉就说明有更新的操作在跑，
 * 这时**不能再写状态** —— 否则启动时的自动比对会把手动同步的 busy 清掉，
 * 界面显示「不忙」而请求还在飞，按钮也能再点一次。（踩过：端到端假绿）
 */
let opSeq = 0;

type State = {
  token: string;
  files: FileMap;
  snapshot: Snapshot;
  current: string | null;
  changes: Change[];
  log: string[];
  error: string | null;
  busy: Busy;
  lastSyncAt: string | null;
  dirty: boolean;
  /** 左侧是否连程序文件（脚本、配置、README…）一起显示。只影响展示，不影响同步。 */
  showAll: boolean;
  /** 「创建笔记」后自增，编辑器据此把光标放进正文（不持久化）。 */
  focusTick: number;
  /** 待确认的远端删除（本轮比对要删但还没点头）。非空时界面必须问一次。 */
  pendingDeletes: string[] | null;
  /**
   * 本地改过、但还没重新比对 —— 这时的 `changes` 是上一次比对的结果，已经过期。
   * 界面必须说「还没比对」，不能说「与远端一致」（刚建完笔记却显示一致，是会误导人的）。
   */
  planStale: boolean;
  /**
   * 移动端（≤768px）侧栏抽屉是否展开。桌面端侧栏常驻，这个值不起作用。
   * **不持久化** —— 每次打开都该是收起的，不能让人一进来就被抽屉糊住整屏。
   */
  drawer: boolean;
  /** 台面壁纸。**持久化**（换台机器也该是同一张桌子）。 */
  wallpaper: WallpaperConfig;
  /** 设置面板是否打开。不持久化 —— 每次进来被面板糊住半屏是打扰。 */
  settings: boolean;

  cfg: () => GhConfig;
  setToken: (t: string) => void;
  setShowAll: (v: boolean) => void;
  setDrawer: (v: boolean) => void;
  setWallpaper: (patch: Partial<WallpaperConfig>) => void;
  setSettings: (v: boolean) => void;
  setCurrent: (path: string | null) => void;
  setContent: (path: string, text: string) => void;
  createFile: (path: string) => void;
  removeFile: (path: string) => void;
  /** 按「目录 + 标题」造一篇新笔记，返回最终路径（重名会自动加 -2）。 */
  createNote: (dir: string, title: string, kind?: NoteKind) => string;
  refreshPlan: () => Promise<void>;
  doSync: (allowDelete?: boolean) => Promise<void>;
  cancelDeletes: () => void;
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      token: ENV_TOKEN,
      files: {},
      snapshot: {},
      current: null,
      changes: [],
      log: [],
      error: null,
      busy: null,
      lastSyncAt: null,
      dirty: false,
      showAll: false,
      focusTick: 0,
      pendingDeletes: null,
      planStale: false,
      drawer: false,
      wallpaper: DEFAULT_WALLPAPER,
      settings: false,

      cfg: () => ({ owner: OWNER, repo: REPO, branch: BRANCH, token: get().token }),

      setToken: (t) => set({ token: t }),
      setShowAll: (v) => set({ showAll: v }),
      setDrawer: (v) => set({ drawer: v }),
      // 过一遍 normalize：localStorage 里那份可能是旧版本写的、也可能被人手改过，
      // 脏值最多让壁纸不显示，不能在渲染时炸出来
      setWallpaper: (patch) => set({ wallpaper: normalizeWallpaper({ ...get().wallpaper, ...patch }) }),
      setSettings: (v) => set({ settings: v }),

      // 顺手收抽屉：手机上的侧栏是浮层，选完还盖着正文就等于白选了。
      // 桌面端抽屉本来就不可见，多带这一个字段没有任何影响。
      setCurrent: (path) => set({ current: path, drawer: false }),

      setContent: (path, text) => {
        const files = { ...get().files, [path]: text };
        set({ files, dirty: true, planStale: true });
      },

      createFile: (path) => {
        const p = path.trim().replace(/^\/+/, '');
        if (!p) return;
        const files = { ...get().files };
        if (!(p in files)) files[p] = `# ${p.replace(/\.md$/, '').split('/').pop()}\n\n`;
        set({ files, current: p, dirty: true, planStale: true, drawer: false });
      },

      removeFile: (path) => {
        const files = { ...get().files };
        delete files[path];
        set({
          files,
          current: get().current === path ? null : get().current,
          dirty: true,
          planStale: true,
        });
      },

      createNote: (dir, title, kind = 'md') => {
        const files = { ...get().files };
        // 后缀跟着格式走 —— 重名去重也得带上同一种后缀（note.ts 里从原路径取，不写死）
        const ext = kind === 'rich' ? RICH_EXT : 'md';
        // 重名不覆盖：撞了就加 -2 / -3
        const p = dedupePath(notePath(dir, title, undefined, ext), (x) => x in files);
        if (!(p in files)) files[p] = kind === 'rich' ? richBody(title) : noteBody(title);
        set({
          files,
          current: p,
          dirty: true,
          planStale: true,
          drawer: false,
          focusTick: get().focusTick + 1,
        });
        return p;
      },

      refreshPlan: async () => {
        const seq = ++opSeq;
        const { cfg, files, snapshot } = get();
        set({ busy: 'plan', error: null });
        try {
          const plan = await planSync(cfg(), files, snapshot);
          if (seq !== opSeq) return;
          set({ changes: plan.changes, busy: null, planStale: false });
        } catch (e) {
          if (seq !== opSeq) return;
          set({ busy: null, error: (e as Error).message });
        }
      },

      doSync: async (allowDelete = false) => {
        const seq = ++opSeq;
        const { cfg, files, snapshot } = get();
        set({ busy: 'sync', error: null, log: [], pendingDeletes: null });
        try {
          const res = await syncOnce(cfg(), files, snapshot, { allowDelete });
          if (seq !== opSeq) return;
          const blocked = new Set(res.pendingDeletes);
          set({
            files: res.files,
            snapshot: res.snapshot,
            // 这轮已经拉完/推完的都消掉，只留等确认的删除 —— 否则顶栏会一边显示
            // 「与远端一致」一边问你要不要删文件，自相矛盾
            changes: blocked.size ? get().changes.filter((c) => blocked.has(c.path)) : [],
            log: res.log,
            busy: null,
            dirty: blocked.size > 0,
            lastSyncAt: new Date().toLocaleTimeString('zh-CN'),
            pendingDeletes: blocked.size ? res.pendingDeletes : null,
            planStale: false,
          });
          const cur = get().current;
          if (cur && !(cur in res.files)) set({ current: Object.keys(res.files)[0] ?? null });
        } catch (e) {
          if (seq !== opSeq) return;
          set({ busy: null, error: (e as Error).message });
        }
      },

      cancelDeletes: () => set({ pendingDeletes: null }),
    }),
    {
      name: 'suisui.demo.v1',
      partialize: (s) => ({
        token: s.token,
        files: s.files,
        snapshot: s.snapshot,
        current: s.current,
        lastSyncAt: s.lastSyncAt,
        showAll: s.showAll,
        wallpaper: s.wallpaper,
      }),
    },
  ),
);
