// WebDAV 的 PROPFIND 解析。davxml.ts 零依赖纯函数，Node 可直接 import：
//   node tests/davxml.test.mjs
//
// 坚果云的 WebDAV 在浏览器里连不上（CORS），所以在真实环境里跑通之前，
// 这一层解析是唯一能在本机验的东西 —— 它错了会表现为"同步完一个文件都没有"，
// 而且不报错（目录全被当成不存在），是最难查的那类。
import { parsePropfind } from '../src/lib/providers/davxml.ts';

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

const xml = (items) =>
  `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">` +
  items
    .map(
      ([href, dir]) =>
        `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
        `<d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>` +
        `<d:getcontentlength>12</d:getcontentlength>` +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    )
    .join('') +
  `</d:multistatus>`;

console.log('\n— 基本形状 —');
eq(
  '分得出文件和目录',
  parsePropfind(
    xml([
      ['/dav/碎碎/', true],
      ['/dav/碎碎/notes/', true],
      ['/dav/碎碎/notes/a.md', false],
    ]),
    '/dav/碎碎',
  ),
  [
    { path: 'notes', dir: true },
    { path: 'notes/a.md', dir: false },
  ],
);

console.log('\n— 库根要剥掉 —');
eq('根目录自己不算一条', parsePropfind(xml([['/dav/碎碎/', true]]), '/dav/碎碎'), []);
eq('根目录带尾斜杠也一样', parsePropfind(xml([['/dav/碎碎/', true]]), '/dav/碎碎/'), []);
eq('绝对 URL 的 href', parsePropfind(xml([['https://dav.jianguoyun.com/dav/碎碎/a.md', false]]), '/dav/碎碎'), [
  { path: 'a.md', dir: false },
]);
eq('base 也写成绝对 URL', parsePropfind(xml([['https://dav.jianguoyun.com/dav/碎碎/a.md', false]]), 'https://dav.jianguoyun.com/dav/碎碎'), [
  { path: 'a.md', dir: false },
]);
eq('库外的东西不进列表', parsePropfind(xml([['/dav/别的/a.md', false]]), '/dav/碎碎'), []);

console.log('\n— URL 编码 —');
eq(
  '中文路径解码回来',
  parsePropfind(xml([['/dav/%E7%A2%8E%E7%A2%8E/%E7%A2%8E%E5%BF%B5/a.md', false]]), '/dav/碎碎'),
  [{ path: '碎念/a.md', dir: false }],
);
eq(
  '空格也解出来',
  parsePropfind(xml([['/dav/碎碎/my%20note.md', false]]), '/dav/碎碎'),
  [{ path: 'my note.md', dir: false }],
);
eq('坏编码不炸（原样留下）', parsePropfind(xml([['/dav/碎碎/a%ZZ.md', false]]), '/dav/碎碎').length, 1);

console.log('\n— 各家的写法差异 —');
eq(
  '没有命名空间前缀（有些服务器这么回）',
  parsePropfind(
    `<multistatus><response><href>/dav/碎碎/a.md</href><propstat><prop><resourcetype/></prop></propstat></response></multistatus>`,
    '/dav/碎碎',
  ),
  [{ path: 'a.md', dir: false }],
);
eq('空响应', parsePropfind('', '/dav/碎碎'), []);
eq('不是 XML 也不炸', parsePropfind('hello', '/dav/碎碎'), []);
eq(
  '集合标签带空格也认（<d:collection />）',
  parsePropfind(
    `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/碎碎/x/</d:href><d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`,
    '/dav/碎碎',
  ),
  [{ path: 'x', dir: true }],
);

console.log('\n— 只要文件 —');
const mixed = parsePropfind(
  xml([
    ['/dav/碎碎/notes/', true],
    ['/dav/碎碎/notes/1.md', false],
    ['/dav/碎碎/notes/sub/', true],
    ['/dav/碎碎/notes/sub/2.md', false],
  ]),
  '/dav/碎碎',
);
eq('目录项带 dir 标记', mixed.filter((i) => i.dir).map((i) => i.path), ['notes', 'notes/sub']);
eq('文件是完整相对路径', mixed.filter((i) => !i.dir).map((i) => i.path), ['notes/1.md', 'notes/sub/2.md']);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
