import { useStore } from '../lib/store';
import {
  FONT_MAX,
  FONT_MIN,
  LINE_MAX,
  LINE_MIN,
  READER_FONTS,
  READER_THEMES,
  stepFontSize,
  themeOf,
} from '../lib/readerstyle';
import { Minus, Plus } from './icons';

/*
 * 「字体 / 字号 / 行距 / 纸色」这四行控件。
 *
 * 它同时被**两处**渲染：
 *   ① 阅读器抬头的「Aa」面板 —— 读的时候手边那个；
 *   ② 设置对话框的「阅读」一节 —— 一次调齐那一个。
 * 两处外观不同（一个是贴着顶栏的横排小面板，一个是设置里的竖排表单），
 * 但**控件本身必须是同一份**：否则就会出现"面板里能调到 32px、设置里卡在 28px"，
 * 或者一边多了一种纸色 —— 用户只是在描述两个不同的东西，其实是同一个偏好。
 *
 * 之所以还能这么写（同一个组件、两套 data-*）：`ns` 把两套钩子区分开。
 * 端到端测试正要分别点这两处的按钮，重名会让它分不清点的是哪一个。
 */

export default function ReaderStyleFields({
  ns,
  preview = false,
}: {
  /** data-* 前缀。`book` = 阅读器里那份，`set` = 设置里那份 */
  ns: 'book' | 'set';
  /** 要不要在下面挂一块实时预览（只有设置那一处给得起这个高度） */
  preview?: boolean;
}) {
  const prefs = useStore((s) => s.readerPrefs);
  const setReaderPrefs = useStore((s) => s.setReaderPrefs);

  /** `data-*` 钩子：`attr('font-plus')` → `{ 'data-book-font-plus': '1' }` */
  const attr = (k: string) => ({ [`data-${ns}-${k}`]: '1' });
  const theme = themeOf(prefs.theme);

  return (
    <div className="space-y-3">
      {/* ① 字体。每一项的样例字就用它自己那套字体画 —— 描述它的效果比给它命名更准 */}
      <Row label="字体">
        <div data-reader-fonts className="flex flex-wrap gap-1">
          {READER_FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              {...{ [`data-${ns}-font-btn`]: f.id }}
              onClick={() => void setReaderPrefs({ font: f.id })}
              title={f.hint}
              aria-pressed={prefs.font === f.id}
              style={{ fontFamily: f.css }}
              className={`min-w-[52px] rounded-[8px] border px-2.5 py-[5px] text-[12.5px] transition-colors ${
                prefs.font === f.id
                  ? 'border-accent-line bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Row>

      {/* ② 字号。给 +/- 而不是滑杆：字号是"再大一点""再小一点"的判断，看数字没意义 */}
      <Row label="字号">
        <div className="flex items-center gap-1">
          <button
            type="button"
            {...attr('font-minus')}
            onClick={() => void setReaderPrefs({ fontSize: stepFontSize(prefs.fontSize, -1) })}
            disabled={prefs.fontSize <= FONT_MIN}
            aria-label="缩小字号"
            className="grid h-7 w-7 place-items-center rounded-[7px] border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:pointer-events-none"
          >
            <Minus size={12} />
          </button>
          <span {...attr('font-size')} className="w-9 text-center text-[12.5px] text-ink">
            {prefs.fontSize}
          </span>
          <button
            type="button"
            {...attr('font-plus')}
            onClick={() => void setReaderPrefs({ fontSize: stepFontSize(prefs.fontSize, 1) })}
            disabled={prefs.fontSize >= FONT_MAX}
            aria-label="放大字号"
            className="grid h-7 w-7 place-items-center rounded-[7px] border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:pointer-events-none"
          >
            <Plus size={12} />
          </button>
          <span className="ml-1 text-[11px] text-ink-3">px</span>
        </div>
      </Row>

      {/* ③ 行距：这个给滑杆 —— 压到什么松紧算合适眼睛说了算，一格一格点没有意义 */}
      <Row label="行距">
        <label className="flex items-center gap-2">
          <input
            type="range"
            {...attr('line')}
            min={LINE_MIN}
            max={LINE_MAX}
            step={0.05}
            value={prefs.lineHeight}
            onChange={(e) => void setReaderPrefs({ lineHeight: Number(e.target.value) })}
            className="w-32 accent-accent"
          />
          <span {...attr('line-val')} className="w-8 text-right text-[12px] text-ink-2">
            {prefs.lineHeight.toFixed(2)}
          </span>
        </label>
      </Row>

      {/* ④ 纸色：五块色样，每块用自己那一档的纸色和字色画 —— 点之前就看得见效果 */}
      <Row label="纸色">
        <div data-reader-themes className="flex flex-wrap gap-1.5">
          {READER_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              {...{ [`data-${ns}-theme-btn`]: t.id }}
              onClick={() => void setReaderPrefs({ theme: t.id })}
              aria-pressed={prefs.theme === t.id}
              title={t.label}
              style={{ background: t.bg, color: t.ink }}
              className={`relative flex h-[30px] min-w-[58px] items-center justify-center rounded-[8px] border px-2 text-[12px] transition-[box-shadow,border-color] ${
                prefs.theme === t.id
                  ? 'border-ink-2 shadow-sm'
                  : 'border-line hover:border-line-2'
              }`}
            >
              {t.label}
              {prefs.theme === t.id && (
                <span className="absolute -bottom-[3px] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-current opacity-60" />
              )}
            </button>
          ))}
        </div>
      </Row>

      {/*
        预览。**它用的是跟正文一模一样的那两个属性**（data-book-theme / data-book-font），
        所以这里是"真的将来样子"，不是照着画的一张插图 ——
        插图可以跟实现走散（加一档纸忘了改图），同一个 CSS 不会。
      */}
      {preview && (
        <div
          data-reader-preview
          data-book-theme={prefs.theme}
          data-book-font={prefs.font}
          style={{ background: theme.bg }}
          className="rounded-[10px] border border-line p-3"
        >
          <div
            data-reader-preview-frame
            style={{ maxWidth: '46em' }}
            className="mx-auto"
          >
            <div
              className="book-body"
              style={{ fontSize: `${prefs.fontSize}px`, lineHeight: prefs.lineHeight }}
            >
              <h1 style={{ marginTop: 0 }}>第一章 夜里的纸</h1>
              <p>
                读书这件事，先要挑到自己看得舒服的字号和纸色 —— 有人要大字淡纸，
                有人偏要在夜里把整块屏压暗，没有哪种是对的。
              </p>
              <p>这一段<span className="book-note-mark">底下压着一道批注底色</span>，换纸色时它应该跟着变得看得见。</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-3">
        排版只影响阅读那一块，界面其他地方照旧；字体四档都是系统自带的，不额外下载。
      </p>
    </div>
  );
}

/** 一行：左边标签（名字），右边控件。标签宽度对齐，右边那列才不会各跳各的 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-8 shrink-0 text-[12px] text-ink-2">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
