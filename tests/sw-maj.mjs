/* Vérifie le bandeau « Nouvelle version disponible » avec un vrai service worker.
   Le test modifie temporairement js/app.js et sw.js, puis les restaure (bloc finally).
   Prérequis : python3 -m http.server 8765 à la racine du dépôt.
   Lancement : node tests/sw-maj.mjs */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const R = process.env.MYDIAG_ROOT || process.cwd(), APP = R + '/js/app.js', SW = R + '/sw.js';
const appOrig = fs.readFileSync(APP, 'utf8'), swOrig = fs.readFileSync(SW, 'utf8');
let ok = 0, ko = 0; const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
let browser;
try {
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const visible = async () => { await page.waitForTimeout(1200); return page.locator('#maj-banner').isVisible(); };
  const versionPage = () => page.evaluate(() => window.CVT || null);
  const chargerJusqua = async v => { for (let i = 0; i < 8; i++) { await page.reload(); await page.waitForTimeout(1200); if (await versionPage() === v) return true; } return false; };
  fs.writeFileSync(APP, appOrig + '\nwindow.CVT = CACHE_VERSION;\n');

  await page.goto(process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html');
  check(await chargerJusqua('mydiag-v9-7'), 'page exécute bien v9-7');
  check(!(await visible()), 'versions synchronisées : bandeau masqué');
  await page.reload(); check(!(await visible()), 'rechargement : toujours masqué');

  fs.writeFileSync(SW, swOrig.replace("'mydiag-v9-7'", "'mydiag-v9-8'"));
  await page.reload(); await page.waitForTimeout(2000); await page.reload(); await page.waitForTimeout(2000);
  check(await visible(), 'worker v9-8 alors que la page est en v9-7 : bandeau affiché');
  await page.click('.maj-close'); check(!(await page.locator('#maj-banner').isVisible()), 'croix : bandeau fermé');

  // Le "Recharger" de l'utilisateur : la page repart sur la version du worker
  fs.writeFileSync(APP, appOrig.replace("'mydiag-v9-7'", "'mydiag-v9-8'") + '\nwindow.CVT = CACHE_VERSION;\n');
  check(await chargerJusqua('mydiag-v9-8'), 'page passée en v9-8 après rechargement');
  check(!(await visible()), 'après mise à jour : bandeau disparu');
  await page.reload(); check(!(await visible()), 'ouvertures suivantes : jamais de bandeau');
  await page.reload(); check(!(await visible()), 'ré-activations répétées du même worker : jamais de bandeau');
} finally {
  fs.writeFileSync(APP, appOrig); fs.writeFileSync(SW, swOrig);
  if (browser) await browser.close();
  console.log('fichiers restaurés :', execSync(`git -C ${R} status --short js/app.js sw.js`).toString().trim() || 'aucune modification résiduelle');
}
console.log(`\nRésultat SW : ${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
