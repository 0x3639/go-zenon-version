import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = new URL('../', import.meta.url);
const file = (path: string) => new URL(path, root);
const mark = await readFile(file('assets/brand/mark.svg'), 'utf8');
await mkdir(file('public'), { recursive: true });
await writeFile(file('public/logo.svg'), mark);
await writeFile(file('public/favicon.svg'), mark);
const raster = (svg: string, width: number, background?: string) => new Resvg(svg, {
  fitTo: { mode: 'width', value: width }, background,
  font: { fontFiles: [fileURLToPath(file('assets/brand/DM-Sans.ttf'))], loadSystemFonts: false, defaultFontFamily: 'DM Sans' },
}).render().asPng();

for (const [name, size] of [['favicon-32.png', 32], ['favicon-48.png', 48], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const)
  await writeFile(file(`public/${name}`), raster(mark, size, '#101713'));

// ICO supports PNG payloads. Keep the standard three desktop icon sizes together.
const sizes = [16, 32, 48];
const images = sizes.map(size => raster(mark, size));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((png, i) => {
  const at = 6 + i * 16;
  directory[at] = sizes[i]; directory[at + 1] = sizes[i];
  directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(png.length, at + 8); directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(file('public/favicon.ico'), Buffer.concat([directory, ...images]));

const dots = Array.from({ length: 37 }, (_, i) => {
  const angle = i * 2.399963;
  const radius = 65 + Math.sqrt(i / 36) * 164;
  return { x: 968 + Math.cos(angle) * radius, y: 315 + Math.sin(angle) * radius * 0.88, r: i % 5 === 0 ? 6 : 3.5, color: ['#c0f181', '#7bb8ef', '#a4b59a'][i % 3] };
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><radialGradient id="glow"><stop stop-color="#25452b"/><stop offset="1" stop-color="#101713"/></radialGradient><linearGradient id="shade"><stop stop-color="#101713"/><stop offset="1" stop-color="#101713" stop-opacity="0"/></linearGradient></defs>
<rect width="1200" height="630" fill="#101713"/>
<circle cx="967" cy="315" r="310" fill="url(#glow)"/>
<g fill="none" stroke="#3f563b" stroke-opacity=".5">${[94, 153, 222, 292].map(r => `<ellipse cx="968" cy="315" rx="${r}" ry="${r * .88}"/>`).join('')}<path d="M660 315h540M968 45v540" stroke-dasharray="3 8"/></g>
<g>${dots.map((d, i) => `<line x1="968" y1="315" x2="${d.x}" y2="${d.y}" stroke="${d.color}" stroke-opacity="${i % 2 ? '.18' : '.32'}"/>`).join('')}</g>
${dots.map(d => `<circle cx="${d.x}" cy="${d.y}" r="${d.r + 6}" fill="${d.color}" opacity=".06"/><circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.color}"/>`).join('')}
<circle cx="968" cy="315" r="39" fill="#17251b" stroke="#8dae67"/>
<g transform="translate(936 283)">${mark.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g>
<rect x="610" y="0" width="125" height="630" fill="url(#shade)"/>
<g transform="translate(64 60)">${mark.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g>
<g font-family="DM Sans" fill="#edf2e9">
<text x="146" y="91" font-size="24" font-weight="700" letter-spacing="3">ZENON</text><text x="146" y="115" font-size="13" fill="#9caf95" letter-spacing="2.4">OBSERVATORY</text>
<text x="64" y="241" font-size="67" font-weight="600" letter-spacing="-2.3">A clearer view</text>
<text x="64" y="317" font-size="67" font-weight="600" letter-spacing="-2.3" fill="#c0f181">of the network.</text>
<text x="67" y="376" font-size="22" fill="#acb9a6">Discover Zenon peers.</text><text x="67" y="409" font-size="22" fill="#acb9a6">See which go-zenon versions they run.</text>
<rect x="64" y="458" width="154" height="34" rx="17" fill="#20301f" stroke="#42553a"/><text x="141" y="480" text-anchor="middle" font-size="12" fill="#c2d7af">P2P DISCOVERY</text>
<rect x="230" y="458" width="142" height="34" rx="17" fill="#20301f" stroke="#42553a"/><text x="301" y="480" text-anchor="middle" font-size="12" fill="#c2d7af">OPEN NETWORK</text>
<path d="M64 539H1136" stroke="#2e3b2c"/><text x="64" y="579" font-size="16" fill="#a3b298">0x3639.com/go-zenon-version</text><text x="1136" y="579" text-anchor="end" font-size="13" fill="#819578">OBSERVED PEERS · SELF-REPORTED VERSIONS</text>
</g></svg>`;
await writeFile(file('public/og-image.svg'), svg);
await writeFile(file('public/og-image.png'), raster(svg, 1200));
console.log('Generated the shared Z mark, social preview, and favicon sizes.');
