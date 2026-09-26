/*
 * 阅读排版「取值守卫」的覆盖。
 *   node tests/readerstyle.test.mjs
 *
 * 这层全是纯数据 + 纯函数，不需要浏览器：测的是"任何脏东西进来，出去的都是一份
 * 合法偏好"。它重要是因为**两处入口共用这一个守卫** —— 它错了，阅读器和设置页
 * 就各自错出两种花样，比单点故障难查得多。
 */
import {
  DEFAULT_PREFS,
  FONT_MAX,
  FONT_MIN,
  LINE_MAX,
  LINE_MIN,
  READER_FONTS,
  READER_THEMES,
  clampPrefs,
  fontOf,
  stepFontSize,
  themeOf,
} from '../src/lib/readerstyle.ts';

let pass = 0;
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      got:  ${g}\n      want: ${w}`);
  }
};
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '   → ' + extra : ''}`);
  }
};

console.log('\n== 选项表自洽');
{
  // 字体与纸色的 id 各不重复 —— id 是落库的键，重复就等于两种东西共用一条记录
  const fids = READER_FONTS.map((f) => f.id);
  const tids = READER_THEMES.map((t) => t.id);
  eq('字体 id 不重复', new Set(fids).size, fids.length);
  eq('纸色 id 不重复', new Set(tids).size, tids.length);
  ok('纸色里有老版本认得的三档', ['paper', 'sepia', 'night'].every((t) => tids.includes(t)));
  ok('纸色扩到了五档', tids.length === 5, tids.join(','));
  ok('字体四档都是系统栈（不打包字体）', fids.length === 4, fids.join(','));
  // 每一档纸色都得自带字色：少了它，那一档就是"黑字黑底"或"白字白底"
  for (const t of READER_THEMES) {
    ok(
      `${t.label} 自带纸/墨/线三色`,
      t.bg.includes('--color-read') && t.ink.includes('--color-read') && t.link.includes('--color-read'),
    );
  }
}

console.log('\n== clampPrefs：脏值进来，合法值出去');
{
  eq('空手而来 = 出厂设置', clampPrefs(undefined), DEFAULT_PREFS);
  eq('null 同上', clampPrefs(null), DEFAULT_PREFS);
  eq('空对象同上', clampPrefs({}), DEFAULT_PREFS);

  // 旧版本的库记录没有 font 字段 —— 必须兜住而不是存个 undefined 进去
  const old = clampPrefs({ fontSize: 19, lineHeight: 2, theme: 'sepia' });
  eq('旧记录补上默认字体', old.font, DEFAULT_PREFS.font);
  eq('旧记录的字号照收', old.fontSize, 19);
  eq('旧记录的纸色照收', old.theme, 'sepia');

  eq(
    '超界的字号被夹住',
    clampPrefs({ fontSize: 99 }).fontSize,
    FONT_MAX,
  );
  eq('负字号被夹到下限', clampPrefs({ fontSize: -3 }).fontSize, FONT_MIN);
  eq('行距超上限被夹住', clampPrefs({ lineHeight: 5 }).lineHeight, LINE_MAX);
  eq('行距低于下限被夹住', clampPrefs({ lineHeight: 0.5 }).lineHeight, LINE_MIN);
  eq('非数字字号用默认', clampPrefs({ fontSize: 'big' }).fontSize, DEFAULT_PREFS.fontSize);
  eq('NaN 行距用默认', clampPrefs({ lineHeight: NaN }).lineHeight, DEFAULT_PREFS.lineHeight);
  eq('小数字号取整', clampPrefs({ fontSize: 17.6 }).fontSize, 18);

  // 认不出来的枚举值回默认：不炸，但也不能把脏值存回去
  eq('不认识的纸色回默认', clampPrefs({ theme: 'pink' }).theme, DEFAULT_PREFS.theme);
  eq('不认识的字体回默认', clampPrefs({ font: 'comic' }).font, DEFAULT_PREFS.font);
  ok(
    '五档纸色全被认',
    READER_THEMES.every((t) => clampPrefs({ theme: t.id }).theme === t.id),
  );
  ok(
    '四档字体全被认',
    READER_FONTS.every((f) => clampPrefs({ font: f.id }).font === f.id),
  );
}

console.log('\n== stepFontSize：±1 且夹边界');
{
  eq('往上一步', stepFontSize(17, 1), 18);
  eq('往下一步', stepFontSize(17, -1), 16);
  eq('顶到上限就停', stepFontSize(FONT_MAX, 1), FONT_MAX);
  eq('压到下限也停', stepFontSize(FONT_MIN, -1), FONT_MIN);
}

console.log('\n== themeOf / fontOf：坏 id 退到第一档');
{
  eq('纸色查得到', themeOf('night').label, '夜间');
  eq('纸色查不到回第一档', themeOf('pink'), READER_THEMES[0]);
  eq('字体查不到回第一档', fontOf('comic'), READER_FONTS[0]);
  eq('空值也回第一档', themeOf(null), READER_THEMES[0]);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
