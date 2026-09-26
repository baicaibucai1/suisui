/*
 * EPUB 解析的覆盖。
 *   node tests/epub.test.mjs
 *
 * 这里是**真的造 zip**：没有真 epub 就谈不上解析对不对，拿几段 XML 字符串喂进去
 * 只证明了正则能匹配，证明不了 container → opf → manifest → spine 这条坐标系
 * 换算是通的（那才是这层最容易错的地方：href 相对 opf、`../` 要跳级、
 * spine 用的是 manifest 的 id 而不是路径）。
 *
 * 三种目录来源各造了一种书：nav.xhtml（EPUB3）/ toc.ncx（EPUB2）/ 都没有（兜底按正文标题）。
 */
import { strToU8, zipSync } from 'fflate';
import {
  chapterText,
  joinPath,
  readEpub,
  searchBook,
  unzipEpub,
} from '../src/lib/epub.ts';

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
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '   → ' + extra : ''}`);
  }
};
const step = (s) => console.log('\n== ' + s);

/** 造一本 epub。缺哪份用哪种默认值，见下面各例 */
const makeEpub = (extra = {}) => {
  const files = {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml':
      '<container version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<package><metadata>
        <dc:title>碎碎念</dc:title>
        <dc:creator>白菜</dc:creator>
      </metadata>
      <manifest>
        <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="../Images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
        <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      </manifest>
      <spine toc="toc">
        <itemref idref="c1"/>
        <itemref idref="c2"/>
      </spine></package>`,
    'OEBPS/Text/ch1.xhtml':
      '<?xml version="1.0"?><html><head><title>第一章</title></head><body><h1>第一章 起</h1><p>今天天气不错。</p><p>出门买了菜。</p></body></html>',
    'OEBPS/Text/ch2.xhtml':
      '<html><body><h1>第二章 承</h1><p>然后回家做饭，天气一直不错。</p><script>alert(1)</script></body></html>',
    'OEBPS/toc.ncx': `<?xml version="1.0"?><ncx><navMap>
        <navPoint><navLabel><text>第一章 起</text></navLabel><content src="Text/ch1.xhtml"/>
          <navPoint><navLabel><text>第一节</text></navLabel><content src="Text/ch1.xhtml#a"/></navPoint>
        </navPoint>
        <navPoint><navLabel><text>第二章 承</text></navLabel><content src="Text/ch2.xhtml"/></navPoint>
      </navMap></ncx>`,
    'Images/cover.jpg': 'not-a-real-jpeg',
    ...extra,
  };
  const u8 = {};
  for (const [k, v] of Object.entries(files)) u8[k] = strToU8(v);
  return zipSync(u8);
};

const read = (bytes) => readEpub(new Uint8Array(bytes));

step('解压');
{
  const files = unzipEpub(new Uint8Array(makeEpub()));
  ok('拿到了条目', Object.keys(files).length >= 6, Object.keys(files).join(' | '));
  ok('目录项被剔掉了（zip 里没有目录，这条只是确认不炸）', !('OEBPS/' in files));
  ok('内容对得上', files['META-INF/container.xml'] instanceof Uint8Array);
}

step('路径换算（三套坐标系靠它统一）');
eq('相对拼到 opf 目录后', joinPath('OEBPS', 'Text/ch1.xhtml'), 'OEBPS/Text/ch1.xhtml');
eq('../ 真跳一级', joinPath('OEBPS', '../Images/cover.jpg'), 'Images/cover.jpg');
eq('锚点被去掉', joinPath('OEBPS', 'Text/ch1.xhtml#a'), 'OEBPS/Text/ch1.xhtml');
eq('空 href 不给过', joinPath('OEBPS', '   '), '');
eq('根目录时不用带前导斜杠', joinPath('', 'ch1.xhtml'), 'ch1.xhtml');

step('读一本 EPUB2 的书（toc.ncx）');
{
  const b = read(makeEpub());
  ok('读出来了', !!b);
  eq('书名', b.title, '碎碎念');
  eq('作者', b.author, '白菜');
  eq('opf 目录', b.opfDir, 'OEBPS');
  eq('正文顺序', b.spine, ['OEBPS/Text/ch1.xhtml', 'OEBPS/Text/ch2.xhtml']);
  eq('封面（../ 跳级后）', b.cover, 'Images/cover.jpg');
  eq('目录带层级', b.toc.map((t) => `${t.level}:${t.label}`), [
    '0:第一章 起',
    '1:第一节',
    '0:第二章 承',
  ]);
  eq('目录里的锚点留着', b.toc[1].href, 'OEBPS/Text/ch1.xhtml#a');
}

step('读一本 EPUB3 的书（nav.xhtml）');
{
  const b = read(
    makeEpub({
      'OEBPS/nav.xhtml':
        '<html><body><nav epub:type="toc"><ol><li><a href="Text/ch1.xhtml">第一章</a>' +
        '<ol><li><a href="Text/ch1.xhtml#a">第一节</a></li></ol></li>' +
        '<li><a href="Text/ch2.xhtml">第二章</a></li></ol></nav></body></html>',
      'OEBPS/content.opf': `<package><metadata><dc:title>碎碎念</dc:title></metadata>
        <manifest>
          <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        </manifest>
        <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    }),
  );
  ok('读出来了', !!b);
  eq('走 nav 那条路', b.toc.map((t) => `${t.level}:${t.label}`), ['0:第一章', '1:第一节', '0:第二章']);
}

step('什么目录都没有 → 按正文标题兜底');
{
  const b = read(
    makeEpub({
      'OEBPS/content.opf': `<package><metadata><dc:title>无目录</dc:title></metadata>
        <manifest>
          <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
      'OEBPS/toc.ncx': undefined,
    }),
  );
  ok('读出来了', !!b);
  eq('用正文里的 h1 当标题', b.toc.map((t) => t.label), ['第一章 起', '第二章 承']);
  eq('顺序照 spine', b.toc.map((t) => t.href), ['OEBPS/Text/ch1.xhtml', 'OEBPS/Text/ch2.xhtml']);
}

step('坏书不能把书架搞坏');
eq('不是 zip → null', readEpub(new Uint8Array([1, 2, 3, 4, 5])), null);
eq('没有 container.xml → null', read(zipSync({ 'a.txt': strToU8('x') })), null);
eq(
  '有 opf 但没有正文 → null（不然书架上会多一条打不开的）',
  read(
    makeEpub({
      'OEBPS/content.opf': `<package><metadata><dc:title>空</dc:title></metadata>
        <manifest><item id="img" href="cover.jpg" media-type="image/jpeg"/></manifest>
        <spine></spine></package>`,
    }),
  ),
  null,
);
{
  const b = read(
    makeEpub({
      'OEBPS/content.opf': `<package><metadata><dc:title>无标题兜底</dc:title></metadata>
        <manifest><item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/><itemref idref="c1"/><itemref idref="x"/></spine></package>`,
    }),
  );
  ok('重复的 spine 项只留一条', b.spine.length === 1, JSON.stringify(b.spine));
  ok('指向不存在的 manifest id 会被跳掉', !b.spine.includes('x'));
}

step('linear="no" 的不是正文');
{
  const b = read(
    makeEpub({
      'OEBPS/content.opf': `<package><metadata><dc:title>带封面页</dc:title></metadata>
        <manifest>
          <item id="cov" href="cover.xhtml" media-type="application/xhtml+xml"/>
          <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="cov" linear="no"/><itemref idref="c1"/></spine></package>`,
    }),
  );
  eq('封面页不进正文', b.spine, ['OEBPS/Text/ch1.xhtml']);
}

step('章节 → 纯文本（搜索吃这一份）');
{
  const b = read(makeEpub());
  const t1 = chapterText(new TextDecoder().decode(b.files[b.spine[0]]));
  ok('标签没了', !t1.includes('<'), t1);
  ok('实体还原了', t1.includes('第一章 起'), t1);
  ok('两段之间有换行', t1.split('\n').length >= 3, JSON.stringify(t1));
  const t2 = chapterText(new TextDecoder().decode(b.files[b.spine[1]]));
  ok('script 里的字不算正文', !t2.includes('alert'), t2);
  ok('但正文还在', t2.includes('天气一直不错'), t2);
  eq('实体：&amp; 还原成 &', chapterText('<p>a &amp; b</p>'), 'a & b');
  eq('实体：&#x4E2D; 还原成中', chapterText('<p>&#x4E2D;&#x6587;</p>'), '中文');
  eq('注释被挖掉', chapterText('<p>前</p><!-- 悄悄话 --><p>后</p>'), '前\n后');
  eq('空章节不炸', chapterText(''), '');
}

step('全书搜索');
{
  const chapters = [
    { href: 'a.xhtml', label: '第一章', text: '今天天气不错。\n出门买了菜。' },
    { href: 'b.xhtml', label: '第二章', text: '然后回家做饭，天气一直不错。\n天气好。' },
  ];
  const hits = searchBook(chapters, '天气');
  // 第二章里「天气」出现两次，所以是三条 —— 每一处命中一条，跳过去才准
  eq('每一处命中一条（同一章两处就是两条）', hits.map((h) => h.label), ['第一章', '第二章', '第二章']);
  eq('同一章里命中两处就给两条', searchBook(chapters, '天气好').length, 1);
  ok('片段里带命中上下文', hits[0].snippet.includes('天气'), hits[0].snippet);
  ok('带 at（跳过去定位用）', typeof hits[0].at === 'number', String(hits[0].at));
  eq('空查询不给结果', searchBook(chapters, '   '), []);
  eq('查不到就是空', searchBook(chapters, '绝不存在的词'), []);
  eq('大小写不敏感', searchBook([{ href: 'a', label: 'A', text: 'Hello World' }], 'hello').length, 1);
  ok('有上限，不会把整本书翻一遍', searchBook(chapters, '。', 3).length <= 3);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
