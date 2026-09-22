/*
 * 同步后端的统一接口。GitHub / 坚果云（WebDAV）/ OneDrive 三种都实现它，
 * 上面的比对引擎（sync.ts）只认这个接口，不认任何一家。
 *
 * ## 一个关键的取舍：`list()` 返回的 sha 必须是**内容指纹**
 *
 * 三路比对（decide.ts）比较的是「本地 sha × 上次快照 × 远端 sha」三个值，
 * 它俩必须是**同一种算法**，同步完两边内容相同 → 指纹也相同，才能用一个值代表"基线"。
 * GitHub 的 blob sha 正好就是 git 的 blob 哈希，本地算得出来。
 *
 * 网盘没有这个东西：WebDAV 给的是 ETag，OneDrive 给的是 quickXorHash ——
 * 算法跟本地不一样，若直接拿来当基线，"本地没动"会被误判成"本地改了"（两边永远不等）。
 * 所以非 Git 后端在 list 时**把内容取回来算指纹**，而不是拿服务端给的标签。
 * 代价是列目录要下载全部内容；笔记库是这个量级（几十篇、每篇几 KB），
 * 换来的是判定表和快照格式一家都不用改 —— 这个交换是值的。
 * 实现里要把取回来的内容缓存住，`read()` 直接用，别再下一次。
 */

export type ProviderId = 'github' | 'nutstore' | 'onedrive';

export type RemoteEntry = {
  path: string;
  /** 内容的 blob 指纹（git blob sha1）。算法必须和本地 `blobSha()` 一致。 */
  sha: string;
};

/** 一批待落远端的改动。`content === null` 表示删除这个路径。 */
export type RemoteChange = {
  path: string;
  content: string | null;
  /**
   * 内容的编码。**附件走 `base64`** —— 这类后端收到的字符串是 base64，
   * 落到仓库里的是解码后的原始字节（指纹因此才对得上）。
   * 不写就是 `'utf-8'`，也就是"这就是文件原文"。
   */
  encoding?: 'utf-8' | 'base64';
};

export type Remote = {
  readonly id: ProviderId;
  readonly label: string;
  /** 列出远端所有文件。**目录不进列表** —— 目录靠路径里的 `/` 表达。 */
  list(): Promise<RemoteEntry[]>;
  /** 读一个文件的原文（已归一化为 LF 无 BOM）。**别用它读附件** —— 见 readBytes。 */
  read(path: string): Promise<string>;
  /**
   * 读一个文件的**原始字节**（附件专用）。
   * ⚠️ 这一条不能省：浏览器/后端的文本解码会把二进制解坏（见 lib/binary.ts 第 3 条）。
   */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * 落一批改动。
   * GitHub 是一个 commit（原子）；网盘没有事务，只能逐个 PUT / DELETE，
   * 中途失败就是"一部分上去了" —— 下轮比对会接着补，但**不能假装它原子**。
   */
  write(changes: RemoteChange[], message: string): Promise<void>;
};

/** 给界面的元数据：能不能在浏览器里直接用、现在接好了没有 */
export type ProviderMeta = {
  id: ProviderId;
  label: string;
  hint: string;
  /** 浏览器直连能不能通。false 的原因要写进 hint（坚果云：WebDAV 不带 CORS 头） */
  webOk: boolean;
  /** 这条链路做完了没有。false 时界面必须标「待接入」，不许给一个按了没反应的按钮。 */
  ready: boolean;
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'github',
    label: 'GitHub',
    hint: '现在用的：一个仓库当库，一次同步一个 commit',
    webOk: true,
    ready: true,
  },
  {
    id: 'nutstore',
    label: '坚果云',
    hint: '走 WebDAV。坚果云的服务器不返回 CORS 头，浏览器直连必被拦 —— 得在桌面端里跑',
    webOk: false,
    ready: true,
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    hint: '走 Microsoft Graph（浏览器可以直连），但 OAuth 要一个 Azure 应用的 client_id —— 授权还没接',
    webOk: true,
    ready: false,
  },
];

export class RemoteError extends Error {
  provider: ProviderId;
  constructor(provider: ProviderId, message: string) {
    super(message);
    this.provider = provider;
    this.name = 'RemoteError';
  }
}
