/* Calage d'une pièce mesurée sur un plan : rectangle coté, ajustement, rotation
   libre, échelle déduite et vérification croisée avec un second calage.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/gabarit.mjs */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SP = path.dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const erreurs = []; let ok = 0, ko = 0;
const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
await page.goto(process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html');
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
// Un lot avec deux pièces mesurées sur le terrain
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'G1', nom: 'Gabarit' }, docs: [], vmc: {}, chaufCol: {}, ecsCol: {},
    appts: [{ id: 'a1', num: 'E01', type: 1, hsp: '2.50' }], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [],
    pieces: [{ id: 1, aid: 'a1', nivInt: 0, nom: 'Séjour', l: '5', larg: '4', rot: 0, x: 0, y: 0 },
             { id: 2, aid: 'a1', nivInt: 0, nom: 'Cuisine', l: '3', larg: '2.5', rot: 0, x: 5, y: 0 }], calques: {} });
});
await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button:has-text("Charger")')]);
await ch.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });

console.log('1. Choix de la méthode de calibrage');
await page.click('#cal-echelle button:has-text("Calibrer")');
await page.waitForSelector('#dlg[open]');
const methodes = await page.locator('#dlg-choix option').allInnerTexts();
check(methodes.length === 2 && methodes[0].includes('pièce mesurée'), 'le calage d\'une pièce est proposé en premier');
check((await page.locator('#dlg').innerText()).includes('vérifie'), 'la vérification croisée est expliquée');
await page.click('#dlg .dlg-ok');
await page.waitForSelector('#dlg[open]');
const pieces = await page.locator('#dlg-choix option').allInnerTexts();
check(pieces.length === 2 && pieces[0].includes('Séjour — 5.00 × 4.00 m'), `pièces proposées avec leurs cotes : ${pieces[0]}`);
await page.click('#dlg .dlg-ok');
await page.waitForFunction(() => cal.gabarit !== null, null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(200);

console.log('2. Rectangle coté posé sur le plan');
check(await page.evaluate(() => cal.mode) === 'caler', 'mode calage actif');
const g0 = await page.evaluate(() => cal.gabarit);
check(g0 && g0.nom === 'Séjour' && g0.l === 5 && g0.larg === 4, 'gabarit aux cotes de la pièce');
check(await page.locator('#cal-gabarit-barre').isVisible(), 'barre du gabarit affichée');
check(await page.locator('#cal-modes').isHidden(), 'sélecteur de mode masqué pendant le calage');
const d0 = await page.evaluate(() => dimsGabarit());
check(Math.abs(d0.h / d0.w - 4 / 5) < 1e-6, 'proportions figées par les cotes du terrain (4/5)');
check((await page.locator('#cal-resultat').innerText()).includes('5.00 × 4.00 m'), 'cotes rappelées sous le plan');

console.log('3. Redimensionnement : l\'échelle suit');
const ech0 = await page.evaluate(() => echelleGabarit());
// Conversion image → écran, relue à chaque fois (la mise en page bouge)
const versEcranTest = async pt => {
  const v = await page.evaluate(() => ({ zoom: cal.zoom, ox: cal.ox, oy: cal.oy }));
  const b = await page.locator('#calque-canvas').boundingBox();
  return { x: b.x + pt.x * v.zoom + v.ox, y: b.y + pt.y * v.zoom + v.oy };
};
const coinGabarit = () => page.evaluate(() => { const d = dimsGabarit(); return gabaritVersImage(d.w / 2, d.h / 2); });
const ancreGabarit = () => page.evaluate(() => { const d = dimsGabarit(); return gabaritVersImage(-d.w / 2, -d.h / 2); });
const w0 = await page.evaluate(() => cal.gabarit.w);
const coin0 = await coinGabarit(), ancre0 = await ancreGabarit();
// Tirer le coin pour doubler la largeur, l'angle opposé restant fixe
const depart = await versEcranTest(coin0);
const arrivee = await versEcranTest({ x: ancre0.x + 2 * (coin0.x - ancre0.x), y: ancre0.y + 2 * (coin0.y - ancre0.y) });
await page.mouse.move(depart.x, depart.y); await page.mouse.down();
await page.mouse.move(arrivee.x, arrivee.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
const w1 = await page.evaluate(() => cal.gabarit.w);
check(Math.abs(w1 / w0 - 2) < 0.08, `largeur doublée (${(w1 / w0).toFixed(2)}×)`);
const d1 = await page.evaluate(() => dimsGabarit());
check(Math.abs(d1.h / d1.w - 4 / 5) < 1e-6, 'proportions conservées après ajustement');
check(Math.abs(await page.evaluate(() => echelleGabarit()) / ech0 - 0.5) < 0.06, 'échelle divisée par deux quand le rectangle double');
const ancre1 = await ancreGabarit();
check(Math.hypot(ancre1.x - ancre0.x, ancre1.y - ancre0.y) < 3, 'l\'angle opposé n\'a pas bougé');

console.log('4. Déplacement et quart de tour');
const avantDep = await page.evaluate(() => ({ x: cal.gabarit.cx, y: cal.gabarit.cy }));
const p1 = await versEcranTest(avantDep);
const p2 = await versEcranTest({ x: avantDep.x + 120, y: avantDep.y + 60 });
await page.mouse.move(p1.x, p1.y); await page.mouse.down(); await page.mouse.move(p2.x, p2.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
const apresDep = await page.evaluate(() => ({ x: cal.gabarit.cx, y: cal.gabarit.cy }));
check(Math.abs(apresDep.x - avantDep.x - 120) < 6 && Math.abs(apresDep.y - avantDep.y - 60) < 6, 'rectangle déplacé au doigt');
const echAvantRot = await page.evaluate(() => echelleGabarit());
await page.click('#cal-gabarit-barre >> text=Quart de tour');
check(await page.evaluate(() => cal.gabarit.ang) === 90, 'quart de tour appliqué');
check(Math.abs(await page.evaluate(() => echelleGabarit()) - echAvantRot) < 1e-9, 'le quart de tour ne change pas l\'échelle');
const dRot = await page.evaluate(() => dimsGabarit());
check(dRot.mL === 5 && dRot.mH === 4, 'le rectangle porte toujours 5 m sur sa longueur');
await page.click('#cal-gabarit-barre >> text=Quart de tour');
await page.click('#cal-gabarit-barre >> text=Quart de tour');
await page.click('#cal-gabarit-barre >> text=Quart de tour');
check(await page.evaluate(() => cal.gabarit.ang) === 0, 'quatre quarts de tour reviennent au départ');

console.log('4 bis. Rotation libre à la poignée');
// Rectangle ramené au centre de l'image, à une taille modeste : la poignée reste visible
await page.evaluate(() => {
  cal.gabarit.w = cal.img.width * 0.25;
  cal.gabarit.cx = cal.img.width / 2; cal.gabarit.cy = cal.img.height / 2; cal.gabarit.ang = 0;
  recentrerCalque(); majInterfaceCalque(); dessinerCalque();
});
await page.waitForTimeout(200);
const echAvantLibre = await page.evaluate(() => echelleGabarit());
// La poignée se trouve à 36 px au-dessus du bord haut, dans le repère du rectangle
const posPoignee = async () => versEcranTest(await page.evaluate(() => { const d = dimsGabarit(); return gabaritVersImage(0, -d.h / 2 - 36 / cal.zoom); }));
const centreEcran = async () => versEcranTest(await page.evaluate(() => ({ x: cal.gabarit.cx, y: cal.gabarit.cy })));
const pg = await posPoignee(); const ce = await centreEcran();
const rayon = Math.hypot(pg.x - ce.x, pg.y - ce.y);
// Amener la poignée à 30° de la verticale
const cible = { x: ce.x + rayon * Math.sin(30 * Math.PI / 180), y: ce.y - rayon * Math.cos(30 * Math.PI / 180) };
await page.mouse.move(pg.x, pg.y); await page.mouse.down();
await page.mouse.move(cible.x, cible.y, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
const angLibre = await page.evaluate(() => cal.gabarit.ang);
check(Math.abs(angLibre - 30) < 2, `inclinaison libre obtenue : ${angLibre}°`);
check(Math.abs(await page.evaluate(() => echelleGabarit()) - echAvantLibre) < 1e-9, 'incliner ne change pas l\'échelle');
check((await page.locator('#cal-resultat').innerText()).includes('incliné de'), 'inclinaison annoncée sous le plan');
// Aimantation : à 1° d'un axe, on retombe pile dessus
const cible2 = { x: ce.x + rayon * Math.sin(1 * Math.PI / 180), y: ce.y - rayon * Math.cos(1 * Math.PI / 180) };
const pg2 = await posPoignee();
await page.mouse.move(pg2.x, pg2.y); await page.mouse.down();
await page.mouse.move(cible2.x, cible2.y, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
const angSnap = await page.evaluate(() => cal.gabarit.ang);
check(angSnap === 0, `aimantation sur l'axe du plan (obtenu ${angSnap}°)`);
// Redresser depuis une inclinaison quelconque
await page.evaluate(() => { cal.gabarit.ang = 74; majInterfaceCalque(); dessinerCalque(); });
await page.click('#cal-gabarit-barre >> text=Redresser');
check(await page.evaluate(() => cal.gabarit.ang) === 90, 'bouton Redresser aligne sur le quart de tour le plus proche');
await page.evaluate(() => { cal.gabarit.ang = 0; majInterfaceCalque(); dessinerCalque(); });

console.log('5. Validation et vérification croisée');
const echAttendue = await page.evaluate(() => echelleGabarit());
await page.click('#cal-gabarit-barre >> text=Valider');
await page.waitForTimeout(300);
check(Math.abs(await page.evaluate(() => cal.echelle) - echAttendue) < 1e-9, 'échelle du plan calée sur le gabarit');
const ref = await page.evaluate(() => cal.ref);
check(ref && ref.libelle.includes('Séjour') && ref.libelle.includes('5.00 × 4.00 m'), `référence enregistrée : ${ref.libelle}`);
check(ref.piece === 1, 'la pièce d\'origine est mémorisée');
check((await page.locator('#cal-echelle').innerText()).includes('Séjour'), 'bandeau rappelle la pièce de calage');
check(await page.evaluate(() => cal.mode) === 'tracer', 'retour au tracé après validation');
check(await page.locator('#cal-gabarit-barre').isHidden(), 'barre du gabarit masquée');
check(await page.evaluate(() => cal.gabarit !== null), 'le rectangle reste affiché comme témoin');

console.log('6. Second calage : écart annoncé');
await page.click('#cal-echelle button:has-text("Recalibrer")');
await page.waitForSelector('#dlg[open]');
await page.click('#dlg .dlg-ok');
await page.waitForSelector('#dlg[open]');
await page.selectOption('#dlg-choix', '2');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
check(await page.evaluate(() => cal.gabarit.nom) === 'Cuisine', 'second gabarit sur la Cuisine');
check((await page.locator('#cal-resultat').innerText()).includes('Écart avec l’échelle actuelle'), 'écart annoncé pendant le calage');
// Ajuster pour retomber sur la même échelle que le premier calage
await page.evaluate(ech => { cal.gabarit.w = 3 / ech; majInterfaceCalque(); dessinerCalque(); }, echAttendue);
check((await page.locator('#cal-resultat').innerText()).includes('concordent'), 'concordance signalée quand les deux relevés s\'accordent');
await page.click('#cal-gabarit-barre >> text=Valider');
await page.waitForTimeout(300);
check((await page.locator('#sys-toast').innerText()).includes('identique'), 'validation : concordance confirmée');

console.log('7. Persistance');
await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 15000 });
check(await page.evaluate(() => cal.gabarit && cal.gabarit.nom) === 'Cuisine', 'gabarit retrouvé après rechargement');
check(Math.abs(await page.evaluate(() => cal.echelle) - echAttendue) < 1e-6, 'échelle retrouvée');
check((await page.locator('#cal-echelle').innerText()).includes('Cuisine'), 'bandeau rappelle la pièce après rechargement');
await page.waitForTimeout(400);


console.log('8. Sans pièce saisie : retour au pointage');
await page.evaluate(() => { db.pieces = []; sauvegarderLocal(); });
await page.click('#cal-echelle button:has-text("Recalibrer")');
await page.waitForTimeout(300);
check(await page.evaluate(() => cal.mode) === 'calibrer', 'sans pièce, le pointage à deux points s\'ouvre directement');

await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
