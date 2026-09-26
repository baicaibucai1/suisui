/*
 * 造一本**真的** epub，给端到端用。
 *
 * 为什么不用现成的书：测试要能断言"第一章里有这句话""目录第二级是这一条"
 * —— 拿一本真书就得跟着它的内容写断言，换一本书断言全废。
 * 自己造的书，内容和目录都是已知的，断言才有意义。
 *
 * 用 fflate 真的打一个 zip（不是拼字符串）：epub 就是一个 zip，
 * 只有真走到「解压 → 读 container → 读 opf → 取正文」那条路，才算验到了。
 */
import { strToU8, zipSync } from 'fflate';

/** 封面用的 1×1 红点 PNG —— 够小，够真（能走通"取封面 → 存 data URL → 书架画出来"） */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function pngBytes() {
  return Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
}

/** 凑长度的段落。书太短的话根本滚不动，"滚到第三章""读到 32%"就都无从验起 */
const filler = (n, word) =>
  Array.from({ length: n }, (_, i) => `<p>第 ${i + 1} 段${word}，用来把这一章撑到能滚动的长度。</p>`).join(
    '\n',
  );

/**
 * @param {Record<string, string|undefined>} extra 覆盖 / 追加条目（给 `undefined` 等于删掉）
 * @returns {Buffer} 一本 epub 的字节
 */
export function makeEpub(extra = {}) {
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
      '</rootfiles></container>',
    'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata>
    <dc:title>碎碎的第一本书</dc:title>
    <dc:creator>白菜不菜</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="Text/ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="../Images/pic.jpg" media-type="image/jpeg"/>
    <item id="cover-img" href="../Images/cover.png" media-type="image/png"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`,
    'OEBPS/Text/ch1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章 起</h1>
<p>今天天气不错，出门买了菜。</p>
<p>回来路上看见一只猫，猫也看了我一眼。</p>
<img src="../../Images/pic.jpg" alt="一张图"/>
${filler(20, '出门前')}
</body></html>`,
    'OEBPS/Text/ch2.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body><h1>第二章 承</h1>
<p>然后回家做饭，天气一直不错。</p>
<blockquote>引用一句：饭要趁热吃。</blockquote>
<p>这天唯一的不顺是盐放多了。</p>
${filler(20, '做饭时')}
</body></html>`,
    'OEBPS/Text/ch3.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第三章</title></head>
<body><h1>第三章 合</h1>
<p>吃完饭天就黑了，猫又来了。</p>
<p>天气不错的一天，就这么过去了。</p>
<script>window.__evil = 1</script>
${filler(20, '天黑后')}
</body></html>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="p1" playOrder="1"><navLabel><text>第一章 起</text></navLabel><content src="Text/ch1.xhtml"/>
    <navPoint id="p1a" playOrder="2"><navLabel><text>出门</text></navLabel><content src="Text/ch1.xhtml#out"/></navPoint>
  </navPoint>
  <navPoint id="p2" playOrder="3"><navLabel><text>第二章 承</text></navLabel><content src="Text/ch2.xhtml"/></navPoint>
  <navPoint id="p3" playOrder="4"><navLabel><text>第三章 合</text></navLabel><content src="Text/ch3.xhtml"/></navPoint>
</navMap></ncx>`,
    'Images/pic.jpg': 'pretend-jpeg-bytes',
    'Images/cover.png': 'pretend-png-bytes',
    ...extra,
  };

  const u8 = {};
  for (const [k, v] of Object.entries(files)) {
    if (v === undefined) continue;
    if (k.endsWith('.png') && v === 'pretend-png-bytes') u8[k] = pngBytes();
    else u8[k] = strToU8(v);
  }
  return Buffer.from(zipSync(u8));
}

/** 一本不是 epub 的东西（导入应当被挡下并说清原因） */
export function notAnEpub() {
  return Buffer.from('这显然不是 epub');
}
