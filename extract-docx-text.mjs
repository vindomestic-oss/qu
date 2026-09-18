import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

const xmlPath = 'C:/qu/_tmp_docx_extract.xml';

execSync(
  `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead('${inputPath.replace(/\\/g, '\\\\')}'); $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }; $reader = New-Object System.IO.StreamReader($entry.Open()); $content = $reader.ReadToEnd(); $reader.Close(); $zip.Dispose(); Set-Content -Path '${xmlPath}' -Value $content -Encoding UTF8"`,
);

const xml = fs.readFileSync(xmlPath, 'utf-8');
let text = xml.replace(/<\/w:p>/g, '\n').replace(/<w:br\s*\/?>/g, '\n');
const parts = [];
const re = /<w:t[^>]*>([^<]*)<\/w:t>|(\n)/g;
let match;
while ((match = re.exec(text))) {
  if (match[1] !== undefined) parts.push(match[1]);
  else parts.push('\n');
}
let result = parts.join('');
result = result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
result = result.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(outputPath, result, 'utf-8');
fs.unlinkSync(xmlPath);
console.log(`${path.basename(inputPath)} -> ${result.length} chars`);
