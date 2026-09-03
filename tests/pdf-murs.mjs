/* Rattachement des ouvrants à leur mur, gommettes fenêtres et portes,
   régénération des plans hors écran, et export PDF du dossier de plans —
   dont le contenu est relu avec pdf.js pour vérifier cotes, gommettes,
   murs associés et images réellement intégrées.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/pdf-murs.mjs */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
const SP = path.dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const erreurs = []; let ok = 0, ko = 0;
const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
const U = process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html';
const sauvegardeEcrite = () => page.waitForFunction(() => !saveEnAttente && !saveTimer, null, { timeout: 5000 });

await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: '2024-77', nom: 'Résidence Les Tilleuls', adresse: '12 rue des Lilas', cp: '75011', ville: 'Paris', annee: '1972' },
    docs: [], vmc: {}, chaufCol: {}, ecsCol: {}, chaufs: [], ecss: [], modelesFens: [], plfs: [], plas: [], calques: {},
    appts: [{ id: 'a1', num: 'E01', type: 1, hsp: '2.50', surf: '32' }],
    murs: [{ id: 101, aid: 'a1', nivInt: 0, ori: 'Nord', donne: 'Extérieur', mat: 'Briques pleines simples', l: '5', h: '2.5' },
           { id: 102, aid: 'a1', nivInt: 0, ori: 'Est', donne: 'Extérieur', mat: 'Béton banché', l: '4', h: '2.5' }],
    pieces: [{ id: 1, aid: 'a1', nivInt: 0, nom: 'Séjour', l: '5', larg: '4', rot: 0, x: 0, y: 0 },
             { id: 2, aid: 'a1', nivInt: 0, nom: 'Chambre', l: '4', larg: '3', rot: 0, x: 5, y: 0 }],
    fens: [{ id: 11, aid: 'a1', nivInt: 0, nom: 'F1', ori: 'Nord', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '120', h: '130', nb: '1', motifs: '1', surf: '1.560' }],
    portes: [{ id: 21, aid: 'a1', nivInt: 0, type: 'Porte opaque pleine', mat: 'Bois', donne: 'Circulations communes', iso: 'Non isolée / Inconnue', sas: 'Non', l: '0.9', h: '2.1' }] });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);

console.log('1. Association d\'une fenêtre à un mur');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="fen"]');
await page.selectOption('#fen-target', 'a1');
await page.waitForTimeout(200);
check(await page.locator('#f-mur').isVisible(), 'champ « Mur porteur » présent');
const optsMur = await page.locator('#f-mur option').allInnerTexts();
check(optsMur.length === 3, `les deux murs du lot sont proposés (${optsMur.length - 1})`);
check(optsMur[1].includes('Nord') && optsMur[1].includes('12.5 m²') && optsMur[1].includes('Brique'), `libellé parlant : ${optsMur[1]}`);
await page.click('#list-fens [data-act="editerParoi"]');
await page.waitForTimeout(200);
await page.selectOption('#f-mur', '101');
await page.click('#ab-save');
await page.waitForTimeout(300);
check(await page.evaluate(() => db.fens[0].murId) === '101', 'mur enregistré sur la fenêtre');
check((await page.locator('#list-fens .item-row').innerText()).includes('Mur Nord'), 'mur rappelé dans la liste');

console.log('2. Alerte quand les ouvrants dépassent la façade');
await page.evaluate(() => { db.fens.push({ id: 12, aid: 'a1', nivInt: 0, nom: 'F2', ori: 'Nord', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '300', h: '250', nb: '2', motifs: '1', surf: '7.500', murId: '101' }); sauvegarderLocal(); renderElementsList('fen'); });
await page.click('#list-fens [data-act="editerParoi"] >> nth=1');
await page.waitForTimeout(200);
await page.click('#ab-save');
await page.waitForTimeout(300);
const alerte = await page.locator('#sys-toast').innerText();
check(alerte.includes('totalisent') && alerte.includes('12.50'), `percement impossible signalé : ${alerte.slice(0, 90)}`);
await page.evaluate(() => { db.fens = db.fens.filter(f => f.id !== 12); sauvegarderLocal(); renderElementsList('fen'); });

console.log('3. Association d\'une porte à un mur');
await page.click('.nav-vue[data-vue="portes"]');
await page.selectOption('#por-target', 'a1');
await page.waitForTimeout(200);
check(await page.locator('#po-mur').isVisible(), 'champ « Mur porteur » sur les portes');
await page.click('#list-portes [data-act="editerParoi"]');
await page.waitForTimeout(200);
await page.selectOption('#po-mur', '102');
await page.click('#ab-save');
await page.waitForTimeout(300);
check(await page.evaluate(() => db.portes[0].murId) === '102', 'mur enregistré sur la porte');
check((await page.locator('#list-portes .item-row').innerText()).includes('Mur Est'), 'mur rappelé dans la liste des portes');

console.log('4. Gommettes : fenêtres et portes');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a1');
await page.waitForTimeout(300);
await page.click('#plan-btn-gom');
check(await page.locator('#plan-gommettes .gom-chip').count() === 2, 'la fenêtre et la porte sont proposées');
const chips = await page.locator('#plan-gommettes .gom-chip').allInnerTexts();
check(chips.some(c => c.includes('F1') && c.includes('🪟')), 'fenêtre repérée par son icône');
check(chips.some(c => c.includes('P1') && c.includes('🚪')), 'porte repérée par son icône et numérotée');
const versEcranPlan = async pt => {
  const v = await page.evaluate(() => ({ ...planVue }));
  const b = await page.locator('#plan-canvas').boundingBox();
  return { x: b.x + v.dx + (pt.x - v.minX) * v.ech, y: b.y + v.dy + (pt.y - v.minY) * v.ech };
};
await page.click('.gom-chip:has-text("F1")');
let c1 = await versEcranPlan({ x: 2.5, y: 0.3 });
await page.mouse.click(c1.x, c1.y);
await page.waitForTimeout(250);
await page.click('.gom-chip:has-text("P1")');
let c2 = await versEcranPlan({ x: 6.5, y: 2.5 });
await page.mouse.click(c2.x, c2.y);
await page.waitForTimeout(250);
check(await page.evaluate(() => !!db.fens[0].posPlan), 'gommette de fenêtre posée');
check(await page.evaluate(() => !!db.portes[0].posPlan), 'gommette de porte posée');
check((await page.locator('#plan-gommettes').innerText()).includes('2 / 2 posée'), 'compteur des deux ouvrants');
// Une gommette sélectionnée est orange : on désélectionne avant de vérifier les couleurs
await page.evaluate(() => { gomSel = null; dessinerPlanPieces(); });
const couleurs = await page.evaluate(() => {
  const c = document.getElementById('plan-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bleu = 0, violet = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 80 && d[i + 1] > 80 && d[i + 1] < 140 && d[i + 2] > 200) bleu++;
    if (d[i] > 100 && d[i] < 145 && d[i + 1] < 90 && d[i + 2] > 200) violet++;
  }
  return { bleu, violet };
});
check(couleurs.bleu > 150 && couleurs.violet > 150, `fenêtre en bleu (${couleurs.bleu} px) et porte en violet (${couleurs.violet} px)`);

console.log('5. Plans redessinés hors écran');
const imgPieces = await page.evaluate(() => imagePlanPieces('a1', 0, 620, 450));
check(typeof imgPieces === 'string' && imgPieces.startsWith('data:image/png'), 'plan des pièces régénéré hors écran');
check(await page.evaluate(() => curAppt) === 'a1' && await page.evaluate(() => modePlan) === 'gommettes', 'le contexte de travail est restauré après le rendu');
check(await page.evaluate(() => document.querySelectorAll('canvas').length) === 3, 'aucun canevas hors écran laissé derrière');
const vide = await page.evaluate(() => imagePlanPieces('a2-inexistant', 0, 300, 200));
check(vide === null, 'lot sans pièce : pas d\'image');

console.log('5 bis. Calque : cote et gommette');
await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
const [chCal] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button:has-text("Charger")')]);
await chCal.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });
// Échelle et cote posées directement, le parcours étant déjà couvert par tests/cotes.mjs
await page.evaluate(() => {
  const r = cal.img.width / 595;
  cal.echelle = 12.45 / (400 * r);
  cal.ref = { metres: 12.45, pixels: 400 * r, libelle: 'façade sud au télémètre', date: '2026-09-03' };
  cal.mesures = [{ id: 1, a: { x: 100 * r, y: 300 * r }, b: { x: 500 * r, y: 300 * r }, nom: 'Façade nord', m: 12.45 }];
  cal.mode = 'gommettes'; sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
});
await page.click('#cal-gommettes .gom-chip:has-text("F1")');
await page.waitForTimeout(150);
// Le canevas doit être à l'écran et sous la barre collante, sinon le clic la touche
await page.evaluate(() => { const c = document.getElementById('calque-canvas'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 175); });
await page.waitForTimeout(250);
const bCal = await page.locator('#calque-canvas').boundingBox();
check(bCal.y > 150, `canevas dégagé de la barre collante (y ${bCal.y.toFixed(0)})`);
const vCal = await page.evaluate(() => ({ zoom: cal.zoom, ox: cal.ox, oy: cal.oy }));
const rr = await page.evaluate(() => cal.img.width / 595);
await page.mouse.click(bCal.x + 300 * rr * vCal.zoom + vCal.ox, bCal.y + 250 * rr * vCal.zoom + vCal.oy);
await page.waitForTimeout(250);
check(await page.evaluate(() => !!db.fens[0].posCal), 'gommette posée sur le plan décalqué');
check(await page.evaluate(() => db.calques['a1_0'].mesures.length) === 1, 'cote enregistrée sur le calque');
const imgCal = await page.evaluate(() => imageCalque('a1', 0, 620, 450));
check(typeof imgCal === 'string' && imgCal.startsWith('data:image/png'), 'calque régénéré hors écran');
check(await page.evaluate(() => cal.mode) === 'gommettes', 'l\'état du calque en cours est restauré');

console.log('6. Export PDF du dossier de plans');
await sauvegardeEcrite();
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
check(await page.locator('text=Dossier de plans (PDF)').isVisible(), 'bouton d\'export PDF présent');
check(await page.evaluate(() => typeof window.jspdf === 'undefined'), 'jsPDF non chargé tant qu\'il ne sert pas');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Dossier de plans (PDF)')]);
const chemin = fs.mkdtempSync(path.join(os.tmpdir(), 'mydiag-')) + '/plans.pdf';
await dl.saveAs(chemin);
check(dl.suggestedFilename().startsWith('Plans_MyDiag_2024-77'), `nom du fichier : ${dl.suggestedFilename()}`);
check(await page.evaluate(() => typeof window.jspdf !== 'undefined'), 'jsPDF chargé à la demande');
const taille = fs.statSync(chemin).size;
check(taille > 8000, `PDF non vide (${Math.round(taille / 1024)} Ko)`);
const brut = fs.readFileSync(chemin, 'latin1');
check(brut.startsWith('%PDF-'), 'en-tête PDF valide');
check(brut.includes('%%EOF'), 'fin de fichier PDF valide');
check(taille < 900000, `fichier raisonnable (${Math.round(taille / 1024)} Ko)`);

console.log('7. Contenu réel du PDF, relu avec pdf.js');
await page.evaluate(() => assurerLib('pdfjsLib', 'lib/pdf.min.js'));
const octets = [...fs.readFileSync(chemin)];
const contenu = await page.evaluate(async data => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  let images = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const t = await p.getTextContent();
    pages.push(t.items.map(i => i.str).join(' '));
    const ops = await p.getOperatorList();
    images += ops.fnArray.filter(f => f === pdfjsLib.OPS.paintImageXObject).length;
  }
  return { nb: doc.numPages, pages, images };
}, octets);
check(contenu.nb === 3, `3 pages : couverture, plan des pièces, plan décalqué → ${contenu.nb}`);
const couverture = contenu.pages[0];
check(couverture.includes('Dossier de plans'), 'couverture titrée');
check(couverture.includes('Résidence Les Tilleuls') && couverture.includes('2024-77'), 'copropriété et référence en couverture');
check(couverture.includes('12 rue des Lilas') && couverture.includes('75011 Paris'), 'adresse complète');
const pageCalque = contenu.pages.find(p => p.includes('Plan décalqué')) || '';
check(!!pageCalque, 'une page porte le plan décalqué');
check(pageCalque.includes('Cotes relevées') && pageCalque.includes('Façade nord') && pageCalque.includes('12.45 m'), 'les cotes relevées figurent au PDF');
check(pageCalque.includes('Échelle') && pageCalque.includes('façade sud au télémètre'), 'l\'origine de l\'échelle est rappelée');
check(pageCalque.includes('F1'), 'la gommette du calque est reprise dans la légende');
const pagePlan = contenu.pages.find(p => p.includes('Plan des pièces relevées')) || '';
check(!!pagePlan, 'une page porte le plan des pièces');
check(pagePlan.includes('Lot E01'), 'lot identifié sur la page');
check(pagePlan.includes('F1') && pagePlan.includes('Fenêtre'), 'la fenêtre figure dans la légende');
check(pagePlan.includes('P1') && pagePlan.includes('Porte'), 'la porte figure dans la légende');
check(pagePlan.includes('Nord') && pagePlan.includes('5×2.5 m'), 'le mur associé à la fenêtre est repris');
check(pagePlan.includes('Est') && pagePlan.includes('4×2.5 m'), 'le mur associé à la porte est repris');
check((pagePlan.match(/oui/g) || []).length === 2, 'les deux ouvrants sont marqués repérés');
check(contenu.images >= 2, `les deux plans sont intégrés en image (${contenu.images})`);
check(contenu.pages.every(p => p.includes('page ')), 'pagination sur toutes les pages');

await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
