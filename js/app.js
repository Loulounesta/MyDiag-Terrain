/* ==========================================================================
   MyDiag-DPE — application (v9.0)
   Un seul fichier, sans framework. Sections :
     0. Utilitaires (toast, dialogue, délégation d'événements)
     1. Couche plateforme (fichiers, appareil photo)
     2. Persistance (base + store médias, sauvegarde différée)
     3. Navigation (zones, sous-vues, historique)
     4. Référentiels ADN
     5. Copropriété et documents
     6. Appartements (rendu par carte)
     7. Parois (formulaires, barre d'action, listes, croquis)
     8. Mode bureau
     9. Synthèse (schéma bâtiment, totaux)
    10. Calculatrice géométrique
    11. Export / import / e-mails
    12. Démarrage
   ========================================================================== */
'use strict';

/* ==========================================================================
   0. UTILITAIRES
   ========================================================================== */
const $ = id => document.getElementById(id);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function horodatage() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function dataURLtoBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(parts[1] || ''); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

// --- Toast (non bloquant, avec action optionnelle : annulation, confirmation légère) ---
let toastTimer = null;
function toast(msg, opts = {}) {
    const el = $('sys-toast'); if (!el) return;
    clearTimeout(toastTimer);
    el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>`;
    if (opts.action) {
        const b = document.createElement('button');
        b.className = 'toast-btn'; b.type = 'button'; b.textContent = opts.action.label;
        b.onclick = () => { fermerToast(); opts.action.fn(); };
        el.appendChild(b);
    }
    el.classList.add('show');
    toastTimer = setTimeout(fermerToast, opts.duree || (opts.action ? 5000 : 2500));
}
function fermerToast() { const el = $('sys-toast'); if (el) el.classList.remove('show'); }
function toastAnnuler(msg, annuler) { toast(msg, { action: { label: 'Annuler', fn: annuler } }); }

// --- Dialogue natif <dialog> (remplace confirm/alert bloquants) ---
const Dialogue = {
    _supporte() { const d = $('dlg'); return !!(d && typeof d.showModal === 'function'); },
    _ouvrir(html) {
        return new Promise(resolve => {
            const dlg = $('dlg'); dlg.innerHTML = html;
            const onClose = () => { dlg.removeEventListener('close', onClose); resolve(false); };
            const fin = v => { dlg.removeEventListener('close', onClose); dlg.close(); resolve(v); };
            dlg.querySelectorAll('[data-val]').forEach(b => { b.onclick = () => fin(b.dataset.val === '1'); });
            dlg.showModal();
            // close() diffère son événement : on n'écoute qu'ensuite, sinon la fermeture
            // du dialogue précédent annulerait aussitôt celui-ci lors d'un enchaînement.
            setTimeout(() => { if (dlg.open) dlg.addEventListener('close', onClose); }, 0);
            const okBtn = dlg.querySelector('.dlg-ok'); if (okBtn) okBtn.focus();
        });
    },
    confirmer({ titre = 'Confirmation', message = '', ok = 'Confirmer', annuler = 'Annuler', danger = false } = {}) {
        if (!this._supporte()) return Promise.resolve(window.confirm((titre ? titre + '\n\n' : '') + message));
        return this._ouvrir(`
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div><div class="dlg-msg">${esc(message)}</div></div>
            <div class="dlg-actions"><button type="button" class="dlg-cancel" data-val="0">${esc(annuler)}</button><button type="button" class="dlg-ok ${danger ? 'danger' : ''}" data-val="1">${esc(ok)}</button></div>`);
    },
    // Sélection d'une valeur dans une liste ; retourne la valeur choisie ou null.
    choisir({ titre = 'Choisir', message = '', options = [], valeur = '', ok = 'Valider', annuler = 'Annuler' } = {}) {
        if (!this._supporte()) { const r = window.prompt((message ? message + '\n' : '') + options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')); const i = parseInt(r) - 1; return Promise.resolve(options[i] ? options[i].value : null); }
        const html = `
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div>${message ? `<div class="dlg-msg">${esc(message)}</div>` : ''}
                <select class="dlg-select" id="dlg-choix">${options.map(o => `<option value="${esc(o.value)}" ${o.value === valeur ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
            <div class="dlg-actions"><button type="button" class="dlg-cancel" data-val="0">${esc(annuler)}</button><button type="button" class="dlg-ok" data-val="1">${esc(ok)}</button></div>`;
        const sel = () => { const e = $('dlg-choix'); return e ? e.value : null; };
        let choix = valeur;
        const p = this._ouvrir(html);
        const dlg = $('dlg'); const e = $('dlg-choix'); if (e) { choix = e.value; e.onchange = () => { choix = e.value; }; }
        return p.then(v => v ? (sel() ?? choix) : null);
    },
    // Plusieurs champs en une boîte ; retourne un objet {id: valeur} ou null.
    formulaire({ titre = 'Saisie', message = '', champs = [], ok = 'Valider', annuler = 'Annuler' } = {}) {
        if (!this._supporte()) {
            const res = {};
            for (const c of champs) {
                const r = window.prompt(c.label, c.valeur || '');
                if (r === null) return Promise.resolve(null);
                res[c.id] = c.type === 'number' ? String(r).replace(',', '.') : r;
            }
            return Promise.resolve(res);
        }
        const html = `
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div>${message ? `<div class="dlg-msg">${esc(message)}</div>` : ''}
                ${champs.map(c => `<label class="dlg-label">${esc(c.label)}
                    <input class="dlg-select" id="dlg-c-${esc(c.id)}" type="${c.type === 'number' ? 'number' : 'text'}" ${c.type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(c.valeur || '')}" placeholder="${esc(c.placeholder || '')}" enterkeyhint="done"></label>`).join('')}
            </div>
            <div class="dlg-actions"><button type="button" class="dlg-cancel" data-val="0">${esc(annuler)}</button><button type="button" class="dlg-ok" data-val="1">${esc(ok)}</button></div>`;
        const p = this._ouvrir(html);
        const premier = $(`dlg-c-${champs[0] && champs[0].id}`);
        if (premier) {
            premier.focus();
            $('dlg').querySelectorAll('input').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const b = $('dlg').querySelector('.dlg-ok'); if (b) b.click(); } }; });
        }
        const lire = () => { const r = {}; champs.forEach(c => { const el = $(`dlg-c-${c.id}`); r[c.id] = el ? (c.type === 'number' ? String(el.value).replace(',', '.') : el.value) : ''; }); return r; };
        let valeurs = lire();
        $('dlg').querySelectorAll('input').forEach(i => { i.oninput = () => { valeurs = lire(); }; });
        return p.then(v => v ? valeurs : null);
    },
    // Saisie d'une valeur numérique ; retourne la valeur ou null.
    saisir({ titre = 'Saisie', message = '', valeur = '', unite = '', ok = 'Valider', annuler = 'Annuler' } = {}) {
        if (!this._supporte()) { const r = window.prompt(message || titre, valeur); return Promise.resolve(r === null ? null : r.replace(',', '.')); }
        const html = `
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div>${message ? `<div class="dlg-msg">${esc(message)}</div>` : ''}
                <input type="number" inputmode="decimal" step="any" id="dlg-saisie" class="dlg-select" value="${esc(valeur)}" placeholder="${esc(unite)}" enterkeyhint="done"></div>
            <div class="dlg-actions"><button type="button" class="dlg-cancel" data-val="0">${esc(annuler)}</button><button type="button" class="dlg-ok" data-val="1">${esc(ok)}</button></div>`;
        const p = this._ouvrir(html);
        const champ = $('dlg-saisie');
        if (champ) {
            champ.focus();
            champ.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const b = $('dlg').querySelector('.dlg-ok'); if (b) b.click(); } };
        }
        return p.then(v => { const val = champ ? champ.value : ''; return v && val ? String(val).replace(',', '.') : null; });
    },
    alerter(message, titre = 'Information') {
        if (!this._supporte()) { window.alert(message); return Promise.resolve(true); }
        return this._ouvrir(`
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div><div class="dlg-msg">${esc(message)}</div></div>
            <div class="dlg-actions"><button type="button" class="dlg-ok" data-val="1">OK</button></div>`);
    }
};

// --- Délégation d'événements pour le HTML généré dynamiquement ---
// Les éléments portent data-act="nom" (clic) ou data-chg="nom" (changement)
// et leurs paramètres en data-*. Aucun gestionnaire inline n'est ré-attaché à chaque rendu.
const Actions = {};
const Changements = {};
document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = Actions[el.dataset.act]; if (!fn) return;
    e.stopPropagation();
    fn(el.dataset, el, e);
});
document.addEventListener('change', e => {
    const el = e.target.closest('[data-chg]'); if (!el) return;
    const fn = Changements[el.dataset.chg]; if (fn) fn(el.dataset, el, e);
});
// Entrée dans un champ de dimension : passe au champ suivant (data-next) ou valide (data-submit).
document.addEventListener('input', e => { if (e.target && (e.target.id === 'pie-l' || e.target.id === 'pie-larg')) majApercuPiece(); if (e.target && e.target.id === 'pie-nom') renderChipsPieces(); });
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const el = e.target; if (!(el instanceof HTMLInputElement)) return;
    if (el.dataset.next) { e.preventDefault(); const n = $(el.dataset.next); if (n) n.focus(); }
    else if (el.dataset.submit) { e.preventDefault(); if (el.dataset.submit === 'bureau') sauverMurBureau(); else sauverParoi(el.dataset.submit); }
});

/* ==========================================================================
   1. COUCHE PLATEFORME — unique point de contact avec le système.
   Empaquetée en natif (Capacitor), ces trois fonctions sont les SEULES à remplacer.
   ========================================================================== */
const Plateforme = {
    estNatif() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); },
    async enregistrerFichier(blob, nomFichier) {
        try {
            if (this.estNatif() && window.CapacitorPlugins && window.CapacitorPlugins.enregistrer) return await window.CapacitorPlugins.enregistrer(blob, nomFichier);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = nomFichier;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            return true;
        } catch (err) { console.error('Enregistrement du fichier impossible :', err); toast('⚠️ Enregistrement impossible : ' + nomFichier); return false; }
    },
    async ouvrirFichier(blob, nomFichier) {
        try {
            if (this.estNatif() && window.CapacitorPlugins && window.CapacitorPlugins.ouvrir) return await window.CapacitorPlugins.ouvrir(blob, nomFichier);
            const url = URL.createObjectURL(blob); window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return true;
        } catch (err) { console.error('Ouverture du fichier impossible :', err); toast('⚠️ Ouverture impossible'); return false; }
    },
    demanderFichier(inputId) { const input = $(inputId); if (input) input.click(); }
};

/* ==========================================================================
   2. PERSISTANCE
   ========================================================================== */
const APP_VERSION = '9.8';
const CACHE_VERSION = 'mydiag-v9-8'; // doit rester égal à CACHE dans sw.js
const CLE_DB = 'mydiag_v9';
const CLE_DB_ANCIENNE = 'mydiag_v8_10';
const DELAI_SAUVEGARDE = 500;

let db = { copro: {}, docs: [], vmc: {}, chaufCol: {}, ecsCol: {}, appts: [], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [], pieces: [], calques: {} };
let tempPhotos = { chauf: {}, ecs: {} };
let expAppts = {};
const accOuverts = new Set();
let curAppt = null;   // 'copro' ou identifiant de lot
let curNivInt = 0;
let editParoiId = null;
let currentUploadTarget = null;
let totauxSortCol = null; let totauxSortAsc = true;
let lastCalc = {};
let vueActive = 'accueil';
let swReady = false;

function normaliserDb() {
    const defauts = { copro: {}, docs: [], vmc: {}, chaufCol: {}, ecsCol: {}, appts: [], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [], pieces: [], calques: {} };
    for (const k in defauts) if (db[k] == null) db[k] = defauts[k];
}

// --- Store médias : les photos et plans (base64) vivent dans un store séparé.
// La base texte reste minuscule, la sauvegarde instantanée ; les <img> reçoivent
// des URL d'objet plutôt que des data: URL de plusieurs Mo dans le DOM.
const Medias = {
    store: null, cache: new Map(), urls: new Map(),
    init() { this.store = localforage.createInstance({ name: 'mydiag-medias', storeName: 'medias' }); },
    async charger() { this.cache.clear(); try { await this.store.iterate((v, k) => { this.cache.set(k, v); }); } catch (e) { console.error('Store médias illisible', e); } },
    estId(v) { return typeof v === 'string' && v.startsWith('med_'); },
    estInline(v) { return typeof v === 'string' && v.startsWith('data:'); },
    async ajouter(dataURL) {
        const id = 'med_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        this.cache.set(id, dataURL);
        try { await this.store.setItem(id, dataURL); }
        catch (e) { console.error('Média non enregistré', e); toast('⚠️ Photo non enregistrée — stockage saturé ? Exportez un backup.'); }
        return id;
    },
    get(v) { if (!v) return ''; return this.estId(v) ? (this.cache.get(v) || '') : v; },
    src(v) {
        if (!v) return '';
        if (!this.estId(v)) return v;
        if (this.urls.has(v)) return this.urls.get(v);
        const d = this.cache.get(v); if (!d) return '';
        const u = URL.createObjectURL(dataURLtoBlob(d)); this.urls.set(v, u); return u;
    },
    taille(v) { const d = this.get(v); return d ? d.length * 0.75 : 0; },
    async supprimer(id) {
        this.cache.delete(id);
        const u = this.urls.get(id); if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
        try { await this.store.removeItem(id); } catch (e) { /* ignoré */ }
    },
    _champs(cb) {
        db.docs.forEach(d => cb(d, 'data'));
        cb(db.chaufCol, 'photo'); cb(db.ecsCol, 'photo');
        db.chaufs.forEach(c => cb(c, 'photo')); db.ecss.forEach(e => cb(e, 'photo'));
        db.appts.forEach(a => { if (a.plans) Object.keys(a.plans).forEach(n => cb(a.plans, n)); });
    },
    references() {
        const ids = new Set(); const add = v => { if (this.estId(v)) ids.add(v); };
        this._champs((o, k) => add(o[k]));
        Object.values(tempPhotos.chauf).forEach(add); Object.values(tempPhotos.ecs).forEach(add);
        return ids;
    },
    contientInline() { let r = false; this._champs((o, k) => { if (this.estInline(o[k])) r = true; }); return r; },
    // Déplace les data: URL inline (anciennes versions, backups) vers le store.
    async externaliser() {
        const taches = []; const dejaVus = new Map(); // même contenu (ex. plan présent en doc et sur le lot) => même média
        this._champs((o, k) => { if (this.estInline(o[k])) taches.push(async () => { const d = o[k]; if (!dejaVus.has(d)) dejaVus.set(d, await this.ajouter(d)); o[k] = dejaVus.get(d); }); });
        for (const t of taches) await t();
    },
    // Copie profonde de la base avec les médias ré-inlinés (format de backup compatible v8).
    inliner() {
        const copie = JSON.parse(JSON.stringify(db));
        const conv = (o, k) => { if (this.estId(o[k])) o[k] = this.get(o[k]) || ''; };
        copie.docs.forEach(d => conv(d, 'data')); conv(copie.chaufCol, 'photo'); conv(copie.ecsCol, 'photo');
        copie.chaufs.forEach(c => conv(c, 'photo')); copie.ecss.forEach(e => conv(e, 'photo'));
        copie.appts.forEach(a => { if (a.plans) Object.keys(a.plans).forEach(n => conv(a.plans, n)); });
        return copie;
    },
    // Supprime les médias que plus rien ne référence (ignore ceux créés il y a moins de 30 s).
    async nettoyer() {
        const refs = this.references(); const seuil = Date.now() - 30000;
        for (const id of [...this.cache.keys()]) {
            if (refs.has(id)) continue;
            const t = parseInt(id.split('_')[1], 36); if (!isNaN(t) && t > seuil) continue;
            await this.supprimer(id);
        }
    },
    async vider() { this.cache.clear(); this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls.clear(); try { await this.store.clear(); } catch (e) { /* ignoré */ } }
};

// --- Sauvegarde différée : une écriture au plus toutes les 500 ms, forcée quand
// on quitte un champ, change d'onglet ou masque l'application.
let saveTimer = null, saveEnCours = false, saveRedemandee = false, saveEnAttente = false;
function sauvegarderLocal() {
    saveEnAttente = true;
    const v = $('voyant-save'); if (v) v.classList.add('attente');
    clearTimeout(saveTimer); saveTimer = setTimeout(sauvegarderMaintenant, DELAI_SAUVEGARDE);
}
async function sauvegarderMaintenant() {
    clearTimeout(saveTimer); saveTimer = null;
    if (saveEnCours) { saveRedemandee = true; return; }
    saveEnCours = true; saveEnAttente = false;
    const v = $('voyant-save');
    try {
        await localforage.setItem(CLE_DB, db);
        if (v) { v.classList.remove('erreur', 'saved-blink'); if (!saveEnAttente) v.classList.remove('attente'); void v.offsetWidth; v.classList.add('saved-blink'); }
        Medias.nettoyer();
    } catch (err) {
        console.error('Sauvegarde locale impossible :', err);
        if (v) { v.classList.remove('attente', 'saved-blink'); v.classList.add('erreur'); }
        toast('⚠️ SAUVEGARDE IMPOSSIBLE — stockage saturé ? Exportez un backup JSON !', { duree: 5000 });
    } finally {
        saveEnCours = false;
        if (saveRedemandee) { saveRedemandee = false; sauvegarderMaintenant(); }
    }
}
function flushSauvegarde() { if (saveEnAttente || saveTimer) sauvegarderMaintenant(); }
async function sauvegarderManuelle() { await sauvegarderMaintenant(); toast('Sauvegardé ✓'); }
document.addEventListener('focusout', () => { if (saveEnAttente) sauvegarderMaintenant(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSauvegarde(); });
window.addEventListener('pagehide', flushSauvegarde);

/* ==========================================================================
   3. NAVIGATION — 5 zones, sous-vues segmentées, historique navigateur.
   ========================================================================== */
const ZONES = [
    { id: 'accueil', ico: '🏠', lbl: 'Accueil', vues: [{ id: 'accueil', lbl: 'Accueil' }] },
    { id: 'dossier', ico: '📁', lbl: 'Dossier', vues: [{ id: 'copro', lbl: '🏢 Copro' }, { id: 'appts', lbl: '🚪 Lots' }, { id: 'pieces', lbl: '📐 Pièces' }, { id: 'calque', lbl: '📄 Calque' }] },
    { id: 'parois', ico: '🧱', lbl: 'Parois', vues: [{ id: 'murs', lbl: '🧱 Murs' }, { id: 'fen', lbl: '🪟 Fenêtres' }, { id: 'portes', lbl: '🚪 Portes' }, { id: 'plafonds', lbl: '🔝 Plafonds' }, { id: 'planchers', lbl: '🔽 Planchers' }] },
    { id: 'synthese', ico: '📊', lbl: 'Synthèse', vues: [{ id: 'recapfen', lbl: '🪟 Récap fenêtres' }, { id: 'bim', lbl: '🏗️ Schéma' }, { id: 'totaux', lbl: '🧮 Totaux' }] },
    { id: 'plus', ico: '⋯', lbl: 'Plus', vues: [{ id: 'bureau', lbl: '🖥️ Mode Bureau' }, { id: 'export', lbl: '📤 Export' }, { id: 'aide', lbl: '❓ Aide' }] }
];
const ZONE_PAR_VUE = {}; ZONES.forEach(z => z.vues.forEach(v => { ZONE_PAR_VUE[v.id] = z.id; }));
const derniereVueZone = {};
const VUES_PAROIS = ['murs', 'fen', 'portes', 'plafonds', 'planchers', 'pieces'];

function construireNavigation() {
    $('nav-zones').innerHTML = ZONES.map(z => `<div class="nav-zone" data-zone="${z.id}" role="button"><span class="nz-ico">${z.ico}</span>${z.lbl}</div>`).join('');
    $('nav-zones').querySelectorAll('.nav-zone').forEach(el => { el.onclick = () => { const z = ZONES.find(x => x.id === el.dataset.zone); goTab(derniereVueZone[z.id] || z.vues[0].id); }; });
}
function majNavigation() {
    const zoneId = ZONE_PAR_VUE[vueActive];
    $('nav-zones').querySelectorAll('.nav-zone').forEach(el => el.classList.toggle('on', el.dataset.zone === zoneId));
    const zone = ZONES.find(z => z.id === zoneId);
    const nv = $('nav-vues');
    nv.innerHTML = zone.vues.length > 1 ? zone.vues.map(v => `<div class="nav-vue ${v.id === vueActive ? 'on' : ''}" data-vue="${v.id}" role="button">${v.lbl}</div>`).join('') : '';
    nv.querySelectorAll('.nav-vue').forEach(el => { el.onclick = () => goTab(el.dataset.vue); });
    const actif = nv.querySelector('.nav-vue.on');
    if (actif && actif.scrollIntoView) actif.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function goTab(tabId, opts = {}) {
    if (!ZONE_PAR_VUE[tabId]) tabId = 'accueil';
    flushSauvegarde();
    document.querySelectorAll('.vw').forEach(v => v.classList.remove('on'));
    $('vw-' + tabId).classList.add('on');
    vueActive = tabId; derniereVueZone[ZONE_PAR_VUE[tabId]] = tabId;
    majNavigation();
    if (opts.historique !== false && (!history.state || history.state.vue !== tabId)) history.pushState({ vue: tabId }, '', '#' + tabId);
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'auto' });

    if (tabId === 'accueil') updateDashboard();
    if (tabId === 'appts') renderApptsList();
    if (tabId === 'aide') majStatutHorsLigne();
    if (tabId === 'calque') ouvrirCalque();
    if (tabId === 'recapfen') renderRecapFens();
    if (tabId === 'bim') renderBIM();
    if (tabId === 'totaux') renderTotauxTable();
    if (tabId === 'bureau') { renderBureauTarget(); renderBureauList(); }
    if (VUES_PAROIS.includes(tabId)) {
        resetEditParoi(); verifierAptActif(tabId); renderElementsList(tabId);
        if (tabId === 'murs') { drawCroquis(); majResumeIso(); }
        if (tabId === 'fen') { peuplerMursDispo('f-mur', ''); peuplerPiecesDispo('f-piece', ''); }
        if (tabId === 'portes') { peuplerMursDispo('po-mur', ''); peuplerPiecesDispo('po-piece', ''); }
        if (tabId === 'pieces') { renderChipsPieces(); majApercuPiece(); assemblerPieces(false); if (modePlan === 'gommettes') renderPaletteGommettes('pieces'); dessinerPlanPieces(); }
    }
    majBarreAction();
}
window.addEventListener('popstate', e => { goTab((e.state && e.state.vue) || location.hash.replace('#', '') || 'accueil', { historique: false }); });

function toggleAcc(id, el) {
    const body = $(id); if (!body) return;
    const ouvert = body.classList.toggle('open');
    if (ouvert) accOuverts.add(id); else accOuverts.delete(id);
    const hd = el || body.previousElementSibling; if (hd) hd.classList.toggle('open', ouvert);
}
function ouvrirAcc(id) { const body = $(id); if (!body) return; body.classList.add('open'); accOuverts.add(id); const hd = body.previousElementSibling; if (hd) hd.classList.add('open'); }
function scrollVers(id) { const el = $(id); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

/* ==========================================================================
   4. RÉFÉRENTIELS ADN
   ========================================================================== */
const ADN = {
    // Listes officielles ADN (fichier ADN_Nomenclature_PARFAITE1.xlsx).
    // Les 7 premiers types sont ceux de l'ADN ; les 2 derniers sont propres au relevé
    // terrain (le hublot bascule le formulaire en saisie de diamètre).
    FEN_TYPE: ['Fenêtres battantes', 'Fenêtres coulissantes', 'Portes-fenêtres coulissantes', 'Portes-fenêtres battantes sans soubassement', 'Portes-fenêtres battantes avec soubassement', 'Fenêtres sans ouverture possible', 'Portes-fenêtres sans ouverture possible', 'Fenêtre de toit (Velux)', 'Hublot'],
    FEN_VITRAGE: ['Simple vitrage vertical', 'Simple vitrage horizontal', 'Double vitrage vertical', 'Double vitrage horizontal', 'Survitrage vertical', 'Survitrage horizontal', 'Triple vitrage vertical', 'Triple vitrage horizontal', 'Brique de verre pleine', 'Brique de verre creuse', 'Polycarbonate'],
    FEN_MATIERE: ['Menuiserie métallique à rupture de pont thermique', 'Menuiserie métallique sans rupture de pont thermique', 'Menuiserie PVC', 'Menuiserie Bois', 'Menuiserie Bois / Métal'],
    FEN_FERMETURE: ['Absence', 'Jalousie accordéon, fermeture à lames orientables y compris les vénitiens extérieurs tout métal, volets battants ou persiennes avec ajours fixes', 'Fermeture sans ajours en position déployée, volets roulants Alu', 'Volet roulant PVC ou bois (épaisseur tablier ≤ 12mm)', 'Persienne coulissante et volet battant PVC ou bois (épaisseur tablier ≤ 22mm)', 'Persienne coulissante et volet battant PVC ou bois (épaisseur tablier ≥ 22mm)', 'Volet roulant PVC ou bois (épaisseur tablier > 12mm)'],
    MURS: ['Pierre de taille moellons constitués d\'un seul matériau / inconnu', 'Pierre de taille moellons avec remplissage tout venant', 'Pisé ou béton de terre stabilisée (à partir d\'argile crue)', 'Pans de bois sans remplissage tout venant', 'Pans de bois avec remplissage tout venant', 'Rondins bois', 'Briques pleines simples', 'Briques pleines doubles avec lame d\'air', 'Briques creuses', 'Blocs de béton pleins', 'Blocs de béton creux', 'Béton banché', 'Béton de mâchefer', 'Brique terre cuite alvéolaire', 'Béton cellulaire construit avant 2013', 'Béton cellulaire construit à partir de 2013', 'Sandwich béton / isolant / béton (sans isolation rapportée)', 'Ossature bois sans remplissage', 'Cloison de plâtre', 'Autre matériau traditionnel ancien', 'Autre matériau innovant récent', 'Autre matériau non répertorié', 'Inconnu'],
    DONNE_SUR_MURS: ['Extérieur', 'Local non chauffé (autre que véranda)', 'Local non chauffé et non accessible', 'Circulations communes', 'Local chauffé', 'Bâtiment ou espace autre qu\'habitation', 'Comble', 'Terre (paroi enterrée)', 'Véranda non chauffée, loggia fermée', 'Local tertiaire à l\'intérieur de l\'immeuble', 'Sous-sol non chauffé'],
    PLAFONDS: ['Inconnu', 'Inconnu avec ou sans remplissage', 'Bois sous solives bois', 'Bois sur solives bois', 'Bardeaux et remplissage', 'Entre solives bois avec ou sans remplissage', 'Bois sur solives métallique', 'Bois sous solives métallique', 'Entre solives métallique avec ou sans remplissage', 'Entrevous, terre-cuite, poutrelles béton', 'Dalle béton', 'Combles aménagés sous rampants', 'Toit de chaume', 'Plaques de plâtre', 'Autre type de plafond non répertorié', 'Toiture en bac acier'],
    DONNE_SUR_PLAFOND: ['Terrasse', 'Combles aménagés', 'Combles perdus', 'Local chauffé', 'Local non chauffé', 'Local non chauffé et non accessible', 'Circulations communes', 'Extérieur', 'Bâtiment autre qu\'habitation', 'Véranda non chauffée, loggia fermée', 'Local tertiaire à l\'intérieur de l\'immeuble'],
    PLANCHERS: ['Inconnu', 'Inconnu avec ou sans remplissage', 'Entre solives bois avec ou sans remplissage', 'Bardeaux et remplissage', 'Bois sur solives bois', 'Entre solives métallique avec ou sans remplissage', 'Bois sur solives métalliques', 'Voutains sur solives métallique', 'Entrevous, terre-cuite, poutrelles béton', 'Dalle béton', 'Voutains en brique ou moellons', 'Entrevous isolants', 'Autre type de plancher non répertorié'],
    DONNE_SUR_PLANCHER: ['Terre-plein', 'Vide sanitaire', 'Local non chauffé', 'Local non chauffé et non accessible', 'Bâtiment autre que d\'habitation', 'Local chauffé', 'Extérieur', 'Circulations communes', 'Terre (paroi enterrée)', 'Sous-sol non chauffé', 'Local tertiaire à l\'intérieur de l\'immeuble'],
    VENTILATION: ['VMC simple flux', 'VMC SF Hygro A < 2001', 'VMC SF Hygro A de 2001 à 2012', 'VMC SF Hygro A après 2012', 'VMC SF Hygro B < 2001', 'VMC SF Hygro B de 2001 à 2012', 'VMC SF Hygro B après 2012', 'VMC simple flux autoréglable < 1982', 'VMC simple flux autoréglable de 1982 à 2000', 'VMC simple flux autoréglable de 2001 à 2012', 'VMC simple flux autoréglable après 2012', 'VMC SF Gaz < 2001', 'VMC SF Gaz de 2001 à 2012', 'VMC SF Gaz après 2012', 'VMC double flux avec échangeur < 2012', 'VMC double flux avec échangeur après 2012', 'VMC double flux sans échangeur < 2012', 'VMC double flux sans échangeur après 2012', 'Ventilation hybride < 2001', 'Ventilation hybride de 2001 à 2012', 'Ventilation hybride après 2012', 'Ventilation naturelle par conduit', 'Ventilation naturelle par conduit avec entrées d\'air hygro', 'Ventilation par entrées d\'air hautes et basses', 'Ventilation par ouverture de fenêtres'],
    ECS_ELECTRIQUE: ['Chauffe eau thermodynamique à accumulation', 'Chauffe eau horizontal', 'Chauffe eau vertical', 'Pompe à chaleur Air/Eau', 'Pompe à chaleur Eau/Eau', 'Pompe à chaleur Eau glycolée/Eau', 'Pompe à chaleur Géothermie', 'Pompe à chaleur Air/Air', 'Chaudière électrique', 'Installation collective unique multi bâtiment']};

const CHAUF_GEN_MAP = {
    'Electrique': ['Pompe à chaleur Air/Eau', 'Pompe à chaleur Eau/Eau', 'Pompe à chaleur Eau glycolée/Eau', 'Pompe à chaleur Géothermie', 'Pompe à chaleur Air/Air', 'Convecteur électrique NFC', 'Convecteur électrique NF**', 'Convecteur électrique NF***', 'Panneau rayonnant électrique NFC', 'Panneau rayonnant électrique NF**', 'Panneau rayonnant électrique NF***', 'Radiateur électrique NFC', 'Radiateur électrique NF**', 'Radiateur électrique NF***', 'Autres émetteurs à effet joule', 'Plancher rayonnant électrique', 'Plafond rayonnant électrique', 'Radiateur électrique à accumulation', 'Chaudière électrique', 'Convecteur bi-jonction', 'Installation collective unique multi bâtiment'],
    'Gaz naturel': ['Radiateur gaz à ventouse', 'Radiateur gaz sur conduits de fumée', 'Générateur d\'air chaud', 'Chaudière basse température', 'Chaudière standard', 'Chaudière classique', 'Chaudière condensation', 'Chaudière PAC hybride', 'Installation collective unique multi bâtiment'],
    'GPL': ['Poêle GPL', 'Générateur d\'air chaud', 'Chaudière basse température', 'Chaudière standard', 'Chaudière classique', 'Chaudière condensation', 'Chaudière PAC hybride', 'Installation collective unique multi bâtiment', 'Radiateur gaz à ventouse', 'Radiateur gaz sur conduits de fumée'],
    'Fioul': ['Poêle fioul', 'Générateur d\'air chaud', 'Chaudière basse température', 'Chaudière standard', 'Chaudière classique', 'Chaudière condensation', 'Chaudière PAC hybride', 'Installation collective unique multi bâtiment'],
    'Bois': ['Cuisinière', 'Poêle à granulés', 'Chaudière bois', 'Chaudière à granulés', 'Poêle à bois bouilleur', 'Installation collective unique multi bâtiment', 'Foyer fermé', 'Poêle bûche', 'Insert', 'Poêle à bois bouilleur granulés'],
    'Charbon': ['Chaudière atmosphérique charbon', 'Cuisinière', 'Foyer fermé', 'Poêle', 'Insert', 'Installation collective unique multi bâtiment'],
    'Réseau de chaleur': ['Réseau de chaleur']
};
const EMETTEURS_ADN = ['Radiateur', 'Plancher chauffant', 'Plafond chauffant', 'Air soufflé', 'Autres équipements'];const EMETTEUR_MAP = new Proxy({}, { get: (_, k) => (typeof k === 'string' && CHAUF_GEN_MAP[k]) ? EMETTEURS_ADN : undefined });

// L'ADN ne publie la liste détaillée que pour l'ECS électrique ; les autres
// énergies conservent les générateurs usuels, alignés sur les libellés ADN.
const ECS_GEN_MAP = {
    'Electrique': ADN.ECS_ELECTRIQUE,
    'Gaz naturel': ['Chauffe-eau gaz instantané', 'Accumulateur gaz', 'Chaudière basse température', 'Chaudière standard', 'Chaudière condensation', 'Production par la chaudière', 'Installation collective unique multi bâtiment'],
    'GPL': ['Chauffe-eau gaz instantané', 'Accumulateur gaz', 'Production par la chaudière', 'Installation collective unique multi bâtiment'],
    'Fioul': ['Production par la chaudière', 'Installation collective unique multi bâtiment'],
    'Bois': ['Production par la chaudière', 'Installation collective unique multi bâtiment'],
    'Charbon': ['Production par la chaudière', 'Installation collective unique multi bâtiment'],
    'Réseau de chaleur': ['Installation collective unique multi bâtiment']
};

// Anciens libellés (avant reprise de la nomenclature ADN) vers les libellés officiels.
// Appliquée une fois au chargement ; toute valeur absente de cette table est conservée
// telle quelle et reste sélectionnable (voir setSelect).
const MIGRATIONS_ADN = {
    // Murs
    'Pisé ou béton de terre stabilisée': 'Pisé ou béton de terre stabilisée (à partir d\'argile crue)',
    'Pans de bois sans remplissage': 'Pans de bois sans remplissage tout venant',
    // Menuiseries
    'Menuiserie métallique avec rupture de pont thermique': 'Menuiserie métallique à rupture de pont thermique',
    'Menuiserie bois': 'Menuiserie Bois',
    'Menuiserie bois/métal': 'Menuiserie Bois / Métal',
    // Fermetures
    'Jalousie accordéon': 'Jalousie accordéon, fermeture à lames orientables y compris les vénitiens extérieurs tout métal, volets battants ou persiennes avec ajours fixes',
    'Fermeture sans ajours, volets roulants Alu': 'Fermeture sans ajours en position déployée, volets roulants Alu',
    'Persienne coulissante': 'Persienne coulissante et volet battant PVC ou bois (épaisseur tablier ≤ 22mm)',
    // Plafonds et planchers
    'Entre solives bois': 'Entre solives bois avec ou sans remplissage',
    'Entre solives métallique': 'Entre solives métallique avec ou sans remplissage',
    'Voutains en brique': 'Voutains en brique ou moellons',
    // Générateurs
    'Installation collective unique': 'Installation collective unique multi bâtiment',
    'Panneau rayonnant électrique': 'Panneau rayonnant électrique NFC',
    'Radiateur électrique': 'Radiateur électrique NFC',
    'Chaudière atmosphérique charbon': 'Chaudière atmosphérique charbon',
    // ECS
    'Chauffe eau thermodynamique': 'Chauffe eau thermodynamique à accumulation',
    'Chauffe-eau horizontal': 'Chauffe eau horizontal',
    'Chauffe-eau vertical': 'Chauffe eau vertical',
    // Ventilation (seuls les cas sans ambiguïté ; les autres restent à re-sélectionner)
    'Ventilation naturelle': 'Ventilation naturelle par conduit'
};
const VMC_AUTO_PAR_PERIODE = {
    'Avant 1982': 'VMC simple flux autoréglable < 1982',
    '1982 – 2000': 'VMC simple flux autoréglable de 1982 à 2000',
    '2001 – 2012': 'VMC simple flux autoréglable de 2001 à 2012',
    'Après 2012': 'VMC simple flux autoréglable après 2012'
};

// Reprend les libellés stockés dans le dossier. Retourne le nombre de valeurs converties.
function migrerVersADN() {
    let n = 0;
    const conv = (o, k) => { const v = o && o[k]; if (v && MIGRATIONS_ADN[v] && MIGRATIONS_ADN[v] !== v) { o[k] = MIGRATIONS_ADN[v]; n++; } };
    db.murs.forEach(m => { conv(m, 'mat'); conv(m, 'donne'); });
    db.fens.forEach(f => { conv(f, 'mat'); conv(f, 'vit'); conv(f, 'fer'); conv(f, 'type'); });
    db.modelesFens.forEach(f => { conv(f, 'mat'); conv(f, 'vit'); conv(f, 'fer'); conv(f, 'type'); });
    db.portes.forEach(p => conv(p, 'donne'));
    db.plfs.forEach(p => { conv(p, 'type'); conv(p, 'donne'); });
    db.plas.forEach(p => { conv(p, 'type'); conv(p, 'donne'); });
    db.chaufs.forEach(c => { conv(c, 'gen'); conv(c, 'emetteur'); });
    db.ecss.forEach(e => conv(e, 'type'));
    conv(db.chaufCol, 'gen'); conv(db.chaufCol, 'emetteur'); conv(db.ecsCol, 'type');
    // La VMC autoréglable ne devient précise qu'en combinant l'ancien type et l'ancienne période.
    if (db.vmc.type === 'VMC Auto-réglable' && VMC_AUTO_PAR_PERIODE[db.vmc.periode]) { db.vmc.type = VMC_AUTO_PAR_PERIODE[db.vmc.periode]; n++; }
    else conv(db.vmc, 'type');
    return n;
}

const ENERGIES_IND = ["Electrique", "Gaz naturel", "GPL", "Fioul", "Bois", "Charbon"];

// Affecte une valeur à une liste déroulante sans jamais la perdre : si la valeur
// enregistrée ne figure plus dans la nomenclature, elle est ajoutée en tête et signalée.
function setSelect(id, val) {
    const el = $(id); if (!el) return;
    if (val && el.tagName === 'SELECT' && ![...el.options].some(o => o.value === val)) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = val + ' (ancienne valeur)'; opt.dataset.horsNomenclature = '1';
        el.insertBefore(opt, el.firstChild);
    }
    el.value = val ?? '';
}

function peuplerSelects() {
    const fill = (id, arr) => { const el = $(id); if (el) el.innerHTML = arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); };
    fill('m-mat', ADN.MURS); fill('m-donne', ADN.DONNE_SUR_MURS); fill('f-type', ADN.FEN_TYPE); fill('f-mat', ADN.FEN_MATIERE); fill('f-vit', ADN.FEN_VITRAGE); fill('f-fer', ADN.FEN_FERMETURE);
    fill('p-type', ADN.PLAFONDS); fill('p-donne', ADN.DONNE_SUR_PLAFOND); fill('s-type', ADN.PLANCHERS); fill('s-donne', ADN.DONNE_SUR_PLANCHER); fill('bur-mat', ADN.MURS); fill('bur-donne', ADN.DONNE_SUR_MURS);
    const vmc = $('vmc-type'); if (vmc) vmc.innerHTML = '<option value="">—</option>' + ADN.VENTILATION.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function updateChaufGen(eId, gId, emId) {
    const en = $(eId).value; const g = $(gId); const em = $(emId);
    g.innerHTML = '<option value="">—</option>' + ((en && CHAUF_GEN_MAP[en]) || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if (em) em.innerHTML = '<option value="">—</option>' + ((en && EMETTEUR_MAP[en]) || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
}
function updateEcsGen(eId, tId) {
    const en = $(eId).value; const t = $(tId);
    t.innerHTML = '<option value="">—</option>' + ((en && ECS_GEN_MAP[en]) || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
}
function checkChaudiereECS(prefix, aptId = null) {
    const genId = prefix === 'col' ? 'col-chauf-gen' : `ifc-gen-${aptId}`; const eId = prefix === 'col' ? 'col-chauf-energie' : `ifc-energie-${aptId}`;
    const ecsEId = prefix === 'col' ? 'col-ecs-energie' : `ife-energie-${aptId}`; const ecsTId = prefix === 'col' ? 'col-ecs-type' : `ife-type-${aptId}`;
    const gen = $(genId).value;
    if (!gen.includes('Chaudière')) return;
    toast('Chaudière détectée : créer l’ECS liée ?', { action: { label: 'Créer', fn: () => {
        if (prefix === 'col') {
            $(ecsEId).value = $(eId).value; updateEcsGen(ecsEId, ecsTId);
            $(ecsTId).value = 'Production par la chaudière'; ouvrirAcc('ecs-acc'); saveCoproData();
        } else {
            db.ecss.push({ id: String(Date.now() + 1), aptId, type: 'Production par la chaudière', energie: $(eId).value, annee: '', vol: '' });
            sauvegarderLocal(); majListeEcs(aptId); updateApptBadges(aptId); toast('ECS liée générée ✓');
        }
    } }, duree: 6000 });
}

/* ==========================================================================
   5. COPROPRIÉTÉ, TABLEAU DE BORD, DOCUMENTS, PHOTOS
   ========================================================================== */
function updateHomeNextStep() {
    const txt = $('home-next-text'); const sub = $('home-next-sub'); const btn = $('home-next-btn'); if (!txt || !sub) return;
    let cible = 'copro', lbl = 'Commencer la saisie ➡️';
    if (!db.copro.ref) { txt.innerText = 'Renseigner la copropriété'; sub.innerText = "Saisissez l'adresse et les infos générales du bâtiment."; }
    else if (db.appts.length === 0) { txt.innerText = 'Créer vos lots / appartements'; sub.innerText = 'Ajoutez au moins un échantillon pour commencer la visite.'; cible = 'appts'; lbl = 'Créer un lot ➡️'; }
    else if (db.murs.length === 0) { txt.innerText = 'Saisir les parois'; sub.innerText = 'Commencez par les murs pour construire la base thermique.'; cible = 'murs'; lbl = 'Saisir les murs ➡️'; }
    else { txt.innerText = 'Finaliser le dossier'; sub.innerText = 'Ajoutez les menuiseries, systèmes et exportez vers ADN.'; cible = 'export'; lbl = 'Aller à l’export ➡️'; }
    if (btn) { btn.textContent = lbl; btn.onclick = () => goTab(cible); }
}
function updateDashboard() {
    $('acc-copro-name').textContent = db.copro.nom || 'Aucune copropriété saisie';
    const addrEl = $('acc-copro-addr');
    const fullAddr = [db.copro.adresse, db.copro.cp, db.copro.ville].filter(Boolean).join(', ');
    if (fullAddr) { addrEl.style.display = 'inline-flex'; addrEl.querySelector('span').textContent = fullAddr; addrEl.href = 'https://maps.google.com/?q=' + encodeURIComponent(fullAddr); }
    else addrEl.style.display = 'none';
    $('tdb-appts').textContent = db.appts.length;
    $('tdb-surf').textContent = db.appts.reduce((acc, val) => acc + (parseFloat(val.surf) || 0), 0).toFixed(1);
    $('tdb-murs').textContent = db.murs.length + db.fens.length + db.portes.length + db.plfs.length + db.plas.length;
    $('tdb-sys').textContent = db.chaufs.length + db.ecss.length;
    updateHomeNextStep();
}
const CHAMPS_COPRO = ['ref', 'nom', 'adresse', 'cp', 'ville', 'annee', 'batiments', 'etages', 'surfcommuns'];
function saveCoproData() {
    CHAMPS_COPRO.forEach(k => { db.copro[k] = $('copro-' + k).value; });
    db.vmc.type = $('vmc-type').value; db.vmc.periode = $('vmc-periode').value;
    db.chaufCol.energie = $('col-chauf-energie').value; db.chaufCol.gen = $('col-chauf-gen').value; db.chaufCol.emetteur = $('col-chauf-emetteur').value;
    db.chaufCol.annee = $('col-chauf-annee').value; db.chaufCol.puissance = $('col-chauf-puissance').value;
    db.ecsCol.energie = $('col-ecs-energie').value; db.ecsCol.type = $('col-ecs-type').value; db.ecsCol.annee = $('col-ecs-annee').value; db.ecsCol.vol = $('col-ecs-vol').value;
    updateDashboard(); sauvegarderLocal();
}
function chargerFormulaireCopro() {
    CHAMPS_COPRO.forEach(k => { if (db.copro[k]) $('copro-' + k).value = db.copro[k]; });
    if (db.vmc.type) setSelect('vmc-type', db.vmc.type);
    if (db.vmc.periode) setSelect('vmc-periode', db.vmc.periode);
    if (db.chaufCol.energie) { setSelect('col-chauf-energie', db.chaufCol.energie); updateChaufGen('col-chauf-energie', 'col-chauf-gen', 'col-chauf-emetteur'); setSelect('col-chauf-gen', db.chaufCol.gen || ''); setSelect('col-chauf-emetteur', db.chaufCol.emetteur || ''); }
    $('col-chauf-annee').value = db.chaufCol.annee || ''; $('col-chauf-puissance').value = db.chaufCol.puissance || '';
    if (db.ecsCol.energie) { setSelect('col-ecs-energie', db.ecsCol.energie); updateEcsGen('col-ecs-energie', 'col-ecs-type'); setSelect('col-ecs-type', db.ecsCol.type || ''); }
    $('col-ecs-annee').value = db.ecsCol.annee || ''; $('col-ecs-vol').value = db.ecsCol.vol || '';
}
async function resetProjet() {
    if (await Dialogue.confirmer({ titre: 'Sauvegarde de sécurité', message: 'Voulez-vous télécharger un backup JSON avant d’effacer le projet ?', ok: 'Télécharger', annuler: 'Ignorer' })) await exportData();
    if (await Dialogue.confirmer({ titre: '⚠️ Tout effacer ?', message: 'Cette action va effacer TOUTES les données de l’application sur cet appareil.\n\nÊtes-vous absolument sûr ?', ok: 'Tout supprimer', danger: true })) {
        clearTimeout(saveTimer); saveTimer = null; saveEnAttente = false;
        await Medias.vider(); await localforage.clear(); location.reload();
    }
}

// --- Upload photos / documents ---
function triggerUpload(type, id = null) { currentUploadTarget = { type, id }; Plateforme.demanderFichier('global-uploader'); }
function brancherUploader() {
    $('global-uploader').onchange = function (e) {
        const file = e.target.files[0]; if (!file) return;
        const MAX_PDF_SIZE = 15 * 1024 * 1024; const reader = new FileReader();
        if (file.type === 'application/pdf') {
            if (file.size > MAX_PDF_SIZE) { toast('PDF trop volumineux — maximum 15 Mo'); e.target.value = ''; return; }
            reader.onload = ev => saveFileToTarget({ name: file.name, data: ev.target.result, isPdf: true });
            reader.readAsDataURL(file); e.target.value = ''; return;
        }
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX_DIM = 1600;
                let w = img.width, h = img.height; const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
                if (scale < 1) { w *= scale; h *= scale; }
                canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                saveFileToTarget({ name: file.name, data: canvas.toDataURL('image/jpeg', 0.75) });
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file); e.target.value = '';
    };
    $('json-uploader').onchange = function (e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => restaurerBackup(ev.target.result);
        reader.readAsText(file); e.target.value = '';
    };
}
async function saveFileToTarget(f) {
    const t = currentUploadTarget; if (!t) return;
    if (f.isPdf && t.type !== 'doc') { toast('Les PDF ne sont acceptés que dans Documents 📂'); return; }
    const mid = await Medias.ajouter(f.data);
    if (t.type === 'doc') { db.docs.push({ id: Date.now(), name: f.name, type: f.isPdf ? 'pdf' : 'img', data: mid }); renderDocs(); }
    else if (t.type === 'chaufCol') { db.chaufCol.photo = mid; renderCoproPhotos(); }
    else if (t.type === 'ecsCol') { db.ecsCol.photo = mid; renderCoproPhotos(); }
    else if (t.type === 'chaufIndTemp') { tempPhotos.chauf[t.id] = mid; renderApptCard(t.id); }
    else if (t.type === 'ecsIndTemp') { tempPhotos.ecs[t.id] = mid; renderApptCard(t.id); }
    else if (t.type === 'chaufInd') { const c = db.chaufs.find(x => x.id === t.id); if (c) { c.photo = mid; majListeChauf(c.aptId); } }
    else if (t.type === 'ecsInd') { const x = db.ecss.find(y => y.id === t.id); if (x) { x.photo = mid; majListeEcs(x.aptId); } }
    sauvegarderLocal(); toast('Photo enregistrée ✓');
}
async function upsertDoc(filename, b64) {
    const mid = await Medias.ajouter(b64);
    const existing = db.docs.find(d => d.name === filename);
    if (existing) existing.data = mid; else db.docs.push({ id: Date.now(), name: filename, type: 'img', data: mid });
    return mid;
}
function ouvrirDoc(id) { const d = db.docs.find(x => String(x.id) === String(id)); if (!d) return; const data = Medias.get(d.data); if (data) Plateforme.ouvrirFichier(dataURLtoBlob(data), d.name); }
function viewImage(src) { if (!src) return; $('img-viewer-src').src = src; $('img-viewer').style.display = 'flex'; }
function estimerPoidsMedias() { let octets = 0; Medias._champs((o, k) => { octets += Medias.taille(o[k]); }); return octets; }

function renderDocs() {
    const cont = $('list-docs'); if (!cont) return;
    const poidsMo = estimerPoidsMedias() / 1048576;
    let entete = `<div style="font-size:12px; font-weight:700; color:var(--tx2); margin-bottom:10px;">📎 ${db.docs.length} document(s) · ~${poidsMo.toFixed(1)} Mo de médias au total`;
    if (poidsMo > 150) entete += `<div style="color:var(--dan); font-weight:800; margin-top:4px;">⚠️ Volume élevé — exportez un backup et videz les documents inutiles.</div>`;
    entete += `</div>`;
    cont.innerHTML = entete + db.docs.map(d => `
        <div class="item-row" style="align-items:center;">
            ${d.type === 'pdf'
                ? `<div class="thumb" style="display:flex; align-items:center; justify-content:center; font-size:20px; background:#FEF2F2; border-color:#FECACA;" data-act="ouvrirDoc" data-id="${d.id}">📄</div>`
                : `<img src="${Medias.src(d.data)}" class="thumb" alt="" data-act="voir">`}
            <div style="flex:1; margin-left:12px; font-size:12px; font-weight:bold; word-break:break-all;">${esc(d.name)}</div>
            <button class="ico-btn dan" data-act="suppDoc" data-id="${d.id}">❌</button>
        </div>`).join('');
}
function suppDoc(id) {
    const idx = db.docs.findIndex(x => String(x.id) === String(id)); if (idx < 0) return;
    const doc = db.docs[idx]; db.docs.splice(idx, 1); renderDocs(); sauvegarderLocal();
    toastAnnuler('Document supprimé', () => { db.docs.splice(idx, 0, doc); renderDocs(); sauvegarderLocal(); });
}
function renderCoproPhotos() {
    const chImg = $('img-chaufCol'); const ecsImg = $('img-ecsCol');
    if (db.chaufCol.photo) { chImg.src = Medias.src(db.chaufCol.photo); chImg.style.display = 'block'; } else chImg.style.display = 'none';
    if (db.ecsCol.photo) { ecsImg.src = Medias.src(db.ecsCol.photo); ecsImg.style.display = 'block'; } else ecsImg.style.display = 'none';
}
Actions.voir = (d, el) => viewImage(el.getAttribute('src'));
Actions.ouvrirDoc = d => ouvrirDoc(d.id);
Actions.suppDoc = d => suppDoc(d.id);

/* ==========================================================================
   6. APPARTEMENTS — rendu par carte
   ========================================================================== */
function getBatimentOptionsHtml(selected = '') {
    const nb = parseInt($('copro-batiments').value) || 1; let html = '<option value="">—</option>';
    for (let i = 1; i <= nb; i++) html += `<option value="${i}" ${selected == i ? 'selected' : ''}>${i}</option>`;
    return html;
}
function updateBatimentOptions(selectId, selectedValue = '') { const s = $(selectId); if (s) s.innerHTML = getBatimentOptionsHtml(selectedValue); }
function getEtageOptionsHtml(selected = '') {
    const n = parseInt($('copro-etages').value) || 0;
    const opts = ['', 'Sous-sol', 'RDC']; for (let i = 1; i < n; i++) opts.push(`R+${i}`); opts.push('Combles');
    return opts.map(v => `<option value="${esc(v)}" ${selected === v && v ? 'selected' : ''}>${v || '—'}</option>`).join('');
}
function updateEtageOptions(selectId, selectedValue = '') { const s = $(selectId); if (s) s.innerHTML = getEtageOptionsHtml(selectedValue); }
function niveauDepuisEtage(etage) {
    const n = parseInt($('copro-etages').value) || 0;
    if (etage === 'RDC') return 'RDC';
    if (etage === 'Combles' || etage === `R+${n - 1}`) return 'Dernier étage';
    if (etage && etage.startsWith('R+')) return 'Intermédiaire';
    if (etage === 'Sous-sol') return 'Intermédiaire';
    return '';
}
function autoSetNiveau(etage, niveauSelectId) { const s = $(niveauSelectId); if (!s || !etage) return; const niv = niveauDepuisEtage(etage); if (niv) s.value = niv; }
function getAptNumOptionsHtml(selected = '') {
    let html = '<option value="">— Sélectionner —</option>';
    for (let i = 1; i <= 50; i++) { const val = 'E' + String(i).padStart(2, '0'); html += `<option value="${val}" ${selected === val ? 'selected' : ''}>${val}</option>`; }
    return html;
}

function showNouvelAppt() { $('apt-num').innerHTML = getAptNumOptionsHtml(); updateEtageOptions('apt-etage'); updateBatimentOptions('apt-bat'); $('new-apt-form').style.display = 'block'; }
function hideNouvelAppt() { $('new-apt-form').style.display = 'none'; }
function creerAppt() {
    const num = $('apt-num').value; if (!num) { toast('⚠️ Numéro d’échantillon requis'); $('apt-num').focus(); return; }
    const a = { id: String(Date.now()), num, bat: $('apt-bat').value, etage: $('apt-etage').value, niveau: $('apt-niveau').value, surf: $('apt-surf').value, hsp: $('apt-hsp').value, type: parseInt($('apt-type').value) || 1 };
    db.appts.push(a); expAppts[a.id] = true; curAppt = a.id; curNivInt = 0; sauvegarderLocal();
    $('apt-num').value = ''; $('apt-hsp').value = ''; $('apt-surf').value = ''; hideNouvelAppt(); renderApptsList(); updateDashboard();
    toast(`Lot ${num} créé ✓`);
}
function dupAppt(id) {
    const src = db.appts.find(a => a.id === id); if (!src) return;
    let maxNum = 0; db.appts.forEach(apt => { const digits = String(apt.num).match(/\d+/); if (digits) maxNum = Math.max(maxNum, parseInt(digits[0])); });
    const newNumStr = 'E' + String(maxNum + 1).padStart(2, '0');
    const newId = String(Date.now()); const newApt = { ...src, id: newId, num: newNumStr };
    if (src.surfs) newApt.surfs = JSON.parse(JSON.stringify(src.surfs)); if (src.plans) newApt.plans = { ...src.plans };
    db.appts.push(newApt);
    const cloneItems = (arrName, fk) => { db[arrName].filter(x => x[fk] === id).forEach(item => db[arrName].push({ ...item, id: Date.now() + Math.random(), [fk]: newId })); };
    cloneItems('murs', 'aid'); cloneItems('fens', 'aid'); cloneItems('portes', 'aid'); cloneItems('plfs', 'aid'); cloneItems('plas', 'aid'); cloneItems('pieces', 'aid'); cloneItems('chaufs', 'aptId'); cloneItems('ecss', 'aptId');
    curAppt = newId; curNivInt = 0; expAppts[newId] = true; sauvegarderLocal(); renderApptsList(); updateDashboard(); toast('Appartement dupliqué sous ' + newNumStr + ' ✓');
}
function toggleAppt(id) { expAppts[id] = !expAppts[id]; renderApptCard(id); }
async function suppAppt(id) {
    const targetId = String(id); const apt = db.appts.find(a => String(a.id) === targetId); if (!apt) return;
    if (!await Dialogue.confirmer({ titre: `Supprimer le lot ${apt.num} ?`, message: 'L’appartement et toutes ses parois, systèmes et plans seront définitivement supprimés.', ok: 'Supprimer', danger: true })) return;
    db.docs = db.docs.filter(d => !d.name.startsWith(`Croquis_${apt.num}_`));
    db.appts = db.appts.filter(a => String(a.id) !== targetId);
    ['murs', 'fens', 'portes', 'plfs', 'plas', 'pieces'].forEach(k => { db[k] = db[k].filter(m => String(m.aid) !== targetId); });
    Object.keys(db.calques).forEach(k => { if (k.startsWith(targetId + '_')) delete db.calques[k]; });
    db.chaufs = db.chaufs.filter(c => String(c.aptId) !== targetId); db.ecss = db.ecss.filter(e => String(e.aptId) !== targetId);
    delete tempPhotos.chauf[targetId]; delete tempPhotos.ecs[targetId]; delete expAppts[targetId];
    if (curAppt === id) curAppt = null;
    sauvegarderLocal(); renderApptsList(); renderDocs(); updateDashboard(); toast(`Lot ${apt.num} supprimé`);
}
function updateApptField(id, field, value) {
    const a = db.appts.find(x => x.id === id); if (!a) return;
    a[field] = value; sauvegarderLocal();
    if (field === 'type') renderApptCard(id);
    else if (field === 'surf' || field === 'num') { const h = document.querySelector(`#appt-${CSS.escape(id)} .appt-num`); if (h) h.innerHTML = enteteAppt(a); }
    updateDashboard();
}
function updateApptEtageLive(aptId, etageVal) {
    updateApptField(aptId, 'etage', etageVal);
    const niveau = niveauDepuisEtage(etageVal);
    if (niveau) { updateApptField(aptId, 'niveau', niveau); const s = $(`edit-niveau-${aptId}`); if (s) s.value = niveau; }
}
function enteteAppt(a) {
    const typeStr = a.type === 2 ? ' (Duplex)' : a.type === 3 ? ' (Triplex)' : '';
    return `${esc(a.num)}${typeStr} <span class="appt-surf">${a.surf ? esc(a.surf) + 'm²' : ''}</span>`;
}

const boutonsSys = (kind, id, aptId) => `
    <div class="item-actions">
        <button class="ico-btn acc" data-act="upload" data-type="${kind}Ind" data-id="${id}">📷</button>
        <button class="ico-btn ok" data-act="cloner${kind === 'chauf' ? 'Chauf' : 'Ecs'}" data-id="${id}">🔄</button>
        <button class="ico-btn acc" data-act="editer${kind === 'chauf' ? 'Chauf' : 'Ecs'}" data-apt="${aptId}" data-id="${id}">✏️</button>
        <button class="ico-btn dan" data-act="supp${kind === 'chauf' ? 'Chauf' : 'Ecs'}" data-apt="${aptId}" data-id="${id}">❌</button>
    </div>`;
function buildChaufListHTML(aptId) {
    const apt = db.appts.find(a => a.id === aptId); const aptNum = apt ? apt.num : '';
    return db.chaufs.filter(c => c.aptId === aptId).map((c, index) => `
        <div class="item-row">
            <div style="flex:1; padding-right:12px; min-width:0;">
                <div style="font-weight:800; color:var(--tx); font-size:14px; margin-bottom:6px;">🔥 Chauff. ${esc(aptNum)} - ${index + 1}</div>
                <div style="color:var(--tx2); font-size:12px; line-height:1.4;">${esc(c.energie)} · ${esc(c.gen)}<br>${esc(c.emetteur || '')} | ${c.puissance ? esc(c.puissance) + 'kW' : ''} | ${c.annee ? esc(c.annee) : ''}</div>
                <div style="margin-top:8px;">${c.photo ? `<img src="${Medias.src(c.photo)}" class="thumb" alt="" data-act="voir">` : ''}</div>
            </div>${boutonsSys('chauf', c.id, aptId)}
        </div>`).join('');
}
function buildEcsListHTML(aptId) {
    const apt = db.appts.find(a => a.id === aptId); const aptNum = apt ? apt.num : '';
    return db.ecss.filter(e => e.aptId === aptId).map((e, index) => `
        <div class="item-row">
            <div style="flex:1; padding-right:12px; min-width:0;">
                <div style="font-weight:800; color:var(--tx); font-size:14px; margin-bottom:6px;">🚿 ECS ${esc(aptNum)} - ${index + 1}</div>
                <div style="color:var(--tx2); font-size:12px; line-height:1.4;">${esc(e.energie)} · ${esc(e.type)}<br>${e.vol ? esc(e.vol) + 'L' : ''} | ${e.annee ? esc(e.annee) : ''}</div>
                <div style="margin-top:8px;">${e.photo ? `<img src="${Medias.src(e.photo)}" class="thumb" alt="" data-act="voir">` : ''}</div>
            </div>${boutonsSys('ecs', e.id, aptId)}
        </div>`).join('');
}
function majListeChauf(aptId) { const el = $('chauf-list-' + aptId); if (el) el.innerHTML = buildChaufListHTML(aptId); const t = $('acc-chauf-titre-' + aptId); if (t) t.textContent = `🔥 Chauffage individuel (${db.chaufs.filter(c => c.aptId === aptId).length})`; }
function majListeEcs(aptId) { const el = $('ecs-list-' + aptId); if (el) el.innerHTML = buildEcsListHTML(aptId); const t = $('acc-ecs-titre-' + aptId); if (t) t.textContent = `🚿 ECS individuelle (${db.ecss.filter(e => e.aptId === aptId).length})`; }

function updateApptBadges(aptId) {
    const el = $('badges-' + aptId); if (!el) return;
    const n = k => db[k].filter(x => x.aid === aptId).length;
    const myC = db.chaufs.filter(c => c.aptId === aptId).length; const myE = db.ecss.filter(e => e.aptId === aptId).length; const m = n('murs');
    const badgeSchema = (m > 2) ? '<span class="badge-elem badge-ok">📐 Plans Actifs</span>' : '<span class="badge-elem badge-warn">📐 Plan Vide</span>';
    const nbPieces = db.pieces.filter(p => p.aid === aptId).length;
    el.innerHTML = `${nbPieces ? `<span class="badge-elem badge-ok">📐 ${nbPieces} pièce(s)</span> ` : ''}<span class="badge-elem">🧱 ${m}</span> <span class="badge-elem">🪟 ${n('fens')}</span> <span class="badge-elem">🚪 ${n('portes')}</span> <span class="badge-elem">🔝 ${n('plfs')}</span> <span class="badge-elem">🔽 ${n('plas')}</span> <span class="badge-elem ${myC ? 'badge-ok' : 'badge-warn'}">🔥 ${myC}</span> <span class="badge-elem ${myE ? 'badge-ok' : 'badge-warn'}">🚿 ${myE}</span> ${badgeSchema}`;
}

function ajouterChauf(aptId) {
    const e = $('ifc-energie-' + aptId).value; const g = $('ifc-gen-' + aptId).value;
    const btn = $('btn-chauf-' + aptId); const editId = btn.getAttribute('data-edit-id');
    if (!e || !g) { toast('⚠️ Énergie et générateur requis'); return; }
    const obj = { id: editId || String(Date.now()), aptId, energie: e, gen: g, emetteur: $('ifc-emetteur-' + aptId).value, annee: $('ifc-annee-' + aptId).value, puissance: $('ifc-puissance-' + aptId).value };
    if (tempPhotos.chauf[aptId]) { obj.photo = tempPhotos.chauf[aptId]; delete tempPhotos.chauf[aptId]; }
    if (editId) { const idx = db.chaufs.findIndex(x => x.id === editId); if (idx >= 0) { if (db.chaufs[idx].photo && !obj.photo) obj.photo = db.chaufs[idx].photo; db.chaufs[idx] = obj; } else db.chaufs.push(obj); }
    else db.chaufs.push(obj);
    sauvegarderLocal(); renderApptCard(aptId); toast('Chauffage enregistré ✓');
}
function clonerChauf(id) { const src = db.chaufs.find(x => x.id === id); if (!src) return; db.chaufs.push({ ...src, id: String(Date.now() + Math.random()) }); sauvegarderLocal(); majListeChauf(src.aptId); updateApptBadges(src.aptId); updateDashboard(); toast('Chauffage cloné ✓'); }
function editerChauf(aptId, chaufId) {
    const c = db.chaufs.find(x => x.id === chaufId); if (!c) return;
    ouvrirAcc(`acc-chauf-${aptId}`);
    setSelect(`ifc-energie-${aptId}`, c.energie); updateChaufGen(`ifc-energie-${aptId}`, `ifc-gen-${aptId}`, `ifc-emetteur-${aptId}`);
    setSelect(`ifc-gen-${aptId}`, c.gen); setSelect(`ifc-emetteur-${aptId}`, c.emetteur || ''); $(`ifc-annee-${aptId}`).value = c.annee || ''; $(`ifc-puissance-${aptId}`).value = c.puissance || '';
    const btn = $(`btn-chauf-${aptId}`); btn.textContent = 'Modifier ce chauffage'; btn.setAttribute('data-edit-id', chaufId);
    scrollVers(`sysform-chauf-${aptId}`);
}
function suppChauf(id, aptId) {
    const idx = db.chaufs.findIndex(c => c.id === id); if (idx < 0) return;
    const item = db.chaufs[idx]; db.chaufs.splice(idx, 1); sauvegarderLocal(); majListeChauf(aptId); updateApptBadges(aptId); updateDashboard();
    toastAnnuler('Chauffage supprimé', () => { db.chaufs.splice(idx, 0, item); sauvegarderLocal(); majListeChauf(aptId); updateApptBadges(aptId); updateDashboard(); });
}
function ajouterEcs(aptId) {
    const e = $('ife-energie-' + aptId).value; const t = $('ife-type-' + aptId).value;
    const btn = $('btn-ecs-' + aptId); const editId = btn.getAttribute('data-edit-id');
    if (!e || !t) { toast('⚠️ Type et énergie requis'); return; }
    const obj = { id: editId || String(Date.now()), aptId, type: t, energie: e, annee: $('ife-annee-' + aptId).value, vol: $('ife-vol-' + aptId).value };
    if (tempPhotos.ecs[aptId]) { obj.photo = tempPhotos.ecs[aptId]; delete tempPhotos.ecs[aptId]; }
    if (editId) { const idx = db.ecss.findIndex(x => x.id === editId); if (idx >= 0) { if (db.ecss[idx].photo && !obj.photo) obj.photo = db.ecss[idx].photo; db.ecss[idx] = obj; } else db.ecss.push(obj); }
    else db.ecss.push(obj);
    sauvegarderLocal(); renderApptCard(aptId); toast('ECS enregistrée ✓');
}
function clonerEcs(id) { const src = db.ecss.find(x => x.id === id); if (!src) return; db.ecss.push({ ...src, id: String(Date.now() + Math.random()) }); sauvegarderLocal(); majListeEcs(src.aptId); updateApptBadges(src.aptId); updateDashboard(); toast('ECS clonée ✓'); }
function editerEcs(aptId, ecsId) {
    const e = db.ecss.find(x => x.id === ecsId); if (!e) return;
    ouvrirAcc(`acc-ecs-${aptId}`);
    setSelect(`ife-energie-${aptId}`, e.energie); updateEcsGen(`ife-energie-${aptId}`, `ife-type-${aptId}`);
    setSelect(`ife-type-${aptId}`, e.type); $(`ife-annee-${aptId}`).value = e.annee || ''; $(`ife-vol-${aptId}`).value = e.vol || '';
    const btn = $(`btn-ecs-${aptId}`); btn.textContent = 'Modifier cette ECS'; btn.setAttribute('data-edit-id', ecsId);
    scrollVers(`sysform-ecs-${aptId}`);
}
function suppEcs(id, aptId) {
    const idx = db.ecss.findIndex(e => e.id === id); if (idx < 0) return;
    const item = db.ecss[idx]; db.ecss.splice(idx, 1); sauvegarderLocal(); majListeEcs(aptId); updateApptBadges(aptId); updateDashboard();
    toastAnnuler('ECS supprimée', () => { db.ecss.splice(idx, 0, item); sauvegarderLocal(); majListeEcs(aptId); updateApptBadges(aptId); updateDashboard(); });
}
function suppPlanAppt(aptId, niv) {
    const apt = db.appts.find(a => a.id === aptId); if (!apt || !apt.plans || !apt.plans[niv]) return;
    const plan = apt.plans[niv]; const nomDoc = `Croquis_${apt.num}_N${niv}.png`;
    const docIdx = db.docs.findIndex(d => d.name === nomDoc); const doc = docIdx >= 0 ? db.docs[docIdx] : null;
    delete apt.plans[niv]; if (doc) db.docs.splice(docIdx, 1);
    sauvegarderLocal(); renderDocs(); renderApptCard(aptId);
    toastAnnuler('Plan retiré du lot', () => { apt.plans = apt.plans || {}; apt.plans[niv] = plan; if (doc) db.docs.splice(docIdx, 0, doc); sauvegarderLocal(); renderDocs(); renderApptCard(aptId); });
}

const optionsEnergie = () => '<option value="">Énergie</option>' + ENERGIES_IND.map(x => `<option>${x}</option>`).join('');
function construireCarteAppt(a) {
    const isExp = expAppts[a.id]; let body = '';
    if (isExp) {
        const nC = db.chaufs.filter(c => c.aptId === a.id).length; const nE = db.ecss.filter(e => e.aptId === a.id).length;
        let plansHtml = '';
        if (a.plans && Object.keys(a.plans).length) {
            plansHtml = `<div style="display:flex; gap:10px; margin-bottom:12px; align-items:center; flex-wrap:wrap;"><span style="font-size:12px; font-weight:800; color:var(--tx2);">📐 Plans :</span>` +
                Object.keys(a.plans).map(n => `<div class="plan-thumb-wrap">
                    <img src="${Medias.src(a.plans[n])}" class="thumb" alt="" style="width:64px; height:44px; margin:0;" data-act="voir">
                    <span class="plan-thumb-niv">N${n}</span>
                    <span class="plan-thumb-del" data-act="suppPlan" data-id="${a.id}" data-niv="${n}">×</span>
                </div>`).join('') + `</div>`;
        }
        const accC = `acc-chauf-${a.id}`, accE = `acc-ecs-${a.id}`;
        body = `<div class="appt-body open">
            <div class="card" style="margin-bottom:10px; border-color:#CBD5E1;">
                <div class="fr"><span class="fl">Identifiant</span><select data-chg="apptField" data-id="${a.id}" data-field="num">${getAptNumOptionsHtml(a.num)}</select></div>
                <div class="fr"><span class="fl">Type de lot</span><select data-chg="apptField" data-id="${a.id}" data-field="type" data-num="1"><option value="1" ${a.type === 1 || !a.type ? 'selected' : ''}>Plain-pied</option><option value="2" ${a.type === 2 ? 'selected' : ''}>Duplex</option><option value="3" ${a.type === 3 ? 'selected' : ''}>Triplex</option></select></div>
                <div class="fr"><span class="fl">Bâtiment n°</span><select data-chg="apptField" data-id="${a.id}" data-field="bat">${getBatimentOptionsHtml(a.bat)}</select></div>
                <div class="fr"><span class="fl">Surface (m²)</span><input type="number" inputmode="decimal" step="any" value="${esc(a.surf || '')}" data-chg="apptField" data-id="${a.id}" data-field="surf"></div>
                <div class="fr"><span class="fl">HSP (m)</span><input type="number" inputmode="decimal" step="any" value="${esc(a.hsp || '')}" data-chg="apptField" data-id="${a.id}" data-field="hsp"></div>
                <div class="fr"><span class="fl">Étage princ.</span><select data-chg="apptEtage" data-id="${a.id}">${getEtageOptionsHtml(a.etage)}</select></div>
                <div class="fr"><span class="fl">Niveau ADN</span><select id="edit-niveau-${a.id}" data-chg="apptField" data-id="${a.id}" data-field="niveau"><option value="">—</option><option value="RDC" ${a.niveau === 'RDC' ? 'selected' : ''}>RDC</option><option value="Intermédiaire" ${a.niveau === 'Intermédiaire' ? 'selected' : ''}>Intermédiaire</option><option value="Dernier étage" ${a.niveau === 'Dernier étage' ? 'selected' : ''}>Dernier étage</option></select></div>
            </div>
            ${plansHtml}
            <div class="appt-quick">
                <button class="qbtn" style="color:var(--acc); border-color:#BFDBFE; background:var(--acc-l);" data-act="goParoi" data-id="${a.id}" data-vue="pieces">📐 Pièces</button>
                <button class="qbtn" data-act="goParoi" data-id="${a.id}" data-vue="murs">🧱 Murs</button>
                <button class="qbtn" data-act="goParoi" data-id="${a.id}" data-vue="fen">🪟 Fenêtres</button>
                <button class="qbtn" data-act="goParoi" data-id="${a.id}" data-vue="portes">🚪 Portes</button>
                <button class="qbtn" data-act="goParoi" data-id="${a.id}" data-vue="plafonds">🔝 Plafonds</button>
                <button class="qbtn" data-act="goParoi" data-id="${a.id}" data-vue="planchers">🔽 Planchers</button>
                <button class="qbtn" style="color:var(--ok); border-color:var(--ok-l); background:var(--ok-l);" data-act="dupAppt" data-id="${a.id}">🔄 Dupliquer</button>
            </div>

            <div class="coll-acc-hd acc-sub ${accOuverts.has(accC) ? 'open' : ''}" data-act="toggleAcc" data-id="${accC}">
                <span id="acc-chauf-titre-${a.id}">🔥 Chauffage individuel (${nC})</span> <span class="acc-arrow">▶</span>
            </div>
            <div class="coll-acc-body ${accOuverts.has(accC) ? 'open' : ''}" id="${accC}">
                <div class="acc-inner sys-form" id="sysform-chauf-${a.id}">
                    <div id="chauf-list-${a.id}">${buildChaufListHTML(a.id)}</div>
                    <div class="row" style="align-items:center;">
                        <select id="ifc-energie-${a.id}" data-chg="chaufEnergie" data-id="${a.id}">${optionsEnergie()}</select>
                        ${tempPhotos.chauf[a.id] ? `<img src="${Medias.src(tempPhotos.chauf[a.id])}" class="thumb thumb-sm" alt="" style="flex:0 0 34px;" data-act="voir">` : ''}
                        <button class="btn-soft" style="flex:0 0 auto; font-size:16px;" data-act="upload" data-type="chaufIndTemp" data-id="${a.id}">📷</button>
                    </div>
                    <select id="ifc-gen-${a.id}" data-chg="chaufGen" data-id="${a.id}"><option value="">Générateur</option></select>
                    <select id="ifc-emetteur-${a.id}"><option value="">Émetteur</option></select>
                    <div class="row"><input type="number" inputmode="numeric" pattern="[0-9]*" id="ifc-annee-${a.id}" placeholder="Année"><input type="number" inputmode="decimal" step="any" id="ifc-puissance-${a.id}" placeholder="Puiss. kW"></div>
                    <button id="btn-chauf-${a.id}" class="btn-dashed" data-act="ajouterChauf" data-id="${a.id}">Ajouter Chauffage</button>
                </div>
            </div>

            <div class="coll-acc-hd acc-sub ${accOuverts.has(accE) ? 'open' : ''}" data-act="toggleAcc" data-id="${accE}">
                <span id="acc-ecs-titre-${a.id}">🚿 ECS individuelle (${nE})</span> <span class="acc-arrow">▶</span>
            </div>
            <div class="coll-acc-body ${accOuverts.has(accE) ? 'open' : ''}" id="${accE}">
                <div class="acc-inner sys-form" id="sysform-ecs-${a.id}">
                    <div id="ecs-list-${a.id}">${buildEcsListHTML(a.id)}</div>
                    <div class="row" style="align-items:center;">
                        <select id="ife-energie-${a.id}" data-chg="ecsEnergie" data-id="${a.id}">${optionsEnergie()}</select>
                        ${tempPhotos.ecs[a.id] ? `<img src="${Medias.src(tempPhotos.ecs[a.id])}" class="thumb thumb-sm" alt="" style="flex:0 0 34px;" data-act="voir">` : ''}
                        <button class="btn-soft" style="flex:0 0 auto; font-size:16px;" data-act="upload" data-type="ecsIndTemp" data-id="${a.id}">📷</button>
                    </div>
                    <select id="ife-type-${a.id}"><option value="">Type</option></select>
                    <div class="row"><input type="number" inputmode="numeric" pattern="[0-9]*" id="ife-annee-${a.id}" placeholder="Année"><input type="number" inputmode="numeric" pattern="[0-9]*" id="ife-vol-${a.id}" placeholder="Vol (L)"></div>
                    <button id="btn-ecs-${a.id}" class="btn-dashed" data-act="ajouterEcs" data-id="${a.id}">Ajouter ECS</button>
                </div>
            </div>

            <div style="margin-top:15px; text-align:right;"><button class="btn-xs" style="color:var(--dan); background:#fff; border:1px solid var(--dan); padding:8px 14px;" data-act="suppAppt" data-id="${a.id}">🗑️ Supprimer l'appartement</button></div>
        </div>`;
    }
    return `<div class="appt-card ${curAppt === a.id ? 'cur' : ''}" id="appt-${a.id}">
        <div class="appt-header" data-act="toggleAppt" data-id="${a.id}">
            <div style="flex:1; min-width:0;">
                <div class="appt-num">${enteteAppt(a)}</div>
                <div id="badges-${a.id}" class="appt-badges"></div>
            </div>
            <span style="color:var(--tx2); font-size:14px; padding-left:10px;">${isExp ? '▼' : '▶'}</span>
        </div>
        <div style="padding:0 16px 16px;">${body}</div>
    </div>`;
}
function renderApptsList() {
    const cont = $('appts-liste'); $('appts-count-lbl').textContent = db.appts.length + ' appartement(s)';
    if (!db.appts.length) { cont.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">Aucun lot saisi.</div>'; return; }
    cont.innerHTML = db.appts.map(construireCarteAppt).join('');
    db.appts.forEach(a => updateApptBadges(a.id));
}
// Re-rend uniquement la carte du lot concerné (pas de reconstruction de toute la liste).
function renderApptCard(id) {
    const a = db.appts.find(x => x.id === id); const old = $('appt-' + id);
    if (!a || !old) { renderApptsList(); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = construireCarteAppt(a);
    old.replaceWith(tmp.firstElementChild); updateApptBadges(id);
}
Object.assign(Actions, {
    toggleAppt: d => toggleAppt(d.id),
    toggleAcc: (d, el) => toggleAcc(d.id, el),
    upload: d => triggerUpload(d.type, d.id || null),
    goParoi: d => { curAppt = d.id; curNivInt = 0; goTab(d.vue); },
    dupAppt: d => dupAppt(d.id),
    suppAppt: d => suppAppt(d.id),
    suppPlan: d => suppPlanAppt(d.id, d.niv),
    ajouterChauf: d => ajouterChauf(d.id), clonerChauf: d => clonerChauf(d.id), editerChauf: d => editerChauf(d.apt, d.id), suppChauf: d => suppChauf(d.id, d.apt),
    ajouterEcs: d => ajouterEcs(d.id), clonerEcs: d => clonerEcs(d.id), editerEcs: d => editerEcs(d.apt, d.id), suppEcs: d => suppEcs(d.id, d.apt)
});
Object.assign(Changements, {
    apptField: (d, el) => updateApptField(d.id, d.field, d.num ? parseInt(el.value) : el.value),
    apptEtage: (d, el) => updateApptEtageLive(d.id, el.value),
    chaufEnergie: d => updateChaufGen(`ifc-energie-${d.id}`, `ifc-gen-${d.id}`, `ifc-emetteur-${d.id}`),
    chaufGen: d => checkChaudiereECS('ind', d.id),
    ecsEnergie: d => updateEcsGen(`ife-energie-${d.id}`, `ife-type-${d.id}`)
});

/* ==========================================================================
   7. PAROIS
   ========================================================================== */
const PAROIS = {
    murs:   { vue: 'murs',      list: 'list-murs',   sel: 'murs-target', niv: 'murs-niv-container', form: 'form-murs',      nom: 'ce mur',      nomF: 'Mur' },
    fens:   { vue: 'fen',       list: 'list-fens',   sel: 'fen-target',  niv: 'fen-niv-container',  form: 'form-fen',       nom: 'cette fenêtre', nomF: 'Fenêtre' },
    portes: { vue: 'portes',    list: 'list-portes', sel: 'por-target',  niv: 'por-niv-container',  form: 'form-portes',    nom: 'cette porte', nomF: 'Porte' },
    plfs:   { vue: 'plafonds',  list: 'list-plfs',   sel: 'plf-target',  niv: 'plf-niv-container',  form: 'form-plafonds',  nom: 'ce plafond',  nomF: 'Plafond' },
    plas:   { vue: 'planchers', list: 'list-plas',   sel: 'pla-target',  niv: 'pla-niv-container',  form: 'form-planchers', nom: 'ce plancher', nomF: 'Plancher' },
    pieces: { vue: 'pieces',    list: 'list-pieces', sel: 'pie-target',  niv: 'pie-niv-container',  form: 'form-pieces',    nom: 'cette pièce', nomF: 'Pièce' }
};
const TYPE_PAR_VUE = { murs: 'murs', fen: 'fens', fens: 'fens', portes: 'portes', plafonds: 'plfs', plfs: 'plfs', planchers: 'plas', plas: 'plas', pieces: 'pieces' };
function typeParoiActif() { return TYPE_PAR_VUE[vueActive] || null; }

function libelleCible() {
    if (!curAppt || curAppt === 'copro') return 'Parties communes';
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return 'Parties communes';
    let s = `Lot ${apt.num}`;
    if (apt.type > 1) s += ' · ' + (curNivInt === 0 ? 'Niveau bas' : (curNivInt === 1 && apt.type === 3) ? 'Niveau inter.' : 'Niveau haut');
    return s;
}
// Barre d'action collante : bouton principal toujours sous le pouce, rappel du lot et du niveau.
function majBarreAction() {
    const type = typeParoiActif(); const bar = $('action-bar');
    if (!type) { bar.classList.remove('on'); document.body.classList.remove('has-ab'); return; }
    const cfg = PAROIS[type]; const ctx = $('ab-ctx'); const save = $('ab-save'); const cancel = $('ab-cancel');
    bar.classList.add('on'); document.body.classList.add('has-ab');
    const edition = !!editParoiId;
    ctx.innerHTML = edition ? `<span>✏️ Modification en cours</span><b>${esc(cfg.nomF)} · ${esc(libelleCible())}</b>` : `<span>Enregistrement dans</span><b>${esc(libelleCible())}</b>`;
    ctx.classList.toggle('editing', edition);
    save.textContent = edition ? `Modifier ${cfg.nom}` : `Enregistrer ${cfg.nom}`;
    save.classList.toggle('editing', edition);
    cancel.hidden = !edition;
}
function sauverParoiActive() { const t = typeParoiActif(); if (t) sauverParoi(t); }
function annulerEdition() { resetEditParoi(); majBarreAction(); toast('Modification annulée'); }
function resetEditParoi() { editParoiId = null; }
function majResumeIso() {
    const el = $('acc-iso-murs-resume'); if (!el) return;
    const iso = $('m-iso').value; const ep = $('m-iso-ep').value; const doub = $('m-doub').value;
    const parts = []; if (iso && iso !== 'Non') parts.push(iso + (ep ? ' ' + ep + 'cm' : '')); if (doub && doub !== 'ABSENT') parts.push('doublage ' + doub);
    el.textContent = parts.length ? '· ' + parts.join(' · ') : '· aucune';
}

function verifierAptActif(tab) {
    const type = TYPE_PAR_VUE[tab]; const cfg = PAROIS[type]; const sel = $(cfg.sel); const nivContainer = $(cfg.niv);
    if (sel) {
        let html = `<option value="copro">🏢 Copropriété (Parties Communes)</option>`;
        db.appts.forEach(a => { const typeText = a.type === 2 ? ' (Duplex)' : a.type === 3 ? ' (Triplex)' : ''; html += `<option value="${a.id}">Lot : ${esc(a.num)}${typeText}</option>`; });
        sel.innerHTML = html;
        if (!curAppt || (curAppt !== 'copro' && !db.appts.some(a => a.id === curAppt))) curAppt = 'copro';
        sel.value = curAppt;
    }
    if (curAppt === 'copro' || !curAppt) {
        curAppt = 'copro'; curNivInt = 0; if (nivContainer) nivContainer.innerHTML = '';
        if (type === 'murs' && !editParoiId) $('m-h').value = '';
    } else {
        const apt = db.appts.find(a => a.id === curAppt);
        if (apt && apt.type && apt.type > 1) {
            let html = '<div class="niv-row">';
            for (let i = 0; i < apt.type; i++) { const lbl = i === 0 ? 'Niveau Bas' : i === 1 ? (apt.type === 3 ? 'Niveau Inter.' : 'Niveau Haut') : 'Niveau Haut'; html += `<button class="niv-btn ${curNivInt === i ? 'niv-on' : 'niv-off'}" data-act="setNiv" data-i="${i}" data-tab="${tab}">${lbl}</button>`; }
            html += '</div>'; if (nivContainer) nivContainer.innerHTML = html;
        } else { curNivInt = 0; if (nivContainer) nivContainer.innerHTML = ''; }
        if (type === 'murs' && !editParoiId && apt) $('m-h').value = apt.hsp || '';
    }
}
function changeTargetApt(val, tab) {
    resetEditParoi(); curAppt = val; curNivInt = 0;
    verifierAptActif(tab); renderElementsList(tab);
    if (tab === 'murs') drawCroquis();
    if (tab === 'fen') { peuplerMursDispo('f-mur', ''); peuplerPiecesDispo('f-piece', ''); }
    if (tab === 'portes') { peuplerMursDispo('po-mur', ''); peuplerPiecesDispo('po-piece', ''); }
    if (tab === 'pieces') { pieceSel = null; gomArmee = null; gomSel = null; renderChipsPieces(); assemblerPieces(false); if (modePlan === 'gommettes') renderPaletteGommettes('pieces'); dessinerPlanPieces(); }
    majBarreAction();
}
function setNivInt(i, tab) {
    resetEditParoi(); curNivInt = i;
    verifierAptActif(tab); renderElementsList(tab);
    if (tab === 'murs') drawCroquis();
    if (tab === 'fen') { peuplerMursDispo('f-mur', ''); peuplerPiecesDispo('f-piece', ''); }
    if (tab === 'portes') { peuplerMursDispo('po-mur', ''); peuplerPiecesDispo('po-piece', ''); }
    if (tab === 'pieces') { pieceSel = null; gomArmee = null; gomSel = null; renderChipsPieces(); assemblerPieces(false); if (modePlan === 'gommettes') renderPaletteGommettes('pieces'); dessinerPlanPieces(); }
    majBarreAction();
}
Actions.setNiv = d => setNivInt(parseInt(d.i), d.tab);

function sauverParoi(type) {
    if (!curAppt) curAppt = 'copro';
    let avertissement = '';   // remplace le message d'enregistrement s'il est renseigné
    let el = editParoiId ? db[type].find(x => x.id === editParoiId) : null;
    if (!el) { el = { id: Date.now(), aid: curAppt }; editParoiId = null; }
    el.nivInt = curNivInt;
    const v = id => $(id).value;
    if (type === 'murs') {
        if (!v('m-l') || !v('m-h')) { toast('⚠️ Longueur et hauteur requises'); $(v('m-l') ? 'm-h' : 'm-l').focus(); return; }
        const oldOri = el.ori; el.ori = v('m-ori'); el.donne = v('m-donne'); el.mat = v('m-mat'); el.l = v('m-l'); el.h = v('m-h'); el.ep = v('m-ep'); el.doub = v('m-doub'); el.iso = v('m-iso'); el.isoEp = v('m-iso-ep');
        if (el.vectX !== undefined && oldOri !== el.ori) { delete el.vectX; delete el.vectY; }
    } else if (type === 'fens') {
        const fori = v('f-ori'), ftype = v('f-type'), fmat = v('f-mat'), fvit = v('f-vit'), fep = v('f-ep'), ffer = v('f-fer'), fmotifs = v('f-motifs');
        let fl = v('f-l'), fh = v('f-h'), fdiam = v('f-diam'), fsurf = 0;
        if (ftype === 'Hublot') { if (!fdiam) { toast('⚠️ Diamètre requis'); $('f-diam').focus(); return; } fl = ''; fh = ''; fsurf = (Math.PI * Math.pow((parseFloat(fdiam) || 0) / 2, 2) / 10000).toFixed(3); }
        else { if (!fl || !fh) { toast('⚠️ Largeur et hauteur requises'); $(fl ? 'f-h' : 'f-l').focus(); return; } fdiam = ''; fsurf = (((parseFloat(fl) || 0) * (parseFloat(fh) || 0)) / 10000).toFixed(3); }
        const dimStr = ftype === 'Hublot' ? `Ø${fdiam}` : `${fl}x${fh}`;
        const shortFer = ffer.length > 15 ? ffer.substring(0, 15) + '...' : (ffer || 'Sans fermeture');
        let existingMod = db.modelesFens.find(m => m.type === ftype && m.mat === fmat && m.vit === fvit && m.ep === fep && m.fer === ffer && m.l === fl && m.h === fh && m.diam === fdiam && m.ori === fori && m.motifs === fmotifs);
        if (!existingMod) { existingMod = { id: 'mod_' + Date.now(), nom: `[${fori}] ${dimStr} | ${shortFer} (${fmotifs} motif(s))`, type: ftype, mat: fmat, vit: fvit, ep: fep, fer: ffer, l: fl, h: fh, diam: fdiam, ori: fori, motifs: fmotifs }; db.modelesFens.push(existingMod); renderBibliFens(); }
        if (!editParoiId) el.nom = 'F' + (db.modelesFens.indexOf(existingMod) + 1);
        el.ori = fori; el.type = ftype; el.mat = fmat; el.vit = fvit; el.ep = fep; el.fer = ffer; el.l = fl; el.h = fh; el.diam = fdiam; el.surf = fsurf; el.nb = v('f-nb'); el.motifs = fmotifs;
        el.murId = v('f-mur') || ''; el.pieceId = v('f-piece') || '';
        const excesF = verifierPercement(murDe(el), parseFloat(fsurf) * (parseFloat(el.nb) || 1), el.id);
        if (excesF) avertissement = `Enregistré, mais les ouvrants de ce mur totalisent ${excesF.total.toFixed(2)} m² pour une façade de ${excesF.surfMur.toFixed(2)} m²`;
    } else if (type === 'portes') {
        if (!v('po-l') || !v('po-h')) { toast('⚠️ Largeur et hauteur requises'); $(v('po-l') ? 'po-h' : 'po-l').focus(); return; }
        el.type = v('po-type'); el.mat = v('po-mat'); el.donne = v('po-donne'); el.iso = v('po-iso'); el.sas = v('po-sas'); el.l = v('po-l'); el.h = v('po-h');
        el.murId = v('po-mur') || ''; el.pieceId = v('po-piece') || '';
        const excesP = verifierPercement(murDe(el), (parseFloat(el.l) || 0) * (parseFloat(el.h) || 0), el.id);
        if (excesP) avertissement = `Enregistré, mais les ouvrants de ce mur totalisent ${excesP.total.toFixed(2)} m² pour une façade de ${excesP.surfMur.toFixed(2)} m²`;
    } else if (type === 'plfs') {
        if (!v('p-s') && !(v('p-l') && v('p-larg'))) { toast('⚠️ Dimensions ou surface requises'); $('p-l').focus(); return; }
        el.type = v('p-type'); el.donne = v('p-donne'); el.l = v('p-l'); el.larg = v('p-larg'); el.s = v('p-s'); el.iso = v('p-iso'); el.isoEp = v('p-iso-ep');
    } else if (type === 'pieces') {
        if (!v('pie-l') || !v('pie-larg')) { toast('⚠️ Longueur et largeur requises'); $(v('pie-l') ? 'pie-larg' : 'pie-l').focus(); return; }
        el.nom = v('pie-nom').trim() || ('Pièce ' + (db.pieces.filter(p => p.aid === curAppt && (p.nivInt || 0) === curNivInt).length + 1));
        el.l = v('pie-l'); el.larg = v('pie-larg');
        if (el.rot === undefined) el.rot = 0;
    } else if (type === 'plas') {
        if (!v('s-s') && !(v('s-l') && v('s-larg'))) { toast('⚠️ Dimensions ou surface requises'); $('s-l').focus(); return; }
        el.type = v('s-type'); el.donne = v('s-donne'); el.l = v('s-l'); el.larg = v('s-larg'); el.s = v('s-s'); el.iso = v('s-iso'); el.isoEp = v('s-iso-ep');
    }
    const etaitEdition = !!editParoiId;
    if (!editParoiId) db[type].push(el);
    editParoiId = null;
    sauvegarderLocal(); renderElementsList(type); majBarreAction();
    if (type === 'fens') renderRecapFens();
    if (curAppt !== 'copro') updateApptBadges(curAppt);
    // Mémoire de saisie : on ne vide que les dimensions, les propriétés restent pour l'élément suivant.
    if (type === 'murs') { $('m-l').value = ''; drawCroquis(); $('m-l').focus(); }
    else if (type === 'fens') { $('f-l').value = ''; $('f-h').value = ''; $('f-diam').value = ''; }   // le mur associé reste choisi
    else if (type === 'portes') { $('po-l').value = ''; $('po-h').value = ''; }
    else if (type === 'plfs') { $('p-l').value = ''; $('p-larg').value = ''; $('p-s').value = ''; }
    else if (type === 'plas') { $('s-l').value = ''; $('s-larg').value = ''; $('s-s').value = ''; }
    else if (type === 'pieces') {
        assemblerPieces(false);
        $('pie-nom').value = ''; $('pie-l').value = ''; $('pie-larg').value = '';
        renderChipsPieces(); majApercuPiece(); dessinerPlanPieces(); $('pie-nom').focus();
    }
    if (avertissement) toast('⚠️ ' + avertissement, { duree: 6000 });
    else toast(etaitEdition ? 'Modification enregistrée ✓' : 'Enregistré ✓ Propriétés conservées.');
}
function editerParoi(type, id) {
    const p = db[type].find(x => String(x.id) === String(id)); if (!p) return;
    editParoiId = p.id; const set = (i, val) => setSelect(i, val);
    if (type === 'murs') {
        set('m-ori', p.ori); set('m-donne', p.donne); set('m-mat', p.mat); set('m-l', p.l); set('m-h', p.h); set('m-ep', p.ep || ''); set('m-doub', p.doub || 'ABSENT'); set('m-iso', p.iso || 'Non'); set('m-iso-ep', p.isoEp || '');
        if ((p.iso && p.iso !== 'Non') || (p.doub && p.doub !== 'ABSENT')) ouvrirAcc('acc-iso-murs'); majResumeIso();
    } else if (type === 'fens') {
        set('f-ori', p.ori || 'Nord'); set('f-type', p.type); toggleFenType(); set('f-mat', p.mat); set('f-vit', p.vit); set('f-ep', p.ep || ''); set('f-fer', p.fer); set('f-l', p.l || ''); set('f-h', p.h || ''); set('f-diam', p.diam || ''); set('f-nb', p.nb || '1'); set('f-motifs', p.motifs || '1');
        peuplerMursDispo('f-mur', p.murId); peuplerPiecesDispo('f-piece', p.pieceId);
    } else if (type === 'portes') {
        set('po-type', p.type || 'Porte opaque pleine'); set('po-mat', p.mat || 'Bois'); set('po-donne', p.donne || 'Extérieur'); set('po-iso', p.iso || 'Non isolée / Inconnue'); set('po-sas', p.sas || 'Non'); set('po-l', p.l || ''); set('po-h', p.h || '');
        peuplerMursDispo('po-mur', p.murId); peuplerPiecesDispo('po-piece', p.pieceId);
    } else if (type === 'plfs') {
        set('p-type', p.type); set('p-donne', p.donne); set('p-l', p.l || ''); set('p-larg', p.larg || ''); set('p-s', p.s || ''); set('p-iso', p.iso || 'Non'); set('p-iso-ep', p.isoEp || '');
    } else if (type === 'pieces') {
        $('pie-nom').value = p.nom || ''; $('pie-l').value = p.l || ''; $('pie-larg').value = p.larg || '';
        renderChipsPieces(); majApercuPiece();
    } else if (type === 'plas') {
        set('s-type', p.type); set('s-donne', p.donne); set('s-l', p.l || ''); set('s-larg', p.larg || ''); set('s-s', p.s || ''); set('s-iso', p.iso || 'Non'); set('s-iso-ep', p.isoEp || '');
    }
    majBarreAction(); scrollVers(PAROIS[type].form);
}
function clonerParoi(type, id) {
    const src = db[type].find(x => String(x.id) === String(id)); if (!src) return;
    const clone = { ...src, id: Date.now() + Math.random(), nivInt: curNivInt };
    if (type === 'pieces') { delete clone.x; delete clone.y; }   // la copie se place à côté, pas dessus
    db[type].push(clone);
    sauvegarderLocal(); renderElementsList(type);
    if (type === 'murs') drawCroquis();
    if (type === 'pieces') assemblerPieces(false);
    if (curAppt !== 'copro') updateApptBadges(curAppt);
    toast('Élément cloné ✓');
}
function suppElement(type, id) {
    const idx = db[type].findIndex(x => String(x.id) === String(id)); if (idx < 0) return;
    const item = db[type][idx]; db[type].splice(idx, 1);
    if (editParoiId === item.id) { editParoiId = null; majBarreAction(); }
    const apres = () => { sauvegarderLocal(); renderElementsList(type); if (type === 'murs') drawCroquis(); if (type === 'pieces') { pieceSel = null; dessinerPlanPieces(); } if (curAppt !== 'copro') updateApptBadges(curAppt); updateDashboard(); };
    apres();
    toastAnnuler('Élément supprimé', () => { db[type].splice(idx, 0, item); apres(); });
}
Actions.clonerParoi = d => clonerParoi(d.type, d.id);
Actions.editerParoi = d => editerParoi(d.type, d.id);
Actions.suppElement = d => suppElement(d.type, d.id);

function renderElementsList(tabId) {
    if (!curAppt) curAppt = 'copro';
    const type = TYPE_PAR_VUE[tabId]; if (!type) return; const cont = $(PAROIS[type].list); const data = db[type];
    if (type === 'pieces') return renderListePieces(cont);
    cont.innerHTML = data.filter(x => x.aid === curAppt && (x.nivInt || 0) === curNivInt).map(x => {
        let dimText = ''; let titleText = x.mat || x.type;
        if (type === 'fens') {
            dimText = x.type === 'Hublot' ? `Ø: ${esc(x.diam || '?')}cm (Surf: ${esc(x.surf || '?')}m²) | Lame: ${esc(x.ep || '?')}mm | Qté: ${esc(x.nb || 1)} (Motifs: ${esc(x.motifs || 1)})` : `Dim: ${esc(x.l || '?')}x${esc(x.h || '?')}cm | Lame: ${esc(x.ep || '?')}mm | Qté: ${esc(x.nb || 1)} (Motifs: ${esc(x.motifs || 1)})`;
            titleText = `${x.nom ? esc(x.nom) + ' - ' : ''}${esc(x.type || '')}`;
            const murF = murDe(x);
            const pieceF = pieceDe(x);
            dimText = `${esc(x.mat || '')} | ${esc(x.vit || '')}<br>Fermeture : ${esc(x.fer || 'Absence')}<br>` + dimText
                + (pieceF ? `<br>🏠 ${esc(pieceF.nom || 'Pièce')}` : '') + (murF ? `${pieceF ? ' · ' : '<br>'}🧱 Mur ${esc(murF.ori || '')} ${esc(murF.l || '')}×${esc(murF.h || '')} m` : '');
        } else if (type === 'plfs' || type === 'plas') {
            dimText = x.s ? `Surf: ${esc(x.s)}m²` : `Dim: ${esc(x.l || '?')} x ${esc(x.larg || '?')}m`;
            if (x.iso && x.iso !== 'Non') dimText += ` | Iso: ${esc(x.iso)}${x.isoEp ? ' ' + esc(x.isoEp) + 'cm' : ''}`; titleText = esc(titleText);
        } else if (type === 'murs') {
            dimText = `Dim: ${esc(x.l || '?')} x ${esc(x.h || '?')}m`; if (x.ep) dimText += ` | Ep: ${esc(x.ep)}cm`;
            if (x.iso && x.iso !== 'Non') dimText += ` | Iso: ${esc(x.iso)}${x.isoEp ? ' ' + esc(x.isoEp) + 'cm' : ''}`;
            titleText = (x.vectX !== undefined) ? 'Mur (Fermeture auto)' : esc(titleText);
        } else if (type === 'portes') {
            dimText = `Dim: ${esc(x.l || '?')} x ${esc(x.h || '?')}m | Iso: ${esc(x.iso || 'Non')} | Sas: ${esc(x.sas || 'Non')}`;
            const pieceP = pieceDe(x); if (pieceP) dimText += `<br>🏠 ${esc(pieceP.nom || 'Pièce')}`;
            const murP = murDe(x); if (murP) dimText += `${pieceP ? ' · ' : '<br>'}🧱 Mur ${esc(murP.ori || '')} ${esc(murP.l || '')}×${esc(murP.h || '')} m`;
            titleText = `${esc(x.type)} (${esc(x.mat || '?')})`;
        }
        const badgeText = type === 'fens' ? esc(x.ori || 'N/A') : (type === 'portes' ? 'Porte' : esc(x.ori || 'Surf.'));
        const enEdition = editParoiId === x.id ? 'border-color:#D97706; box-shadow:0 0 0 2px #FDE68A;' : '';
        return `
        <div class="item-row" style="${enEdition}">
            <div style="flex:1; padding-right:12px; min-width:0;">
                <div style="margin-bottom: 6px;"><span class="badge">${badgeText}</span> <b style="font-size:14px; color:var(--tx);">${titleText}</b></div>
                <div style="color:var(--tx2); font-size:12px; line-height:1.5; word-wrap: break-word;">${dimText}</div>
            </div>
            <div class="item-actions">
                <button class="ico-btn ok" data-act="clonerParoi" data-type="${type}" data-id="${x.id}">🔄</button>
                <button class="ico-btn acc" data-act="editerParoi" data-type="${type}" data-id="${x.id}">✏️</button>
                <button class="ico-btn dan" data-act="suppElement" data-type="${type}" data-id="${x.id}">❌</button>
            </div>
        </div>`;
    }).join('');
}
function toggleFenType() {
    const type = $('f-type'); const lh = $('f-dim-lh'); const diam = $('f-dim-diam');
    if (type && lh && diam) { const hublot = type.value === 'Hublot'; lh.style.display = hublot ? 'none' : 'block'; diam.style.display = hublot ? 'block' : 'none'; }
}

// --- Bibliothèque de modèles de fenêtres ---
function chargerModeleFen(id) {
    if (!id) { editParoiId = null; $('f-l').value = ''; $('f-h').value = ''; $('f-diam').value = ''; majBarreAction(); return; }
    const m = db.modelesFens.find(x => x.id === id); if (!m) return;
    setSelect('f-ori', m.ori || 'Nord'); setSelect('f-type', m.type); toggleFenType(); setSelect('f-mat', m.mat); setSelect('f-vit', m.vit); $('f-ep').value = m.ep || ''; setSelect('f-fer', m.fer);
    $('f-l').value = m.l || ''; $('f-h').value = m.h || ''; $('f-diam').value = m.diam || ''; $('f-motifs').value = m.motifs || '1';
    toast('Modèle chargé ✓');
}
Actions.chargerModele = d => chargerModeleFen(d.id || '');
function renderBibliFens() {
    const cont = $('f-bibli-container'); if (!cont) return;
    let html = `<div class="bibli-scroll"><div class="bibli-new" data-act="chargerModele" data-id=""><div style="font-size:24px; margin-bottom:4px;">✨</div><div style="font-size:13px; font-weight:900; color:var(--tx2);">Nouvelle</div></div>`;
    (db.modelesFens || []).forEach((m, index) => {
        const dimStr = m.type === 'Hublot' ? `Ø${esc(m.diam)}` : `${esc(m.l)}x${esc(m.h)}`;
        const shortFer = m.fer && m.fer !== 'Absence' ? esc(m.fer.substring(0, 14)) + '...' : 'Sans volet';
        html += `<div class="bibli-mod" data-act="chargerModele" data-id="${esc(m.id)}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><span class="bibli-rep">F${index + 1}</span><span class="bibli-ori">${m.ori ? esc(m.ori.substring(0, 1)) : '-'}</span></div>
            <div style="font-size:14px; color:var(--tx); font-weight:900; margin-bottom:4px;">${dimStr} cm</div>
            <div style="font-size:11px; font-weight:700; color:var(--tx2);">${shortFer}</div>
        </div>`;
    });
    cont.innerHTML = html + '</div>';
}

/* --- Récapitulatif des fenêtres : vue d'ensemble, duplication et correction rapides --- */
let recapFiltreLot = '', recapFiltreOri = '';

function surfaceFen(f) {
    let u = parseFloat(f.surf);
    if (isNaN(u)) u = f.type === 'Hublot' ? (Math.PI * Math.pow((parseFloat(f.diam) || 0) / 2, 2) / 10000) : ((parseFloat(f.l) || 0) * (parseFloat(f.h) || 0)) / 10000;
    return u * (parseFloat(f.nb) || 1);
}
function nomLot(aid) {
    if (aid === 'copro') return '🏢 Parties communes';
    const a = db.appts.find(x => x.id === aid);
    return a ? `🚪 Lot ${a.num}` : '⚠️ Lot supprimé';
}
function libelleNiveau(f) {
    const a = db.appts.find(x => x.id === f.aid);
    if (!a || !a.type || a.type < 2) return '';
    const n = f.nivInt || 0;
    return ' · ' + (n === 0 ? 'Niv. bas' : (n === 1 && a.type === 3) ? 'Niv. inter.' : 'Niv. haut');
}

function renderRecapFens() {
    const selLot = $('recap-lot');
    if (selLot) {
        // Reprendre le choix affiché avant de reconstruire la liste, sinon un changement
        // de filtre serait annulé par son propre rendu.
        if (selLot.options.length) recapFiltreLot = selLot.value;
        selLot.innerHTML = '<option value="">Tous les lots</option><option value="copro">🏢 Parties communes</option>' +
            db.appts.map(a => `<option value="${a.id}">🚪 Lot ${esc(a.num)}</option>`).join('');
        selLot.value = [...selLot.options].some(o => o.value === recapFiltreLot) ? recapFiltreLot : '';
        recapFiltreLot = selLot.value;
    }
    const selOri = $('recap-ori'); if (selOri) recapFiltreOri = selOri.value;

    const liste = db.fens.filter(f => (!recapFiltreLot || f.aid === recapFiltreLot) && (!recapFiltreOri || f.ori === recapFiltreOri));
    const nb = liste.reduce((s, f) => s + (parseFloat(f.nb) || 1), 0);
    const surf = liste.reduce((s, f) => s + surfaceFen(f), 0);
    const resume = $('recap-resume');
    if (resume) resume.innerHTML = `<span>${nb}</span> menuiserie(s) · <span>${surf.toFixed(2)} m²</span> de surface vitrée · <span>${liste.length}</span> ligne(s)`;

    const cont = $('recap-contenu'); if (!cont) return;
    if (!liste.length) {
        cont.innerHTML = `<div class="recap-groupe"><div class="recap-vide">${db.fens.length ? 'Aucune fenêtre ne correspond à ce filtre.' : 'Aucune fenêtre saisie pour le moment.'}</div></div>`;
        return;
    }
    // Regroupement par lot, parties communes d'abord puis ordre de création des lots
    const ordre = ['copro', ...db.appts.map(a => a.id)];
    const groupes = new Map();
    liste.forEach(f => { if (!groupes.has(f.aid)) groupes.set(f.aid, []); groupes.get(f.aid).push(f); });
    const cles = [...groupes.keys()].sort((a, b) => { const ia = ordre.indexOf(a), ib = ordre.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });

    cont.innerHTML = cles.map(aid => {
        const items = groupes.get(aid);
        const sg = items.reduce((s, f) => s + surfaceFen(f), 0);
        const ng = items.reduce((s, f) => s + (parseFloat(f.nb) || 1), 0);
        return `<div class="recap-groupe">
            <div class="recap-groupe-hd"><span>${esc(nomLot(aid))}</span><small>${ng} menuiserie(s) · ${sg.toFixed(2)} m²</small></div>
            ${items.map(f => {
                const dim = f.type === 'Hublot' ? `Ø ${esc(f.diam || '?')} cm` : `${esc(f.l || '?')} × ${esc(f.h || '?')} cm`;
                const fer = f.fer && f.fer !== 'Absence' ? esc(f.fer) : 'Sans fermeture';
                return `<div class="recap-ligne ${editParoiId === f.id ? 'encours' : ''}">
                    <div class="recap-rep">${esc(f.nom || 'F?')}</div>
                    <div class="recap-info">
                        <div class="recap-titre">${esc(f.type || '')} · ${esc(f.ori || '')}${esc(libelleNiveau(f))}</div>
                        <div class="recap-detail">${dim} — ${esc(f.mat || '')}<br>${esc(f.vit || '')}${f.ep ? ' (lame ' + esc(f.ep) + ' mm)' : ''}<br>Fermeture : ${fer}${pieceDe(f) ? `<br>🏠 ${esc(pieceDe(f).nom || '')}` : ''}${murDe(f) ? `${pieceDe(f) ? ' · ' : '<br>'}🧱 Mur ${esc(murDe(f).ori || '')} ${esc(murDe(f).l || '')}×${esc(murDe(f).h || '')} m` : ''}</div>
                        <div class="recap-chiffres">Qté ${esc(f.nb || 1)} · ${esc(f.motifs || 1)} motif(s) · ${surfaceFen(f).toFixed(2)} m²${f.posPlan || f.posCal ? ' · 📍 repérée sur plan' : ''}</div>
                    </div>
                    <div class="recap-actions">
                        <button class="ico-btn ok" title="Quantité +1" data-act="recapPlus" data-id="${f.id}">➕</button>
                        <button class="ico-btn ok" title="Dupliquer dans ce lot" data-act="recapCloner" data-id="${f.id}">🔄</button>
                        <button class="ico-btn gris" title="Copier vers un autre lot" data-act="recapCopier" data-id="${f.id}">↗️</button>
                        <button class="ico-btn acc" title="Modifier" data-act="recapEditer" data-id="${f.id}">✏️</button>
                        <button class="ico-btn dan" title="Supprimer" data-act="recapSupp" data-id="${f.id}">❌</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
}

const trouverFen = id => db.fens.find(f => String(f.id) === String(id));
Object.assign(Actions, {
    recapPlus: d => {
        const f = trouverFen(d.id); if (!f) return;
        const avant = parseFloat(f.nb) || 1; f.nb = String(avant + 1);
        sauvegarderLocal(); renderRecapFens(); updateDashboard();
        toastAnnuler(`${f.nom || 'Fenêtre'} : quantité ${avant + 1}`, () => { f.nb = String(avant); sauvegarderLocal(); renderRecapFens(); updateDashboard(); });
    },
    recapCloner: d => {
        const f = trouverFen(d.id); if (!f) return;
        const clone = { ...f, id: Date.now() + Math.random() };
        db.fens.push(clone); sauvegarderLocal(); renderRecapFens(); updateDashboard();
        if (f.aid !== 'copro') updateApptBadges(f.aid);
        toastAnnuler(`${f.nom || 'Fenêtre'} dupliquée dans ${nomLot(f.aid)}`, () => { db.fens = db.fens.filter(x => x.id !== clone.id); sauvegarderLocal(); renderRecapFens(); updateDashboard(); });
    },
    recapCopier: async d => {
        const f = trouverFen(d.id); if (!f) return;
        const options = [{ value: 'copro', label: '🏢 Parties communes' }];
        db.appts.forEach(a => {
            const nivs = (a.type && a.type > 1) ? a.type : 1;
            for (let n = 0; n < nivs; n++) options.push({ value: `${a.id}|${n}`, label: `🚪 Lot ${a.num}${nivs > 1 ? ' · ' + (n === 0 ? 'Niv. bas' : (n === 1 && nivs === 3) ? 'Niv. inter.' : 'Niv. haut') : ''}` });
        });
        const cible = await Dialogue.choisir({ titre: 'Copier la menuiserie', message: `${f.nom || 'Fenêtre'} — ${f.type || ''} ${f.l && f.h ? f.l + '×' + f.h + ' cm' : ''}`, options, ok: 'Copier' });
        if (!cible) return;
        const [aid, niv] = cible.split('|');
        const clone = { ...f, id: Date.now() + Math.random(), aid, nivInt: parseInt(niv) || 0 };
        db.fens.push(clone); sauvegarderLocal(); renderRecapFens(); updateDashboard();
        if (aid !== 'copro') updateApptBadges(aid);
        toastAnnuler(`Copiée vers ${nomLot(aid)}`, () => { db.fens = db.fens.filter(x => x.id !== clone.id); sauvegarderLocal(); renderRecapFens(); updateDashboard(); });
    },
    recapEditer: d => {
        const f = trouverFen(d.id); if (!f) return;
        curAppt = f.aid; curNivInt = f.nivInt || 0;
        goTab('fen');
        editerParoi('fens', f.id);
        toast(`Modification de ${f.nom || 'la fenêtre'} — ${nomLot(f.aid)}`);
    },
    recapSupp: d => {
        const idx = db.fens.findIndex(f => String(f.id) === String(d.id)); if (idx < 0) return;
        const item = db.fens[idx]; db.fens.splice(idx, 1);
        if (editParoiId === item.id) { editParoiId = null; majBarreAction(); }
        const apres = () => { sauvegarderLocal(); renderRecapFens(); updateDashboard(); if (item.aid !== 'copro') updateApptBadges(item.aid); };
        apres();
        toastAnnuler(`${item.nom || 'Fenêtre'} supprimée`, () => { db.fens.splice(idx, 0, item); apres(); });
    }
});

// --- Croquis du niveau (canvas) ---
function getShortMat(mat) {
    if (!mat) return ''; if (mat.includes('Pierre')) return 'Pierre'; if (mat.includes('Béton banché')) return 'Béton'; if (mat.includes('Blocs de béton')) return 'Parpaing';
    if (mat.includes('Briques pleines')) return 'Brique pl.'; if (mat.includes('Briques creuses') || mat.includes('alvéolaire')) return 'Brique cr.'; if (mat.includes('Pisé')) return 'Pisé'; if (mat.includes('bois')) return 'Bois'; return 'Inc.';
}
function drawCroquis() {
    const canvas = $('croquis-canvas'); if (!canvas) return;
    const container = $('croquis-container'); const msg = $('croquis-msg');
    if (!curAppt) { container.style.display = 'none'; return; }
    const mursApt = db.murs.filter(m => m.aid === curAppt && (m.nivInt || 0) === curNivInt);
    if (mursApt.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect(); const cw = rect.width || 400; const ch = rect.height || 260;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);

    const points = [{ x: 0, y: 0 }]; let curX = 0, curY = 0;
    mursApt.forEach(m => {
        const l = parseFloat(m.l) || 0;
        if (m.vectX !== undefined && m.vectY !== undefined) { const origL = Math.hypot(m.vectX, m.vectY); if (origL > 0) { curX += m.vectX * (l / origL); curY += m.vectY * (l / origL); } else { curX += m.vectX; curY += m.vectY; } }
        else { if (m.ori === 'Nord') curX += l; else if (m.ori === 'Est') curY += l; else if (m.ori === 'Sud') curX -= l; else if (m.ori === 'Ouest') curY -= l; }
        points.push({ x: curX, y: curY });
    });
    let area = 0;
    for (let i = 0; i < points.length - 1; i++) area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
    area += points[points.length - 1].x * points[0].y - points[0].x * points[points.length - 1].y; area = Math.abs(area) / 2;

    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(maxX - minX, 0.1), height = Math.max(maxY - minY, 0.1);
    const padding = 45; const scale = Math.min((cw - padding * 2) / width, (ch - padding * 2) / height);
    const offsetX = (cw - width * scale) / 2, offsetY = (ch - height * scale) / 2;
    const px = p => offsetX + (p.x - minX) * scale, py = p => offsetY + (p.y - minY) * scale;

    ctx.beginPath(); ctx.strokeStyle = '#2563EB'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(px(p), py(p)); else ctx.lineTo(px(p), py(p)); }); ctx.stroke();

    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1]; const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1; const nx = -dy / len, ny = dx / len;
        const textPx = px(mid) + nx * 14, textPy = py(mid) + ny * 14;
        const text = mursApt[i].l + 'm ' + getShortMat(mursApt[i].mat) + (mursApt[i].ep ? ` (${mursApt[i].ep}cm)` : '');
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(textPx - tw / 2 - 4, textPy - 10, tw + 8, 20); ctx.fillStyle = '#0F172A'; ctx.fillText(text, textPx, textPy);
    }
    const compX = 25, compY = 30;
    ctx.beginPath(); ctx.moveTo(compX, compY - 10); ctx.lineTo(compX, compY + 10); ctx.moveTo(compX - 10, compY); ctx.lineTo(compX + 10, compY); ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(compX, compY - 12); ctx.lineTo(compX - 4, compY - 2); ctx.lineTo(compX + 4, compY - 2); ctx.fillStyle = '#EF4444'; ctx.fill();
    ctx.fillStyle = '#1E293B'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('N', compX, compY - 18);

    const startP = points[0], endP = points[points.length - 1];
    ctx.beginPath(); ctx.arc(px(startP), py(startP), 6, 0, 2 * Math.PI); ctx.fillStyle = '#16A34A'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(px(endP), py(endP), 6, 0, 2 * Math.PI); ctx.fillStyle = '#EF4444'; ctx.fill(); ctx.stroke();

    const err = Math.hypot(curX, curY); let txt = '';
    if (mursApt.length < 2) txt = '<span style="color:#94A3B8;">Tracez au moins 2 murs pour pouvoir fermer le polygone...</span>';
    else if (err > 0.15) {
        txt = `<span style="color:var(--dan); font-weight:800;">⚠️ Écart fermeture : ${err.toFixed(2)} m</span><br><span style="color:var(--ok); font-weight:800;">Surface estimée : ${area.toFixed(1)} m²</span><br><button class="btn-xs" style="margin-top:12px; padding:10px 16px; background:var(--warn-l); color:var(--warn); border:1px solid #FDE68A;" data-act="fermerPolygone" data-cx="${curX}" data-cy="${curY}">🔗 Fermer automatiquement</button>`;
        ctx.beginPath(); ctx.setLineDash([5, 5]); ctx.moveTo(px(endP), py(endP)); ctx.lineTo(px(startP), py(startP)); ctx.strokeStyle = '#EF4444'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    } else {
        let opts = `<option value="copro" ${curAppt === 'copro' ? 'selected' : ''}>🏢 Parties communes</option>`;
        db.appts.forEach(a => { opts += `<option value="${a.id}" ${curAppt === a.id ? 'selected' : ''}>Lot ${esc(a.num)}</option>`; });
        txt = `<span style="color:var(--ok); font-size:14px; font-weight:800;">✅ Périmètre fermé</span><br><span style="font-size:15px; color:var(--tx);">Surface (Niveau ${curNivInt}) : <b>${area.toFixed(1)} m²</b></span>
            <div style="display:flex; gap:8px; margin-top:12px; align-items:center; justify-content:center; flex-wrap:wrap;">
                <select id="croquis-apply-target" style="padding:10px; border-radius:8px; border:1px solid var(--bor); font-weight:700; color:var(--tx); background:#fff; max-width:100%;">${opts}</select>
                <button class="btn-xs" style="background:var(--ok); color:#fff; padding:10px 14px;" data-act="appliquerCroquis" data-area="${area.toFixed(1)}">✔️ Appliquer surface + plan</button>
            </div>`;
        ctx.beginPath(); ctx.moveTo(px(endP), py(endP)); ctx.lineTo(px(startP), py(startP)); ctx.strokeStyle = '#16A34A'; ctx.lineWidth = 2; ctx.stroke();
    }
    msg.innerHTML = txt; if (curAppt !== 'copro') updateApptBadges(curAppt);
}
window.addEventListener('resize', debounce(() => { if (vueActive === 'murs') drawCroquis(); }, 150));
window.addEventListener('orientationchange', () => setTimeout(() => { if (vueActive === 'murs') drawCroquis(); }, 300));

function fermerPolygone(cX, cY) {
    const dx = -cX, dy = -cY; const l = Math.hypot(dx, dy).toFixed(2);
    const ori = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'Nord' : 'Sud') : (dy >= 0 ? 'Est' : 'Ouest');
    const m = { id: Date.now(), aid: curAppt, nivInt: curNivInt, ori, donne: $('m-donne').value || 'Extérieur', mat: $('m-mat').value || 'Inconnu', l: String(l), h: $('m-h').value || '', ep: $('m-ep').value || '', iso: $('m-iso').value || 'Non', isoEp: $('m-iso-ep').value || '', doub: $('m-doub').value || 'ABSENT', vectX: dx, vectY: dy };
    db.murs.push(m); sauvegarderLocal(); renderElementsList('murs'); drawCroquis(); toast('Mur de fermeture (' + l + 'm) généré ✓');
}
Actions.fermerPolygone = d => fermerPolygone(parseFloat(d.cx), parseFloat(d.cy));
async function appliquerCroquis(area) {
    const target = $('croquis-apply-target').value; const canvas = $('croquis-canvas'); if (!canvas) return;
    const b64 = canvas.toDataURL('image/png');
    if (target === 'copro') {
        db.copro.surfcommuns = area; const input = $('copro-surfcommuns'); if (input) input.value = area;
        await upsertDoc('Croquis_Copro_PartiesCommunes.png', b64);
        toast(`Surface (${area} m²) + plan affectés aux parties communes ✓`);
    } else {
        const apt = db.appts.find(a => a.id === target); if (!apt) return;
        apt.surfs = apt.surfs || {}; apt.surfs[curNivInt] = parseFloat(area);
        apt.surf = Object.values(apt.surfs).reduce((s, v) => s + v, 0).toFixed(1);
        apt.plans = apt.plans || {}; apt.plans[curNivInt] = await upsertDoc(`Croquis_${apt.num}_N${curNivInt}.png`, b64);
        toast(`Surface N${curNivInt} (${area} m²) + plan affectés au lot ${apt.num} ✓`);
    }
    sauvegarderLocal(); renderDocs(); updateDashboard();
}
Actions.appliquerCroquis = d => appliquerCroquis(parseFloat(d.area));
async function exporterCroquis() {
    const canvas = $('croquis-canvas'); if (!canvas || $('croquis-container').style.display === 'none') return;
    const b64 = canvas.toDataURL('image/png'); let filename = 'Croquis_Copro_PartiesCommunes.png';
    if (curAppt !== 'copro') { const aptObj = db.appts.find(a => a.id === curAppt); filename = `Croquis_${aptObj ? aptObj.num : 'Lot'}_N${curNivInt}.png`; }
    await upsertDoc(filename, b64); sauvegarderLocal(); renderDocs(); toast('Plan ajouté au dossier Copro 📁');
}

/* ==========================================================================
   7 bis. SAISIE PAR PIÈCES ET PLAN ASSEMBLÉ
   On mesure une pièce (longueur × largeur), pas un mur : la surface habitable
   s'additionne toute seule et les pièces sont assemblées en un plan de lot,
   ajustable au doigt. Coordonnées et dimensions sont en mètres.
   ========================================================================== */
const PIECES_COURANTES = ['Séjour', 'Cuisine', 'Chambre', 'Salle de bains', 'WC', 'Dégagement', 'Entrée', 'Bureau', 'Cellier'];
let pieceSel = null;              // pièce sélectionnée sur le plan
let planDrag = null;              // déplacement en cours

const dimsPiece = p => { const L = parseFloat(p.l) || 0, la = parseFloat(p.larg) || 0; return p.rot ? { w: la, h: L } : { w: L, h: la }; };
const surfacePiece = p => (parseFloat(p.l) || 0) * (parseFloat(p.larg) || 0);
const piecesCourantes = () => db.pieces.filter(p => p.aid === curAppt && (p.nivInt || 0) === curNivInt);

function renderChipsPieces() {
    const cont = $('piece-chips'); if (!cont) return;
    const actuel = ($('pie-nom').value || '').trim().toLowerCase();
    // Les chambres se numérotent d'elles-mêmes : Chambre, Chambre 2, Chambre 3…
    const suivant = nom => {
        const memes = piecesCourantes().filter(p => (p.nom || '').startsWith(nom));
        return memes.length ? `${nom} ${memes.length + 1}` : nom;
    };
    cont.innerHTML = PIECES_COURANTES.map(n => {
        const propose = suivant(n);
        return `<button type="button" class="piece-chip ${actuel === propose.toLowerCase() ? 'on' : ''}" data-act="chipPiece" data-nom="${esc(propose)}">${esc(propose)}</button>`;
    }).join('');
}
Actions.chipPiece = d => { $('pie-nom').value = d.nom; renderChipsPieces(); $('pie-l').focus(); };

function majApercuPiece() {
    const el = $('pie-apercu'); if (!el) return;
    const L = parseFloat($('pie-l').value) || 0, la = parseFloat($('pie-larg').value) || 0;
    el.innerHTML = (L > 0 && la > 0) ? `Surface de la pièce : <b>${(L * la).toFixed(2)} m²</b>` : '';
}

function renderListePieces(cont) {
    const liste = piecesCourantes();
    const total = liste.reduce((s, p) => s + surfacePiece(p), 0);
    const info = $('pie-total');
    if (info) info.textContent = liste.length ? `${liste.length} pièce(s) · ${total.toFixed(2)} m²` : '';
    cont.innerHTML = liste.map(p => `
        <div class="item-row ${pieceSel === p.id ? 'piece-row-sel' : ''}">
            <div style="flex:1; padding-right:12px; min-width:0;">
                <div style="margin-bottom:4px;"><b style="font-size:15px; color:var(--tx);">${esc(p.nom || 'Pièce')}</b></div>
                <div style="color:var(--tx2); font-size:12px; line-height:1.5;">${esc(p.l)} × ${esc(p.larg)} m${p.rot ? ' · pivotée' : ''}</div>
                <div style="color:var(--acc); font-size:13px; font-weight:800; margin-top:3px;">${surfacePiece(p).toFixed(2)} m²${(() => {
                    const nf = db.fens.filter(f => String(f.pieceId) === String(p.id)).length;
                    const np = db.portes.filter(x => String(x.pieceId) === String(p.id)).length;
                    const sv = surfaceVitreePiece(p.id);
                    if (!nf && !np) return '';
                    return ` <span style="color:var(--tx2); font-weight:700;">· ${nf ? `🪟 ${nf} (${sv.toFixed(2)} m²)` : ''}${nf && np ? ' · ' : ''}${np ? `🚪 ${np}` : ''}</span>`;
                })()}</div>
            </div>
            <div class="item-actions">
                <button class="ico-btn ok" title="Dupliquer" data-act="clonerParoi" data-type="pieces" data-id="${p.id}">🔄</button>
                <button class="ico-btn acc" title="Modifier" data-act="editerParoi" data-type="pieces" data-id="${p.id}">✏️</button>
                <button class="ico-btn dan" title="Supprimer" data-act="suppElement" data-type="pieces" data-id="${p.id}">❌</button>
            </div>
        </div>`).join('');
}

/* --- Assemblage : rangées successives, largeur cible proche d'un carré --- */
function assemblerPieces(tout) {
    const liste = piecesCourantes(); if (!liste.length) return;
    const aPlacer = tout ? [...liste].sort((a, b) => surfacePiece(b) - surfacePiece(a)) : liste.filter(p => p.x === undefined || p.y === undefined);
    if (!aPlacer.length) { dessinerPlanPieces(); return; }
    const total = liste.reduce((s, p) => s + surfacePiece(p), 0);
    const maxW = Math.max(...aPlacer.map(p => dimsPiece(p).w), 1);
    const cible = Math.max(Math.sqrt(total * 1.3), maxW);

    let x0 = 0, y0 = 0;
    if (!tout) {
        // Les nouvelles pièces se posent sous l'assemblage existant, sans le déranger.
        const placees = liste.filter(p => p.x !== undefined && p.y !== undefined);
        if (placees.length) {
            x0 = Math.min(...placees.map(p => p.x));
            y0 = Math.max(...placees.map(p => p.y + dimsPiece(p).h));
        }
    }
    let x = x0, y = y0, hRangee = 0;
    aPlacer.forEach(p => {
        const d = dimsPiece(p);
        if (x > x0 && (x - x0) + d.w > cible) { x = x0; y += hRangee; hRangee = 0; }
        p.x = Math.round(x * 100) / 100; p.y = Math.round(y * 100) / 100;
        x += d.w; hRangee = Math.max(hRangee, d.h);
    });
    sauvegarderLocal(); dessinerPlanPieces();
    if (tout) toast('Pièces réassemblées ✓');
}

function pivoterPieceSel() {
    const liste = piecesCourantes();
    const p = liste.find(x => x.id === pieceSel) || liste[liste.length - 1];
    if (!p) { toast('Aucune pièce à pivoter'); return; }
    p.rot = p.rot ? 0 : 1; pieceSel = p.id;
    sauvegarderLocal(); dessinerPlanPieces(); renderElementsList('pieces');
    toast(`${p.nom || 'Pièce'} pivotée`);
}

/* --- Dessin du plan assemblé --- */
let planVue = null;   // repère courant (échelle et décalage) pour la conversion écran ↔ mètres
let modePlan = 'pieces';   // 'pieces' : agencer les pièces · 'gommettes' : repérer les fenêtres
function basculerGommettesPlan() {
    modePlan = modePlan === 'gommettes' ? 'pieces' : 'gommettes';
    gomArmee = null; gomSel = null;
    const b = $('plan-btn-gom'); if (b) b.classList.toggle('on', modePlan === 'gommettes');
    const pal = $('plan-gommettes'); if (pal) pal.hidden = modePlan !== 'gommettes';
    if (modePlan === 'gommettes') renderPaletteGommettes('pieces');
    dessinerPlanPieces();
    toast(modePlan === 'gommettes' ? 'Touchez une fenêtre puis le plan pour la repérer' : 'Retour à l’agencement des pièces');
}
// `canvasCible` permet de produire le même dessin hors écran, pour l'export PDF.
function dessinerPlanPieces(canvasCible) {
    const horsEcran = !!canvasCible;
    const canvas = canvasCible || $('plan-canvas'); const cont = $('plan-container');
    if (!canvas || (!cont && !horsEcran)) return;
    const liste = piecesCourantes();
    if (!liste.length) { if (!horsEcran) { cont.style.display = 'none'; planVue = null; } return; }
    if (!horsEcran) cont.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width || 340, ch = rect.height || 300;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);

    const placees = liste.filter(p => p.x !== undefined && p.y !== undefined);
    if (!placees.length) { assemblerPieces(false); return; }
    const minX = Math.min(...placees.map(p => p.x)), minY = Math.min(...placees.map(p => p.y));
    const maxX = Math.max(...placees.map(p => p.x + dimsPiece(p).w)), maxY = Math.max(...placees.map(p => p.y + dimsPiece(p).h));
    const pad = 26;
    const ech = Math.min((cw - pad * 2) / Math.max(maxX - minX, 0.5), (ch - pad * 2) / Math.max(maxY - minY, 0.5));
    const dx = (cw - (maxX - minX) * ech) / 2, dy = (ch - (maxY - minY) * ech) / 2;
    if (!horsEcran) planVue = { ech, dx, dy, minX, minY };
    const px = mx => dx + (mx - minX) * ech, py = my => dy + (my - minY) * ech;

    // Contour extérieur du logement, tracé sous les pièces
    const contour = contourPieces(placees);
    if (contour.length > 2) {
        ctx.beginPath();
        contour.forEach((p, i) => { const X = px(p.x), Y = py(p.y); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
        ctx.closePath(); ctx.fillStyle = 'rgba(37,99,235,0.06)'; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#1E293B'; ctx.lineJoin = 'round'; ctx.stroke();
    }

    placees.forEach(p => {
        const d = dimsPiece(p);
        const X = px(p.x), Y = py(p.y), W = d.w * ech, H = d.h * ech;
        const actif = pieceSel === p.id;
        ctx.fillStyle = actif ? '#DBEAFE' : '#FFFFFF';
        ctx.fillRect(X, Y, W, H);
        ctx.lineWidth = actif ? 3 : 1.5; ctx.strokeStyle = actif ? '#2563EB' : '#94A3B8';
        ctx.strokeRect(X, Y, W, H);
        // Nom et surface, seulement si la case est assez grande
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0F172A';
        if (W > 46 && H > 30) {
            ctx.font = 'bold 11px sans-serif';
            const nom = String(p.nom || 'Pièce');
            const court = ctx.measureText(nom).width > W - 8 ? nom.slice(0, Math.max(3, Math.floor((W - 8) / 6))) + '…' : nom;
            ctx.fillText(court, X + W / 2, Y + H / 2 - 7);
            ctx.font = '10px sans-serif'; ctx.fillStyle = '#2563EB';
            ctx.fillText(surfacePiece(p).toFixed(1) + ' m²', X + W / 2, Y + H / 2 + 7);
        } else if (W > 24 && H > 16) {
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(surfacePiece(p).toFixed(1), X + W / 2, Y + H / 2);
        }
    });

    dessinerGommettes(ctx, 'pieces', p => ({ x: px(p.x), y: py(p.y) }));

    const total = liste.reduce((s, p) => s + surfacePiece(p), 0);
    const emprise = (maxX - minX).toFixed(1) + ' × ' + (maxY - minY).toFixed(1) + ' m';
    if (horsEcran) return;
    const conseil = modePlan === 'gommettes' ? 'touchez une fenêtre dans la liste puis le plan' : 'glissez une pièce pour l’ajuster';
    $('plan-msg').innerHTML = `Surface des pièces : <b>${total.toFixed(2)} m²</b><br><span style="font-size:12px;">Emprise ${emprise} · ${conseil}</span>`;
}
window.addEventListener('resize', debounce(() => { if (vueActive === 'pieces') dessinerPlanPieces(); }, 150));

/* --- Déplacement des pièces au doigt, avec aimantation --- */
function pointPlan(e) {
    const canvas = $('plan-canvas'); const r = canvas.getBoundingClientRect();
    if (!planVue) return null;
    return { x: planVue.minX + (e.clientX - r.left - planVue.dx) / planVue.ech, y: planVue.minY + (e.clientY - r.top - planVue.dy) / planVue.ech };
}
function brancherPlanPieces() {
    const canvas = $('plan-canvas'); if (!canvas) return;
    canvas.addEventListener('pointerdown', e => {
        const pt = pointPlan(e); if (!pt) return;
        if (modePlan === 'gommettes') {
            const unite = 1 / (planVue ? planVue.ech : 1);
            const sousLeDoigt = gommetteSous('pieces', pt, unite);
            if (sousLeDoigt) {
                gomSel = sousLeDoigt.id; gomArmee = null;
                gomDrag = { id: sousLeDoigt.id, dx: pt.x - sousLeDoigt.posPlan.x, dy: pt.y - sousLeDoigt.posPlan.y };
                canvas.setPointerCapture(e.pointerId);
                rafraichirGommettes('pieces');
            } else if (!poserGommette('pieces', pt)) { gomSel = null; rafraichirGommettes('pieces'); }
            return;
        }
        const trouvee = [...piecesCourantes()].reverse().find(p => { const d = dimsPiece(p); return pt.x >= p.x && pt.x <= p.x + d.w && pt.y >= p.y && pt.y <= p.y + d.h; });
        pieceSel = trouvee ? trouvee.id : null;
        if (trouvee) { planDrag = { id: trouvee.id, dx: pt.x - trouvee.x, dy: pt.y - trouvee.y }; canvas.setPointerCapture(e.pointerId); }
        dessinerPlanPieces(); renderElementsList('pieces');
    });
    canvas.addEventListener('pointermove', e => {
        const pt = pointPlan(e); if (!pt) return;
        if (gomDrag) {
            const o = trouverOuvrant(gomDrag.id); if (!o) return;
            o.posPlan = { x: pt.x - gomDrag.dx, y: pt.y - gomDrag.dy }; dessinerPlanPieces();
            return;
        }
        if (!planDrag) return;
        const p = piecesCourantes().find(x => x.id === planDrag.id); if (!p) return;
        p.x = aimanter(pt.x - planDrag.dx, p, 'x'); p.y = aimanter(pt.y - planDrag.dy, p, 'y');
        dessinerPlanPieces();
    });
    const fin = () => {
        if (gomDrag) {
            const o = trouverOuvrant(gomDrag.id);
            if (o && o.posPlan) rattacherAPieceSous(o, o.posPlan);   // la pièce suit le déplacement
            gomDrag = null; sauvegarderLocal(); rafraichirGommettes('pieces');
            renderElementsList('pieces');
            return;
        }
        if (planDrag) { planDrag = null; sauvegarderLocal(); dessinerPlanPieces(); }
    };
    canvas.addEventListener('pointerup', fin);
    canvas.addEventListener('pointercancel', fin);
}
// Aimante le bord de la pièce déplacée sur les bords des autres, sinon sur une trame de 5 cm.
function aimanter(valeur, piece, axe) {
    const SEUIL = 0.3;
    const d = dimsPiece(piece); const taille = axe === 'x' ? d.w : d.h;
    const bords = [];
    piecesCourantes().forEach(p => {
        if (p.id === piece.id) return;
        const dp = dimsPiece(p);
        bords.push(axe === 'x' ? p.x : p.y, axe === 'x' ? p.x + dp.w : p.y + dp.h);
    });
    let meilleur = null, ecart = SEUIL;
    bords.forEach(b => {
        [b, b - taille].forEach(cand => { const e = Math.abs(cand - valeur); if (e < ecart) { ecart = e; meilleur = cand; } });
    });
    return Math.round((meilleur !== null ? meilleur : valeur) * 20) / 20;
}

/* --- Rattachement d'un ouvrant à sa pièce ---
   Situer une fenêtre dans le séjour parle davantage que de la rattacher au mur
   nord. Poser sa gommette sur le plan suffit : la pièce sous le doigt est
   reconnue et retenue. Un identifiant devenu orphelin (pièce supprimée) est
   simplement ignoré, ce qui laisse l'annulation faire son travail. */
const pieceDe = o => o && o.pieceId ? db.pieces.find(p => String(p.id) === String(o.pieceId)) : null;
function peuplerPiecesDispo(selectId, valeur) {
    const sel = $(selectId); if (!sel) return;
    const liste = piecesCourantes();
    if (!liste.length) { sel.innerHTML = '<option value="">Aucune pièce saisie pour ce lot et ce niveau</option>'; return; }
    sel.innerHTML = '<option value="">— Aucune pièce associée —</option>' +
        liste.map(p => `<option value="${p.id}">${esc(p.nom || 'Pièce')} · ${surfacePiece(p).toFixed(1)} m²</option>`).join('');
    setSelect(selectId, valeur || '');
}
// Pièce contenant un point du plan assemblé (coordonnées en mètres).
function pieceSous(pt) {
    return [...piecesCourantes()].reverse().find(p => {
        if (p.x === undefined || p.y === undefined) return false;
        const d = dimsPiece(p);
        return pt.x >= p.x && pt.x <= p.x + d.w && pt.y >= p.y && pt.y <= p.y + d.h;
    }) || null;
}
// Surface vitrée d'une pièce : utile pour juger l'éclairement au regard du sol.
function surfaceVitreePiece(pieceId) {
    return db.fens.filter(f => String(f.pieceId) === String(pieceId)).reduce((s, f) => s + surfaceFen(f), 0);
}

/* --- Rattachement d'un ouvrant à son mur ---
   Une fenêtre ou une porte perce un mur : le lien permet de vérifier que les
   surfaces vitrées tiennent dans la façade, et de le rappeler à l'export. */
const mursCourants = () => db.murs.filter(m => m.aid === curAppt && (m.nivInt || 0) === curNivInt);
function libelleMur(m) {
    const surf = ((parseFloat(m.l) || 0) * (parseFloat(m.h) || 0)).toFixed(1);
    return `${m.ori || 'Sans orientation'} · ${m.l || '?'}×${m.h || '?'} m (${surf} m²) · ${getShortMat(m.mat)}`;
}
function peuplerMursDispo(selectId, valeur) {
    const sel = $(selectId); if (!sel) return;
    const liste = mursCourants();
    sel.innerHTML = '<option value="">— Aucun mur associé —</option>' +
        liste.map(m => `<option value="${m.id}">${esc(libelleMur(m))}</option>`).join('');
    setSelect(selectId, valeur || '');
    if (!liste.length) sel.innerHTML = '<option value="">Aucun mur saisi pour ce lot et ce niveau</option>';
}
const murDe = o => o && o.murId ? db.murs.find(m => String(m.id) === String(o.murId)) : null;
// Surface des ouvrants rattachés à un mur, pour signaler un percement impossible.
function surfaceOuvrantsDuMur(murId, sauf) {
    let s = 0;
    db.fens.forEach(f => { if (String(f.murId) === String(murId) && f.id !== sauf) s += surfaceFen(f); });
    db.portes.forEach(p => { if (String(p.murId) === String(murId) && p.id !== sauf) s += (parseFloat(p.l) || 0) * (parseFloat(p.h) || 0); });
    return s;
}
function verifierPercement(mur, surfaceAjoutee, sauf) {
    if (!mur) return null;
    const surfMur = (parseFloat(mur.l) || 0) * (parseFloat(mur.h) || 0);
    if (surfMur <= 0) return null;
    const total = surfaceOuvrantsDuMur(mur.id, sauf) + surfaceAjoutee;
    return total > surfMur ? { total, surfMur } : null;
}

/* --- Gommettes : repérer les fenêtres sur un plan ---
   Chaque fenêtre peut porter deux repères, l'un sur le plan assemblé des pièces
   (en mètres), l'autre sur le plan décalqué (en pixels de l'image). Ils sont
   indépendants : un même lot peut être documenté sur les deux supports. */
let gomArmee = null;   // fenêtre en attente de pose
let gomSel = null;     // gommette sélectionnée
let gomDrag = null;
const CHAMP_GOM = { pieces: 'posPlan', calque: 'posCal' };

const fensCourantes = () => db.fens.filter(f => f.aid === curAppt && (f.nivInt || 0) === curNivInt);
const portesCourantes = () => db.portes.filter(p => p.aid === curAppt && (p.nivInt || 0) === curNivInt);
// Fenêtres et portes se repèrent de la même façon ; seul le libellé et la couleur diffèrent.
const ouvrantsCourants = () => [
    ...fensCourantes().map(f => ({ o: f, genre: 'fen' })),
    ...portesCourantes().map(p => ({ o: p, genre: 'porte' }))
];
const libelleOuvrant = (o, genre) => {
    if (genre === 'porte') return `${o.l || '?'}×${o.h || '?'} m${o.donne ? ' · ' + o.donne : ''}`;
    const dim = o.type === 'Hublot' ? `Ø${o.diam || '?'}` : `${o.l || '?'}×${o.h || '?'}`;
    return `${dim} cm${o.ori ? ' · ' + o.ori : ''}`;
};
const repereOuvrant = (o, genre) => o.nom || (genre === 'porte' ? 'P' + (db.portes.indexOf(o) + 1) : 'F?');
const trouverOuvrant = id => db.fens.find(f => String(f.id) === String(id)) || db.portes.find(p => String(p.id) === String(id)) || null;
const genreOuvrant = o => db.portes.includes(o) ? 'porte' : 'fen';

function renderPaletteGommettes(support) {
    const cont = $(support === 'pieces' ? 'plan-gommettes' : 'cal-gommettes'); if (!cont) return;
    const champ = CHAMP_GOM[support];
    const liste = ouvrantsCourants();
    if (!liste.length) {
        cont.innerHTML = `<div class="gom-aide">Aucune fenêtre ni porte saisie pour ce lot et ce niveau. Ajoutez-les dans Parois, elles apparaîtront ici.</div>`;
        return;
    }
    const posees = liste.filter(x => x.o[champ]).length;
    cont.innerHTML = `<div class="gom-aide" style="flex:0 0 100%;">${posees} / ${liste.length} posée(s) · touchez un ouvrant puis le plan${gomSel ? ' · <b>gommette sélectionnée : glissez-la ou retirez-la</b>' : ''}</div>` +
        liste.map(({ o, genre }) => {
            const etat = gomArmee === o.id ? 'armee' : (o[champ] ? 'posee' : '');
            return `<button type="button" class="gom-chip ${etat} ${genre === 'porte' ? 'porte' : ''}" data-act="gomChip" data-id="${o.id}" data-support="${support}">
                <span class="gom-rep">${esc(repereOuvrant(o, genre))}</span>${genre === 'porte' ? '🚪 ' : '🪟 '}${esc(libelleOuvrant(o, genre))}${o[champ] ? ' ✓' : ''}</button>`;
        }).join('') +
        (gomSel ? `<button type="button" class="gom-chip" style="border-color:#FECACA; background:var(--dan-l); color:var(--dan);" data-act="gomRetirer" data-support="${support}">❌ Retirer la gommette</button>` : '');
}
Actions.gomChip = d => {
    const support = d.support; const champ = CHAMP_GOM[support];
    const o = trouverOuvrant(d.id); if (!o) return;
    const rep = repereOuvrant(o, genreOuvrant(o));
    if (gomArmee === o.id) { gomArmee = null; }
    else if (o[champ]) { gomSel = o.id; gomArmee = null; toast(`${rep} sélectionné — glissez-le sur le plan`); }
    else { gomArmee = o.id; gomSel = null; toast(`Touchez le plan pour poser ${rep}`); }
    rafraichirGommettes(support);
};
Actions.gomRetirer = d => {
    const support = d.support; const champ = CHAMP_GOM[support];
    const o = trouverOuvrant(gomSel); if (!o) return;
    const ancienne = o[champ]; delete o[champ]; gomSel = null;
    sauvegarderLocal(); rafraichirGommettes(support);
    toastAnnuler(`Gommette ${repereOuvrant(o, genreOuvrant(o))} retirée`, () => { o[champ] = ancienne; sauvegarderLocal(); rafraichirGommettes(support); });
};
function rafraichirGommettes(support) {
    renderPaletteGommettes(support);
    if (support === 'pieces') dessinerPlanPieces(); else dessinerCalque();
}
// Pose ou déplacement, dans le repère du support (mètres ou pixels d'image)
function poserGommette(support, pt) {
    const champ = CHAMP_GOM[support];
    if (!gomArmee) return false;
    const o = trouverOuvrant(gomArmee); if (!o) return false;
    o[champ] = { x: pt.x, y: pt.y };
    gomSel = o.id; gomArmee = null;
    const piece = support === 'pieces' ? rattacherAPieceSous(o, pt) : null;
    sauvegarderLocal(); rafraichirGommettes(support);
    toast(`${repereOuvrant(o, genreOuvrant(o))} posé${piece ? ' dans « ' + piece.nom + ' »' : ''} ✓`);
    return true;
}
// La pastille est dessinée 24 px au-dessus de son point d'ancrage : c'est elle que
// le doigt vise, la zone sensible doit donc suivre le dessin. `unite` convertit un
// pixel écran dans le repère du support (mètres ou pixels d'image).
const DECALAGE_GOM = 24, RAYON_GOM = 20;
// Sur le plan des pièces, la gommette dit d'elle-même dans quelle pièce elle tombe.
function rattacherAPieceSous(o, pt) {
    const piece = pieceSous(pt);
    o.pieceId = piece ? piece.id : '';
    return piece;
}
function gommetteSous(support, pt, unite) {
    const champ = CHAMP_GOM[support];
    return ouvrantsCourants().map(x => x.o).filter(o => o[champ]).reverse().find(o => {
        const p = o[champ];
        const surPastille = Math.hypot(p.x - pt.x, p.y - DECALAGE_GOM * unite - pt.y) < RAYON_GOM * unite;
        const surPointe = Math.hypot(p.x - pt.x, p.y - pt.y) < 12 * unite;
        return surPastille || surPointe;
    }) || null;
}
// Dessin commun aux deux plans : versEcran convertit du repère du support vers l'écran.
function dessinerGommettes(ctx, support, versEcranFn) {
    const champ = CHAMP_GOM[support];
    ouvrantsCourants().forEach(({ o, genre }) => {
        const p = o[champ]; if (!p) return;
        const e = versEcranFn(p);
        const actif = gomSel === o.id;
        // Bleu pour les fenêtres, violet pour les portes ; orange quand sélectionné.
        const couleur = actif ? '#D97706' : (genre === 'porte' ? '#7C3AED' : '#2563EB');
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - 5, e.y - 13); ctx.lineTo(e.x + 5, e.y - 13); ctx.closePath();
        ctx.fillStyle = couleur; ctx.fill();
        ctx.beginPath(); ctx.arc(e.x, e.y - 24, 14, 0, 7);
        ctx.fillStyle = couleur; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText(String(repereOuvrant(o, genre)).slice(0, 4), e.x, e.y - 24);
    });
}

/* --- Contour extérieur de l'ensemble des pièces ---
   Grille non uniforme bâtie sur les arêtes des pièces : exacte, et petite.
   Chaque cellule occupée fournit ses arêtes de bord, que l'on chaîne en boucle. */
function contourPieces(pieces) {
    const placees = pieces.filter(p => p.x !== undefined && p.y !== undefined);
    if (!placees.length) return [];
    const xs = [...new Set(placees.flatMap(p => [p.x, p.x + dimsPiece(p).w]))].sort((a, b) => a - b);
    const ys = [...new Set(placees.flatMap(p => [p.y, p.y + dimsPiece(p).h]))].sort((a, b) => a - b);
    const nx = xs.length - 1, ny = ys.length - 1;
    if (nx < 1 || ny < 1) return [];
    const couvert = (i, j) => {
        if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
        const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        return placees.some(p => { const d = dimsPiece(p); return cx > p.x && cx < p.x + d.w && cy > p.y && cy < p.y + d.h; });
    };
    const cle = p => p.x.toFixed(3) + ';' + p.y.toFixed(3);
    const depuis = new Map();
    const ajouter = (a, b) => { const k = cle(a); if (!depuis.has(k)) depuis.set(k, []); depuis.get(k).push(b); };
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        if (!couvert(i, j)) continue;
        const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
        if (!couvert(i, j - 1)) ajouter({ x: x0, y: y0 }, { x: x1, y: y0 });
        if (!couvert(i + 1, j)) ajouter({ x: x1, y: y0 }, { x: x1, y: y1 });
        if (!couvert(i, j + 1)) ajouter({ x: x1, y: y1 }, { x: x0, y: y1 });
        if (!couvert(i - 1, j)) ajouter({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
    // Chaînage en boucles ; on garde la plus longue (le contour extérieur).
    const boucles = [];
    const restant = new Map([...depuis].map(([k, v]) => [k, [...v]]));
    for (const depart of [...restant.keys()]) {
        while ((restant.get(depart) || []).length) {
            const boucle = []; let courant = depart; let garde = 0;
            while (garde++ < 20000) {
                const suites = restant.get(courant);
                if (!suites || !suites.length) break;
                const suivant = suites.shift();
                boucle.push(suivant);
                courant = cle(suivant);
                if (courant === depart) break;
            }
            if (boucle.length > 2) boucles.push(boucle);
        }
    }
    if (!boucles.length) return [];
    const perim = b => b.reduce((s, p, i) => s + Math.hypot(p.x - b[(i + 1) % b.length].x, p.y - b[(i + 1) % b.length].y), 0);
    const boucle = boucles.sort((a, b) => perim(b) - perim(a))[0];
    // Suppression des points alignés
    const simple = [];
    for (let i = 0; i < boucle.length; i++) {
        const a = boucle[(i - 1 + boucle.length) % boucle.length], b = boucle[i], c = boucle[(i + 1) % boucle.length];
        const colineaire = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-6;
        if (!colineaire) simple.push(b);
    }
    return simple.length > 2 ? simple : boucle;
}

/* --- Actions du plan --- */
function appliquerSurfacePieces() {
    const liste = piecesCourantes();
    if (!liste.length) { toast('Aucune pièce saisie'); return; }
    const total = liste.reduce((s, p) => s + surfacePiece(p), 0);
    if (curAppt === 'copro') {
        db.copro.surfcommuns = total.toFixed(2);
        const input = $('copro-surfcommuns'); if (input) input.value = db.copro.surfcommuns;
        sauvegarderLocal(); updateDashboard(); toast(`Surface (${total.toFixed(2)} m²) affectée aux parties communes ✓`);
        return;
    }
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return;
    apt.surfs = apt.surfs || {}; apt.surfs[curNivInt] = total;
    apt.surf = Object.values(apt.surfs).reduce((s, v) => s + v, 0).toFixed(1);
    sauvegarderLocal(); renderApptsList(); updateDashboard();
    toast(`Surface N${curNivInt} (${total.toFixed(2)} m²) appliquée au lot ${apt.num} · total ${apt.surf} m²`);
}
async function enregistrerPlanPieces() {
    const canvas = $('plan-canvas');
    if (!canvas || !piecesCourantes().length) { toast('Aucun plan à enregistrer'); return; }
    const b64 = canvas.toDataURL('image/png');
    if (curAppt === 'copro') {
        await upsertDoc('Plan_Copro_PartiesCommunes.png', b64);
        sauvegarderLocal(); renderDocs(); toast('Plan des parties communes enregistré 📁'); return;
    }
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return;
    apt.plans = apt.plans || {};
    apt.plans[curNivInt] = await upsertDoc(`Plan_${apt.num}_N${curNivInt}.png`, b64);
    sauvegarderLocal(); renderDocs(); renderApptsList();
    toast(`Plan du lot ${apt.num} enregistré 📁`);
}
async function genererMursDepuisPieces() {
    const liste = piecesCourantes();
    const contour = contourPieces(liste);
    if (contour.length < 3) { toast('Assemblez au moins deux pièces pour tracer un contour'); return; }
    const apt = db.appts.find(a => a.id === curAppt);
    const hauteur = (apt && apt.hsp) || $('m-h').value || '';
    if (!await Dialogue.confirmer({
        titre: 'Générer les murs de façade',
        message: `${contour.length} mur(s) seront créés à partir du contour extérieur des pièces${hauteur ? `, avec une hauteur de ${hauteur} m` : ''}.\n\nLeur matériau et leur isolation restent à compléter.`,
        ok: 'Générer'
    })) return;
    const crees = creerMursDepuisContour(contour, hauteur);
    toast(`${crees} mur(s) de façade générés — complétez matériau et isolation ✏️`);
}
// Fabrique un mur par segment du contour, en conservant le vecteur pour que
// le croquis redessine exactement la forme relevée.
function creerMursDepuisContour(contour, hauteur) {
    let n = 0;
    for (let i = 0; i < contour.length; i++) {
        const a = contour[i], b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const l = Math.hypot(dx, dy);
        if (l < 0.05) continue;
        const ori = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'Nord' : 'Sud') : (dy >= 0 ? 'Est' : 'Ouest');
        db.murs.push({ id: Date.now() + Math.random(), aid: curAppt, nivInt: curNivInt, ori, donne: 'Extérieur', mat: 'Inconnu', l: l.toFixed(2), h: String(hauteur || ''), ep: '', iso: 'Non', isoEp: '', doub: 'ABSENT', vectX: dx, vectY: dy });
        n++;
    }
    sauvegarderLocal(); updateDashboard();
    if (curAppt !== 'copro') updateApptBadges(curAppt);
    return n;
}

/* ==========================================================================
   7 ter. CALQUE SUR UN PLAN EXISTANT
   Le plan du syndic (PDF ou photo) sert de fond : on donne l'échelle en
   pointant une cote connue, puis on suit le contour au doigt. Surface,
   périmètre et murs de façade en découlent.
   Les points sont stockés en pixels de l'image ; l'échelle est en mètres/pixel.
   ========================================================================== */
let cal = { media: null, img: null, echelle: 0, pts: [], mesures: [], calib: [], ref: null, gabarit: null, mode: 'tracer', zoom: 1, ox: 0, oy: 0, pdfDoc: null, page: 1, nbPages: 1 };
let calGab = null;   // déplacement ou redimensionnement du gabarit en cours
let calPointers = new Map(), calDrag = null, calPinch = null;

const cleCalque = () => `${curAppt || 'copro'}_${curNivInt}`;

function ouvrirCalque() {
    renderCibleCalque();
    chargerEtatCalque();
}
function renderCibleCalque() {
    const sel = $('cal-target'); if (!sel) return;
    let html = `<option value="copro">🏢 Copropriété (Parties Communes)</option>`;
    db.appts.forEach(a => { const t = a.type === 2 ? ' (Duplex)' : a.type === 3 ? ' (Triplex)' : ''; html += `<option value="${a.id}">Lot : ${esc(a.num)}${t}</option>`; });
    sel.innerHTML = html;
    if (!curAppt || (curAppt !== 'copro' && !db.appts.some(a => a.id === curAppt))) curAppt = 'copro';
    sel.value = curAppt;
    const nivCont = $('cal-niv-container'); if (!nivCont) return;
    const apt = db.appts.find(a => a.id === curAppt);
    if (apt && apt.type > 1) {
        let html2 = '<div class="niv-row">';
        for (let i = 0; i < apt.type; i++) {
            const lbl = i === 0 ? 'Niveau Bas' : i === 1 ? (apt.type === 3 ? 'Niveau Inter.' : 'Niveau Haut') : 'Niveau Haut';
            html2 += `<button class="niv-btn ${curNivInt === i ? 'niv-on' : 'niv-off'}" data-act="calNiv" data-i="${i}">${lbl}</button>`;
        }
        nivCont.innerHTML = html2 + '</div>';
    } else { curNivInt = 0; nivCont.innerHTML = ''; }
}
Actions.calNiv = d => { curNivInt = parseInt(d.i); renderCibleCalque(); chargerEtatCalque(); };
function changerCibleCalque(val) { curAppt = val; curNivInt = 0; renderCibleCalque(); chargerEtatCalque(); }

function chargerEtatCalque() {
    const etat = db.calques[cleCalque()];
    cal.pts = []; cal.mesures = []; cal.calib = []; cal.ref = null; cal.gabarit = null; cal.echelle = 0; cal.img = null; cal.media = null; cal.mode = 'tracer';
    cal.zoom = 1; cal.ox = 0; cal.oy = 0; cal.pdfDoc = null; cal.page = 1; cal.nbPages = 1; cal.chargement = false;
    if (etat && etat.media) {
        cal.media = etat.media; cal.echelle = etat.echelle || 0; cal.pts = (etat.pts || []).map(p => ({ ...p }));
        cal.mesures = (etat.mesures || []).map(m => ({ ...m })); cal.ref = etat.ref || null; cal.gabarit = etat.gabarit ? migrerGabarit({ ...etat.gabarit }) : null;
        const src = Medias.src(etat.media);
        if (src) {
            // Le décodage de l'image est asynchrone : on l'annonce, sinon l'écran
            // afficherait « aucun plan » alors que l'échelle et le tracé sont là.
            cal.chargement = true;
            const img = new Image();
            img.onload = () => { cal.img = img; cal.chargement = false; recentrerCalque(); majInterfaceCalque(); };
            img.onerror = () => { cal.chargement = false; majInterfaceCalque(); toast('⚠️ Plan du calque introuvable'); };
            img.src = src;
        }
    }
    majInterfaceCalque(); dessinerCalque();
}
function sauverEtatCalque() {
    if (!cal.media) { delete db.calques[cleCalque()]; }
    else db.calques[cleCalque()] = { media: cal.media, echelle: cal.echelle, ref: cal.ref, gabarit: cal.gabarit ? { ...cal.gabarit } : null, pts: cal.pts.map(p => ({ ...p })), mesures: cal.mesures.map(m => ({ ...m })) };
    sauvegarderLocal();
}

/* --- Chargement d'un plan : PDF (via pdf.js) ou photo --- */
function chargerPlanCalque() { Plateforme.demanderFichier('calque-uploader'); }
function brancherCalque() {
    const input = $('calque-uploader');
    if (input) input.onchange = async e => {
        const file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        try {
            if (file.type === 'application/pdf') await chargerPdfCalque(file);
            else await chargerImageCalque(file);
        } catch (err) {
            console.error('Plan illisible', err);
            toast('⚠️ Plan illisible : ' + (err.message || 'format non pris en charge'), { duree: 5000 });
        }
    };
    const canvas = $('calque-canvas'); if (!canvas) return;
    canvas.addEventListener('pointerdown', calPointerDown);
    canvas.addEventListener('pointermove', calPointerMove);
    canvas.addEventListener('pointerup', calPointerUp);
    canvas.addEventListener('pointercancel', calPointerUp);
    window.addEventListener('resize', debounce(() => { if (vueActive === 'calque') dessinerCalque(); }, 150));
}
async function chargerImageCalque(file) {
    const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataURL; });
    // Redimensionnement : au-delà de 2000 px, le confort de tracé ne gagne rien et la mémoire souffre.
    const MAX = 2000; const ech = Math.min(1, MAX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * ech); c.height = Math.round(img.height * ech);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    await poserImageCalque(c.toDataURL('image/jpeg', 0.85));
    toast('Plan chargé — calibrez sur une cote connue 📏');
}
async function chargerPdfCalque(file) {
    if (!await assurerLib('pdfjsLib', 'lib/pdf.min.js')) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    cal.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    cal.nbPages = cal.pdfDoc.numPages; cal.page = 1;
    await rendrePagePdf();
    toast(cal.nbPages > 1 ? `Plan chargé (page 1 sur ${cal.nbPages}) — calibrez 📏` : 'Plan chargé — calibrez sur une cote connue 📏');
}
async function rendrePagePdf() {
    const page = await cal.pdfDoc.getPage(cal.page);
    const base = page.getViewport({ scale: 1 });
    const ech = Math.min(2200 / Math.max(base.width, base.height), 3);
    const viewport = page.getViewport({ scale: ech });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    await poserImageCalque(c.toDataURL('image/jpeg', 0.9));
}
async function poserImageCalque(dataURL) {
    if (cal.media) await Medias.supprimer(cal.media);
    cal.media = await Medias.ajouter(dataURL);
    cal.pts = []; cal.mesures = []; cal.calib = []; cal.ref = null; cal.gabarit = null; cal.echelle = 0; cal.mode = 'calibrer';
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = Medias.src(cal.media); });
    cal.img = img;
    recentrerCalque(); sauverEtatCalque(); majInterfaceCalque();
}
async function pageSuivanteCalque() {
    if (!cal.pdfDoc) { toast('Rechargez le PDF pour changer de page'); return; }
    cal.page = cal.page % cal.nbPages + 1;
    await rendrePagePdf();
    toast(`Page ${cal.page} sur ${cal.nbPages}`);
}

/* --- Repère : conversion écran ↔ pixels de l'image --- */
function tailleCalque() { const c = $('calque-canvas'); const r = c.getBoundingClientRect(); return { w: r.width || 340, h: r.height || 380, r }; }
function recentrerCalque() {
    if (!cal.img) return;
    const { w, h } = tailleCalque();
    cal.zoom = Math.min(w / cal.img.width, h / cal.img.height);
    cal.ox = (w - cal.img.width * cal.zoom) / 2;
    cal.oy = (h - cal.img.height * cal.zoom) / 2;
    dessinerCalque();
}
function zoomCalque(facteur, cx, cy) {
    if (!cal.img) return;
    const { w, h } = tailleCalque();
    if (cx === undefined) { cx = w / 2; cy = h / 2; }
    const avant = cal.zoom;
    cal.zoom = Math.max(0.05, Math.min(cal.zoom * facteur, 30));
    const k = cal.zoom / avant;
    cal.ox = cx - (cx - cal.ox) * k; cal.oy = cy - (cy - cal.oy) * k;
    dessinerCalque();
}
const versImage = (sx, sy) => ({ x: (sx - cal.ox) / cal.zoom, y: (sy - cal.oy) / cal.zoom });
const versEcran = p => ({ x: p.x * cal.zoom + cal.ox, y: p.y * cal.zoom + cal.oy });

function calPointerDown(e) {
    if (!cal.img) return;
    const { r } = tailleCalque();
    calPointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    $('calque-canvas').setPointerCapture(e.pointerId);
    if (calPointers.size === 2) {
        const [a, b] = [...calPointers.values()];
        calPinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
        calDrag = null;
    } else if (calPointers.size === 1) {
        const pos = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (cal.mode === 'gommettes') {
            const p = versImage(pos.x, pos.y);
            const sousLeDoigt = gommetteSous('calque', p, 1 / cal.zoom);
            if (sousLeDoigt) {
                gomSel = sousLeDoigt.id; gomArmee = null;
                gomDrag = { id: sousLeDoigt.id, dx: p.x - sousLeDoigt.posCal.x, dy: p.y - sousLeDoigt.posCal.y };
                calDrag = null;
                rafraichirGommettes('calque');
                return;
            }
        }
        if (cal.mode === 'caler' && cal.gabarit) {
            const p = versImage(pos.x, pos.y); const d = dimsGabarit(); const g = cal.gabarit;
            const tol = 26 / cal.zoom;
            const l = gabaritVersLocal(p);
            if (Math.hypot(l.x, l.y + d.h / 2 + 36 / cal.zoom) < tol) { calGab = { type: 'tourner' }; calDrag = null; return; }
            if (Math.hypot(l.x - d.w / 2, l.y - d.h / 2) < tol) { calGab = { type: 'coin', ancre: gabaritVersImage(-d.w / 2, -d.h / 2) }; calDrag = null; return; }
            if (Math.abs(l.x) <= d.w / 2 && Math.abs(l.y) <= d.h / 2) { calGab = { type: 'deplacer', dx: p.x - g.cx, dy: p.y - g.cy }; calDrag = null; return; }
        }
        calDrag = { depart: pos, bouge: false, ox: cal.ox, oy: cal.oy };
    }
}
function calPointerMove(e) {
    if (!cal.img || !calPointers.has(e.pointerId)) return;
    const { r } = tailleCalque();
    const pos = { x: e.clientX - r.left, y: e.clientY - r.top };
    calPointers.set(e.pointerId, pos);
    if (calPinch && calPointers.size === 2) {
        const [a, b] = [...calPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (calPinch.dist > 4) zoomCalque(d / calPinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        calPinch.dist = d;
        return;
    }
    if (gomDrag) {
        const o = trouverOuvrant(gomDrag.id);
        if (o) { const p = versImage(pos.x, pos.y); o.posCal = { x: p.x - gomDrag.dx, y: p.y - gomDrag.dy }; dessinerCalque(); }
        return;
    }
    if (calGab && cal.gabarit) {
        const p = versImage(pos.x, pos.y); const g = cal.gabarit;
        if (calGab.type === 'deplacer') { g.cx = p.x - calGab.dx; g.cy = p.y - calGab.dy; }
        else if (calGab.type === 'tourner') {
            // La poignée se tient au-dessus du rectangle : d'où le quart de tour ajouté.
            let a = Math.atan2(p.y - g.cy, p.x - g.cx) / RAD + 90;
            a = (a % 360 + 360) % 360;
            const droit = Math.round(a / 90) * 90;
            if (Math.abs(a - droit) < 2.5) a = droit % 360;   // aimantation sur les axes du plan
            g.ang = Math.round(a * 2) / 2;
        } else {
            // Coin tiré : l'angle opposé reste fixe, les proportions suivent le relevé.
            const { ux, uy, vx, vy } = axesGabarit();
            const nw = Math.max(12 / cal.zoom, (p.x - calGab.ancre.x) * ux + (p.y - calGab.ancre.y) * uy);
            const nh = nw * (+g.larg / +g.l);
            g.w = nw;
            g.cx = calGab.ancre.x + (nw / 2) * ux + (nh / 2) * vx;
            g.cy = calGab.ancre.y + (nw / 2) * uy + (nh / 2) * vy;
        }
        majInterfaceCalque(); dessinerCalque();
        return;
    }
    if (!calDrag) return;
    const dx = pos.x - calDrag.depart.x, dy = pos.y - calDrag.depart.y;
    // Au-delà de 8 px, le geste est un déplacement, pas un pointage.
    if (!calDrag.bouge && Math.hypot(dx, dy) > 8) calDrag.bouge = true;
    if (calDrag.bouge) { cal.ox = calDrag.ox + dx; cal.oy = calDrag.oy + dy; dessinerCalque(); }
}
function calPointerUp(e) {
    calPointers.delete(e.pointerId);
    if (calPointers.size < 2) calPinch = null;
    if (gomDrag) { gomDrag = null; sauvegarderLocal(); rafraichirGommettes('calque'); return; }
    if (calGab) { calGab = null; sauverEtatCalque(); return; }
    if (!calDrag) return;
    const drag = calDrag; calDrag = null;
    if (drag.bouge || !cal.img) return;
    poserPointCalque(versImage(drag.depart.x, drag.depart.y));
}
async function poserPointCalque(p) {
    if (cal.mode === 'gommettes') {
        if (!poserGommette('calque', p)) { gomSel = null; rafraichirGommettes('calque'); }
        return;
    }
    if (cal.mode === 'calibrer') {
        cal.calib.push(p);
        dessinerCalque();
        if (cal.calib.length === 2) {
            const pix = Math.hypot(cal.calib[1].x - cal.calib[0].x, cal.calib[1].y - cal.calib[0].y);
            const rep = await Dialogue.formulaire({
                titre: 'Calibrer le plan',
                message: 'Saisissez la longueur relevée sur le terrain entre les deux points pointés. Cette échelle sera conservée avec le plan.',
                champs: [
                    { id: 'm', label: 'Longueur mesurée (m)', type: 'number', placeholder: 'ex : 12.45' },
                    { id: 'lib', label: 'Sur quoi (facultatif)', type: 'text', placeholder: 'ex : façade sud au télémètre' }
                ], ok: 'Enregistrer l’échelle'
            });
            const m = rep && parseFloat(rep.m);
            if (m > 0 && pix > 2) {
                cal.echelle = m / pix;
                cal.ref = { metres: m, pixels: pix, libelle: (rep.lib || '').trim(), date: new Date().toISOString().slice(0, 10) };
                cal.mode = 'tracer';
                toast(`Échelle enregistrée sur ${m} m ✓`, { duree: 3500 });
                sauverEtatCalque();
            } else { toast('Calibrage abandonné'); }
            cal.calib = [];
            majInterfaceCalque();
        }
        dessinerCalque();
        return;
    }
    if (cal.mode === 'mesurer') {
        cal.calib.push(p);
        dessinerCalque();
        if (cal.calib.length === 2) {
            const pix = Math.hypot(cal.calib[1].x - cal.calib[0].x, cal.calib[1].y - cal.calib[0].y);
            const longueur = pix * cal.echelle;
            const rep = await Dialogue.formulaire({
                titre: `Cote relevée : ${longueur.toFixed(2)} m`,
                message: 'Donnez-lui un nom pour la retrouver au bureau.',
                champs: [{ id: 'nom', label: 'Nom de la cote', type: 'text', placeholder: 'ex : façade nord' }],
                ok: 'Enregistrer la cote'
            });
            if (rep) {
                cal.mesures.push({ id: Date.now() + Math.random(), a: { ...cal.calib[0] }, b: { ...cal.calib[1] }, nom: (rep.nom || '').trim() || `Cote ${cal.mesures.length + 1}`, m: +longueur.toFixed(3) });
                sauverEtatCalque();
                toast(`Cote enregistrée : ${longueur.toFixed(2)} m ✓`);
            }
            cal.calib = [];
            majInterfaceCalque();
        }
        dessinerCalque();
        return;
    }
    cal.pts.push(p);
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}
async function lancerCalibrage() {
    if (!cal.img) { toast('Chargez d’abord un plan'); return; }
    const pieces = piecesCourantes();
    if (pieces.length) {
        const methode = await Dialogue.choisir({
            titre: 'Calibrer le plan',
            message: 'Caler une pièce déjà mesurée vérifie du même coup le plan et votre relevé : si le rectangle épouse la pièce, les deux concordent.',
            options: [
                { value: 'piece', label: '🔲 Caler une pièce mesurée' },
                { value: 'deux', label: '📏 Pointer deux points' }
            ], valeur: 'piece', ok: 'Continuer'
        });
        if (!methode) return;
        if (methode === 'piece') return demarrerGabarit();
    }
    calibrageDeuxPoints();
}
function calibrageDeuxPoints() {
    cal.mode = 'calibrer'; cal.calib = [];
    toast('Pointez les deux extrémités de la cote mesurée sur le terrain', { duree: 4500 });
    majInterfaceCalque(); dessinerCalque();
}

/* --- Gabarit : le rectangle coté d'une pièce relevée, posé sur le plan ---
   Ses proportions sont figées par les cotes du terrain ; le redimensionner
   revient à régler l'échelle du plan, et son ajustement vaut vérification. */
const RAD = Math.PI / 180;
const dimsGabarit = () => {
    const g = cal.gabarit; if (!g) return null;
    // Le rectangle porte toujours la longueur sur son axe local x : l'incliner ne
    // change donc pas l'échelle, seulement son orientation sur le plan.
    return { w: g.w, h: g.w * (+g.larg / +g.l), mL: +g.l, mH: +g.larg };
};
const echelleGabarit = () => { const d = dimsGabarit(); return d && d.w > 0 ? d.mL / d.w : 0; };
// Repère propre au rectangle : origine au centre, axe x le long de la longueur.
const gabaritVersLocal = p => {
    const g = cal.gabarit; const a = -(g.ang || 0) * RAD;
    const dx = p.x - g.cx, dy = p.y - g.cy;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
};
const gabaritVersImage = (lx, ly) => {
    const g = cal.gabarit; const a = (g.ang || 0) * RAD;
    return { x: g.cx + lx * Math.cos(a) - ly * Math.sin(a), y: g.cy + lx * Math.sin(a) + ly * Math.cos(a) };
};
const axesGabarit = () => { const a = (cal.gabarit.ang || 0) * RAD; return { ux: Math.cos(a), uy: Math.sin(a), vx: -Math.sin(a), vy: Math.cos(a) }; };
// Gabarits enregistrés avant la rotation libre : coin haut-gauche et bascule 0/90.
function migrerGabarit(g) {
    if (!g || g.cx !== undefined) return g;
    const mL = g.rot ? +g.larg : +g.l, mH = g.rot ? +g.l : +g.larg;
    const h = g.w * (mH / mL);
    return { pieceId: g.pieceId, nom: g.nom, l: +g.l, larg: +g.larg, ang: g.rot ? 90 : 0,
             w: g.rot ? g.w * (+g.l / +g.larg) : g.w, cx: g.x + g.w / 2, cy: g.y + h / 2 };
}

async function demarrerGabarit() {
    const pieces = piecesCourantes();
    if (!pieces.length) { toast('Saisissez d’abord les pièces du lot (Dossier › Pièces)', { duree: 4000 }); return; }
    const choix = await Dialogue.choisir({
        titre: 'Quelle pièce caler ?',
        message: 'Son rectangle apparaîtra sur le plan : posez-le sur la pièce correspondante, puis ajustez le coin.',
        options: pieces.map(p => ({ value: String(p.id), label: `${p.nom} — ${(+p.l).toFixed(2)} × ${(+p.larg).toFixed(2)} m` })),
        ok: 'Poser le rectangle'
    });
    if (!choix) return;
    const p = pieces.find(x => String(x.id) === choix); if (!p) return;
    const { w, h } = tailleCalque();
    const centre = versImage(w / 2, h / 2);
    const largeurPx = (w * 0.45) / cal.zoom;
    cal.gabarit = { pieceId: p.id, nom: p.nom, l: +p.l, larg: +p.larg, ang: 0, w: largeurPx, cx: centre.x, cy: centre.y };
    cal.mode = 'caler'; cal.calib = [];
    majInterfaceCalque(); dessinerCalque();
    toast('Glissez le rectangle, tirez son coin pour l’ajuster, sa poignée haute pour l’incliner', { duree: 5500 });
}
function pivoterGabarit() {
    if (!cal.gabarit) return;
    cal.gabarit.ang = ((cal.gabarit.ang || 0) + 90) % 360;
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}
function redresserGabarit() {
    if (!cal.gabarit) return;
    cal.gabarit.ang = Math.round((cal.gabarit.ang || 0) / 90) * 90 % 360;
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
    toast('Rectangle redressé sur les axes du plan');
}
function annulerGabarit() {
    cal.gabarit = null; cal.mode = cal.echelle ? 'tracer' : 'calibrer';
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
    toast('Calage abandonné');
}
function validerGabarit() {
    const ech = echelleGabarit();
    if (!ech) { toast('Posez d’abord un rectangle'); return; }
    const g = cal.gabarit;
    const avant = cal.echelle;
    cal.echelle = ech;
    cal.ref = { metres: +g.l, pixels: dimsGabarit().w, libelle: `la pièce ${g.nom} (${(+g.l).toFixed(2)} × ${(+g.larg).toFixed(2)} m)`, piece: g.pieceId, date: new Date().toISOString().slice(0, 10) };
    cal.mode = 'tracer';
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
    // Comparer à l'échelle précédente met en évidence un plan ou un relevé douteux.
    if (avant > 0) {
        const ecart = (ech - avant) / avant * 100;
        toast(`Échelle calée sur ${g.nom} ✓ ${Math.abs(ecart) < 0.5 ? 'identique à la précédente' : `écart de ${ecart > 0 ? '+' : ''}${ecart.toFixed(1)} % avec la précédente`}`, { duree: 5000 });
    } else {
        toast(`Échelle calée sur la pièce ${g.nom} ✓`, { duree: 4000 });
    }
}
function basculerModeCalque(mode) {
    if (!cal.img) { toast('Chargez d’abord un plan'); return; }
    if (mode === 'mesurer' && !cal.echelle) { toast('Calibrez d’abord le plan 📏'); lancerCalibrage(); return; }
    cal.mode = mode; cal.calib = []; gomArmee = null; gomSel = null;
    const messages = {
        mesurer: 'Pointez les deux extrémités de la cote à relever',
        tracer: 'Touchez les angles du lot pour tracer son contour',
        gommettes: 'Touchez une fenêtre dans la liste puis le plan pour la repérer'
    };
    toast(messages[mode] || '', { duree: 3000 });
    majInterfaceCalque(); dessinerCalque();
}
function renderMesuresCalque() {
    const cont = $('cal-mesures'); const card = $('cal-mesures-card'); if (!cont || !card) return;
    card.hidden = !cal.mesures.length;
    const info = $('cal-mesures-info');
    if (info) info.textContent = cal.mesures.length ? `${cal.mesures.length} cote(s)` : '';
    cont.innerHTML = cal.mesures.map(m => `
        <div class="cal-mesure-ligne">
            <span class="cal-mesure-nom">${esc(m.nom)}</span>
            <span class="cal-mesure-val">${(+m.m).toFixed(2)} m</span>
            <button class="ico-btn dan" title="Supprimer" data-act="suppMesure" data-id="${m.id}">❌</button>
        </div>`).join('');
}
Actions.suppMesure = d => {
    const idx = cal.mesures.findIndex(m => String(m.id) === String(d.id)); if (idx < 0) return;
    const item = cal.mesures[idx]; cal.mesures.splice(idx, 1);
    sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
    toastAnnuler(`Cote « ${item.nom} » supprimée`, () => { cal.mesures.splice(idx, 0, item); sauverEtatCalque(); majInterfaceCalque(); dessinerCalque(); });
};
// Le même plan sert souvent à plusieurs lots : on le reprend avec son échelle.
async function reprendrePlanExistant() {
    const options = [];
    Object.entries(db.calques).forEach(([cle, etat]) => {
        if (!etat.media || cle === cleCalque()) return;
        if (options.some(o => o.media === etat.media)) return;
        const [aid, niv] = cle.split('_');
        const apt = db.appts.find(a => a.id === aid);
        const ou = aid === 'copro' ? 'parties communes' : (apt ? `lot ${apt.num}` : 'lot supprimé');
        const ech = etat.echelle ? `échelle réglée${etat.ref && etat.ref.libelle ? ' sur ' + etat.ref.libelle : ''}` : 'sans échelle';
        options.push({ value: cle, media: etat.media, label: `Plan du ${ou} · N${niv} — ${ech}` });
    });
    if (!options.length) { toast('Aucun autre plan chargé dans ce dossier'); return; }
    const choix = await Dialogue.choisir({ titre: 'Reprendre un plan', message: 'Le plan et son échelle seront repris pour la cible en cours. Votre tracé reste propre à chaque lot.', options: options.map(o => ({ value: o.value, label: o.label })), ok: 'Reprendre' });
    if (!choix) return;
    const src = db.calques[choix]; if (!src) return;
    cal.media = src.media; cal.echelle = src.echelle || 0; cal.ref = src.ref || null;
    cal.pts = []; cal.mesures = []; cal.calib = []; cal.mode = cal.echelle ? 'tracer' : 'calibrer';
    cal.chargement = true; majInterfaceCalque();
    const img = new Image();
    img.onload = () => { cal.img = img; cal.chargement = false; recentrerCalque(); majInterfaceCalque(); };
    img.onerror = () => { cal.chargement = false; majInterfaceCalque(); toast('⚠️ Plan introuvable'); };
    img.src = Medias.src(cal.media);
    sauverEtatCalque();
    toast(cal.echelle ? 'Plan et échelle repris ✓' : 'Plan repris — il reste à calibrer');
}
function annulerDernierPoint() {
    if (cal.mode === 'calibrer' && cal.calib.length) { cal.calib.pop(); dessinerCalque(); return; }
    if (!cal.pts.length) { toast('Aucun point à annuler'); return; }
    cal.pts.pop(); sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}
async function effacerTrace() {
    if (!cal.pts.length) return;
    if (!await Dialogue.confirmer({ titre: 'Effacer le tracé ?', message: 'Les points du contour seront supprimés. Le plan et l’échelle sont conservés.', ok: 'Effacer', danger: true })) return;
    cal.pts = []; sauverEtatCalque(); majInterfaceCalque(); dessinerCalque();
}

/* --- Mesures --- */
function surfaceCalque() {
    if (cal.pts.length < 3 || !cal.echelle) return 0;
    let a = 0;
    for (let i = 0; i < cal.pts.length; i++) {
        const p = cal.pts[i], q = cal.pts[(i + 1) % cal.pts.length];
        a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2 * cal.echelle * cal.echelle;
}
function perimetreCalque() {
    if (cal.pts.length < 2 || !cal.echelle) return 0;
    let l = 0;
    for (let i = 0; i < cal.pts.length; i++) {
        const p = cal.pts[i], q = cal.pts[(i + 1) % cal.pts.length];
        if (i === cal.pts.length - 1 && cal.pts.length < 3) break;
        l += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return l * cal.echelle;
}

function majInterfaceCalque() {
    const aPlan = !!cal.img;
    const etapes = [
        { n: '1', lbl: 'Charger', faite: aPlan },
        { n: '2', lbl: 'Calibrer', faite: !!cal.echelle, active: aPlan && cal.mode === 'calibrer' },
        { n: '3', lbl: 'Tracer', faite: cal.pts.length > 2, active: aPlan && !!cal.echelle && cal.mode === 'tracer' }
    ];
    const cont = $('cal-etapes');
    if (cont) cont.innerHTML = etapes.map(e => `<div class="cal-etape ${e.active ? 'active' : e.faite ? 'faite' : ''}"><b>${e.faite && !e.active ? '✓' : e.n}</b>${e.lbl}</div>`).join('');
    const vide = $('cal-vide');
    if (vide) {
        vide.hidden = aPlan;
        const titre = vide.querySelector('div:nth-child(2)');
        if (titre) titre.textContent = cal.chargement ? 'Chargement du plan…' : 'Aucun plan chargé';
    }
    const barre = $('cal-barre'); if (barre) barre.hidden = !aPlan;
    const zoom = $('cal-zoom'); if (zoom) zoom.hidden = !aPlan;
    const btnPage = $('cal-btn-page'); if (btnPage) btnPage.hidden = !(cal.pdfDoc && cal.nbPages > 1);

    // Bandeau d'échelle : ce qu'elle vaut, et sur quoi elle a été calibrée.
    const bandeau = $('cal-echelle');
    if (bandeau) {
        bandeau.hidden = !aPlan;
        bandeau.classList.toggle('absente', !cal.echelle);
        if (aPlan) {
            if (cal.echelle) {
                const r = cal.ref;
                const quand = r && r.date ? ' le ' + r.date.split('-').reverse().join('/') : '';
                const origine = !r ? 'calibrage enregistré'
                    : r.piece ? `calée sur ${esc(r.libelle)}${quand}`
                    : `d’après ${r.metres} m relevés${r.libelle ? ' sur ' + esc(r.libelle) : ''}${quand}`;
                // Largeur totale du plan : un repère vérifiable d'un coup d'œil,
                // qui trahit tout de suite un calibrage faux d'un facteur dix.
                const largeur = cal.img ? ` · le plan couvre ${(cal.img.width * cal.echelle).toFixed(1)} m de large` : '';
                bandeau.innerHTML = `<div class="cal-ech-txt"><b>Échelle conservée</b><small>${origine}${largeur}</small></div><button onclick="lancerCalibrage()">Recalibrer</button>`;
            } else {
                bandeau.innerHTML = `<div class="cal-ech-txt"><b>Échelle à régler</b><small>Pointez une cote mesurée sur le terrain : l’échelle restera attachée à ce plan.</small></div><button onclick="lancerCalibrage()">Calibrer</button>`;
            }
        }
    }
    const gb = $('cal-gabarit-barre');
    if (gb) gb.hidden = !(aPlan && cal.mode === 'caler' && cal.gabarit);
    const modes = $('cal-modes');
    if (modes) {
        modes.hidden = !aPlan || cal.mode === 'caler';
        const bm = $('cal-mode-mesurer'), bt = $('cal-mode-tracer'), bg = $('cal-mode-gommettes');
        if (bm) bm.classList.toggle('on', cal.mode === 'mesurer');
        if (bt) bt.classList.toggle('on', cal.mode === 'tracer');
        if (bg) bg.classList.toggle('on', cal.mode === 'gommettes');
    }
    const palGom = $('cal-gommettes');
    if (palGom) {
        palGom.hidden = !(aPlan && cal.mode === 'gommettes');
        if (!palGom.hidden) renderPaletteGommettes('calque');
    }
    renderMesuresCalque();

    const res = $('cal-resultat'); const act = $('cal-actions');
    // Le plan s'enregistre dès qu'il y a quelque chose à conserver : une cote suffit.
    const pret = aPlan && (cal.pts.length > 2 || cal.mesures.length > 0);
    if (res) {
        res.hidden = !aPlan;
        if (aPlan) {
            // Le repérage des fenêtres ne dépend pas de l'échelle : il passe en premier.
            if (cal.mode === 'gommettes') {
                const champ = CHAMP_GOM.calque; const liste = ouvrantsCourants();
                res.innerHTML = `📍 <b>Repérage des ouvrants</b> — ${liste.filter(x => x.o[champ]).length} / ${liste.length} posée(s)<br><span style="font-size:12px;">Touchez une fenêtre dans la liste puis l’endroit du plan. Une gommette posée se déplace au doigt.</span>`;
            }
            else if (cal.mode === 'caler' && cal.gabarit) {
                const d = dimsGabarit(); const ech = echelleGabarit();
                const largeur = cal.img ? (cal.img.width * ech) : 0;
                let comparaison = '';
                if (cal.echelle > 0) {
                    const ecart = (ech - cal.echelle) / cal.echelle * 100;
                    comparaison = `<br><span style="font-size:12px; color:${Math.abs(ecart) < 2 ? 'var(--ok)' : '#B45309'};">Écart avec l’échelle actuelle : ${ecart > 0 ? '+' : ''}${ecart.toFixed(1)} %${Math.abs(ecart) < 2 ? ' — les deux concordent' : ' — vérifiez le plan ou le relevé'}</span>`;
                }
                const ang = ((cal.gabarit.ang || 0) % 360 + 360) % 360;
                const incl = ang % 90 === 0 ? (ang === 0 ? 'aligné sur le plan' : `pivoté de ${ang}°`) : `incliné de ${ang.toFixed(1)}°`;
                res.innerHTML = `🔲 <b>Calage sur ${esc(cal.gabarit.nom)}</b> — ${d.mL.toFixed(2)} × ${d.mH.toFixed(2)} m · ${incl}<br><span style="font-size:12px;">Le plan couvrirait <b>${largeur.toFixed(1)} m</b> de large. Glissez le rectangle, tirez son coin, inclinez-le par la poignée haute, puis validez.</span>${comparaison}`;
            }
            else if (!cal.echelle) res.innerHTML = '📏 <b>Échelle à régler</b><br><span style="font-size:12px;">Touchez « Calibrer » : calez une pièce mesurée, ou pointez les deux bouts d’une cote connue.</span>';
            else if (cal.mode === 'mesurer') res.innerHTML = `📐 <b>Relevé de cotes</b><br><span style="font-size:12px;">Pointez deux extrémités : la cote est enregistrée avec son nom. ${cal.calib.length === 1 ? 'Premier point posé…' : ''}</span>`;
            else if (cal.pts.length < 3) res.innerHTML = `✅ Échelle réglée<br><span style="font-size:12px;">Touchez les angles du lot pour tracer son contour (${cal.pts.length} point(s) posé(s)). Glissez pour déplacer, pincez pour zoomer.</span>`;
            else res.innerHTML = `Surface relevée : <span class="cal-surf">${surfaceCalque().toFixed(2)} m²</span><br>Périmètre <b>${perimetreCalque().toFixed(2)} m</b> · ${cal.pts.length} points`;
        }
    }
    if (act) act.hidden = !pret;
    // Surface et murs supposent un contour fermé ; l'enregistrement du plan, non.
    const contourPret = !!(cal.echelle && cal.pts.length > 2);
    const bs = $('cal-btn-surface'), bmu = $('cal-btn-murs');
    if (bs) bs.hidden = !contourPret;
    if (bmu) bmu.hidden = !contourPret;
}

function dessinerCalque(canvasCible) {
    const canvas = canvasCible || $('calque-canvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = canvasCible ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    const r0 = canvas.getBoundingClientRect();
    const { w, h } = canvasCible ? { w: r0.width || canvas.width, h: r0.height || canvas.height } : tailleCalque();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!cal.img) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cal.img, cal.ox, cal.oy, cal.img.width * cal.zoom, cal.img.height * cal.zoom);

    // Cote de calibrage
    if (cal.calib.length) {
        ctx.strokeStyle = '#D97706'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
        ctx.beginPath();
        cal.calib.forEach((p, i) => { const e = versEcran(p); i === 0 ? ctx.moveTo(e.x, e.y) : ctx.lineTo(e.x, e.y); });
        ctx.stroke(); ctx.setLineDash([]);
        cal.calib.forEach(p => { const e = versEcran(p); ctx.beginPath(); ctx.arc(e.x, e.y, 7, 0, 7); ctx.fillStyle = '#D97706'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); });
    }
    // Gabarit de pièce : rectangle aux cotes du terrain, posé et incliné sur le plan
    if (cal.gabarit) {
        const d = dimsGabarit(); const g = cal.gabarit;
        const c = versEcran({ x: g.cx, y: g.cy });
        const W = d.w * cal.zoom, H = d.h * cal.zoom;
        const actif = cal.mode === 'caler';
        ctx.save();
        ctx.translate(c.x, c.y); ctx.rotate((g.ang || 0) * RAD);
        ctx.fillStyle = actif ? 'rgba(217,119,6,0.16)' : 'rgba(217,119,6,0.06)';
        ctx.fillRect(-W / 2, -H / 2, W, H);
        ctx.strokeStyle = '#D97706'; ctx.lineWidth = actif ? 3 : 2;
        ctx.setLineDash(actif ? [] : [6, 4]);
        ctx.strokeRect(-W / 2, -H / 2, W, H);
        ctx.setLineDash([]);
        if (actif) {
            // Poignée de rotation, reliée au bord haut ; poignée d'échelle au coin
            const yr = -H / 2 - 36;   // 36 px à l'écran, comme la zone sensible
            ctx.beginPath(); ctx.moveTo(0, -H / 2); ctx.lineTo(0, yr); ctx.strokeStyle = '#D97706'; ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(0, yr, 11, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#D97706'; ctx.lineWidth = 3; ctx.stroke();
            ctx.beginPath(); ctx.arc(W / 2, H / 2, 11, 0, 7); ctx.fillStyle = '#D97706'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
        }
        ctx.restore();

        // Cotes et nom, tenus à l'horizontale pour rester lisibles quelle que soit l'inclinaison
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const etiquette = (txt, lx, ly) => {
            const e = versEcran(gabaritVersImage(lx, ly));
            const tw = ctx.measureText(txt).width;
            ctx.fillStyle = 'rgba(255,251,235,0.96)'; ctx.fillRect(e.x - tw / 2 - 5, e.y - 10, tw + 10, 20);
            ctx.strokeStyle = '#FDE68A'; ctx.lineWidth = 1; ctx.strokeRect(e.x - tw / 2 - 5, e.y - 10, tw + 10, 20);
            ctx.fillStyle = '#B45309'; ctx.fillText(txt, e.x, e.y);
        };
        const grand = Math.min(W, H);
        if (Math.max(W, H) > 54) etiquette(d.mL.toFixed(2) + ' m', 0, -d.h / 2);
        if (grand > 40) etiquette(d.mH.toFixed(2) + ' m', -d.w / 2, 0);
        if (grand > 46) { ctx.font = 'bold 11px sans-serif'; etiquette(g.nom, 0, 0); }
    }

    dessinerGommettes(ctx, 'calque', p => versEcran(p));

    // Cotes enregistrées
    cal.mesures.forEach(m => {
        const a = versEcran(m.a), b = versEcran(m.b);
        ctx.strokeStyle = '#16A34A'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        [a, b].forEach(e => { ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, 7); ctx.fillStyle = '#16A34A'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); });
        const txt = `${m.nom} · ${(+m.m).toFixed(2)} m`;
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(txt).width;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = 'rgba(240,253,244,0.95)'; ctx.fillRect(mx - tw / 2 - 5, my - 10, tw + 10, 20);
        ctx.strokeStyle = '#BBF7D0'; ctx.lineWidth = 1; ctx.strokeRect(mx - tw / 2 - 5, my - 10, tw + 10, 20);
        ctx.fillStyle = '#166534'; ctx.fillText(txt, mx, my);
    });

    // Contour tracé
    if (cal.pts.length) {
        ctx.beginPath();
        cal.pts.forEach((p, i) => { const e = versEcran(p); i === 0 ? ctx.moveTo(e.x, e.y) : ctx.lineTo(e.x, e.y); });
        if (cal.pts.length > 2) {
            ctx.closePath();
            ctx.fillStyle = 'rgba(37,99,235,0.16)'; ctx.fill();
        }
        ctx.strokeStyle = '#2563EB'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
        // Longueur de chaque segment
        if (cal.echelle) {
            ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const n = cal.pts.length;
            for (let i = 0; i < (n > 2 ? n : n - 1); i++) {
                const p = cal.pts[i], q = cal.pts[(i + 1) % n];
                const a = versEcran(p), b = versEcran(q);
                const lm = Math.hypot(q.x - p.x, q.y - p.y) * cal.echelle;
                if (lm < 0.05) continue;
                const txt = lm.toFixed(2) + ' m';
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const tw = ctx.measureText(txt).width;
                ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(mx - tw / 2 - 4, my - 9, tw + 8, 18);
                ctx.fillStyle = '#0F172A'; ctx.fillText(txt, mx, my);
            }
        }
        cal.pts.forEach((p, i) => {
            const e = versEcran(p);
            ctx.beginPath(); ctx.arc(e.x, e.y, i === 0 ? 7 : 5, 0, 7);
            ctx.fillStyle = i === 0 ? '#16A34A' : '#2563EB'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        });
    }
}

/* --- Actions du calque --- */
function appliquerSurfaceCalque() {
    const s = surfaceCalque();
    if (!s) { toast('Tracez au moins trois points pour obtenir une surface'); return; }
    if (curAppt === 'copro') {
        db.copro.surfcommuns = s.toFixed(2);
        const input = $('copro-surfcommuns'); if (input) input.value = db.copro.surfcommuns;
        sauvegarderLocal(); updateDashboard(); toast(`Surface (${s.toFixed(2)} m²) affectée aux parties communes ✓`);
        return;
    }
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return;
    apt.surfs = apt.surfs || {}; apt.surfs[curNivInt] = s;
    apt.surf = Object.values(apt.surfs).reduce((x, v) => x + v, 0).toFixed(1);
    sauvegarderLocal(); renderApptsList(); updateDashboard();
    toast(`Surface N${curNivInt} (${s.toFixed(2)} m²) appliquée au lot ${apt.num} · total ${apt.surf} m²`);
}
async function enregistrerPlanCalque() {
    const canvas = $('calque-canvas');
    if (!canvas || !cal.img) { toast('Aucun plan à enregistrer'); return; }
    const b64 = canvas.toDataURL('image/png');
    if (curAppt === 'copro') {
        await upsertDoc('Calque_Copro_PartiesCommunes.png', b64);
        sauvegarderLocal(); renderDocs(); toast('Calque enregistré dans les documents 📁'); return;
    }
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return;
    apt.plans = apt.plans || {};
    apt.plans[curNivInt] = await upsertDoc(`Calque_${apt.num}_N${curNivInt}.png`, b64);
    sauvegarderLocal(); renderDocs(); renderApptsList();
    toast(`Calque du lot ${apt.num} enregistré 📁`);
}
async function genererMursDepuisCalque() {
    if (cal.pts.length < 3 || !cal.echelle) { toast('Calibrez puis tracez au moins trois points'); return; }
    const apt = db.appts.find(a => a.id === curAppt);
    const hauteur = (apt && apt.hsp) || '';
    if (!await Dialogue.confirmer({
        titre: 'Générer les murs de façade',
        message: `${cal.pts.length} mur(s) seront créés d’après le contour relevé${hauteur ? `, avec une hauteur de ${hauteur} m` : ''}.\n\nLeur matériau et leur isolation restent à compléter.`,
        ok: 'Générer'
    })) return;
    // Passage des pixels de l'image aux mètres du plan, avec le même repère que le croquis.
    const contour = cal.pts.map(p => ({ x: p.x * cal.echelle, y: p.y * cal.echelle }));
    const crees = creerMursDepuisContour(contour, hauteur);
    toast(`${crees} mur(s) de façade générés — complétez matériau et isolation ✏️`);
}

/* ==========================================================================
   8. MODE BUREAU
   ========================================================================== */
function renderBureauTarget() {
    const sel = $('bur-target'); if (!sel) return; const val = sel.value;
    let html = `<option value="copro">🏢 Parties Communes (Copro)</option>`;
    db.appts.forEach(a => { const typeText = a.type === 2 ? ' (Duplex)' : a.type === 3 ? ' (Triplex)' : ''; html += `<option value="${a.id}">Lot : ${esc(a.num)}${typeText}</option>`; });
    sel.innerHTML = html; if (val && [...sel.options].some(o => o.value === val)) sel.value = val;
}
function sauverMurBureau() {
    const targetId = $('bur-target').value; const L = $('bur-l').value; const H = $('bur-h').value;
    if (!L || !H) { toast('⚠️ Veuillez saisir L et H'); $(L ? 'bur-h' : 'bur-l').focus(); return; }
    db.murs.push({ id: Date.now(), aid: targetId, nivInt: 0, ori: $('bur-ori').value, mat: $('bur-mat').value, donne: $('bur-donne').value, iso: $('bur-iso').value, isoEp: $('bur-iso-ep').value, l: L, h: H, ep: '', doub: 'ABSENT' });
    sauvegarderLocal(); $('bur-l').value = ''; $('bur-l').focus(); toast('Mur ajouté ✓'); renderBureauList(); updateDashboard();
}
function renderBureauList() {
    const cont = $('bur-list'); if (!cont) return;
    if (db.murs.length === 0) { cont.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">Aucun mur saisi pour le moment.</div>'; return; }
    const sortedMurs = [...db.murs].sort((a, b) => (a.aid === 'copro' ? -1 : b.aid === 'copro' ? 1 : 0));
    cont.innerHTML = sortedMurs.map(x => {
        const aptObj = db.appts.find(a => a.id === x.aid); const lotName = x.aid === 'copro' ? '🏢 Communs' : `🚪 Lot ${esc(aptObj ? aptObj.num : '?')}`;
        return `<div class="item-row" style="padding:10px; align-items:center;">
            <div style="width:90px; flex-shrink:0;"><span class="badge" style="background:#E2E8F0; color:#0F172A;">${lotName}</span></div>
            <div style="flex:1; padding-left:10px; min-width:0;">
                <div style="font-weight:800; font-size:13px; color:var(--tx);">${esc(x.ori)} | ${esc(x.mat || '')}</div>
                <div style="font-size:12px; color:var(--tx2);">Dim: ${esc(x.l)}x${esc(x.h)}m ${x.iso !== 'Non' && x.iso ? '| Iso: ' + esc(x.iso) : ''}</div>
            </div>
            <button class="ico-btn dan" data-act="suppMurBureau" data-id="${x.id}">❌</button>
        </div>`;
    }).join('');
}
Actions.suppMurBureau = d => {
    const idx = db.murs.findIndex(m => String(m.id) === String(d.id)); if (idx < 0) return;
    const item = db.murs[idx]; db.murs.splice(idx, 1); sauvegarderLocal(); renderBureauList(); updateDashboard();
    toastAnnuler('Mur supprimé', () => { db.murs.splice(idx, 0, item); sauvegarderLocal(); renderBureauList(); updateDashboard(); });
};

/* ==========================================================================
   9. SYNTHÈSE — schéma bâtiment, totaux
   ========================================================================== */
function renderTotauxTable() {
    const cat = $('totaux-category').value; const cont = $('totaux-table-container');
    if (!db[cat] || db[cat].length === 0) { cont.innerHTML = '<div style="padding:24px; text-align:center; color:var(--tx2); font-weight:600;">Aucune donnée pour cette catégorie.</div>'; return; }
    const data = db[cat].map(item => {
        const apt = db.appts.find(a => a.id === item.aid); const aptNum = item.aid === 'copro' ? 'Communs' : (apt ? apt.num : '?'); let surf = 0;
        if (cat === 'murs' || cat === 'portes') surf = (parseFloat(item.l) || 0) * (parseFloat(item.h) || 0);
        else if (cat === 'fens') { let fSurf = parseFloat(item.surf); if (isNaN(fSurf)) fSurf = item.type === 'Hublot' ? (Math.PI * Math.pow((parseFloat(item.diam) || 0) / 2, 2) / 10000) : ((parseFloat(item.l) || 0) * (parseFloat(item.h) || 0)) / 10000; surf = fSurf * (parseFloat(item.nb) || 1); }
        else if (cat === 'plfs' || cat === 'plas') surf = item.s ? parseFloat(item.s) : (parseFloat(item.l) || 0) * (parseFloat(item.larg) || 0);
        return { ...item, aptNum, surf: surf.toFixed(2) };
    });
    if (totauxSortCol) data.sort((a, b) => {
        let valA = a[totauxSortCol] || '', valB = b[totauxSortCol] || '';
        if (!isNaN(parseFloat(valA)) && !isNaN(parseFloat(valB))) { valA = parseFloat(valA); valB = parseFloat(valB); }
        return valA < valB ? (totauxSortAsc ? -1 : 1) : valA > valB ? (totauxSortAsc ? 1 : -1) : 0;
    });
    const th = (label, col) => `<th data-act="sortTotaux" data-col="${col}">${label}${totauxSortCol === col ? (totauxSortAsc ? ' ▲' : ' ▼') : ''}</th>`;
    let html = '<table class="tbl"><thead><tr>' + th('Lot', 'aptNum');
    if (cat === 'murs') html += th('Ori.', 'ori') + th('Matériau', 'mat') + th('L (m)', 'l') + th('H (m)', 'h');
    else if (cat === 'fens') html += th('Ori.', 'ori') + th('Type', 'type') + th('Matériau', 'mat') + th('Dim/Diam', 'l') + th('Qté', 'nb');
    else if (cat === 'portes') html += th('Type', 'type') + th('Matériau', 'mat') + th('L (m)', 'l') + th('H (m)', 'h');
    else html += th('Type', 'type') + th('Donne sur', 'donne') + th('L (m)', 'l') + th('larg (m)', 'larg');
    html += th('Surf. (m²)', 'surf') + '</tr></thead><tbody>';
    let totalSurf = 0;
    data.forEach(d => {
        totalSurf += parseFloat(d.surf); html += `<tr><td><strong>${esc(d.aptNum)}</strong></td>`;
        if (cat === 'murs') html += `<td>${esc(d.ori || '')}</td><td>${esc(d.mat || '')}</td><td>${esc(d.l || '')}</td><td>${esc(d.h || '')}</td>`;
        else if (cat === 'fens') html += `<td>${esc(d.ori || '')}</td><td>${esc(d.type || '')}</td><td>${esc(d.mat || '')}</td><td>${d.type === 'Hublot' ? `Ø${esc(d.diam)}cm` : `${esc(d.l)}x${esc(d.h)}cm`}</td><td>${esc(d.nb || '1')}</td>`;
        else if (cat === 'portes') html += `<td>${esc(d.type || '')}</td><td>${esc(d.mat || '')}</td><td>${esc(d.l || '')}</td><td>${esc(d.h || '')}</td>`;
        else html += `<td>${esc(d.type || '')}</td><td>${esc(d.donne || '')}</td><td>${esc(d.l || '')}</td><td>${esc(d.larg || '')}</td>`;
        html += `<td style="font-weight:900; color:var(--acc);">${d.surf}</td></tr>`;
    });
    const colSpan = cat === 'fens' ? 6 : 5;
    html += `</tbody><tfoot><tr><td colspan="${colSpan}" style="text-align:right;">TOTAL SURFACES :</td><td>${totalSurf.toFixed(2)} m²</td></tr></tfoot></table>`;
    cont.innerHTML = html;
}
function sortTotaux(col) { if (totauxSortCol === col) totauxSortAsc = !totauxSortAsc; else { totauxSortCol = col; totauxSortAsc = true; } renderTotauxTable(); }
Actions.sortTotaux = d => sortTotaux(d.col);

function renderBIM() {
    const cont = $('bim-container');
    if (db.appts.length === 0) { cont.innerHTML = '<div style="text-align:center; padding:20px; color:var(--tx2);">Ajoutez des échantillons pour voir la modélisation.</div>'; return; }
    let html = '';
    const bats = [...new Set(db.appts.map(a => a.bat || '1'))].sort();
    const floorOrder = { 'Sous-sol': -1, 'RDC': 0, 'Combles': 999 };
    const getFloorVal = f => floorOrder[f] !== undefined ? floorOrder[f] : (f && f.startsWith('R+') ? parseInt(f.replace('R+', '')) : 0);
    bats.forEach(b => {
        const apptsBat = db.appts.filter(a => (a.bat || '1') === b); const floors = {};
        apptsBat.forEach(a => { const f = a.etage || 'RDC'; (floors[f] = floors[f] || []).push(a); });
        const sortedFloors = Object.keys(floors).sort((x, y) => getFloorVal(y) - getFloorVal(x));
        html += `<div class="card" style="padding:15px; margin-top:15px;"><h3 style="color:var(--acc); margin-bottom:15px; text-align:center;">🏢 Bâtiment ${esc(b)}</h3><div style="display:flex; flex-direction:column; gap:5px; align-items:center;">`;
        let totSurf = 0;
        sortedFloors.forEach(f => {
            html += `<div style="display:flex; gap:5px; width:100%; justify-content:center;"><div style="width:60px; font-weight:bold; font-size:12px; color:var(--tx2); display:flex; align-items:center; justify-content:flex-end; padding-right:10px;">${esc(f)}</div><div style="display:flex; gap:5px; flex:1; flex-wrap:wrap;">`;
            floors[f].forEach(a => { totSurf += parseFloat(a.surf || 0); const w = Math.max(50, Math.min((parseFloat(a.surf || 40) * 1.5), 150)); html += `<div class="tetris-block" style="width:${w}px;"><div>${esc(a.num)}</div><div style="font-size:9px; opacity:0.8;">${a.surf ? esc(a.surf) + 'm²' : ''}</div></div>`; });
            html += `</div></div>`;
        });
        const nbEtagesDeclares = parseInt(db.copro.etages) || sortedFloors.length; const surfEstimee = (totSurf / sortedFloors.length) * nbEtagesDeclares;
        html += `</div><div style="margin-top:20px; padding-top:15px; border-top:1px dashed var(--bor); text-align:center;">
            <div style="font-size:12px; color:var(--tx2);">Surface Échantillonnée</div><div style="font-size:20px; font-weight:900; color:var(--ok);">${totSurf.toFixed(1)} m²</div>
            <div style="font-size:12px; color:var(--tx2); margin-top:12px;">Extrapolation estimée Bâtiment (Basée sur ${nbEtagesDeclares} niveaux)</div><div style="font-size:20px; font-weight:900; color:#D97706;">~ ${surfEstimee.toFixed(0)} m²</div>
            <div style="font-size:11px; color:#B45309; margin-top:6px;">⚠️ Estimation indicative (moyenne des niveaux saisis × étages déclarés) — ne pas utiliser comme valeur certifiée.</div></div></div>`;
    });
    cont.innerHTML = html;
}

/* ==========================================================================
   10. CALCULATRICE GÉOMÉTRIQUE (pignon, rampant, surface habitable)
   ========================================================================== */
function runCalc() {
    const L = parseFloat($('calc-L').value), l = parseFloat($('calc-l').value), h = parseFloat($('calc-h').value), H = parseFloat($('calc-H').value), proj = parseFloat($('calc-proj').value) || 0;
    const resDiv = $('calc-res');
    if (isNaN(L) || isNaN(l) || isNaN(h) || isNaN(H) || L <= 0 || l <= 0 || h < 0 || H <= 0 || proj < 0 || H < h || (proj * 2) > l) { resDiv.style.display = 'none'; return; }
    const l_plat = Math.max(l - 2 * proj, 0);
    const sMur = L * h, sPig = (l * h) + (((l + l_plat) / 2) * (H - h)), hyp = Math.hypot(H - h, proj), sRamp = L * hyp, sPlat = L * l_plat;
    let sHabitable = 0;
    if (H < 1.80) sHabitable = 0; else if (h >= 1.80) sHabitable = L * l; else { const x_180 = (1.80 - h) * (proj / (H - h)); sHabitable = L * (l - 2 * x_180); }
    lastCalc = { sMur: sMur.toFixed(2), sPig: sPig.toFixed(2), sRamp: sRamp.toFixed(2), sPlat: sPlat.toFixed(2), sHab: sHabitable.toFixed(2) };
    $('res-mur').textContent = lastCalc.sMur + ' m²'; $('res-pig').textContent = lastCalc.sPig + ' m²'; $('res-ramp').textContent = lastCalc.sRamp + ' m²'; $('res-plat').textContent = lastCalc.sPlat + ' m²'; $('res-shab').textContent = lastCalc.sHab + ' m²';
    $('row-calc-plat').style.display = l_plat > 0 ? 'flex' : 'none'; resDiv.style.display = 'block';
}
function applyHabSurface() {
    if (!curAppt || curAppt === 'copro') { toast('⚠️ Sélectionnez un appartement dans le contexte de saisie'); return; }
    if (!lastCalc.sHab) return;
    const apt = db.appts.find(a => a.id === curAppt); if (!apt) return;
    apt.surfs = apt.surfs || {}; apt.surfs[curNivInt] = parseFloat(lastCalc.sHab);
    apt.surf = Object.values(apt.surfs).reduce((s, v) => s + v, 0).toFixed(1);
    sauvegarderLocal(); updateDashboard();
    toast(`Surface habitable N${curNivInt} (${lastCalc.sHab} m²) appliquée au lot ${apt.num} · Total : ${apt.surf} m²`);
}
function addCalc(type) {
    if (!curAppt) curAppt = 'copro';
    const el = { id: Date.now(), aid: curAppt, nivInt: curNivInt };
    if (type === 'mur') { Object.assign(el, { mat: 'Inconnu', ori: '', donne: 'Extérieur', l: $('calc-L').value, h: $('calc-h').value, ep: '', isoEp: '', doub: 'ABSENT', iso: 'Non' }); db.murs.push(el); toast('Mur Façade ajouté. Modifiez-le ✏️'); }
    else if (type === 'pig') { const l = $('calc-l').value; Object.assign(el, { mat: 'Inconnu', ori: '', donne: 'Extérieur', l, h: (parseFloat(lastCalc.sPig) / parseFloat(l)).toFixed(2), ep: '', isoEp: '', doub: 'ABSENT', iso: 'Non' }); db.murs.push(el); toast('Mur Pignon ajouté. Modifiez-le ✏️'); }
    else if (type === 'ramp') { Object.assign(el, { type: 'Combles aménagés sous rampants', donne: 'Extérieur', s: lastCalc.sRamp, iso: 'Non', isoEp: '' }); db.plfs.push(el); toast('Plafond rampant ajouté. Modifiez-le ✏️'); }
    else if (type === 'plat') { Object.assign(el, { type: 'Inconnu', donne: 'Combles perdus', s: lastCalc.sPlat, iso: 'Non', isoEp: '' }); db.plfs.push(el); toast('Plafond plat ajouté. Modifiez-le ✏️'); }
    sauvegarderLocal(); renderElementsList(type === 'mur' || type === 'pig' ? 'murs' : 'plfs');
    if (type === 'mur' || type === 'pig') drawCroquis();
    if (curAppt !== 'copro') updateApptBadges(curAppt); updateDashboard();
}

/* ==========================================================================
   11. EXPORT / IMPORT / E-MAILS
   ========================================================================== */
// Chargement à la demande des bibliothèques lourdes (XLSX ≈ 880 Ko, JSZip ≈ 100 Ko).
const libsChargees = {};
function chargerScript(src) {
    if (libsChargees[src]) return libsChargees[src];
    libsChargees[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete libsChargees[src]; rej(new Error(src)); }; document.head.appendChild(s); });
    return libsChargees[src];
}
async function assurerLib(globalName, src) {
    if (window[globalName]) return true;
    toast('Chargement du module…', { duree: 1500 });
    try { await chargerScript(src); } catch (e) { /* ignoré */ }
    if (!window[globalName]) { toast('⚠️ Module indisponible : ' + src + ' (vérifiez la connexion)', { duree: 5000 }); return false; }
    return true;
}
async function exportData() {
    const payload = { ...Medias.inliner(), _meta: { app: 'MyDiag-DPE', schemaVersion: 1, appVersion: APP_VERSION, exportDate: new Date().toISOString() } };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (await Plateforme.enregistrerFichier(blob, `MyDiag_Backup_${db.copro.ref || 'Projet'}_${horodatage()}.json`)) toast('Backup JSON enregistré ✓');
}
function importData() { Plateforme.demanderFichier('json-uploader'); }
async function restaurerBackup(texte) {
    let data;
    try { data = JSON.parse(texte); } catch (e) { Dialogue.alerter('Impossible de lire ce fichier : JSON illisible ou corrompu.', 'Restauration impossible'); return; }
    if (data && data._meta && data._meta.app && data._meta.app !== 'MyDiag-DPE') { Dialogue.alerter("Ce fichier provient d'une autre application (" + data._meta.app + ').', 'Restauration impossible'); return; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.appts) || !Array.isArray(data.murs)) { Dialogue.alerter("Fichier invalide : ce n'est pas un backup MyDiag.", 'Restauration impossible'); return; }
    const nomProjet = (data.copro && (data.copro.nom || data.copro.ref)) || 'Projet sans nom';
    const dateInfo = data._meta && data._meta.exportDate ? '\nExporté le : ' + data._meta.exportDate.substring(0, 10) : '';
    if (!await Dialogue.confirmer({ titre: 'Restaurer ce backup ?', message: `📁 ${nomProjet} — ${data.appts.length} lot(s), ${data.murs.length} mur(s)${dateInfo}\n\n⚠️ Les données actuellement sur cet appareil seront remplacées.`, ok: 'Restaurer', danger: true })) return;
    delete data._meta;
    clearTimeout(saveTimer); saveTimer = null; saveEnAttente = false;
    await Medias.vider(); db = data; normaliserDb(); await Medias.externaliser();
    await localforage.setItem(CLE_DB, db); location.reload();
}
function genererCodeFen(f) {
    const contient = (v, ...mots) => { const t = String(v || '').toLowerCase(); return mots.some(m => t.includes(m.toLowerCase())); };
    const rep = f.nom || 'F?';
    let typeAbr = '';
    if (f.type) {
        if (f.type === 'Fenêtres battantes') typeAbr = 'FB';
        else if (f.type === 'Fenêtres coulissantes') typeAbr = 'FC';
        else if (f.type === 'Portes-fenêtres coulissantes') typeAbr = 'PFC';
        else if (contient(f.type, 'Portes-fenêtres battantes')) typeAbr = 'PFB';
        else if (contient(f.type, 'sans ouverture')) typeAbr = 'Fixe';
        else if (contient(f.type, 'toit')) typeAbr = 'Velux';
        else if (f.type === 'Hublot') typeAbr = 'Hublot';
    }
    const dim = f.type === 'Hublot' ? `Ø${f.diam}` : `${f.l}x${f.h}`;
    // Libellés ADN : « Menuiserie métallique à rupture de pont thermique », « Menuiserie Bois / Métal »…
    let matAbr = '';
    if (f.mat) {
        if (contient(f.mat, 'PVC')) matAbr = 'PVC';
        else if (contient(f.mat, 'bois / métal', 'bois/métal')) matAbr = 'Bois/Métal';
        else if (contient(f.mat, 'sans rupture')) matAbr = 'Métal';
        else if (contient(f.mat, 'à rupture', 'avec rupture')) matAbr = 'Métal RPT';
        else if (contient(f.mat, 'bois')) matAbr = 'Bois';
    }
    // L'ADN distingue vitrage vertical et horizontal : le suffixe H conserve l'information.
    let vitAbr = '';
    if (f.vit) {
        const h = contient(f.vit, 'horizontal') ? ' H' : '';
        if (contient(f.vit, 'Simple')) vitAbr = 'SV' + h;
        else if (contient(f.vit, 'Double')) vitAbr = 'DV' + (f.ep ? ` 4/${f.ep}/4` : '') + h;
        else if (contient(f.vit, 'Triple')) vitAbr = 'TV' + (f.ep ? ` 4/${f.ep}/4/${f.ep}/4` : '') + h;
        else if (contient(f.vit, 'Survitrage')) vitAbr = 'Surv.' + h;
        else if (contient(f.vit, 'Brique')) vitAbr = 'Brique';
        else if (contient(f.vit, 'Polycarbonate')) vitAbr = 'Poly.';
    }
    let ferAbr = '';
    if (f.fer) {
        if (f.fer === 'Absence') ferAbr = 'sFerm';
        else if (contient(f.fer, 'volets roulants Alu')) ferAbr = 'aVR Alu';
        else if (contient(f.fer, 'Volet roulant')) ferAbr = 'aVR';
        // La jalousie est testée avant la persienne : son libellé ADN contient aussi
        // « persiennes avec ajours fixes ».
        else if (contient(f.fer, 'Jalousie')) ferAbr = 'aJalousie';
        else if (contient(f.fer, 'Persienne')) ferAbr = 'aPers.';
    }
    return `${rep} ${typeAbr} ${f.ori || ''} ${dim} ${matAbr} ${vitAbr} ${ferAbr}`.trim().replace(/\s+/g, ' ');
}

async function exportExcel() {
    if (!await assurerLib('XLSX', 'lib/xlsx.full.min.js')) return;
    toast('Génération du fichier Excel...'); const wb = XLSX.utils.book_new();
    const getAptNum = id => { if (id === 'copro') return 'Communs'; const a = db.appts.find(x => x.id === id); return a ? a.num : 'Inconnu'; };
    const feuille = (rows, nom) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), nom); };
    feuille([{ "Référence": db.copro.ref || "", "Nom": db.copro.nom || "", "Adresse": db.copro.adresse || "", "Code Postal": db.copro.cp || "", "Ville": db.copro.ville || "", "Année constr.": db.copro.annee || "", "Bâtiments": db.copro.batiments || "", "Étages": db.copro.etages || "", "Surface Communs (m²)": db.copro.surfcommuns || "", "VMC Type": db.vmc.type || "", "VMC Période": db.vmc.periode || "", "Chauff Col. Energie": db.chaufCol.energie || "", "Chauff Col. Générateur": db.chaufCol.gen || "", "Chauff Col. Emetteur": db.chaufCol.emetteur || "", "Chauff Col. Année": db.chaufCol.annee || "", "Chauff Col. Puissance": db.chaufCol.puissance || "", "ECS Col. Energie": db.ecsCol.energie || "", "ECS Col. Type": db.ecsCol.type || "", "ECS Col. Année": db.ecsCol.annee || "", "ECS Col. Volume": db.ecsCol.vol || "" }], 'Copro');
    feuille(db.appts.map(a => ({ "Lot": a.num, "Bâtiment": a.bat || "", "Type": a.type === 2 ? "Duplex" : a.type === 3 ? "Triplex" : "Plain-pied", "Étage": a.etage || "", "Niveau ADN": a.niveau || "", "Surface (m²)": a.surf || "", "HSP (m)": a.hsp || "" })), 'Appartements');
    feuille(db.murs.map(m => ({ "Lot": getAptNum(m.aid), "Niveau (Duplex)": m.nivInt || 0, "Orientation": m.ori || "Auto", "Donne sur": m.donne || "", "Matériau": m.mat || "", "Longueur (m)": m.l || "", "Hauteur (m)": m.h || "", "Épaisseur (cm)": m.ep || "", "Doublage": m.doub || "ABSENT", "Isolant": m.iso || "", "Ép. Isolant (cm)": m.isoEp || "" })), 'Murs');
    feuille(db.fens.map(f => ({ "Lot": getAptNum(f.aid), "Niveau": f.nivInt || 0, "Code ANALYSIMMO": genererCodeFen(f), "Repère": f.nom || "", "Orientation": f.ori || "", "Type": f.type || "", "Matériau": f.mat || "", "Vitrage": f.vit || "", "Ép. Lame (mm)": f.ep || "", "Fermeture": f.fer || "", "Largeur (cm)": f.l || "", "Hauteur (cm)": f.h || "", "Diamètre (cm)": f.diam || "", "Surface Unitaire (m²)": f.surf || "", "Quantité": f.nb || 1, "Motifs": f.motifs || 1,
        "Pièce": pieceDe(f) ? (pieceDe(f).nom || "") : "",
        "Mur associé": murDe(f) ? libelleMur(murDe(f)) : "",
        "Repérée sur plan": [f.posPlan ? 'plan des pièces' : '', f.posCal ? 'plan décalqué' : ''].filter(Boolean).join(' + ') || "" })), 'Fenêtres');
    feuille(db.portes.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type": p.type || "", "Matériau": p.mat || "", "Donne sur": p.donne || "", "Isolation": p.iso || "", "Sas": p.sas || "", "Largeur (m)": p.l || "", "Hauteur (m)": p.h || "",
        "Pièce": pieceDe(p) ? (pieceDe(p).nom || "") : "",
        "Mur associé": murDe(p) ? libelleMur(murDe(p)) : "",
        "Repérée sur plan": [p.posPlan ? 'plan des pièces' : '', p.posCal ? 'plan décalqué' : ''].filter(Boolean).join(' + ') || "" })), 'Portes');
    feuille(db.plfs.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type ADN": p.type || "", "Donne sur": p.donne || "", "Longueur (m)": p.l || "", "Largeur (m)": p.larg || "", "Surface (m²)": p.s || "", "Isolant": p.iso || "", "Ép. Isolant (cm)": p.isoEp || "" })), 'Plafonds');
    feuille(db.plas.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type ADN": p.type || "", "Donne sur": p.donne || "", "Longueur (m)": p.l || "", "Largeur (m)": p.larg || "", "Surface (m²)": p.s || "", "Isolant": p.iso || "", "Ép. Isolant (cm)": p.isoEp || "" })), 'Planchers');
    const cotes = [];
    Object.entries(db.calques).forEach(([cle, etat]) => {
        const [aid, niv] = cle.split('_');
        (etat.mesures || []).forEach(m => cotes.push({ "Lot": getAptNum(aid), "Niveau": niv, "Cote": m.nom || "", "Longueur (m)": (+m.m).toFixed(2), "Échelle du plan": etat.ref ? `${etat.ref.metres} m relevés${etat.ref.libelle ? ' sur ' + etat.ref.libelle : ''}` : "" }));
    });
    feuille(cotes, 'Cotes relevées');
    feuille(db.pieces.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Pièce": p.nom || "", "Longueur (m)": p.l || "", "Largeur (m)": p.larg || "", "Surface (m²)": (surfacePiece(p)).toFixed(2),
        "Fenêtres": db.fens.filter(f => String(f.pieceId) === String(p.id)).length,
        "Surface vitrée (m²)": surfaceVitreePiece(p.id).toFixed(2),
        "Portes": db.portes.filter(x => String(x.pieceId) === String(p.id)).length })), 'Pièces');
    feuille(db.chaufs.map(c => ({ "Lot": getAptNum(c.aptId), "Énergie": c.energie || "", "Générateur": c.gen || "", "Émetteur": c.emetteur || "", "Année": c.annee || "", "Puissance (kW)": c.puissance || "" })), 'Chauffages');
    feuille(db.ecss.map(e => ({ "Lot": getAptNum(e.aptId), "Énergie": e.energie || "", "Type/Générateur": e.type || "", "Année": e.annee || "", "Volume (L)": e.vol || "" })), 'ECS');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (await Plateforme.enregistrerFichier(blob, `Export_MyDiag_${db.copro.ref || 'Projet'}_${horodatage()}.xlsx`)) toast('Fichier Excel enregistré ✓');
}
/* --- Export PDF du dossier de plans ---
   Les plans sont redessinés au moment de l'export, à partir des données du jour :
   le PDF reflète donc toujours les cotes et les gommettes en cours, et non une
   ancienne capture enregistrée dans les documents. */
function canvasHorsEcran(largeur, hauteur) {
    const c = document.createElement('canvas');
    c.width = largeur; c.height = hauteur;
    // Rattaché hors champ : les fonctions de dessin lisent la taille CSS réelle.
    c.style.cssText = `position:absolute; left:-99999px; top:0; width:${largeur}px; height:${hauteur}px;`;
    document.body.appendChild(c);
    return c;
}
// Exécute une fonction dans le contexte d'un autre lot ou niveau, puis remet tout en place.
async function avecContexte(aid, niv, fn) {
    const sAppt = curAppt, sNiv = curNivInt, sCal = cal, sGom = gomSel, sPiece = pieceSel, sMode = modePlan;
    curAppt = aid; curNivInt = niv; gomSel = null; pieceSel = null; modePlan = 'pieces';
    try { return await fn(); }
    finally { curAppt = sAppt; curNivInt = sNiv; cal = sCal; gomSel = sGom; pieceSel = sPiece; modePlan = sMode; }
}
async function imagePlanPieces(aid, niv, L, H) {
    return avecContexte(aid, niv, () => {
        if (!piecesCourantes().length) return null;
        const c = canvasHorsEcran(L, H);
        try { dessinerPlanPieces(c); return c.toDataURL('image/png'); }
        finally { c.remove(); }
    });
}
async function imageCalque(aid, niv, L, H) {
    const etat = db.calques[`${aid}_${niv}`];
    if (!etat || !etat.media) return null;
    const src = Medias.src(etat.media); if (!src) return null;
    let img;
    try { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
    catch (e) { return null; }
    return avecContexte(aid, niv, () => {
        const zoom = Math.min(L / img.width, H / img.height);
        cal = { media: etat.media, img, echelle: etat.echelle || 0, pts: (etat.pts || []).map(p => ({ ...p })),
                mesures: (etat.mesures || []).map(m => ({ ...m })), calib: [], ref: etat.ref || null,
                gabarit: etat.gabarit ? migrerGabarit({ ...etat.gabarit }) : null,
                mode: 'apercu', zoom, ox: (L - img.width * zoom) / 2, oy: (H - img.height * zoom) / 2,
                pdfDoc: null, page: 1, nbPages: 1 };
        const c = canvasHorsEcran(L, H);
        try { dessinerCalque(c); return c.toDataURL('image/png'); }
        finally { c.remove(); }
    });
}
// Ouvrants repérés et cotes d'un lot et d'un niveau, pour la légende de la page.
function legendePlan(aid, niv) {
    const dansCible = o => o.aid === aid && (o.nivInt || 0) === niv;
    const lignes = [];
    db.fens.filter(dansCible).forEach(f => {
        const m = murDe(f), pc = pieceDe(f);
        lignes.push({ rep: f.nom || 'F?', genre: 'Fenêtre', desc: `${f.type || ''} ${f.type === 'Hublot' ? 'Ø' + (f.diam || '?') : (f.l || '?') + '×' + (f.h || '?')} cm`.trim(),
                      piece: pc ? (pc.nom || 'Pièce') : '—',
                      mur: m ? `${m.ori || ''} ${m.l || ''}×${m.h || ''} m` : '—', repere: !!(f.posPlan || f.posCal) });
    });
    db.portes.filter(dansCible).forEach((p, i) => {
        const m = murDe(p), pc = pieceDe(p);
        lignes.push({ rep: p.nom || 'P' + (i + 1), genre: 'Porte', desc: `${p.type || ''} ${p.l || '?'}×${p.h || '?'} m`.trim(),
                      piece: pc ? (pc.nom || 'Pièce') : '—',
                      mur: m ? `${m.ori || ''} ${m.l || ''}×${m.h || ''} m` : '—', repere: !!(p.posPlan || p.posCal) });
    });
    const etat = db.calques[`${aid}_${niv}`];
    const cotes = (etat && etat.mesures ? etat.mesures : []).map(m => ({ nom: m.nom, m: +m.m }));
    const pieces = db.pieces.filter(dansCible).map(p => ({
        nom: p.nom || 'Pièce', surf: surfacePiece(p), vitree: surfaceVitreePiece(p.id),
        nb: db.fens.filter(f => String(f.pieceId) === String(p.id)).length
    }));
    return { lignes, cotes, pieces, echelle: etat ? etat.echelle : 0, ref: etat ? etat.ref : null };
}

async function exportPdfPlans() {
    if (!await assurerLib('jspdf', 'lib/jspdf.umd.min.js')) return;
    const { jsPDF } = window.jspdf;
    toast('Génération du dossier de plans…', { duree: 2500 });

    const supports = [];
    const ajouterSupports = (aid, libelle, niveaux) => {
        for (let n = 0; n < niveaux; n++) {
            const nivLbl = niveaux > 1 ? ` · ${n === 0 ? 'niveau bas' : (n === 1 && niveaux === 3) ? 'niveau intermédiaire' : 'niveau haut'}` : '';
            if (db.pieces.some(p => p.aid === aid && (p.nivInt || 0) === n)) supports.push({ aid, niv: n, titre: `${libelle}${nivLbl}`, type: 'Plan des pièces relevées' });
            if (db.calques[`${aid}_${n}`]) supports.push({ aid, niv: n, titre: `${libelle}${nivLbl}`, type: 'Plan décalqué' });
        }
    };
    ajouterSupports('copro', 'Parties communes', 1);
    db.appts.forEach(a => ajouterSupports(a.id, `Lot ${a.num}`, a.type > 1 ? a.type : 1));

    if (!supports.length) { toast('Aucun plan à exporter : saisissez des pièces ou chargez un plan'); return; }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const LARGEUR = 210, MARGE = 14, UTILE = LARGEUR - MARGE * 2;
    const gris = () => pdf.setTextColor(100, 116, 139);
    const noir = () => pdf.setTextColor(15, 23, 42);

    // Couverture
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); noir();
    pdf.text('Dossier de plans', MARGE, 40);
    pdf.setFontSize(13); gris();
    pdf.text(db.copro.nom || 'Copropriété non nommée', MARGE, 50);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
    const adresse = [db.copro.adresse, [db.copro.cp, db.copro.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    let y = 60;
    const ligneInfo = (etiquette, valeur) => { if (!valeur) return; gris(); pdf.text(etiquette, MARGE, y); noir(); pdf.text(String(valeur), MARGE + 45, y); y += 7; };
    ligneInfo('Référence', db.copro.ref);
    ligneInfo('Adresse', adresse);
    ligneInfo('Année de construction', db.copro.annee);
    ligneInfo('Lots relevés', db.appts.length);
    ligneInfo('Surface relevée', db.appts.reduce((s, a) => s + (parseFloat(a.surf) || 0), 0).toFixed(1) + ' m²');
    ligneInfo('Plans du dossier', supports.length);
    ligneInfo('Édité le', new Date().toLocaleDateString('fr-FR'));
    gris(); pdf.setFontSize(9);
    pdf.text('Plans redessinés à la date d’édition : cotes et gommettes reflètent le relevé en cours.', MARGE, 285);

    for (const sup of supports) {
        pdf.addPage();
        const estCalque = sup.type === 'Plan décalqué';
        // 1240 px de large : net à l'impression sans alourdir le fichier
        const img = estCalque ? await imageCalque(sup.aid, sup.niv, 1240, 900) : await imagePlanPieces(sup.aid, sup.niv, 1240, 900);

        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); noir();
        pdf.text(sup.titre, MARGE, 20);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); gris();
        pdf.text(sup.type, MARGE, 26);

        let yy = 32;
        if (img) {
            const hImg = UTILE * 900 / 1240;
            pdf.addImage(img, 'PNG', MARGE, yy, UTILE, hImg);
            pdf.setDrawColor(203, 213, 225); pdf.rect(MARGE, yy, UTILE, hImg);
            yy += hImg + 8;
        } else { gris(); pdf.text('Plan indisponible.', MARGE, yy); yy += 8; }

        const leg = legendePlan(sup.aid, sup.niv);
        if (leg.echelle) {
            gris(); pdf.setFontSize(9);
            const orig = leg.ref ? (leg.ref.piece ? `calée sur ${leg.ref.libelle}` : `d’après ${leg.ref.metres} m relevés${leg.ref.libelle ? ' sur ' + leg.ref.libelle : ''}`) : 'calibrage enregistré';
            pdf.text(`Échelle : ${orig}`, MARGE, yy); yy += 6;
        }
        if (leg.lignes.length) {
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); noir();
            pdf.text('Ouvrants', MARGE, yy); yy += 5;
            pdf.setFontSize(8); gris();
            pdf.text('Repère', MARGE, yy); pdf.text('Type', MARGE + 16, yy); pdf.text('Dimensions', MARGE + 36, yy);
            pdf.text('Pièce', MARGE + 84, yy); pdf.text('Mur associé', MARGE + 116, yy); pdf.text('Repéré', MARGE + 162, yy); yy += 4;
            pdf.setDrawColor(226, 232, 240); pdf.line(MARGE, yy - 2, LARGEUR - MARGE, yy - 2);
            pdf.setFont('helvetica', 'normal'); noir();
            leg.lignes.forEach(l => {
                if (yy > 280) { pdf.addPage(); yy = 20; }
                pdf.text(String(l.rep), MARGE, yy);
                pdf.text(l.genre, MARGE + 16, yy);
                pdf.text(pdf.splitTextToSize(l.desc, 46)[0] || '', MARGE + 36, yy);
                pdf.text(pdf.splitTextToSize(l.piece, 30)[0] || '', MARGE + 84, yy);
                pdf.text(pdf.splitTextToSize(l.mur, 44)[0] || '', MARGE + 116, yy);
                pdf.text(l.repere ? 'oui' : '—', MARGE + 162, yy);
                yy += 5;
            });
            yy += 4;
        }
        if (leg.pieces.length && !estCalque) {
            if (yy > 260) { pdf.addPage(); yy = 20; }
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); noir();
            pdf.text('Pièces relevées', MARGE, yy); yy += 5;
            pdf.setFontSize(8); gris();
            pdf.text('Pièce', MARGE, yy); pdf.text('Surface au sol', MARGE + 60, yy); pdf.text('Surface vitrée', MARGE + 110, yy); pdf.text('Fenêtres', MARGE + 162, yy); yy += 4;
            pdf.setDrawColor(226, 232, 240); pdf.line(MARGE, yy - 2, LARGEUR - MARGE, yy - 2);
            pdf.setFont('helvetica', 'normal'); noir();
            leg.pieces.forEach(p => {
                if (yy > 280) { pdf.addPage(); yy = 20; }
                pdf.text(pdf.splitTextToSize(p.nom, 55)[0] || '', MARGE, yy);
                pdf.text(p.surf.toFixed(2) + ' m²', MARGE + 60, yy);
                pdf.text(p.vitree > 0 ? p.vitree.toFixed(2) + ' m²' : '—', MARGE + 110, yy);
                pdf.text(String(p.nb), MARGE + 162, yy);
                yy += 5;
            });
            yy += 4;
        }
        if (leg.cotes.length) {
            if (yy > 265) { pdf.addPage(); yy = 20; }
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); noir();
            pdf.text('Cotes relevées', MARGE, yy); yy += 5;
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
            leg.cotes.forEach(c => {
                if (yy > 280) { pdf.addPage(); yy = 20; }
                noir(); pdf.text(String(c.nom), MARGE, yy);
                pdf.text(c.m.toFixed(2) + ' m', MARGE + 100, yy);
                yy += 5;
            });
        }
    }

    // Pagination
    const total = pdf.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        pdf.setPage(i); pdf.setFontSize(8); gris();
        pdf.text(`${db.copro.ref || 'MyDiag'} — page ${i} / ${total}`, LARGEUR - MARGE, 290, { align: 'right' });
    }

    const blob = pdf.output('blob');
    if (await Plateforme.enregistrerFichier(blob, `Plans_MyDiag_${db.copro.ref || 'Projet'}_${horodatage()}.pdf`)) toast('Dossier de plans PDF enregistré ✓');
}

async function exportZip() {
    if (!await assurerLib('JSZip', 'lib/jszip.min.js')) return;
    toast('Préparation du ZIP en cours...'); const zip = new JSZip(); let hasPhotos = false;
    const extIm = d => d.includes('application/pdf') ? '.pdf' : d.includes('image/jpeg') ? '.jpg' : '.png';
    const ajouter = (dossier, nom, ref) => { const d = Medias.get(ref); if (d && d.includes('base64,')) { dossier.file(nom + extIm(d), d.split(',')[1], { base64: true }); hasPhotos = true; } };
    const docFolder = zip.folder('Documents_Copro'); db.docs.forEach((d, i) => { const data = Medias.get(d.data); if (data && data.includes('base64,')) { docFolder.file(d.name || `doc_${i}${extIm(data)}`, data.split(',')[1], { base64: true }); hasPhotos = true; } });
    const coproFolder = zip.folder('Systemes_Collectifs'); ajouter(coproFolder, 'Plaque_Chauffage_Collectif', db.chaufCol.photo); ajouter(coproFolder, 'Plaque_ECS_Collective', db.ecsCol.photo);
    const indFolder = zip.folder('Systemes_Individuels'); const num = id => { const a = db.appts.find(x => x.id === id); return a ? a.num : 'Inconnu'; };
    db.chaufs.forEach((c, i) => ajouter(indFolder, `Chauffage_${num(c.aptId)}_${i + 1}`, c.photo)); db.ecss.forEach((e, i) => ajouter(indFolder, `ECS_${num(e.aptId)}_${i + 1}`, e.photo));
    if (!hasPhotos) { toast('Aucune photo à exporter.'); return; }
    const content = await zip.generateAsync({ type: 'blob' });
    if (await Plateforme.enregistrerFichier(content, `Photos_MyDiag_${horodatage()}.zip`)) toast('ZIP enregistré ✓');
}
function envoyerMailExport() {
    const ref = db.copro.ref || 'Sans_Ref'; const nom = db.copro.nom || 'Copropriété non renseignée';
    const subject = encodeURIComponent(`Dossier DPE - Réf: ${ref} - ${nom}`);
    const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint les exports (Excel, Photos ZIP et Backup JSON) pour le dossier DPE référence ${ref}.\n\n⚠️ PENSEZ À JOINDRE LES 3 FICHIERS TÉLÉCHARGÉS AVANT D'ENVOYER CE MAIL.\n\nCordialement.`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`; toast('Ouverture de la messagerie...');
}
function envoyerMailRDV() {
    const ref = db.copro.ref || 'Sans_Ref'; const nom = db.copro.nom || '';
    const subject = encodeURIComponent(`Demande de RDV supplémentaires - Réf: ${ref}`);
    const body = encodeURIComponent(`Bonjour,\n\nLors de ma visite sur le dossier "${nom}" (Réf: ${ref}), je n'ai pas pu accéder à tous les échantillons nécessaires pour la représentativité du DPE.\n\nPourriez-vous s'il vous plaît planifier des rendez-vous supplémentaires avec les occupants manquants ?\n\nMerci d'avance pour votre retour.\n\nCordialement.`);
    window.location.href = `mailto:c.louis@eti360.fr?subject=${subject}&body=${body}`; toast('Ouverture de la messagerie...');
}

/* ==========================================================================
   12. DÉMARRAGE — service worker, statut hors ligne, initialisation
   ========================================================================== */
async function majStatutHorsLigne() {
    const el = $('statut-horsligne'); if (!el) return;
    let stockage = '';
    try { if (navigator.storage && navigator.storage.estimate) { const est = await navigator.storage.estimate(); stockage = `<div>💾 Stockage utilisé : <b>${(est.usage / 1048576).toFixed(0)} Mo</b> / ~${(est.quota / 1048576).toFixed(0)} Mo</div>`; } } catch (e) { /* ignoré */ }
    el.innerHTML = `<div>${navigator.onLine ? '🟢 En ligne' : '✈️ Hors ligne'}</div>
        <div>${swReady ? '✅ Mode hors ligne prêt' : '⏳ Cache en préparation (ouvrez l\'app une fois avec Internet)'}</div>
        <div>📦 Version cache : <b>${CACHE_VERSION}</b> · App v${APP_VERSION}</div>${stockage}`;
}
window.addEventListener('online', majStatutHorsLigne); window.addEventListener('offline', majStatutHorsLigne);
function enregistrerServiceWorker() {
    if (!('serviceWorker' in navigator)) { majStatutHorsLigne(); return; }
    // Le bandeau « Nouvelle version disponible » ne s'affiche que si le service worker
    // actif porte une version différente de celle de la page (poignée de main par message).
    // Une simple ré-activation du même worker (iOS relance, re-enregistrement) ne l'affiche pas,
    // et il disparaît de lui-même dès que la page et le worker sont à la même version.
    const versionDuWorker = w => new Promise(res => {
        if (!w) return res(null);
        const ch = new MessageChannel(); const t = setTimeout(() => res(null), 1500);
        ch.port1.onmessage = ev => { clearTimeout(t); res((ev.data && ev.data.cache) || null); };
        try { w.postMessage({ type: 'VERSION?' }, [ch.port2]); } catch (err) { clearTimeout(t); res(null); }
    });
    const verifier = async w => {
        const v = await versionDuWorker(w); const b = $('maj-banner');
        if (!b || !v) return; // worker muet (ancienne version) : ne rien affirmer
        b.hidden = (v === CACHE_VERSION);
    };
    navigator.serviceWorker.register('sw.js')
        .then(reg => {
            swReady = true; majStatutHorsLigne(); if (!reg) return;
            if (reg.active) verifier(reg.active);
            const surveiller = w => { if (w) w.addEventListener('statechange', () => { if (w.state === 'activated') verifier(w); }); };
            surveiller(reg.installing); surveiller(reg.waiting);
            reg.addEventListener('updatefound', () => surveiller(reg.installing));
            if (reg.update) reg.update().catch(() => {});
        })
        .catch(err => { console.error('Service worker indisponible', err); majStatutHorsLigne(); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (navigator.serviceWorker.controller) verifier(navigator.serviceWorker.controller); });
}

async function init() {
    Medias.init();
    let data = null, migration = false;
    try { data = await localforage.getItem(CLE_DB); } catch (e) { console.error('Base illisible', e); }
    if (!data) { try { const ancien = await localforage.getItem(CLE_DB_ANCIENNE); if (ancien) { data = ancien; migration = true; } } catch (e) { /* ignoré */ } }
    await Medias.charger();
    if (data) db = data; normaliserDb();
    const nbMigres = migrerVersADN();
    if (migration || Medias.contientInline()) {
        await Medias.externaliser(); await localforage.setItem(CLE_DB, db);
        if (migration) { try { await localforage.removeItem(CLE_DB_ANCIENNE); } catch (e) { /* ignoré */ } }
    }
    $('hd-version').textContent = 'v' + APP_VERSION; const av = $('aide-version'); if (av) av.textContent = APP_VERSION;
    construireNavigation(); brancherUploader(); brancherPlanPieces(); brancherCalque(); peuplerSelects(); chargerFormulaireCopro();
    renderDocs(); renderCoproPhotos(); renderApptsList(); renderBibliFens(); updateDashboard();
    if (nbMigres) { sauvegarderLocal(); setTimeout(() => toast(`${nbMigres} libellé(s) mis à jour vers la nomenclature ADN`, { duree: 4000 }), 800); }
    const vueInitiale = location.hash.replace('#', '');
    history.replaceState({ vue: ZONE_PAR_VUE[vueInitiale] ? vueInitiale : 'accueil' }, '', location.pathname + location.search + (ZONE_PAR_VUE[vueInitiale] ? '#' + vueInitiale : ''));
    goTab(ZONE_PAR_VUE[vueInitiale] ? vueInitiale : 'accueil', { historique: false });
    enregistrerServiceWorker();
}
document.addEventListener('DOMContentLoaded', () => { init().catch(err => { console.error('Initialisation impossible', err); toast('⚠️ Erreur au démarrage : ' + err.message, { duree: 8000 }); }); });
