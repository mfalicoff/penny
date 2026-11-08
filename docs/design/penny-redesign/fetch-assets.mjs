import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const icons = ['leaf-outline', 'home-outline', 'list-outline', 'people-outline', 'airplane-outline', 'ellipsis-horizontal', 'add-outline', 'chevron-back-outline', 'chevron-forward-outline', 'chevron-down-outline', 'close-outline', 'checkmark-outline', 'search-outline', 'options-outline', 'calendar-outline', 'wallet-outline', 'pricetag-outline', 'repeat-outline', 'settings-outline', 'cafe-outline', 'basket-outline', 'bus-outline', 'arrow-down-outline', 'arrow-up-outline', 'trending-up-outline', 'pie-chart-outline', 'receipt-outline', 'document-text-outline', 'lock-closed-outline', 'finger-print-outline', 'cloud-done-outline', 'cloud-offline-outline', 'alert-circle-outline', 'server-outline', 'person-add-outline', 'copy-outline', 'pause-outline', 'play-outline', 'trash-outline', 'image-outline', 'key-outline', 'sunny-outline', 'moon-outline', 'card-outline', 'cash-outline', 'log-out-outline', 'checkmark-circle-outline', 'wifi-outline', 'battery-full-outline', 'time-outline', 'create-outline'];
await fs.mkdir(path.join(root, 'assets/icons'), { recursive: true });
for (let i = 0; i < icons.length; i += 8) {
  await Promise.all(icons.slice(i, i + 8).map(async name => {
    const target = path.join(root, 'assets/icons', `${name}.svg`);
    try { await fs.access(target); return; } catch { /* Fetch missing assets only. */ }
    const response = await fetch(`https://raw.githubusercontent.com/ionic-team/ionicons/main/src/svg/${name}.svg`);
    if (!response.ok) throw new Error(`Icon ${name}: HTTP ${response.status}`);
    await fs.writeFile(target, await response.text());
  }));
}
for (const [local, remote] of [
  ['IONIC-LICENSE', 'https://raw.githubusercontent.com/ionic-team/ionicons/main/LICENSE'],
  ['DM-Sans.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf'],
  ['DM-Sans-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/OFL.txt'],
]) {
  const response = await fetch(remote);
  if (!response.ok) throw new Error(`Asset ${local}: HTTP ${response.status}`);
  await fs.writeFile(path.join(root, 'assets', local), Buffer.from(await response.arrayBuffer()));
}
console.log(`Downloaded ${icons.length} source Ionicons and the proposed DM Sans typeface.`);
