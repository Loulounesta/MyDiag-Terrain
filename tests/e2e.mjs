/* Scénario de bout en bout MyDiag-DPE (Playwright + Chromium).
   Prérequis : npm i -D playwright && npx playwright install chromium
   Lancement : python3 -m http.server 8765  (à la racine du dépôt)
              node tests/e2e.mjs
   Le scénario couvre : navigation par zones et historique, sauvegarde différée, rendu par carte,
   barre d'action, croquis, édition/annulation, suppression avec annulation, store médias,
   backup/restauration, migration v8, dialogues natifs, exports. */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'mydiag-e2e-'));
const URL = process.env.MYDIAG_URL || 'http://127.0.0.1:8765/index.html';
const erreurs = [];
let ok = 0, ko = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ✓', msg); } else { ko++; console.log('  ✗', msg); } }

// PNG 1x1 rouge
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(SP + '/px.png', PNG);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));

console.log('1. Chargement et navigation');
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
check(await page.locator('.nav-zone.on').textContent() === '🏠Accueil', 'zone Accueil active');
check(await page.locator('#nav-vues').innerText() === '', 'pas de sous-barre sur Accueil');
await page.click('.nav-zone[data-zone="dossier"]');
check(await page.locator('#vw-copro').isVisible(), 'zone Dossier ouvre Copro');
check((await page.locator('.nav-vue').count()) === 2, 'sous-barre Copro/Lots');
check(await page.evaluate(() => location.hash) === '#copro', 'hash mis à jour');
check(await page.evaluate(() => getComputedStyle(document.querySelector('#copro-nom')).fontSize) === '16px', 'champs à 16px');

console.log('2. Saisie copro et sauvegarde différée');
await page.fill('#copro-ref', '2024-001');
await page.fill('#copro-nom', 'Les Lilas');
await page.fill('#copro-etages', '4');
await page.fill('#copro-batiments', '2');
const attente = await page.evaluate(() => document.getElementById('voyant-save').classList.contains('attente'));
check(attente, 'voyant en attente pendant la frappe');
await page.waitForTimeout(800);
const sauve = await page.evaluate(async () => (await localforage.getItem('mydiag_v9')).copro.nom);
check(sauve === 'Les Lilas', 'sauvegarde différée écrite en base');

console.log('3. Création de lot et rendu par carte');
await page.click('.nav-vue[data-vue="appts"]');
await page.click('text=+ Nouveau lot');
await page.selectOption('#apt-num', 'E01');
await page.selectOption('#apt-type', '2');
await page.selectOption('#apt-etage', 'R+3');
check(await page.inputValue('#apt-niveau') === 'Dernier étage', 'niveau ADN auto-déduit');
await page.fill('#apt-surf', '65');
await page.fill('#apt-hsp', '2.5');
await page.click('text=Créer le lot');
check((await page.locator('.appt-card').count()) === 1, 'carte de lot créée');
await page.click('[data-act="toggleAcc"][data-id^="acc-chauf-"]');
check(await page.locator('[id^="acc-chauf-"].coll-acc-body').evaluate(e => e.classList.contains('open')), 'accordéon chauffage ouvert');
const aptId = await page.locator('.appt-card').getAttribute('id').then(s => s.replace('appt-', ''));
await page.selectOption(`#ifc-energie-${aptId}`, 'Gaz naturel');
await page.selectOption(`#ifc-gen-${aptId}`, 'Chaudière condensation');
check(await page.locator('#sys-toast .toast-btn').isVisible(), 'proposition ECS liée non bloquante (toast)');
await page.click('#sys-toast .toast-btn');
check(await page.locator(`#ecs-list-${aptId} .item-row`).count() === 1, 'ECS liée créée');
await page.click(`[data-act="ajouterChauf"][data-id="${aptId}"]`);
check(await page.locator(`#chauf-list-${aptId} .item-row`).count() === 1, 'chauffage ajouté');
check(await page.locator(`#acc-chauf-${aptId}`).evaluate(e => e.classList.contains('open')), 'accordéon reste ouvert après re-rendu de la carte');
check((await page.locator('.appt-card').count()) === 1, 'une seule carte après re-rendu');

console.log('4. Saisie de murs, barre d\'action, croquis');
await page.click(`[data-act="goParoi"][data-id="${aptId}"][data-vue="murs"]`);
check(await page.locator('#vw-murs').isVisible(), 'vue Murs ouverte');
check(await page.locator('body').evaluate(b => b.classList.contains('has-ab')), 'barre d\'action affichée');
check((await page.locator('#ab-ctx').innerText()).includes('Lot E01'), 'contexte lot dans la barre');
check((await page.locator('#ab-ctx').innerText()).includes('Niveau bas'), 'niveau duplex dans la barre');
check(await page.inputValue('#m-h') === '2.5', 'HSP pré-remplie');
check(await page.locator('.niv-btn').count() === 2, 'sélecteur de niveau duplex');
await page.fill('#m-l', '5');
await page.press('#m-l', 'Enter');
check(await page.evaluate(() => document.activeElement.id) === 'm-h', 'Entrée passe de L à H');
await page.press('#m-h', 'Enter');
check(await page.locator('#list-murs .item-row').count() === 1, 'mur 1 enregistré via Entrée');
check(await page.inputValue('#m-l') === '', 'longueur vidée, HSP conservée : ' + await page.inputValue('#m-h'));
await page.selectOption('#m-ori', 'Est'); await page.fill('#m-l', '4'); await page.click('#ab-save');
await page.selectOption('#m-ori', 'Sud'); await page.fill('#m-l', '5'); await page.click('#ab-save');
await page.selectOption('#m-ori', 'Ouest'); await page.fill('#m-l', '4'); await page.click('#ab-save');
check(await page.locator('#list-murs .item-row').count() === 4, '4 murs enregistrés');
check(await page.locator('#croquis-container').isVisible(), 'croquis visible');
check((await page.locator('#croquis-msg').innerText()).includes('Périmètre fermé'), 'polygone fermé');
const dpr = await page.evaluate(() => { const c = document.getElementById('croquis-canvas'); return c.width / c.getBoundingClientRect().width; });
check(Math.abs(dpr - 2) < 0.05, 'canvas rendu au devicePixelRatio (2x)');
await page.click('[data-act="appliquerCroquis"]');
await page.waitForTimeout(300);
check((await page.locator('#sys-toast').innerText()).includes('plan affectés'), 'surface + plan appliqués');

console.log('5. Édition, annulation, suppression avec annulation');
await page.click('#list-murs [data-act="editerParoi"] >> nth=1');
check((await page.locator('#ab-save').innerText()) === 'Modifier ce mur', 'bouton en mode modification');
check(!(await page.locator('#ab-cancel').isHidden()), 'bouton Annuler visible');
check(await page.inputValue('#m-l') === '4', 'valeurs chargées dans le formulaire');
await page.fill('#m-l', '4.5'); await page.click('#ab-save');
check((await page.locator('#list-murs .item-row').nth(1).innerText()).includes('4.5'), 'modification enregistrée');
check(await page.locator('#ab-cancel').isHidden(), 'retour en mode création');
await page.click('#list-murs [data-act="editerParoi"] >> nth=0');
await page.click('#ab-cancel');
check((await page.locator('#ab-save').innerText()) === 'Enregistrer ce mur', 'annulation de l\'édition');
await page.click('#list-murs [data-act="suppElement"] >> nth=3');
check(await page.locator('#list-murs .item-row').count() === 3, 'mur supprimé immédiatement');
check((await page.locator('#sys-toast').innerText()).includes('Annuler'), 'toast avec Annuler');
await page.click('#sys-toast .toast-btn');
check(await page.locator('#list-murs .item-row').count() === 4, 'suppression annulée, mur restauré');

console.log('6. Historique navigateur');
await page.goBack();
await page.waitForTimeout(200);
check(await page.locator('#vw-appts').isVisible(), 'retour arrière = vue précédente (Lots)');
await page.goForward();
await page.waitForTimeout(200);
check(await page.locator('#vw-murs').isVisible(), 'avance = Murs');

console.log('7. Photo → store médias, object URL, persistance');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="copro"]');
await page.click('text=📂 Documents & Justificatifs');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Ajouter un document / Photo')]);
await chooser.setFiles(SP + '/px.png');
await page.waitForFunction(() => document.querySelectorAll('#list-docs img.thumb').length === 2);
const src = await page.locator('#list-docs img.thumb').first().getAttribute('src');
check(src.startsWith('blob:'), 'image affichée via URL d\'objet (pas de data: dans le DOM)');
await page.waitForTimeout(800);
const [baseDocs, nbMedias] = await page.evaluate(async () => { const d = await localforage.getItem('mydiag_v9'); const s = localforage.createInstance({ name: 'mydiag-medias', storeName: 'medias' }); return [d.docs[0].data, (await s.keys()).length]; });
check(baseDocs.startsWith('med_') && nbMedias === 2, 'base texte référence un id, médias dans le store séparé (' + nbMedias + ' médias : photo + plan)');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
check(await page.inputValue('#copro-nom') === 'Les Lilas', 'copro rechargée');
check(await page.locator('#list-docs img.thumb').count() === 2, 'documents (photo + plan) présents après rechargement');
await page.click('.nav-vue[data-vue="appts"]');
await page.click('.appt-header');
check(await page.locator('.plan-thumb-wrap img').count() === 1, 'plan du lot restauré');

console.log('8. Backup JSON avec médias ré-inlinés, puis restauration');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Backup JSON')]);
const backupPath = SP + '/backup.json'; await dl.saveAs(backupPath);
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
check(backup.docs[0].data.startsWith('data:image/png'), 'backup contient les photos inline (compatible v8)');
check(backup.appts[0].plans && backup.appts[0].plans['0'].startsWith('data:image/png'), 'backup contient le plan inline');
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restaurer un backup')]);
await chooser2.setFiles(backupPath);
await page.waitForSelector('#dlg[open]');
check((await page.locator('#dlg').innerText()).includes('Les Lilas'), 'dialogue natif de confirmation de restauration');
await Promise.all([page.waitForNavigation(), page.click('#dlg .dlg-ok')]);
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
check(await page.inputValue('#copro-nom') === 'Les Lilas', 'backup restauré');
const apresRestauration = await page.evaluate(async () => { const d = await localforage.getItem('mydiag_v9'); const s = localforage.createInstance({ name: 'mydiag-medias', storeName: 'medias' }); return [d.docs[0].data.startsWith('med_'), (await s.keys()).length]; });
check(apresRestauration[0] && apresRestauration[1] === 2, 'médias du backup externalisés dans le store');

console.log('9. Migration depuis l\'ancienne clé v8 (photos inline)');
await page.evaluate(async () => {
    await localforage.removeItem('mydiag_v9');
    await localforage.createInstance({ name: 'mydiag-medias', storeName: 'medias' }).clear();
    const b64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    await localforage.setItem('mydiag_v8_10', { copro: { ref: 'OLD', nom: 'Ancienne' }, docs: [{ id: 1, name: 'a.png', type: 'img', data: b64 }], vmc: {}, chaufCol: { photo: b64 }, ecsCol: {}, appts: [{ id: 'a1', num: 'E02', type: 1, plans: { 0: b64 } }], chaufs: [{ id: 'c1', aptId: 'a1', energie: 'Fioul', gen: 'Chaudière standard', photo: b64 }], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [] });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.nav-zone').length === 5);
const migr = await page.evaluate(async () => { const d = await localforage.getItem('mydiag_v9'); const old = await localforage.getItem('mydiag_v8_10'); const s = localforage.createInstance({ name: 'mydiag-medias', storeName: 'medias' }); return { nom: d.copro.nom, doc: d.docs[0].data, chauf: d.chaufs[0].photo, plan: d.appts[0].plans[0], col: d.chaufCol.photo, old, n: (await s.keys()).length }; });
check(migr.nom === 'Ancienne' && migr.old === null, 'ancienne base migrée et supprimée');
check([migr.doc, migr.chauf, migr.plan, migr.col].every(v => v.startsWith('med_')) && migr.n === 1, '4 champs inline identiques externalisés vers 1 seul média (déduplication)');
check(await page.locator('#img-chaufCol').evaluate(i => i.style.display === 'block' && i.src.startsWith('blob:')), 'photo chauffage collectif affichée');

console.log('10. Suppression de lot via dialogue natif');
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="appts"]');
await page.click('.appt-header');
await page.click('[data-act="suppAppt"]');
await page.waitForSelector('#dlg[open]');
await page.click('#dlg .dlg-cancel');
check(await page.locator('.appt-card').count() === 1, 'annulation dans le dialogue conserve le lot');
await page.click('[data-act="suppAppt"]');
await page.waitForSelector('#dlg[open]');
await page.click('#dlg .dlg-ok');
check(await page.locator('.appt-card').count() === 0, 'lot supprimé après confirmation');

console.log('11. Fenêtres, portes, totaux, schéma, bureau, calculatrice');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="fen"]');
await page.fill('#f-l', '120'); await page.fill('#f-h', '130'); await page.click('#ab-save');
check(await page.locator('#list-fens .item-row').count() === 1, 'fenêtre enregistrée');
check(await page.locator('.bibli-mod').count() === 1, 'modèle F1 en bibliothèque');
await page.click('.nav-vue[data-vue="portes"]'); await page.fill('#po-l', '0.9'); await page.fill('#po-h', '2.1'); await page.click('#ab-save');
check(await page.locator('#list-portes .item-row').count() === 1, 'porte enregistrée');
await page.click('.nav-vue[data-vue="plafonds"]'); await page.fill('#p-s', '40'); await page.click('#ab-save');
check(await page.locator('#list-plfs .item-row').count() === 1, 'plafond enregistré');
await page.click('.nav-zone[data-zone="synthese"]');
check(await page.locator('#vw-bim').isVisible(), 'schéma affiché');
await page.click('.nav-vue[data-vue="totaux"]');
await page.selectOption('#totaux-category', 'fens');
check((await page.locator('#totaux-table-container').innerText()).includes('1.56'), 'totaux fenêtres : 1.56 m²');
await page.click('#totaux-table-container th >> nth=0');
check((await page.locator('#totaux-table-container th').first().innerText()).includes('▲'), 'tri des totaux par délégation');
check(!(await page.locator('body').evaluate(b => b.classList.contains('has-ab'))), 'barre d\'action masquée hors parois');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="bureau"]');
await page.fill('#bur-l', '3'); await page.press('#bur-l', 'Enter'); await page.fill('#bur-h', '2.6'); await page.press('#bur-h', 'Enter');
check(await page.locator('#bur-list .item-row').count() === 1, 'mur bureau ajouté via Entrée');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="murs"]');
await page.click('text=🧮 Préparer les surfaces');
await page.fill('#calc-L', '10'); await page.fill('#calc-l', '8'); await page.fill('#calc-h', '1.2'); await page.fill('#calc-H', '3'); await page.fill('#calc-proj', '3');
check(await page.locator('#calc-res').isVisible(), 'calculatrice affiche les résultats');
check((await page.locator('#res-shab').innerText()) === '60.00 m²', 'surface habitable ≥1.80 m : 60.00 m²');

console.log('12. Export Excel (chargement à la demande de XLSX)');
check(await page.evaluate(() => typeof window.XLSX === 'undefined'), 'XLSX non chargé au démarrage');
await page.click('.nav-zone[data-zone="plus"]'); await page.click('.nav-vue[data-vue="export"]');
const [dlx] = await Promise.all([page.waitForEvent('download'), page.click('text=Export Excel')]);
check(dlx.suggestedFilename().endsWith('.xlsx'), 'fichier Excel généré : ' + dlx.suggestedFilename());
check(await page.evaluate(() => typeof window.XLSX !== 'undefined'), 'XLSX chargé à la demande');

console.log('13. Captures d\'écran');
await page.click('.nav-zone[data-zone="parois"]'); await page.click('.nav-vue[data-vue="murs"]');
await page.waitForTimeout(2800); await page.screenshot({ path: SP + '/capture-murs.png' });
await page.click('.nav-zone[data-zone="accueil"]');
await page.waitForTimeout(400); await page.screenshot({ path: SP + '/capture-accueil.png' });
await page.click('.nav-zone[data-zone="dossier"]'); await page.click('.nav-vue[data-vue="appts"]');
await page.waitForTimeout(400); await page.click('.appt-header').catch(() => {}); await page.waitForTimeout(300); await page.screenshot({ path: SP + '/capture-lots.png' });

await browser.close();
console.log(`\nRésultat : ${ok} OK, ${ko} KO — captures dans ${SP}`);
if (erreurs.length) { console.log('Erreurs console/page :'); erreurs.forEach(e => console.log('  -', e)); }
process.exit(ko || erreurs.length ? 1 : 0);
