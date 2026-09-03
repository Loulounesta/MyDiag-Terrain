/* Nomenclature ADN, migration des anciens libellés, récapitulatif des fenêtres
   et centrage du dialogue.
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/adn-recap.mjs */
import { chromium } from 'playwright';
const erreurs = []; let ok = 0, ko = 0;
const check = (c, m) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
const U = process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html';

console.log('1. Nomenclature ADN');
await page.goto(U);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
const n = await page.evaluate(() => ({ murs: ADN.MURS.length, dm: ADN.DONNE_SUR_MURS.length, plf: ADN.PLAFONDS.length, dplf: ADN.DONNE_SUR_PLAFOND.length, pla: ADN.PLANCHERS.length, dpla: ADN.DONNE_SUR_PLANCHER.length, vent: ADN.VENTILATION.length, vit: ADN.FEN_VITRAGE.length, mat: ADN.FEN_MATIERE.length, fer: ADN.FEN_FERMETURE.length, typ: ADN.FEN_TYPE.length }));
check(n.murs === 23 && n.dm === 11, `murs ${n.murs} / donne-sur ${n.dm}`);
check(n.plf === 16 && n.dplf === 11 && n.pla === 13 && n.dpla === 11, `plafonds ${n.plf}/${n.dplf}, planchers ${n.pla}/${n.dpla}`);
check(n.vent === 25, `ventilation ${n.vent} valeurs ADN`);
check(n.vit === 11 && n.mat === 5 && n.fer === 7, `vitrage ${n.vit}, matière ${n.mat}, fermeture ${n.fer} (Absence incluse)`);
check(n.typ === 9, `types fenêtre ${n.typ} (7 ADN + Velux + Hublot)`);
await page.click('.nav-zone[data-zone="parois"]');
check((await page.locator('#m-mat option').count()) === 23, 'liste Matériau des murs peuplée');
check(await page.locator('#m-mat option', { hasText: 'Béton de mâchefer' }).count() === 1, 'valeur ADN « Béton de mâchefer » présente');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="copro"]');
await page.click('text=🌀 Ventilation collective');
check((await page.locator('#vmc-type option').count()) === 26, 'liste ventilation ADN dans le formulaire');
const emet = await page.evaluate(() => EMETTEUR_MAP['Bois']);
check(Array.isArray(emet) && emet.length === 5, 'émetteurs ADN disponibles pour le Bois');
const genBois = await page.evaluate(() => CHAUF_GEN_MAP['Bois'].length);
check(genBois === 10, `générateurs Bois : ${genBois} (auparavant aucun)`);

console.log('2. Migration des anciens libellés');
await page.evaluate(async () => {
  await localforage.setItem('mydiag_v9', { copro: { ref: 'M1', nom: 'Migration' }, docs: [], vmc: { type: 'VMC Auto-réglable', periode: '1982 – 2000' }, chaufCol: { energie: 'Gaz naturel', gen: 'Installation collective unique' }, ecsCol: { energie: 'Electrique', type: 'Chauffe-eau vertical' },
    appts: [{ id: 'a1', num: 'E01', type: 1, surf: '50' }],
    chaufs: [], ecss: [],
    murs: [{ id: 1, aid: 'a1', nivInt: 0, ori: 'Nord', mat: 'Pisé ou béton de terre stabilisée', donne: 'Extérieur', l: '5', h: '2.5' }],
    fens: [{ id: 2, aid: 'a1', nivInt: 0, nom: 'F1', ori: 'Sud', type: 'Fenêtres battantes', mat: 'Menuiserie métallique avec rupture de pont thermique', vit: 'Double vitrage vertical', fer: 'Fermeture sans ajours, volets roulants Alu', l: '120', h: '130', nb: '2', motifs: '1', surf: '1.560' }],
    modelesFens: [], portes: [], plfs: [{ id: 3, aid: 'a1', nivInt: 0, type: 'Entre solives bois', donne: 'Combles perdus', s: '40' }], plas: [] });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.waitForFunction(() => document.getElementById('sys-toast').innerText.includes('nomenclature ADN'), null, { timeout: 5000 }).then(() => check(true, 'migration signalée à l\'utilisateur')).catch(() => check(false, 'migration signalée à l\'utilisateur'));
const m = await page.evaluate(() => ({ mur: db.murs[0].mat, fenMat: db.fens[0].mat, fenFer: db.fens[0].fer, plf: db.plfs[0].type, vmc: db.vmc.type, gen: db.chaufCol.gen, ecs: db.ecsCol.type }));
check(m.mur === "Pisé ou béton de terre stabilisée (à partir d'argile crue)", 'mur migré vers le libellé ADN');
check(m.fenMat === 'Menuiserie métallique à rupture de pont thermique', 'menuiserie migrée (« à rupture »)');
check(m.fenFer === 'Fermeture sans ajours en position déployée, volets roulants Alu', 'fermeture migrée');
check(m.plf === 'Entre solives bois avec ou sans remplissage', 'plafond migré');
check(m.vmc === 'VMC simple flux autoréglable de 1982 à 2000', 'VMC migrée en combinant type et période');
check(m.gen === 'Installation collective unique multi bâtiment', 'générateur collectif migré');
check(m.ecs === 'Chauffe eau vertical', 'ECS migrée');

console.log('3. Valeur hors nomenclature conservée');
await page.evaluate(async () => { const d = await localforage.getItem('mydiag_v9'); d.murs[0].mat = 'Matériau maison inventé'; await localforage.setItem('mydiag_v9', d); });
await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
await page.click('.nav-zone[data-zone="parois"]');
await page.selectOption('#murs-target', await page.evaluate(() => db.appts[0].id));
await page.click('#list-murs [data-act="editerParoi"]');
check(await page.inputValue('#m-mat') === 'Matériau maison inventé', 'valeur inconnue conservée dans la liste');
check((await page.locator('#m-mat option[data-hors-nomenclature]').innerText()).includes('ancienne valeur'), 'valeur inconnue signalée');
await page.click('#ab-save');
check(await page.evaluate(() => db.murs[0].mat) === 'Matériau maison inventé', 'enregistrement sans écrasement silencieux');

console.log('4. Page récapitulatif des fenêtres');
await page.click('.nav-zone[data-zone="synthese"]');
check(await page.locator('#vw-recapfen').isVisible(), 'la zone Synthèse ouvre le récap');
check((await page.locator('#recap-resume').innerText()).includes('2 menuiserie(s)'), 'résumé : quantités cumulées');
check((await page.locator('#recap-resume').innerText()).includes('3.12 m²'), 'résumé : surface vitrée totale (1.560 × 2)');
check(await page.locator('.recap-ligne').count() === 1, 'une ligne de menuiserie');
check((await page.locator('.recap-groupe-hd').innerText()).includes('Lot E01'), 'regroupement par lot');
await page.click('[data-act="recapPlus"]');
check(await page.evaluate(() => db.fens[0].nb) === '3', 'bouton ➕ : quantité passée à 3');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => db.fens[0].nb) === '2', 'annulation de la quantité');
await page.click('[data-act="recapCloner"]');
check(await page.evaluate(() => db.fens.length) === 2, 'duplication dans le même lot');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => db.fens.length) === 1, 'annulation de la duplication');

console.log('5. Copie vers un autre lot');
await page.evaluate(() => { db.appts.push({ id: 'a2', num: 'E02', type: 2, surf: '60' }); renderRecapFens(); });
await page.click('[data-act="recapCopier"]');
await page.waitForSelector('#dlg[open]');
const opts = await page.locator('#dlg-choix option').count();
check(opts === 4, `cibles proposées : ${opts} (communs + E01 + E02 sur 2 niveaux)`);
await page.selectOption('#dlg-choix', 'a2|1');
await page.click('#dlg .dlg-ok');
const copie = await page.evaluate(() => { const f = db.fens[db.fens.length - 1]; return { aid: f.aid, niv: f.nivInt, type: f.type }; });
check(copie.aid === 'a2' && copie.niv === 1, 'copiée dans le lot E02, niveau haut');
check(await page.locator('.recap-groupe').count() === 2, 'deux groupes affichés');

console.log('6. Filtres et correction depuis le récap');
await page.selectOption('#recap-lot', 'a2');
check(await page.locator('.recap-ligne').count() === 1, 'filtre par lot');
await page.selectOption('#recap-ori', 'Nord');
check((await page.locator('.recap-vide').innerText()).includes('Aucune fenêtre ne correspond'), 'filtre orientation sans résultat');
await page.selectOption('#recap-ori', ''); await page.selectOption('#recap-lot', '');
await page.click('[data-act="recapEditer"] >> nth=0');
check(await page.locator('#vw-fen').isVisible(), 'le crayon bascule sur le formulaire Fenêtres');
check(await page.inputValue('#f-l') === '120', 'valeurs chargées dans le formulaire');
check((await page.locator('#ab-save').innerText()).includes('Modifier'), 'mode modification actif');
await page.fill('#f-l', '140'); await page.click('#ab-save');
await page.click('.nav-zone[data-zone="synthese"]');
check((await page.locator('.recap-ligne').first().innerText()).includes('140'), 'correction visible dans le récap');
await page.click('[data-act="recapSupp"] >> nth=0');
check(await page.evaluate(() => db.fens.length) === 1, 'suppression depuis le récap');
await page.click('#sys-toast .toast-btn');
check(await page.evaluate(() => db.fens.length) === 2, 'suppression annulable');

console.log('7. Dialogue centré');
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  await page.setViewportSize(vp);
  await page.evaluate(() => { Dialogue.confirmer({ titre: 'Test', message: 'Centrage' }); });
  await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(150);
  const r = await page.locator('#dlg').boundingBox();
  const dx = Math.abs(r.x + r.width / 2 - vp.width / 2), dy = Math.abs(r.y + r.height / 2 - vp.height / 2);
  check(dx < 2 && dy < 2, `centré en ${vp.width}×${vp.height} (écart ${dx.toFixed(0)}, ${dy.toFixed(0)} px)`);
  check(r.y > 20, `pas collé au bord haut (${r.y.toFixed(0)} px)`);
  await page.click('#dlg .dlg-cancel');
}
await page.setViewportSize({ width: 390, height: 844 });

await page.click('.nav-zone[data-zone="synthese"]');


console.log('8. Code ANALYSIMMO avec les libellés ADN');
const cas = [
  [{ nom: 'F1', type: 'Fenêtres battantes', ori: 'Sud', l: '120', h: '130', mat: 'Menuiserie métallique à rupture de pont thermique', vit: 'Double vitrage vertical', ep: '16', fer: 'Fermeture sans ajours en position déployée, volets roulants Alu' }, 'F1 FB Sud 120x130 Métal RPT DV 4/16/4 aVR Alu'],
  [{ nom: 'F2', type: 'Portes-fenêtres coulissantes', ori: 'Est', l: '200', h: '215', mat: 'Menuiserie Bois / Métal', vit: 'Triple vitrage horizontal', ep: '12', fer: 'Absence' }, 'F2 PFC Est 200x215 Bois/Métal TV 4/12/4/12/4 H sFerm'],
  [{ nom: 'F3', type: 'Fenêtres coulissantes', ori: 'Nord', l: '90', h: '90', mat: 'Menuiserie Bois', vit: 'Simple vitrage horizontal', fer: 'Persienne coulissante et volet battant PVC ou bois (épaisseur tablier ≤ 22mm)' }, 'F3 FC Nord 90x90 Bois SV H aPers.'],
  [{ nom: 'F4', type: 'Hublot', ori: 'Ouest', diam: '40', mat: 'Menuiserie PVC', vit: 'Polycarbonate', fer: 'Jalousie accordéon, fermeture à lames orientables y compris les vénitiens extérieurs tout métal, volets battants ou persiennes avec ajours fixes' }, 'F4 Hublot Ouest Ø40 PVC Poly. aJalousie'],
  [{ nom: 'F5', type: 'Fenêtres battantes', ori: 'Sud', l: '80', h: '100', mat: 'Menuiserie métallique sans rupture de pont thermique', vit: 'Double vitrage vertical', ep: '8', fer: 'Volet roulant PVC ou bois (épaisseur tablier > 12mm)' }, 'F5 FB Sud 80x100 Métal DV 4/8/4 aVR']
];
for (const [f, attendu] of cas) {
  const got = await page.evaluate(x => genererCodeFen(x), f);
  check(got === attendu, `code : ${got}`);
}

await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO`);
if (erreurs.length) { console.log('Erreurs :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
