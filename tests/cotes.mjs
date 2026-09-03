/* Calibrage sur une mesure terrain, cotes enregistrées, persistance de l'échelle
   et reprise d'un plan calibré sur un autre lot.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/cotes.mjs */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SP = path.dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const erreurs = []; let ok = 0, ko = 0;
const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
const U = process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html';

await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'C1', nom: 'Cotes' }, docs: [], vmc: {}, chaufCol: {}, ecsCol: {},
    appts: [{ id: 'a1', num: 'E01', type: 1, hsp: '2.50' }, { id: 'a2', num: 'E02', type: 1, hsp: '2.50' }],
    chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [], pieces: [], calques: {} });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="dossier"]');
await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');

console.log('1. Avant tout plan');
check(await page.locator('#cal-echelle').isHidden(), 'pas de bandeau d\'échelle sans plan');
check(await page.locator('#cal-modes').isHidden(), 'pas de sélecteur de mode sans plan');
check(await page.locator('#cal-vide').isVisible(), 'invite de chargement');
check((await page.locator('#cal-vide').innerText()).includes('déjà calibré'), 'reprise d\'un plan proposée dès l\'invite');

console.log('2. Chargement du PDF puis calibrage sur une mesure terrain');
const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button:has-text("Charger")')]);
await ch.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });
check(await page.locator('#cal-echelle').isVisible(), 'bandeau d\'échelle affiché');
check((await page.locator('#cal-echelle').innerText()).includes('Échelle à régler'), 'échelle annoncée manquante');
check(await page.evaluate(() => document.getElementById('cal-echelle').classList.contains('absente')), 'bandeau en alerte');
check(await page.locator('#cal-actions').isHidden(), 'aucune action tant que rien n\'est relevé');

// Calibrage : la cote du PDF fait 400 pt, mesurée à 12.45 m sur le terrain
const r = await page.evaluate(() => cal.img.width / 595);
await page.click('#cal-echelle button:has-text("Calibrer")');
check(await page.evaluate(() => cal.mode) === 'calibrer', 'mode calibrage actif');
// La boîte du canvas est relue à chaque clic : le bandeau d'échelle déplace la mise en page.
const clic = async (ix, iy) => {
  const boite = await page.locator('#calque-canvas').boundingBox();
  const v = await page.evaluate(() => ({ zoom: cal.zoom, ox: cal.ox, oy: cal.oy }));
  await page.mouse.click(boite.x + ix * v.zoom + v.ox, boite.y + iy * v.zoom + v.oy);
};
await clic(100 * r, 300 * r);
await clic(500 * r, 300 * r);
await page.waitForSelector('#dlg[open]');
check((await page.locator('#dlg').innerText()).includes('terrain'), 'le dialogue parle de la mesure terrain');
check(await page.locator('#dlg-c-m').isVisible() && await page.locator('#dlg-c-lib').isVisible(), 'deux champs : longueur et référence');
await page.fill('#dlg-c-m', '12.45');
await page.fill('#dlg-c-lib', 'façade sud au télémètre');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
check(await page.evaluate(() => cal.echelle > 0), 'échelle enregistrée');
const ref = await page.evaluate(() => cal.ref);
check(ref && ref.metres === 12.45 && ref.libelle === 'façade sud au télémètre', 'référence de calibrage conservée');
const bandeau = await page.locator('#cal-echelle').innerText();
check(bandeau.includes('Échelle conservée'), 'bandeau : échelle conservée');
check(bandeau.includes('12.45 m') && bandeau.includes('façade sud au télémètre'), 'bandeau rappelle la mesure terrain');
check(!(await page.evaluate(() => document.getElementById('cal-echelle').classList.contains('absente'))), 'bandeau repassé au vert');

console.log('3. Relevé et enregistrement d\'une cote');
await page.click('#cal-mode-mesurer');
check(await page.evaluate(() => cal.mode) === 'mesurer', 'mode mesure actif');
check(await page.evaluate(() => document.getElementById('cal-mode-mesurer').classList.contains('on')), 'mode mesure signalé');
// Le côté vertical du rectangle fait 300 pt, soit 300/400 × 12.45 = 9.34 m
await clic(500 * r, 142 * r);
await clic(500 * r, 442 * r);
await page.waitForSelector('#dlg[open]');
const titreCote = await page.locator('#dlg .dlg-title').innerText();
check(titreCote.includes('9.3'), `longueur calculée annoncée : ${titreCote}`);
await page.fill('#dlg-c-nom', 'Pignon est');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
check(await page.evaluate(() => cal.mesures.length) === 1, 'cote enregistrée');
const cote = await page.evaluate(() => cal.mesures[0]);
check(Math.abs(cote.m - 9.34) < 0.05, `longueur ${cote.m} m (300 pt à l'échelle de 12.45 m pour 400 pt)`);
check(cote.nom === 'Pignon est', 'nom conservé');
check(await page.locator('#cal-mesures-card').isVisible(), 'liste des cotes affichée');
check((await page.locator('.cal-mesure-ligne').innerText()).includes('Pignon est'), 'cote listée');
check((await page.locator('.cal-mesure-ligne').innerText()).includes('9.3'), 'longueur listée');
check(await page.locator('#cal-actions').isVisible(), 'actions accessibles dès une cote relevée');
check(await page.locator('#cal-btn-surface').isHidden(), 'pas de surface sans contour fermé');
check(await page.locator('#cal-btn-murs').isHidden(), 'pas de murs sans contour fermé');

console.log('4. Enregistrement du plan coté');
await page.click('text=💾 Enregistrer le plan coté');
await page.waitForTimeout(500);
check(await page.evaluate(() => db.docs.some(d => d.name.startsWith('Calque_E01'))), 'plan coté enregistré dans les documents');
check(await page.evaluate(() => !!(db.appts[0].plans && db.appts[0].plans[0])), 'plan rattaché au lot');

console.log('5. Persistance de l\'échelle et des cotes');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 15000 });
check(await page.evaluate(() => cal.echelle > 0), 'échelle retrouvée après rechargement');
check(await page.evaluate(() => cal.ref && cal.ref.libelle) === 'façade sud au télémètre', 'référence terrain retrouvée');
check(await page.evaluate(() => cal.mesures.length) === 1, 'cote retrouvée');
check((await page.locator('#cal-echelle').innerText()).includes('12.45'), 'bandeau rappelle l\'échelle après rechargement');

console.log('6. Reprise du plan calibré sur un autre lot');
await page.selectOption('#cal-target', 'a2');
await page.waitForTimeout(400);
check(await page.evaluate(() => cal.echelle) === 0, 'nouveau lot : pas de plan au départ');
check(await page.locator('#cal-vide').isVisible(), 'invite affichée pour le nouveau lot');
await page.click('#cal-vide button:has-text("Reprendre")');
await page.waitForSelector('#dlg[open]');
const opts = await page.locator('#dlg-choix option').allInnerTexts();
check(opts.length === 1 && opts[0].includes('lot E01'), `plan proposé : ${opts[0]}`);
check(opts[0].includes('façade sud au télémètre'), 'la référence de calibrage est rappelée dans le choix');
await page.click('#dlg .dlg-ok');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 15000 });
check(await page.evaluate(() => cal.echelle > 0), 'échelle reprise sans recalibrer');
check(await page.evaluate(() => cal.ref && cal.ref.metres) === 12.45, 'référence terrain reprise');
check(await page.evaluate(() => cal.mesures.length) === 0, 'les cotes restent propres à chaque lot');
check(await page.evaluate(() => cal.pts.length) === 0, 'le tracé reste propre à chaque lot');
check((await page.locator('#cal-echelle').innerText()).includes('Échelle conservée'), 'bandeau vert sur le nouveau lot');
// Une cote relevée sur ce lot utilise bien l'échelle reprise
await page.click('#cal-mode-mesurer');
const r2 = await page.evaluate(() => cal.img.width / 595);
await clic(100 * r2, 400 * r2); await clic(500 * r2, 400 * r2);
await page.waitForSelector('#dlg[open]');
check((await page.locator('#dlg .dlg-title').innerText()).includes('12.4'), 'cote mesurée avec l\'échelle reprise');
await page.fill('#dlg-c-nom', 'Façade sud');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
check(await page.evaluate(() => cal.mesures.length) === 1, 'cote enregistrée sur le second lot');
check(await page.evaluate(() => db.calques['a1_0'].mesures.length) === 1, 'les cotes du premier lot sont intactes');

console.log('7. Suppression annulable et export');
await page.click('[data-act="suppMesure"]');
check(await page.evaluate(() => cal.mesures.length) === 0, 'cote supprimée');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => cal.mesures.length) === 1, 'suppression annulable');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export Excel')]);
check(dl.suggestedFilename().endsWith('.xlsx'), 'export Excel généré');

await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
await page.waitForTimeout(1200);


await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
