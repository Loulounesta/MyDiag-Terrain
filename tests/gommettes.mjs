/* Gommettes de repérage des fenêtres, sur le plan assemblé des pièces
   et sur le plan décalqué : pose, déplacement, retrait, indépendance des
   deux supports, persistance et exports.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/gommettes.mjs */
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
// La sauvegarde est différée de 500 ms : on attend qu'elle soit écrite avant de recharger.
const sauvegardeEcrite = () => page.waitForFunction(() => !saveEnAttente && !saveTimer, null, { timeout: 5000 });

await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'G1', nom: 'Gommettes' }, docs: [], vmc: {}, chaufCol: {}, ecsCol: {},
    appts: [{ id: 'a1', num: 'E01', type: 1, hsp: '2.50' }], chaufs: [], ecss: [], murs: [], modelesFens: [], portes: [], plfs: [], plas: [],
    pieces: [{ id: 1, aid: 'a1', nivInt: 0, nom: 'Séjour', l: '5', larg: '4', rot: 0, x: 0, y: 0 },
             { id: 2, aid: 'a1', nivInt: 0, nom: 'Chambre', l: '4', larg: '3', rot: 0, x: 5, y: 0 }],
    fens: [{ id: 11, aid: 'a1', nivInt: 0, nom: 'F1', ori: 'Sud', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '120', h: '130', nb: '1', motifs: '1', surf: '1.560' },
           { id: 12, aid: 'a1', nivInt: 0, nom: 'F2', ori: 'Est', type: 'Fenêtres coulissantes', mat: 'Menuiserie bois', vit: 'Simple vitrage vertical', fer: 'Absence', l: '90', h: '110', nb: '1', motifs: '1', surf: '0.990' }],
    calques: {} });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);

console.log('1. Gommettes sur le plan des pièces');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a1');
await page.waitForTimeout(300);
check(await page.locator('#plan-container').isVisible(), 'plan des pièces affiché');
check(await page.locator('#plan-gommettes').isHidden(), 'palette masquée hors du mode gommettes');
await page.click('#plan-btn-gom');
check(await page.evaluate(() => modePlan) === 'gommettes', 'mode gommettes actif');
check(await page.locator('#plan-gommettes').isVisible(), 'palette affichée');
check(await page.locator('#plan-gommettes .gom-chip').count() === 2, 'les deux fenêtres du lot sont proposées');
check((await page.locator('#plan-gommettes').innerText()).includes('0 / 2 posée'), 'compteur de pose');
check((await page.locator('.gom-chip').first().innerText()).includes('F1'), 'repère affiché sur la pastille');
check((await page.locator('.gom-chip').first().innerText()).includes('120×130'), 'dimensions rappelées');

console.log('2. Pose d\'une gommette');
await page.click('.gom-chip:has-text("F1")');
check(await page.evaluate(() => gomArmee) === 11, 'fenêtre armée');
check(await page.evaluate(() => document.querySelector('.gom-chip').classList.contains('armee')), 'pastille signalée armée');
const boite = await page.locator('#plan-canvas').boundingBox();
const versEcranPlan = async pt => {
  const v = await page.evaluate(() => ({ ...planVue }));
  const b = await page.locator('#plan-canvas').boundingBox();
  return { x: b.x + v.dx + (pt.x - v.minX) * v.ech, y: b.y + v.dy + (pt.y - v.minY) * v.ech };
};
const cible = await versEcranPlan({ x: 2.5, y: 0.2 });
await page.mouse.click(cible.x, cible.y);
await page.waitForTimeout(250);
const pos1 = await page.evaluate(() => db.fens[0].posPlan);
check(pos1 && Math.abs(pos1.x - 2.5) < 0.3 && Math.abs(pos1.y - 0.2) < 0.3, `gommette posée en ${pos1 ? pos1.x.toFixed(2) + ', ' + pos1.y.toFixed(2) : 'nulle part'} m`);
check(await page.evaluate(() => gomArmee) === null, 'fenêtre désarmée après la pose');
check(await page.evaluate(() => gomSel) === 11, 'gommette posée reste sélectionnée');
check((await page.locator('#plan-gommettes').innerText()).includes('1 / 2 posée'), 'compteur mis à jour');
check(await page.evaluate(() => document.querySelector('.gom-chip').classList.contains('posee')), 'pastille marquée posée');
check(await page.locator('.gom-chip:has-text("Retirer")').isVisible(), 'retrait proposé quand une gommette est sélectionnée');

console.log('3. Déplacement au doigt');
const depart = await versEcranPlan(pos1);
const arrivee = await versEcranPlan({ x: 4, y: 3 });
await page.mouse.move(depart.x, depart.y - 24); await page.mouse.down();
await page.mouse.move(arrivee.x, arrivee.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(250);
const pos2 = await page.evaluate(() => db.fens[0].posPlan);
const unite = await page.evaluate(() => 1 / planVue.ech);
// La pastille reste sous le doigt ; son ancre est 24 px plus bas
check(Math.abs(pos2.x - 4) < 0.5 && Math.abs(pos2.y - 24 * unite - 3) < 0.5, `gommette déplacée : pastille en 4.00, ${(pos2.y - 24 * unite).toFixed(2)} m`);

console.log('4. Retrait annulable');
await page.click('.gom-chip:has-text("Retirer")');
check(await page.evaluate(() => db.fens[0].posPlan) === undefined, 'gommette retirée');
check((await page.locator('#plan-gommettes').innerText()).includes('0 / 2 posée'), 'compteur revenu à zéro');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => !!db.fens[0].posPlan), 'retrait annulable');

console.log('5. Le plan enregistré porte les gommettes');
await page.evaluate(() => { db.fens[1].posPlan = { x: 7, y: 1.5 }; sauvegarderLocal(); dessinerPlanPieces(); });
const pixels = await page.evaluate(() => {
  const c = document.getElementById('plan-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bleus = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] > 80 && d[i + 1] < 140 && d[i + 2] > 200) bleus++;
  return bleus;
});
check(pixels > 200, `gommettes dessinées sur le plan (${pixels} pixels bleus)`);
await page.click('#plan-container >> text=Enregistrer le plan');
await page.waitForTimeout(500);
check(await page.evaluate(() => !!(db.appts[0].plans && db.appts[0].plans[0])), 'plan enregistré avec les gommettes');
await page.click('#plan-btn-gom');
check(await page.evaluate(() => modePlan) === 'pieces', 'retour à l\'agencement des pièces');
check(await page.locator('#plan-gommettes').isHidden(), 'palette masquée');

console.log('6. Gommettes sur le plan décalqué');
await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button:has-text("Charger")')]);
await ch.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });
check(await page.locator('#cal-mode-gommettes').isVisible(), 'mode gommettes proposé sur le calque');
await page.click('#cal-mode-gommettes');
check(await page.evaluate(() => cal.mode) === 'gommettes', 'mode gommettes actif sur le calque');
check(await page.locator('#cal-gommettes').isVisible(), 'palette du calque affichée');
check((await page.locator('#cal-resultat').innerText()).includes('Repérage des fenêtres'), 'panneau explicatif');
check((await page.locator('#cal-gommettes').innerText()).includes('0 / 2 posée'), 'aucune gommette sur ce support au départ');
await page.click('#cal-gommettes .gom-chip:has-text("F1")');
const clicCal = async (ix, iy) => {
  const b = await page.locator('#calque-canvas').boundingBox();
  const v = await page.evaluate(() => ({ zoom: cal.zoom, ox: cal.ox, oy: cal.oy }));
  await page.mouse.click(b.x + ix * v.zoom + v.ox, b.y + iy * v.zoom + v.oy);
};
const r = await page.evaluate(() => cal.img.width / 595);
await clicCal(300 * r, 250 * r);
await page.waitForTimeout(250);
const posCal = await page.evaluate(() => db.fens[0].posCal);
const attenduX = 300 * r;
check(posCal && Math.abs(posCal.x - attenduX) < 40, `gommette posée sur le calque (x ${posCal ? posCal.x.toFixed(0) : '—'} pour ${attenduX.toFixed(0)} attendu)`);
check(await page.evaluate(() => !!db.fens[0].posPlan), 'la gommette du plan des pièces est conservée');
check(await page.evaluate(() => db.fens[0].posCal.x !== db.fens[0].posPlan.x), 'les deux supports sont indépendants');
check((await page.locator('#cal-gommettes').innerText()).includes('1 / 2 posée'), 'compteur du calque');

console.log('7. Persistance et exports');
await sauvegardeEcrite();
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
check(await page.evaluate(() => !!db.fens[0].posCal && !!db.fens[0].posPlan), 'positions conservées après rechargement');
await page.click('.nav-zone[data-zone="synthese"]');
await page.waitForTimeout(300);
check((await page.locator('.recap-ligne').first().innerText()).includes('repérée sur plan'), 'récap signale les fenêtres repérées');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export Excel')]);
check(dl.suggestedFilename().endsWith('.xlsx'), 'export Excel généré');

console.log('8. Lot sans fenêtre');
await page.evaluate(async () => { db.appts.push({ id: 'a2', num: 'E02', type: 1 }); db.pieces.push({ id: 3, aid: 'a2', nivInt: 0, nom: 'Studio', l: '4', larg: '4', rot: 0, x: 0, y: 0 }); sauvegarderLocal(); });
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a2');
await page.waitForTimeout(300);
await page.click('#plan-btn-gom');
check((await page.locator('#plan-gommettes').innerText()).includes('Aucune fenêtre saisie'), 'message clair quand le lot n\'a pas de fenêtre');
check(await page.locator('#plan-gommettes .gom-chip').count() === 0, 'aucune pastille proposée');

await page.selectOption('#pie-target', 'a1');
await page.waitForTimeout(400);


await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
