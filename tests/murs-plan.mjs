/* Rattachement des ouvrants au mur qu'ils percent, depuis le plan.
   Les murs nés d'un contour (plan des pièces ou plan décalqué) portent leur
   segment : une gommette posée le long d'une façade se rattache toute seule au
   bon mur, la pièce n'étant plus qu'un complément facultatif.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/murs-plan.mjs */
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
const sauvegardeEcrite = () => page.waitForFunction(() => !saveEnAttente && !saveTimer, null, { timeout: 5000 });

await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
// Deux pièces en L : le contour donne six façades d'orientations distinctes.
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'M1', nom: 'Murs' }, docs: [], vmc: {}, chaufCol: {}, ecsCol: {},
    appts: [{ id: 'a1', num: 'M01', type: 1, hsp: '2.50' }], chaufs: [], ecss: [], murs: [], modelesFens: [], portes: [], plfs: [], plas: [],
    pieces: [{ id: 1, aid: 'a1', nivInt: 0, nom: 'Séjour', l: '5', larg: '4', rot: 0, x: 0, y: 0 },
             { id: 2, aid: 'a1', nivInt: 0, nom: 'Chambre', l: '4', larg: '3', rot: 0, x: 5, y: 0 }],
    fens: [{ id: 11, aid: 'a1', nivInt: 0, nom: 'F1', ori: 'Sud', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '120', h: '130', nb: '1', motifs: '1', surf: '1.560' },
           { id: 12, aid: 'a1', nivInt: 0, nom: 'F2', ori: 'Est', type: 'Fenêtres coulissantes', mat: 'Menuiserie bois', vit: 'Simple vitrage vertical', fer: 'Absence', l: '90', h: '110', nb: '1', motifs: '1', surf: '0.990' },
           { id: 13, aid: 'a1', nivInt: 0, nom: 'F3', ori: 'Est', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '300', h: '200', nb: '1', motifs: '1', surf: '6.000' }],
    calques: {} });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);

console.log('1. Les murs générés retiennent leur position');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a1');
await page.waitForTimeout(300);
const murs = await page.evaluate(() => {
  const n = creerMursDepuisContour(contourPieces(piecesCourantes()), '2.50', 'pieces');
  return { n, murs: db.murs.map(m => ({ id: m.id, ori: m.ori, l: m.l, repere: m.repere, seg: m.seg })) };
});
check(murs.n === 6, `six façades générées depuis le contour en L (${murs.n})`);
check(murs.murs.every(m => m.seg && m.repere === 'pieces'), 'chaque mur porte son segment et son repère');
const murNord = murs.murs.find(m => m.ori === 'Nord');
const murOuest = murs.murs.find(m => m.ori === 'Ouest');
const murCourt = murs.murs.find(m => m.ori === 'Est' && m.l === '1.00');
check(murNord && murNord.l === '9.00', `façade Nord de 9 m (${murNord ? murNord.l : '—'})`);
check(murOuest && murOuest.l === '4.00', `façade Ouest de 4 m (${murOuest ? murOuest.l : '—'})`);
check(!!murCourt, 'refend Est de 1 m présent');
check(await page.evaluate(() => mursTraces('pieces').length) === 6, 'les six murs sont repérables sur le plan des pièces');
check(await page.evaluate(() => mursTraces('calque').length) === 0, 'aucun mur repérable sur le calque');

console.log('2. Le mur se déduit de la gommette posée');
// Les messages sont collectés : un toast de migration ADN peut survenir au démarrage.
const brancherToasts = () => page.evaluate(() => { window.__toasts = []; const brut = window.toast; window.toast = (m, o) => { window.__toasts.push(String(m)); return brut(m, o); }; });
const messages = () => page.evaluate(() => (window.__toasts || []).slice());
await brancherToasts();
await page.click('#plan-btn-gom');
check((await page.locator('#plan-gommettes').innerText()).includes('6 façades reconnues 📐'), 'la palette annonce les façades reconnues');
// Le plan est amené sous la barre collante : sinon un appui près de son bord haut
// (la pastille d'une gommette est dessinée 24 px au-dessus de son ancre) touche l'entête.
const amenerLePlan = async () => {
  await page.evaluate(() => window.scrollBy(0, document.getElementById('plan-canvas').getBoundingClientRect().top - 220));
  await page.waitForTimeout(200);
};
const versEcranPlan = async pt => {
  const v = await page.evaluate(() => ({ ...planVue }));
  const b = await page.locator('#plan-canvas').boundingBox();
  return { x: b.x + v.dx + (pt.x - v.minX) * v.ech, y: b.y + v.dy + (pt.y - v.minY) * v.ech };
};
await amenerLePlan();
await page.click('#plan-gommettes .gom-chip:has-text("F1")');
let c = await versEcranPlan({ x: 2.5, y: 0.15 });
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(250);
check(String(await page.evaluate(() => db.fens[0].murId)) === String(murNord.id), 'F1 posée le long de la façade Nord y est rattachée');
check(await page.evaluate(() => (pieceDe(db.fens[0]) || {}).nom) === 'Séjour', 'la pièce reste renseignée en complément');
const messagePose = (await messages()).filter(m => m.includes('posé'));
check(messagePose.some(m => m.includes('F1 posé sur le mur Nord')), `le message nomme le mur : « ${messagePose.join(' | ')} »`);

console.log('3. Le rattachement suit le déplacement');
const pos1 = await page.evaluate(() => db.fens[0].posPlan);
await amenerLePlan();
const depart = await versEcranPlan(pos1);
const arrivee = await versEcranPlan({ x: 0.15, y: 2 });
await page.mouse.move(depart.x, depart.y - 24); await page.mouse.down();
await page.mouse.move(arrivee.x, arrivee.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(250);
check(String(await page.evaluate(() => db.fens[0].murId)) === String(murOuest.id), 'glissée sur la façade Ouest, F1 change de mur');

console.log('4. Loin de toute façade, le choix manuel est conservé');
await page.evaluate(() => { db.fens[1].murId = '999'; db.fens[1].pieceId = 2; sauvegarderLocal(); });
await page.click('#plan-gommettes .gom-chip:has-text("F2")');
c = await versEcranPlan({ x: 2.5, y: 2 });   // plein milieu du séjour, à 2 m des murs
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(250);
check(await page.evaluate(() => db.fens[1].murId) === '999', 'aucun mur sous la gommette : le mur choisi à la main est gardé');
check(await page.evaluate(() => String(db.fens[1].pieceId)) === '1', 'la pièce sous la gommette est reconnue');
await page.evaluate(() => { gomArmee = db.fens[1].id; delete db.fens[1].posPlan; poserGommette('pieces', { x: 7, y: 3.6 }); });
await page.waitForTimeout(200);
check(await page.evaluate(() => String(db.fens[1].pieceId)) === '1', 'hors de toute pièce, la pièce précédente n’est pas effacée');

console.log('5. Percement impossible signalé à la pose');
await page.click('#plan-gommettes .gom-chip:has-text("F3")');
c = await versEcranPlan({ x: 5.05, y: 3.5 });   // le long du refend Est de 1 m
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(250);
check(String(await page.evaluate(() => db.fens[2].murId)) === String(murCourt.id), 'F3 rattachée au refend de 1 m');
const alerte = (await messages()).filter(m => m.includes('⚠️'));
check(alerte.some(m => m.includes('2.50 m²')), `6 m² de vitrage sur 2,50 m² de façade : alerte affichée`);

console.log('6. La façade portant la gommette est soulignée');
await page.click('#plan-gommettes .gom-chip:has-text("F1")');   // gommette rattachée à la façade Ouest, longue de 4 m
await page.waitForTimeout(200);
const orange = () => page.evaluate(() => {
  const cv = document.getElementById('plan-canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 95 && d[i + 1] < 145 && d[i + 2] < 60) n++;
  return n;
});
const avec = await orange();
const memoire = await page.evaluate(() => { const v = db.fens[0].murId; db.fens[0].murId = ''; dessinerPlanPieces(); return v; });
const sans = await orange();
check(avec > sans + 150, `mur de la gommette sélectionnée mis en évidence (${avec} px contre ${sans})`);
await page.evaluate(id => { db.fens[0].murId = id; sauvegarderLocal(); dessinerPlanPieces(); }, memoire);

console.log('7. Le formulaire reflète le rattachement');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="fen"]');
await page.selectOption('#fen-target', 'a1');
await page.waitForTimeout(300);
await page.click('#list-fens .item-row:has-text("F1") [data-act="editerParoi"]');
await page.waitForTimeout(300);
check(String(await page.inputValue('#f-mur')) === String(murOuest.id), 'le mur déduit du plan est présélectionné dans le formulaire');
const optionsMur = await page.locator('#f-mur option').allInnerTexts();
check(optionsMur.filter(t => t.includes('📐')).length === 6, 'les murs situés sur un plan sont signalés dans la liste');
check((await page.locator('#vw-fen').innerText()).includes('Mur percé'), 'le champ mur est nommé « Mur percé »');
check((await page.locator('#vw-fen').innerText()).includes('Pièce (facultatif)'), 'la pièce est annoncée facultative');
const ordre = await page.evaluate(() => {
  const html = document.getElementById('vw-fen').innerHTML;
  return html.indexOf('f-mur') < html.indexOf('f-piece');
});
check(ordre, 'le mur est demandé avant la pièce');
check((await page.locator('#list-fens .item-row:has-text("F1")').innerText()).includes('🧱 Mur Ouest'), 'la liste rappelle le mur de la fenêtre');
await page.click('#ab-cancel');

console.log('8. Rattachement sur un plan décalqué');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="calque"]');
await page.selectOption('#cal-target', 'a1');
const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cal-vide button:has-text("Charger")')]);
await ch.setFiles(SP + '/plan-test.pdf');
await page.waitForFunction(() => cal.img !== null, null, { timeout: 20000 });
const murCal = await page.evaluate(() => {
  cal.echelle = 0.01;   // 1 pixel d'image = 1 cm
  const n = creerMursDepuisContour([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], '2.50', 'calque');
  const m = mursTraces('calque').find(x => x.ori === 'Sud');
  return { n, id: m && m.id, traces: mursTraces('calque').length };
});
check(murCal.n === 4 && murCal.traces === 4, 'quatre murs repérables sur le calque');
check(await page.evaluate(() => mursTraces('pieces').length) === 6, 'les murs du plan des pièces restent distincts');
await page.click('#cal-mode-gommettes');
await page.click('#cal-gommettes .gom-chip:has-text("F2")');
await page.locator('#calque-canvas').scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
const b = await page.locator('#calque-canvas').boundingBox();
const vue = await page.evaluate(() => ({ zoom: cal.zoom, ox: cal.ox, oy: cal.oy }));
// 3,95 m sur le plan, soit le long de la façade Sud tracée à 4 m (1 px = 1 cm)
await page.mouse.click(b.x + 300 * vue.zoom + vue.ox, b.y + 395 * vue.zoom + vue.oy);
await page.waitForTimeout(250);
check(String(await page.evaluate(() => db.fens[1].murId)) === String(murCal.id), 'gommette posée sur le calque rattachée à la façade Sud du calque');
check(await page.evaluate(() => !!db.fens[1].posCal), 'position retenue sur le calque');

console.log('9. Persistance et export');
await sauvegardeEcrite();
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
check(await page.evaluate(() => db.murs.filter(m => m.seg).length) === 10, 'les segments des murs survivent au rechargement');
check(String(await page.evaluate(() => db.fens[0].murId)) === String(murOuest.id), 'le rattachement de F1 est conservé');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Dossier de plans (PDF)')]);
check(dl.suggestedFilename().endsWith('.pdf'), 'export PDF des plans généré');

await brancherToasts();   // le rechargement de l'étape 9 a remis la page à neuf
console.log('10. Murs saisis à la main, sans géométrie mémorisée');
// Le cas d'un dossier existant : les murs viennent du formulaire Parois › Murs,
// ils n'ont pas de segment. Le contour des pièces doit suffire à les reconnaître.
await page.evaluate(async () => {
  db.appts.push({ id: 'a2', num: 'M02', type: 1, hsp: '2.50' });
  db.pieces.push({ id: 21, aid: 'a2', nivInt: 0, nom: 'Séjour', l: '6', larg: '4', rot: 0, x: 0, y: 0 });
  db.murs.push({ id: 201, aid: 'a2', nivInt: 0, ori: 'Nord', donne: 'Extérieur', mat: 'Briques creuses', l: '6', h: '2.5', iso: 'Non', doub: 'ABSENT' },
                { id: 202, aid: 'a2', nivInt: 0, ori: 'Ouest', donne: 'Extérieur', mat: 'Briques creuses', l: '4', h: '2.5', iso: 'Non', doub: 'ABSENT' });
  db.fens.push({ id: 31, aid: 'a2', nivInt: 0, nom: 'F9', ori: 'Nord', type: 'Fenêtres battantes', mat: 'Menuiserie PVC', vit: 'Double vitrage vertical', fer: 'Absence', l: '100', h: '120', nb: '1', motifs: '1', surf: '1.200' });
  sauvegarderLocal();
});
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="pieces"]');
await page.selectOption('#pie-target', 'a2');
await page.waitForTimeout(400);
check(await page.evaluate(() => mursTraces('pieces').length) === 0, 'aucun de ces murs ne porte de segment');
check(await page.evaluate(() => facadesDuPlan('pieces').filter(f => f.mur).length) === 2, 'les deux murs saisis sont rapprochés du contour');
await page.click('#plan-btn-gom');
check((await page.locator('#plan-gommettes').innerText()).includes('2 façades reconnues 📐'), 'la palette les annonce');
await amenerLePlan();
await page.click('#plan-gommettes .gom-chip:has-text("F9")');
c = await versEcranPlan({ x: 3, y: 0.15 });
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(300);
check(String(await page.evaluate(() => db.fens[3].murId)) === '201', 'F9 rattachée au mur Nord saisi à la main');
const dits = (await messages()).filter(m => m.includes('F9'));
check(dits.some(m => m.includes('sur le mur Nord')), `le message nomme le mur : « ${dits.join(' | ')} »`);

console.log('11. Façade sans mur correspondant');
await page.evaluate(() => { gomArmee = db.fens[3].id; delete db.fens[3].posPlan; db.fens[3].murId = ''; poserGommette('pieces', { x: 3, y: 3.9 }); });
await page.waitForTimeout(250);
check(await page.evaluate(() => db.fens[3].murId) === '', 'aucun mur Sud saisi : rien n’est inventé');
const manque = (await messages()).filter(m => m.includes('aucun mur'));
check(manque.some(m => m.includes('Sud')), `le message dit ce qui manque : « ${manque.join(' | ')} »`);

console.log('12. Repère 📐 dans la liste des murs');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="fen"]');
await page.selectOption('#fen-target', 'a2');
await page.waitForTimeout(300);
await page.click('#list-fens .item-row:has-text("F9") [data-act="editerParoi"]');
await page.waitForTimeout(300);
const opts2 = await page.locator('#f-mur option').allInnerTexts();
check(opts2.filter(t => t.includes('📐')).length === 2, 'les deux murs reconnus sur le plan sont signalés');
await page.click('#ab-cancel');

await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
