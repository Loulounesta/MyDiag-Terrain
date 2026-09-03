/* Saisie par pièces, assemblage automatique, contour, et calque sur plan PDF.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/plans.mjs
   Le PDF de test se trouve dans tests/fixtures/plan-test.pdf. */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SP = path.dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const erreurs = []; let ok = 0, ko = 0;
const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
const U = process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html';

// Prépare un dossier avec un lot
await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'P1', nom: 'Plans', etages: '3' }, docs: [], vmc: {}, chaufCol: {}, ecsCol: {},
    appts: [{ id: 'a1', num: 'E01', type: 1, hsp: '2.50' }], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [], pieces: [], calques: {} });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);

console.log('1. Navigation vers la saisie par pièces');
await page.click('.nav-zone[data-zone="dossier"]');
check((await page.locator('.nav-vue').count()) === 4, 'zone Dossier : Copro, Lots, Pièces, Calque');
await page.click('.nav-vue[data-vue="pieces"]');
check(await page.locator('#vw-pieces').isVisible(), 'vue Pièces ouverte');
check(await page.locator('body').evaluate(b => b.classList.contains('has-ab')), 'barre d\'action disponible');
check((await page.locator('#ab-save').innerText()).includes('cette pièce'), 'bouton « Enregistrer cette pièce »');
await page.selectOption('#pie-target', 'a1');
check((await page.locator('#ab-ctx').innerText()).includes('Lot E01'), 'contexte lot dans la barre');
check((await page.locator('.piece-chip').count()) === 9, 'raccourcis de noms de pièces');

console.log('2. Saisie de pièces');
await page.click('.piece-chip:has-text("Séjour")');
check(await page.inputValue('#pie-nom') === 'Séjour', 'raccourci renseigne le nom');
check(await page.evaluate(() => document.activeElement.id) === 'pie-l', 'curseur placé sur la longueur');
await page.fill('#pie-l', '5');
await page.fill('#pie-larg', '4');
check((await page.locator('#pie-apercu').innerText()).includes('20.00 m²'), 'aperçu de surface en direct');
await page.press('#pie-larg', 'Enter');
check(await page.evaluate(() => db.pieces.length) === 1, 'pièce enregistrée par Entrée');
check(await page.inputValue('#pie-nom') === '', 'champs vidés pour la pièce suivante');
check(await page.locator('#plan-container').isVisible(), 'plan affiché dès la première pièce');

const ajouter = async (chip, l, larg) => {
  await page.click(`.piece-chip:has-text("${chip}")`);
  await page.fill('#pie-l', String(l)); await page.fill('#pie-larg', String(larg));
  await page.click('#ab-save');
};
await ajouter('Cuisine', 3, 2.5);
await ajouter('Chambre', 4, 3);
check(await page.inputValue('#pie-nom') === '', 'nom vidé après enregistrement');
await page.click('.piece-chip:has-text("Chambre 2")');
check(await page.inputValue('#pie-nom') === 'Chambre 2', 'les chambres se numérotent seules');
await page.fill('#pie-l', '3.5'); await page.fill('#pie-larg', '3'); await page.click('#ab-save');
await ajouter('Salle de bains', 2.5, 2);
check(await page.evaluate(() => db.pieces.length) === 5, '5 pièces saisies');
const total = await page.evaluate(() => db.pieces.reduce((s, p) => s + p.l * p.larg, 0));
check(Math.abs(total - 55) < 0.01, `surface totale ${total.toFixed(2)} m² (20+7.5+12+10.5+5)`);
check((await page.locator('#pie-total').innerText()).includes('55.00 m²'), 'total affiché dans la liste');
check((await page.locator('#plan-msg').innerText()).includes('55.00 m²'), 'total affiché sous le plan');
check(await page.locator('#list-pieces .item-row').count() === 5, '5 lignes dans la liste');

console.log('3. Assemblage automatique');
const pos = await page.evaluate(() => db.pieces.map(p => ({ n: p.nom, x: p.x, y: p.y })));
check(pos.every(p => typeof p.x === 'number' && typeof p.y === 'number'), 'toutes les pièces sont positionnées');
const chevauche = await page.evaluate(() => {
  const d = p => p.rot ? { w: +p.larg, h: +p.l } : { w: +p.l, h: +p.larg };
  for (let i = 0; i < db.pieces.length; i++) for (let j = i + 1; j < db.pieces.length; j++) {
    const a = db.pieces[i], b = db.pieces[j], da = d(a), db_ = d(b);
    const inter = a.x < b.x + db_.w - 0.01 && a.x + da.w > b.x + 0.01 && a.y < b.y + db_.h - 0.01 && a.y + da.h > b.y + 0.01;
    if (inter) return `${a.nom} / ${b.nom}`;
  }
  return null;
});
check(chevauche === null, 'aucun chevauchement entre pièces' + (chevauche ? ' — ' + chevauche : ''));
await page.click('#plan-container >> text=Réassembler');
check((await page.locator('#sys-toast').innerText()).includes('réassemblées'), 'réassemblage manuel');
const chevauche2 = await page.evaluate(() => {
  const d = p => p.rot ? { w: +p.larg, h: +p.l } : { w: +p.l, h: +p.larg };
  for (let i = 0; i < db.pieces.length; i++) for (let j = i + 1; j < db.pieces.length; j++) {
    const a = db.pieces[i], b = db.pieces[j], da = d(a), db_ = d(b);
    if (a.x < b.x + db_.w - 0.01 && a.x + da.w > b.x + 0.01 && a.y < b.y + db_.h - 0.01 && a.y + da.h > b.y + 0.01) return true;
  }
  return false;
});
check(!chevauche2, 'toujours aucun chevauchement après réassemblage');

console.log('4. Contour extérieur');
const contour = await page.evaluate(() => contourPieces(db.pieces).map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })));
check(contour.length >= 4, `contour de ${contour.length} sommets`);
const aireContour = await page.evaluate(() => {
  const c = contourPieces(db.pieces); let a = 0;
  for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
});
check(aireContour >= 54.99, `aire du contour ${aireContour.toFixed(2)} m² ≥ somme des pièces`);

console.log('5. Rotation et déplacement');
await page.evaluate(() => { pieceSel = db.pieces[0].id; });
await page.click('#plan-container >> text=Pivoter');
check(await page.evaluate(() => db.pieces[0].rot) === 1, 'pièce pivotée');
check((await page.locator('#list-pieces .item-row').first().innerText()).includes('pivotée'), 'rotation visible dans la liste');
await page.click('#plan-container >> text=Pivoter');
check(await page.evaluate(() => db.pieces[0].rot) === 0, 'rotation annulable');
const boite = await page.locator('#plan-canvas').boundingBox();
await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
await page.mouse.down(); await page.mouse.move(boite.x + boite.width / 2 + 40, boite.y + boite.height / 2 + 30, { steps: 6 }); await page.mouse.up();
check(await page.evaluate(() => pieceSel !== null), 'une pièce est sélectionnée par le toucher');

console.log('6. Surface, plan et murs depuis les pièces');
await page.click('#plan-container >> text=Appliquer la surface au lot');
const apt = await page.evaluate(() => db.appts[0]);
check(Math.abs(parseFloat(apt.surf) - 55) < 0.1, `surface du lot : ${apt.surf} m²`);
await page.click('#plan-container >> text=Enregistrer le plan');
await page.waitForTimeout(400);
check(await page.evaluate(() => !!(db.appts[0].plans && db.appts[0].plans[0])), 'plan enregistré sur le lot');
check(await page.evaluate(() => db.docs.some(d => d.name.startsWith('Plan_E01'))), 'plan ajouté aux documents');
await page.click('#plan-container >> text=Générer les murs');
await page.waitForSelector('#dlg[open]');
check((await page.locator('#dlg').innerText()).includes('2.50 m'), 'hauteur du lot reprise dans la confirmation');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
const murs = await page.evaluate(() => db.murs.map(m => ({ l: +m.l, ori: m.ori, h: m.h, vect: m.vectX !== undefined })));
check(murs.length >= 4, `${murs.length} murs générés`);
check(murs.every(m => m.h === '2.50'), 'hauteur reprise sur tous les murs');
check(murs.every(m => m.vect), 'vecteurs conservés pour le croquis');
const perim = murs.reduce((s, m) => s + m.l, 0);
check(perim > 25 && perim < 50, `périmètre cohérent : ${perim.toFixed(2)} m`);

console.log('7. Calque : chargement d\'un PDF');
await page.click('.nav-vue[data-vue="calque"]');
check(await page.locator('#vw-calque').isVisible(), 'vue Calque ouverte');
check(await page.locator('#cal-vide').isVisible(), 'invite de chargement affichée');
check(await page.evaluate(() => typeof window.pdfjsLib === 'undefined'), 'pdf.js non chargé tant qu\'il ne sert pas');
await page.selectOption('#cal-target', 'a1');
const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button')]);
await ch.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });
check(true, 'PDF rendu dans le calque');
check(await page.evaluate(() => typeof window.pdfjsLib !== 'undefined'), 'pdf.js chargé à la demande');
check(await page.locator('#cal-vide').isHidden(), 'invite masquée après chargement');
check(await page.evaluate(() => !!db.calques['a1_0']), 'calque mémorisé pour le lot');
const dims = await page.evaluate(() => ({ w: cal.img.width, h: cal.img.height }));
check(dims.w > 500 && dims.h > 700, `page rendue en ${dims.w}×${dims.h} px`);

console.log('8. Calibrage et tracé');
// Le rectangle du PDF fait 400 pt de large ; on le calibre à 10 m.
const ratio = await page.evaluate(() => cal.img.width / 595);
await page.evaluate(r => {
  cal.mode = 'calibrer';
  cal.calib = [{ x: 100 * r, y: 300 }, { x: 500 * r, y: 300 }];
  const pix = Math.hypot(cal.calib[1].x - cal.calib[0].x, cal.calib[1].y - cal.calib[0].y);
  cal.echelle = 10 / pix; cal.mode = 'tracer'; cal.calib = [];
  sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}, ratio);
check(await page.evaluate(() => cal.echelle > 0), 'échelle réglée');
check((await page.locator('#cal-resultat').innerText()).includes('Échelle réglée'), 'invite de tracé affichée');
// Contour : le rectangle 400×300 pt doit donner 10 m × 7,5 m = 75 m²
await page.evaluate(r => {
  cal.pts = [{ x: 100 * r, y: 142 * r }, { x: 500 * r, y: 142 * r }, { x: 500 * r, y: 442 * r }, { x: 100 * r, y: 442 * r }];
  sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}, ratio);
const surf = await page.evaluate(() => surfaceCalque());
check(Math.abs(surf - 75) < 0.5, `surface relevée ${surf.toFixed(2)} m² (attendu 75)`);
const per = await page.evaluate(() => perimetreCalque());
check(Math.abs(per - 35) < 0.5, `périmètre ${per.toFixed(2)} m (attendu 35)`);
check((await page.locator('#cal-resultat').innerText()).includes('75.0'), 'surface affichée');
check(await page.locator('#cal-actions').isVisible(), 'actions disponibles');

console.log('9. Points, zoom et persistance du calque');
await page.click('text=↩︎ Annuler le point');
check(await page.evaluate(() => cal.pts.length) === 3, 'dernier point annulé');
await page.evaluate(r => { cal.pts.push({ x: 100 * r, y: 442 * r }); sauverEtatCalque(); majInterfaceCalque(); }, ratio);
const z0 = await page.evaluate(() => cal.zoom);
await page.click('.cal-zbtn:has-text("＋")');
check(await page.evaluate(() => cal.zoom) > z0, 'zoom avant');
await page.click('.cal-zbtn:has-text("⛶")');
check(Math.abs(await page.evaluate(() => cal.zoom) - z0) < 0.001, 'recentrage rétablit la vue');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 15000 });
check(await page.evaluate(() => cal.pts.length) === 4 && await page.evaluate(() => cal.echelle > 0), 'calque, échelle et tracé restaurés après rechargement');

console.log('10. Surface, plan et murs depuis le calque');
await page.evaluate(() => { db.murs = []; sauvegarderLocal(); });
await page.click('#cal-actions >> text=Appliquer la surface');
check(Math.abs(await page.evaluate(() => parseFloat(db.appts[0].surf)) - 75) < 0.6, `surface du lot mise à jour : ${await page.evaluate(() => db.appts[0].surf)} m²`);
await page.click('#cal-actions >> text=Enregistrer le plan');
await page.waitForTimeout(400);
check(await page.evaluate(() => db.docs.some(d => d.name.startsWith('Calque_E01'))), 'calque enregistré dans les documents');
await page.click('#cal-actions >> text=Générer les murs');
await page.waitForSelector('#dlg[open]');
await page.click('#dlg .dlg-ok');
await page.waitForTimeout(300);
const murs2 = await page.evaluate(() => db.murs.map(m => +m.l));
check(murs2.length === 4, `${murs2.length} murs générés depuis le calque`);
const attendus = [10, 7.5, 10, 7.5];
check(murs2.every((l, i) => Math.abs(l - attendus[i]) < 0.3), 'longueurs conformes au relevé : ' + murs2.map(l => l.toFixed(2)).join(' / '));
await page.click('.nav-zone[data-zone="parois"]');
await page.selectOption('#murs-target', 'a1');
check(await page.locator('#croquis-container').isVisible(), 'croquis reconstruit depuis les murs générés');
check((await page.locator('#croquis-msg').innerText()).includes('Périmètre fermé'), 'contour refermé dans le croquis');

console.log('11. Export et suppression');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export Excel')]);
check(dl.suggestedFilename().endsWith('.xlsx'), 'export Excel généré avec la feuille Pièces');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a1');
await page.click('#list-pieces [data-act="suppElement"] >> nth=0');
check(await page.evaluate(() => db.pieces.length) === 4, 'pièce supprimée');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => db.pieces.length) === 5, 'suppression annulable');
await page.click('#list-pieces [data-act="clonerParoi"] >> nth=0');
check(await page.evaluate(() => db.pieces.length) === 6, 'pièce dupliquée');
const sansChevauchement = await page.evaluate(() => {
  const d = p => p.rot ? { w: +p.larg, h: +p.l } : { w: +p.l, h: +p.larg };
  for (let i = 0; i < db.pieces.length; i++) for (let j = i + 1; j < db.pieces.length; j++) {
    const a = db.pieces[i], b = db.pieces[j], da = d(a), db_ = d(b);
    if (a.x < b.x + db_.w - 0.01 && a.x + da.w > b.x + 0.01 && a.y < b.y + db_.h - 0.01 && a.y + da.h > b.y + 0.01) return false;
  }
  return true;
});
check(sansChevauchement, 'la copie ne se superpose pas à l\'originale');


await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
await page.waitForTimeout(1200);


await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
