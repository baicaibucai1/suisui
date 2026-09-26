// 导入 md 的解码与判定。零依赖纯函数，Node 可直接 import：
//   node tests/mdimport.test.mjs
//
// 这里压的是两件"错了不会报错、只会静默变坏"的事：
//   ① **编码**。GBK 文件按 utf-8 读出来的不是错误，是一篇满屏问号的笔记 ——
//      等用户发现，他的原文已经不在库里了（他看到的是乱码版本）。
//      所以 utf-8 用 fatal 严格解，解不通就换 gb18030，这条必须钉死。
//   ② **后缀判定**。只按后缀认，不看 MIME（浏览器给 .md 的 type 各家都不一样）。
import { MD_EXTS, decodeMarkdown, isMdName, stripExt } from '../src/lib/mdimport.ts';
import { importBase, importPath } from '../src/lib/note.ts';

let pass = 0;
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.log('  ✗ ' + label + '\n      得到 ' + g + '\n      期望 ' + w);
  }
};
const enc = (s) => new TextEncoder().encode(s);
/** 「中」= D6D0 「文」= CEC4（GBK）。整段不是合法 utf-8，严格解码会抛错 */
const GBK_BYTES = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

console.log('\n== 后缀判定');
eq('.md 认', isMdName('随手.md'), true);
eq('.markdown 认', isMdName('a.markdown'), true);
eq('.mdown 认', isMdName('a.mdown'), true);
eq('.txt 认（很多人拿它当草稿）', isMdName('草稿.txt'), true);
eq('大写后缀也认', isMdName('A.MD'), true);
eq('图片不认', isMdName('图.png'), false);
eq('doc 不认', isMdName('稿子.doc'), false);
eq('没有后缀不认', isMdName('README'), false);
eq('后缀只是名字的一部分时不认（a.md.txt 算 txt）', isMdName('a.md.txt'), true);
eq('名单里就是这四种', MD_EXTS, ['.md', '.markdown', '.mdown', '.txt']);

console.log('\n== 去后缀');
eq('去掉 .md', stripExt('随手.md'), '随手');
eq('去掉 .markdown', stripExt('a.markdown'), 'a');
eq('去掉 .txt', stripExt('草稿.txt'), '草稿');
eq('没有后缀原样返回', stripExt('README'), 'README');
eq('只去最后一个（a.md.md）', stripExt('a.md.md'), 'a.md');

console.log('\n== 解码：utf-8');
eq('中文原样', decodeMarkdown(enc('# 标题\n\n正文。')), '# 标题\n\n正文。');
eq('空文件是空串', decodeMarkdown(new Uint8Array(0)), '');
eq('纯 ASCII', decodeMarkdown(enc('hello')), 'hello');
eq(
  '带 BOM 的 utf-8：BOM 剥掉',
  decodeMarkdown(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# 标题')])),
  '# 标题',
);

console.log('\n== 解码：GBK 兜底');
eq('GBK 中文能解出来', decodeMarkdown(GBK_BYTES), '中文');
// 真实形态：ASCII 的标记 / 换行 + GBK 的中文。（不能拿 utf-8 的中文混进去 ——
// 那是个不存在的病态文件，两种编码的字节会被互相吃掉）
eq(
  'GBK 文件里混 ASCII（这才是真实的文件）',
  decodeMarkdown(new Uint8Array([...enc('# note\n\n'), ...GBK_BYTES, 0x0a])),
  '# note\n\n中文\n',
);
// 整篇都是 GBK（标题也是中文）：「笔」= B1 CA 「记」= BC C7
eq(
  '整篇 GBK，标题也是中文',
  decodeMarkdown(new Uint8Array([0xb1, 0xca, 0xbc, 0xc7])),
  '笔记',
);
{
  const got = decodeMarkdown(GBK_BYTES);
  eq('GBK 解出来不含替换字符 U+FFFD', got.includes('�'), false);
}
{
  // 二进制字节（不是文本）：gb18030 也能解出字来，所以要看它有没有变成 U+FFFD
  const got = decodeMarkdown(new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]));
  eq('真不是文本时至少不抛错（有内容返回）', typeof got === 'string', true);
}

console.log('\n== 落库路径');
eq('加到目录下', importBase('thoughts', '随手'), 'thoughts/随手.md');
eq('根目录也能落', importBase('', '随手'), '/随手.md');
eq('目录末尾多一道斜杠不重复', importBase('thoughts/', '随手'), 'thoughts/随手.md');
eq('名字里的斜杠会被清掉（不能凭空多出一层）', importBase('thoughts', 'a/b'), 'thoughts/ab.md');
eq('名字清完是空的 → 未命名', importBase('thoughts', '???'), 'thoughts/未命名.md');

console.log('\n== 重名：加 -2，绝不覆盖');
{
  const has = new Set(['thoughts/随手.md']);
  eq('撞了就 -2', importPath('thoughts', '随手', (p) => has.has(p)), 'thoughts/随手-2.md');
}
{
  const has = new Set(['thoughts/随手.md', 'thoughts/随手-2.md']);
  eq('连撞两个到 -3', importPath('thoughts', '随手', (p) => has.has(p)), 'thoughts/随手-3.md');
}
eq('没撞就不动', importPath('thoughts', '别的', () => false), 'thoughts/别的.md');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
