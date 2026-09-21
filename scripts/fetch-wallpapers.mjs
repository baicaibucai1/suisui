/*
 * 抓 Bing 每日壁纸，落到 public/wallpapers/，顺手写一份 manifest.json。
 *
 * 为什么是**构建前抓**，而不是运行时去 Bing 拉：
 *   Bing 的图片接口不返回 CORS 头，浏览器里 fetch 会被拦；而给它加代理就等于
 *   把用户的所有请求都过一道我们自己的服务器。壁纸是纯装饰，不值得为它引入一条
 *   常驻的外网通道 —— 所以随包走：抓一次，之后离线也能用。
 *
 * 用法：
 *   node scripts/fetch-wallpapers.mjs            # 抓最近 8 天（默认）
 *   node scripts/fetch-wallpapers.mjs --days=16  # 多抓几天
 *   node scripts/fetch-wallpapers.mjs --force    # 已有的也重抓
 *
 * 幂等：同一天的图已经存在就跳过（除非 --force），重跑只会补新的。
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { get } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'wallpapers');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/** Bing 一次最多给 8 天，想更多就翻页（idx 是"往前第几天"） */
const PER_PAGE = 8;

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const DAYS = Math.max(1, Math.min(48, Number(arg('days', 8)) || 8));
const FORCE = process.argv.includes('--force');
const MKT = arg('mkt', 'zh-CN');

/** 取一段文本：带 302 跟随（th 端点会跳一次），只收二进制就用 Buffer 攒 */
function fetchBuf(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'User-Agent': UA, Accept: 'image/jpeg,image/*,*/*' } }, (res) => {
      // Bing 的图床偶尔 301/302 到 cn.bing.com，不跟随就拿到一段 HTML
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        fetchBuf(next, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`超时 ${url}`)));
  });
}

function fetchJson(url) {
  return fetchBuf(url).then((b) => JSON.parse(b.toString('utf8')));
}

const exists = async (p) => {
  try {
    const s = await stat(p);
    return s.size > 1024; // 小于 1KB 的"图"基本是错误页
  } catch {
    return false;
  }
};

/** 「正在梳理皮毛的海獭，蒙特雷湾，加利福尼亚州，美国 (© Suzi Eszterhas/Minden Pictures)」 */
function splitCopyright(raw) {
  const m = /^(.*?)\s*[（(]\s*©\s*(.*?)\s*[)）]\s*$/.exec(raw ?? '');
  const lead = (m ? m[1] : raw ?? '').trim();
  const credit = (m ? m[2] : '').trim();
  // 地点那几段跟在图注后面，列表里只留第一句当标题
  const title = lead.split(/[，,]/)[0].trim() || lead || '未命名';
  return { title, credit, full: (raw ?? '').trim() };
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const pages = Math.ceil(DAYS / PER_PAGE);
  const raw = [];
  for (let p = 0; p < pages; p++) {
    const n = Math.min(PER_PAGE, DAYS - p * PER_PAGE);
    const url = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${p * PER_PAGE}&n=${n}&mkt=${MKT}`;
    const j = await fetchJson(url);
    raw.push(...(j.images ?? []));
  }

  // 同一天可能被翻页重复带回来
  const seen = new Set();
  const items = [];
  for (const img of raw) {
    const date = String(img.startdate ?? '').trim();
    if (!date || seen.has(date)) continue;
    seen.add(date);

    const id = `wp-${date}`;
    const file = `${id}.jpg`;
    const thumb = `${id}-thumb.jpg`;
    const dst = path.join(OUT, file);
    const dstT = path.join(OUT, thumb);

    if (!FORCE && (await exists(dst)) && (await exists(dstT))) {
      items.push({ ...splitCopyright(img.copyright), id, date, file, thumb });
      console.log(`· 已有 ${id}`);
      continue;
    }

    const big = await fetchBuf(`https://www.bing.com${img.urlbase}_1920x1080.jpg`);
    // 缩略图走图床自己的缩放参数：19KB 上下，列表里铺 8 张也不心疼
    const small = await fetchBuf(`https://www.bing.com${img.urlbase}_1920x1080.jpg&w=480&h=270`);
    await writeFile(dst, big);
    await writeFile(dstT, small);
    items.push({ ...splitCopyright(img.copyright), id, date, file, thumb });
    console.log(
      `+ ${id}  ${(big.length / 1024).toFixed(0)}KB / 缩略 ${(small.length / 1024).toFixed(0)}KB  ${items.at(-1).title}`,
    );
  }

  items.sort((a, b) => (a.date < b.date ? 1 : -1)); // 新的在前

  const manifest = {
    source: 'bing',
    market: MKT,
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items: items.map(({ id, date, title, credit, full, file, thumb }) => ({
      id,
      date,
      title,
      credit,
      copyright: full,
      url: `wallpapers/${file}`,
      thumb: `wallpapers/${thumb}`,
    })),
  };

  await writeFile(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  console.log(`\n共 ${items.length} 张 → public/wallpapers/  manifest.json 已更新`);
}

main().catch((e) => {
  console.error('抓壁纸失败：', e.message);
  process.exit(1);
});
