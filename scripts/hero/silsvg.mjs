import potrace from 'potrace';
import { writeFileSync } from 'fs';
const [inp, out, W, H] = process.argv.slice(2);
potrace.trace(inp, { threshold: 128, turdSize: 60, optTolerance: 0.5, alphaMax: 1.0, color: '#ffffff', background: 'transparent' }, (err, svg) => {
  if (err) throw err;
  const d = svg.match(/ d="([^"]+)"/)[1].replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(Number(n) * 2) / 10));
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * 2 * 2 / 10} ${H * 2 * 2 / 10}"><path fill="#fff" fill-rule="evenodd" d="${d}"/></svg>\n`);
  console.log('ok');
});
