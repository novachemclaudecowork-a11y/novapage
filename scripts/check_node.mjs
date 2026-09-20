/**
 * 檢查 .nvmrc、package.json 的 engines 與 Astro 實際要求的 Node 版本一致。
 *
 * 會加這支檢查，是因為曾經 .nvmrc 寫 20 而 Astro 要求 >= 22.12，
 * 本機剛好是 22 所以沒被發現，直到 Cloudflare 依 .nvmrc 裝了 Node 20 才建置失敗。
 *
 * 用法：node scripts/check_node.mjs
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const astro = JSON.parse(readFileSync('node_modules/astro/package.json', 'utf8'));
const nvmrc = readFileSync('.nvmrc', 'utf8').trim();

const required = astro.engines?.node ?? '';
const requiredMajor = Number(required.match(/(\d+)/)?.[1] ?? 0);
const nvmrcMajor = Number(nvmrc.match(/(\d+)/)?.[1] ?? 0);
const enginesMajor = Number((pkg.engines?.node ?? '').match(/(\d+)/)?.[1] ?? 0);

const problems = [];
if (nvmrcMajor < requiredMajor) {
  problems.push(`.nvmrc 是 ${nvmrc}，但 Astro 要求 ${required}。部署平台會依 .nvmrc 安裝 Node，版本太低會建置失敗。`);
}
if (enginesMajor < requiredMajor) {
  problems.push(`package.json 的 engines.node 是 ${pkg.engines?.node}，但 Astro 要求 ${required}。`);
}
if (Number(process.versions.node.split('.')[0]) < requiredMajor) {
  problems.push(`目前執行的 Node 是 ${process.version}，低於 Astro 要求的 ${required}。`);
}

if (problems.length) {
  console.error('❌ Node 版本設定不一致：');
  for (const p of problems) console.error(`   ・${p}`);
  process.exit(1);
}
console.log(`✅ Node 版本設定一致：Astro 要求 ${required}，.nvmrc ${nvmrc}，engines ${pkg.engines.node}，執行中 ${process.version}`);
