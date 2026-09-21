import { useStore } from '../lib/store';
import { isProgramArtifact } from '../lib/visible';

export default function StatusBar() {
  const log = useStore((s) => s.log);
  const error = useStore((s) => s.error);
  const files = useStore((s) => s.files);
  const dirty = useStore((s) => s.dirty);
  const busy = useStore((s) => s.busy);
  const showAll = useStore((s) => s.showAll);
  const token = useStore((s) => s.token);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const current = useStore((s) => s.current);

  // 日志自带 ✔ 前缀，状态点已经表达了"成功"，这里去掉避免重复
  const tail = (log.slice(-1)[0] ?? '').replace(/^✔\s*/, '');
  const paths = Object.keys(files);
  // 同步始终是全量，所以这里两个数都给：左侧看得见的 / 本地实际持有的
  const shown = showAll ? paths.length : paths.filter((p) => !isProgramArtifact(p)).length;
  const countText = showAll ? `${paths.length} 个文件` : `${shown} / ${paths.length} 个文件`;
  const chars = current ? (files[current] ?? '').replace(/\s/g, '').length : 0;

  const tone = error ? 'bg-danger' : busy ? 'bg-warn' : dirty ? 'bg-warn' : 'bg-ok';
  const message = error ? `错误：${error}` : busy ? '正在与远端通信…' : dirty ? '有未同步的改动' : tail;

  return (
    <footer className="status-bar flex h-[30px] shrink-0 items-center gap-3 border-t border-line bg-surface px-4 text-[11.5px] max-md:gap-2 max-md:px-3">
      <span className="flex items-center gap-1.5">
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${tone} ${busy ? 'animate-pulse' : ''}`} />
        <span className={error ? 'text-danger' : 'text-ink-2'}>{error ? '出错' : busy ? '通信中' : '就绪'}</span>
      </span>

      <span className={`min-w-0 flex-1 truncate ${error ? 'text-danger' : 'text-ink-3'}`}>{message}</span>

      {/* 下面这几个都是桌面才有地方摆的细节；手机上留状态点和消息就够 */}
      {current && chars > 0 && (
        <span className="shrink-0 tabular-nums text-ink-3 max-md:hidden">{chars} 字</span>
      )}
      <span
        className="shrink-0 tabular-nums text-ink-3 max-md:hidden"
        title="左侧可见 / 本地实际持有（程序文件只是不显示，照常同步）"
      >
        {countText}
      </span>
      <span className="shrink-0 text-ink-3 max-md:hidden">{token ? '凭据已配置' : '未配置凭据'}</span>
      {lastSyncAt && (
        <span className="shrink-0 tabular-nums text-ink-3 max-md:hidden">同步于 {lastSyncAt}</span>
      )}
    </footer>
  );
}
