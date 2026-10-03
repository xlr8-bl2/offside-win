import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
const [inp, out, q = '0.82'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const data = await p.evaluate(async ([url, q]) => {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', Number(q));
}, ['data:image/png;base64,' + readFileSync(inp).toString('base64'), q]);
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await b.close();
