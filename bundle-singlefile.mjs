import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
const htmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(htmlPath)) {
  console.error('dist/index.html not found. Run npm run build first.');
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf8');

// Replace CSS
html = html.replace(/<link rel="stylesheet"[^>]+href="(\.\/assets\/[^"]+\.css)">/g, (match, href) => {
  const cssFile = path.join(distDir, href.replace('./', ''));
  if (fs.existsSync(cssFile)) {
    const cssContent = fs.readFileSync(cssFile, 'utf8');
    return `<style>\n${cssContent}\n</style>`;
  }
  return match;
});

// Replace JS
html = html.replace(/<script type="module"[^>]+src="(\.\/assets\/[^"]+\.js)"><\/script>/g, (match, src) => {
  const jsFile = path.join(distDir, src.replace('./', ''));
  if (fs.existsSync(jsFile)) {
    const jsContent = fs.readFileSync(jsFile, 'utf8');
    return `<script type="module">\n${jsContent}\n</script>`;
  }
  return match;
});

// Save standalone HTML
const outPath1 = path.join(distDir, 'TodoTree_一键直达.html');
fs.writeFileSync(outPath1, html, 'utf8');

const outPath2 = path.resolve('..', 'TodoTree_一键直达.html');
fs.writeFileSync(outPath2, html, 'utf8');

console.log('Successfully generated standalone single-file:');
console.log('1.', outPath1);
console.log('2.', outPath2);
