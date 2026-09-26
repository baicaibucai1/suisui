// 附件（图片 / PDF）的二进制内核覆盖。binary.ts 是零依赖纯函数，Node 可直接 import：
//   node tests/binary.test.mjs
//
// 这里验的是**三条最容易错的规矩**（见 src/lib/binary.ts 文件头）：
//   ① 附件绝不过 normalizeText
//   ② 指纹按**解码后的字节**算，不是按 base64 字符串
//   ③ 大小、MIME、data URL 都从后缀推，别在别处各写一份
import { createHash } from 'node:crypto';
import {
  ATTACH_LIMIT,
  base64Bytes,
  base64ToBytes,
  bytesSha,
  bytesToBase64,
  dataUrl,
  extOf,
  isBinaryPath,
  isImagePath,
  isPdfPath,
  isTooBig,
  mimeOf,
  prettySize,
  storedSha,
  tryBase64ToBytes,
} from '../src/lib/binary.ts';
import { parseEmbed, parseTags, parseWiki, resolveFile } from '../src/lib/links.ts';

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
    console.log(`  ✗ ${label}\n      得到 ${g}\n      期望 ${w}`);
  }
};

console.log('\n== 后缀 → 类型 / MIME');
eq('后缀', extOf('thoughts/a.PNG'), 'png');
eq('没有后缀', extOf('notes/开张'), '');
eq('点开头的不算后缀', extOf('notes/.folder'), '');
eq('png 是图片', isImagePath('a.png'), true);
eq('JPG 大小写都认', isImagePath('a.JPG'), true);
eq('svg 也算图片', isImagePath('a.svg'), true);
eq('pdf 不是图片', isImagePath('a.pdf'), false);
eq('pdf 是 pdf', isPdfPath('a.pdf'), true);
eq('png 不是 pdf', isPdfPath('a.png'), false);
eq('md 不是附件', isBinaryPath('a.md'), false);
eq('png 是附件', isBinaryPath('x/y/a.png'), true);
eq('pdf 是附件', isBinaryPath('x/y/a.pdf'), true);
eq('MIME：png', mimeOf('a.png'), 'image/png');
eq('MIME：jpeg', mimeOf('a.jpeg'), 'image/jpeg');
eq('MIME：pdf', mimeOf('a.pdf'), 'application/pdf');
eq('MIME：svg', mimeOf('a.svg'), 'image/svg+xml');
eq('MIME：认不出就退回 octet-stream', mimeOf('a.zzz'), 'application/octet-stream');

console.log('\n== data URL');
eq('data URL', dataUrl('a.png', 'AAAA'), 'data:image/png;base64,AAAA');
// 手工粘进来的 base64 常带换行 —— data URL 里留着换行图片就裂了
eq('base64 里的换行要吃掉', dataUrl('a.png', 'AA\nAA'), 'data:image/png;base64,AAAA');

console.log('\n== base64 ↔ 字节');
{
  // 一个最小 PNG 的前几个字节：0x89 P N G \r \n
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128]);
  const b64 = bytesToBase64(bytes);
  eq('编出来是标准 base64', b64, 'iVBORw0KGgoA/4A=');
  eq('解回去一模一样', Array.from(base64ToBytes(b64)), Array.from(bytes));
  eq('带空白也能解', Array.from(base64ToBytes('iVBORw0K\nGgoA/4A=')), Array.from(bytes));
  eq('坏 base64 返回 null（不抛）', tryBase64ToBytes('这不是 base64 !!'), null);
  eq('空串解出空数组', Array.from(base64ToBytes('')).length, 0);
}

console.log('\n== 大块不分帧也不爆栈');
{
  // 1.5MB：一次性 String.fromCharCode(...arr) 会 RangeError，分块不会
  const big = new Uint8Array(1_500_000);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  const b64 = bytesToBase64(big);
  const back = base64ToBytes(b64);
  eq('往返长度一致', back.length, big.length);
  eq('头尾字节对得上', [back[0], back[1], back[big.length - 1]], [big[0], big[1], big[big.length - 1]]);
}

console.log('\n== 指纹：按字节算，不是按 base64 字符串算');
{
  const text = 'hello 碎碎\n';
  const bytes = new TextEncoder().encode(text);
  const want = createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)]))
    .digest('hex');
  eq('和 git 的 blob 哈希一致', await bytesSha(bytes), want);
  eq('storedSha 解开了再算', await storedSha(bytesToBase64(bytes)), want);
  eq('storedSha 对坏数据返回 null', await storedSha('!!!'), null);
  eq('按 base64 字符串算会不一样（所以不能那么算）', await bytesSha(new TextEncoder().encode(bytesToBase64(bytes))) === want, false);
}

console.log('\n== 体积');
eq('base64 串对应的原始字节数', base64Bytes('iVBORw0KGgoA/4A='), 11);
eq('没有补位时', base64Bytes('AAAA'), 3);
eq('B', prettySize(512), '512 B');
eq('KB', prettySize(2048), '2.0 KB');
eq('MB', prettySize(3 * 1024 * 1024), '3.0 MB');
eq('没超限', isTooBig(ATTACH_LIMIT), false);
eq('超一个字节就算超', isTooBig(ATTACH_LIMIT + 1), true);

console.log('\n== 正文里的 ![[嵌入]]');
{
  const text = '看图：![[a.png]]，还有链接 [[开张]]';
  const embeds = parseEmbed(text);
  eq('一条嵌入', embeds.length, 1);
  eq('target 不含叹号', embeds[0].target, 'a.png');
  eq('区间含叹号', text.slice(embeds[0].from, embeds[0].to), '![[a.png]]');
  // 互斥：嵌入里那截不能再被当链接
  eq('嵌入不再当链接', parseWiki(text).map((l) => l.target), ['开张']);
  eq('显示文字照旧剥掉', parseEmbed('![[a.png|一张图]]')[0].target, 'a.png');
  eq('代码块里的不算嵌入', parseEmbed('`![[a.png]]`').length, 0);
  eq('嵌入里的 #标签 不算标签', parseTags('![[a#b.png]]').length, 0);
  eq('嵌入前后的标签照常', parseTags('#灵感 ![[a.png]]').map((t) => t.tag), ['灵感']);
}

console.log('\n== ![[图.png]] 里那个名字怎么落到文件上');
{
  const files = ['thoughts/dot.png', 'thoughts/a.md', 'notes/dot.png', 'imgs/logo.svg'];
  eq('带后缀的全名', resolveFile('dot.png', files, 'thoughts'), 'thoughts/dot.png');
  eq('同目录优先（两处同名）', resolveFile('dot.png', files, 'notes'), 'notes/dot.png');
  eq('写全路径', resolveFile('imgs/logo.svg', files, 'thoughts'), 'imgs/logo.svg');
  eq('./ 开头的相对写法', resolveFile('./dot.png', files, 'thoughts'), 'thoughts/dot.png');
  eq('/ 开头的也认', resolveFile('/imgs/logo.svg', files), 'imgs/logo.svg');
  eq('没有就是 null', resolveFile('nope.png', files), null);
  eq('空串 → null', resolveFile('  ', files), null);
  // 关键区别：笔记那套会剥掉后缀，附件这套必须留着
  eq('笔记解析器找不到带后缀的附件', resolveFile('dot', files, 'thoughts'), null);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
