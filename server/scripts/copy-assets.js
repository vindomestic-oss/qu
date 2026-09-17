const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
const toDir = path.join(__dirname, '..', 'dist', 'db');
const to = path.join(toDir, 'schema.sql');

fs.mkdirSync(toDir, { recursive: true });
fs.copyFileSync(from, to);
console.log(`copied ${from} -> ${to}`);
