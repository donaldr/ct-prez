// Builds public/deck.pdf: one 16:9 landscape page per slide, with the deck's real fonts embedded.
// Run with `npm run pdf` after changing the deck. Needs Playwright with Chromium installed.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const font = (p) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'node_modules', p)).toString('base64');
const fontCss = `
@font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url(${font('@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2')}) format('woff2'); }
${[400, 500, 600].map((w) => `@font-face { font-family: 'IBM Plex Sans'; font-weight: ${w}; src: url(${font(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`)}) format('woff2'); }`).join('\n')}
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // Use the bundled fonts instead of Google Fonts, so the build doesn't depend on the network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('file://' + path.join(root, 'public', 'index.html'));
  await page.addStyleTag({ content: fontCss });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(500);
  const out = path.join(root, 'public', 'deck.pdf');
  // Explicit landscape page size (13.333 x 7.5 in, the standard 16:9 slide), no rotation.
  await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: false });
  await browser.close();
  console.log('Wrote', out);
})();
