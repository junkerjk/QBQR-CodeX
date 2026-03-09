const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'miniprogram', 'assets', 'icons');
fs.mkdirSync(dir, { recursive: true });

const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const buffer = Buffer.from(base64, 'base64');

const files = [
  'reserve.png', 'reserve_active.png',
  'inventory.png', 'inventory_active.png',
  'mine.png', 'mine_active.png'
];

files.forEach(file => {
  fs.writeFileSync(path.join(dir, file), buffer);
});
console.log('Icons created.');
