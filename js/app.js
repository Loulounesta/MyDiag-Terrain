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
            dlg.addEventListener('close', onClose);
            dlg.querySelectorAll('[data-val]').forEach(b => { b.onclick = () => fin(b.dataset.val === '1'); });
            dlg.showModal();
            const okBtn = dlg.querySelector('.dlg-ok'); if (okBtn) okBtn.focus();
        });
    },
    confirmer({ titre = 'Confirmation', message = '', ok = 'Confirmer', annuler = 'Annuler', danger = false } = {}) {
        if (!this._supporte()) return Promise.resolve(window.confirm((titre ? titre + '\n\n' : '') + message));
        return this._ouvrir(`
            <div class="dlg-body"><div class="dlg-title">${esc(titre)}</div><div class="dlg-msg">${esc(message)}</div></div>
            <div class="dlg-actions"><button type="button" class="dlg-cancel" data-val="0">${esc(annuler)}</button><button type="button" class="dlg-ok ${danger ? 'danger' : ''}" data-val="1">${esc(ok)}</button></div>`);
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
const APP_VERSION = '9.0.1';
const CACHE_VERSION = 'mydiag-v9-0-1'; // doit rester égal à CACHE dans sw.js
const CLE_DB = 'mydiag_v9';
const CLE_DB_ANCIENNE = 'mydiag_v8_10';
const DELAI_SAUVEGARDE = 500;

let db = { copro: {}, docs: [], vmc: {}, chaufCol: {}, ecsCol: {}, appts: [], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [] };
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
    const defauts = { copro: {}, docs: [], vmc: {}, chaufCol: {}, ecsCol: {}, appts: [], chaufs: [], ecss: [], murs: [], fens: [], modelesFens: [], portes: [], plfs: [], plas: [] };
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
    { id: 'dossier', ico: '📁', lbl: 'Dossier', vues: [{ id: 'copro', lbl: '🏢 Copro' }, { id: 'appts', lbl: '🚪 Lots' }] },
    { id: 'parois', ico: '🧱', lbl: 'Parois', vues: [{ id: 'murs', lbl: '🧱 Murs' }, { id: 'fen', lbl: '🪟 Fenêtres' }, { id: 'portes', lbl: '🚪 Portes' }, { id: 'plafonds', lbl: '🔝 Plafonds' }, { id: 'planchers', lbl: '🔽 Planchers' }] },
    { id: 'synthese', ico: '📊', lbl: 'Synthèse', vues: [{ id: 'bim', lbl: '🏗️ Schéma' }, { id: 'totaux', lbl: '🧮 Totaux' }] },
    { id: 'plus', ico: '⋯', lbl: 'Plus', vues: [{ id: 'bureau', lbl: '🖥️ Mode Bureau' }, { id: 'export', lbl: '📤 Export' }, { id: 'aide', lbl: '❓ Aide' }] }
];
const ZONE_PAR_VUE = {}; ZONES.forEach(z => z.vues.forEach(v => { ZONE_PAR_VUE[v.id] = z.id; }));
const derniereVueZone = {};
const VUES_PAROIS = ['murs', 'fen', 'portes', 'plafonds', 'planchers'];

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
    if (tabId === 'bim') renderBIM();
    if (tabId === 'totaux') renderTotauxTable();
    if (tabId === 'bureau') { renderBureauTarget(); renderBureauList(); }
    if (VUES_PAROIS.includes(tabId)) {
        resetEditParoi(); verifierAptActif(tabId); renderElementsList(tabId);
        if (tabId === 'murs') { drawCroquis(); majResumeIso(); }
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
    MURS: ["Pierre de taille moellons constitués d'un seul matériau / inconnu", "Pierre de taille moellons avec remplissage tout venant", "Pisé ou béton de terre stabilisée", "Pans de bois sans remplissage", "Briques pleines simples", "Briques creuses", "Blocs de béton pleins", "Blocs de béton creux", "Béton banché", "Brique terre cuite alvéolaire", "Ossature bois sans remplissage", "Inconnu"],
    DONNE_SUR_MURS: ["Extérieur", "Local non chauffé (autre que véranda)", "Local non chauffé et non accessible", "Circulations communes", "Local chauffé", "Bâtiment ou espace autre qu'habitation", "Comble", "Terre (paroi enterrée)", "Sous-sol non chauffé"],
    FEN_TYPE: ["Fenêtres battantes", "Fenêtres coulissantes", "Portes-fenêtres coulissantes", "Portes-fenêtres battantes sans soubassement", "Portes-fenêtres battantes avec soubassement", "Fenêtres sans ouverture possible", "Portes-fenêtres sans ouverture possible", "Fenêtre de toit (Velux)", "Hublot"],
    FEN_VITRAGE: ["Simple vitrage vertical", "Double vitrage vertical", "Survitrage vertical", "Triple vitrage vertical", "Brique de verre pleine", "Brique de verre creuse", "Polycarbonate"],
    FEN_MATIERE: ["Menuiserie PVC", "Menuiserie bois", "Menuiserie métallique avec rupture de pont thermique", "Menuiserie métallique sans rupture de pont thermique", "Menuiserie bois/métal"],
    FEN_FERMETURE: ["Absence", "Jalousie accordéon", "Fermeture sans ajours, volets roulants Alu", "Volet roulant PVC ou bois (épaisseur tablier ≤ 12mm)", "Persienne coulissante", "Volet roulant PVC ou bois (épaisseur tablier > 12mm)"],
    PLAFONDS: ["Dalle béton", "Bois sous solives bois", "Bois sur solives bois", "Entre solives bois", "Bois sur solives métallique", "Bois sous solives métallique", "Entrevous, terre-cuite, poutrelles béton", "Combles aménagés sous rampants", "Plaques de plâtre", "Inconnu"],
    DONNE_SUR_PLAFOND: ["Terrasse", "Combles aménagés", "Combles perdus", "Local chauffé", "Local non chauffé", "Circulations communes", "Extérieur"],
    PLANCHERS: ["Dalle béton", "Entre solives bois", "Bois sur solives bois", "Entre solives métallique", "Bois sur solives métalliques", "Entrevous, terre-cuite, poutrelles béton", "Voutains en brique", "Entrevous isolants", "Inconnu"],
    DONNE_SUR_PLANCHER: ["Terre-plein", "Vide sanitaire", "Local non chauffé", "Local chauffé", "Extérieur", "Circulations communes", "Terre (paroi enterrée)", "Sous-sol non chauffé"]
};
const CHAUF_GEN_MAP = {
    "Electrique": ["Pompe à chaleur Air/Eau", "Pompe à chaleur Air/Air", "Convecteur électrique NFC", "Panneau rayonnant électrique", "Radiateur électrique", "Plancher rayonnant électrique", "Chaudière électrique", "Installation collective unique"],
    "Gaz naturel": ["Radiateur gaz à ventouse", "Chaudière basse température", "Chaudière standard", "Chaudière condensation", "Chaudière PAC hybride", "Installation collective unique"],
    "GPL": ["Chaudière basse température", "Chaudière standard", "Chaudière condensation", "Installation collective unique"],
    "Fioul": ["Chaudière basse température", "Chaudière standard", "Chaudière condensation", "Installation collective unique"],
    "Réseau de chaleur": ["Installation collective unique multi bâtiment"]
};
const EMETTEUR_MAP = {
    "Electrique": ["Radiateur", "Plancher chauffant", "Plafond chauffant", "Air soufflé"],
    "Gaz naturel": ["Radiateur", "Plancher chauffant", "Plafond chauffant", "Air soufflé"],
    "GPL": ["Radiateur", "Plancher chauffant", "Air soufflé"],
    "Fioul": ["Radiateur", "Plancher chauffant", "Air soufflé"],
    "Réseau de chaleur": ["Radiateur", "Plancher chauffant", "Air soufflé"]
};
const ECS_GEN_MAP = {
    "Electrique": ["Chauffe eau thermodynamique", "Chauffe-eau horizontal", "Chauffe-eau vertical", "Pompe à chaleur Air/Eau", "Chaudière électrique", "Installation collective unique"],
    "Gaz naturel": ["Chauffe-eau gaz instantané", "Accumulateur gaz", "Chaudière basse température", "Chaudière standard", "Chaudière condensation", "Production par la chaudière", "Installation collective unique"],
    "GPL": ["Production par la chaudière", "Installation collective unique"],
    "Fioul": ["Production par la chaudière", "Installation collective unique"],
    "Réseau de chaleur": ["Installation collective unique multi bâtiment"]
};
const ENERGIES_IND = ["Electrique", "Gaz naturel", "GPL", "Fioul", "Bois", "Charbon"];

function peuplerSelects() {
    const fill = (id, arr) => { const el = $(id); if (el) el.innerHTML = arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); };
    fill('m-mat', ADN.MURS); fill('m-donne', ADN.DONNE_SUR_MURS); fill('f-type', ADN.FEN_TYPE); fill('f-mat', ADN.FEN_MATIERE); fill('f-vit', ADN.FEN_VITRAGE); fill('f-fer', ADN.FEN_FERMETURE);
    fill('p-type', ADN.PLAFONDS); fill('p-donne', ADN.DONNE_SUR_PLAFOND); fill('s-type', ADN.PLANCHERS); fill('s-donne', ADN.DONNE_SUR_PLANCHER); fill('bur-mat', ADN.MURS); fill('bur-donne', ADN.DONNE_SUR_MURS);
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
    if (db.vmc.type) $('vmc-type').value = db.vmc.type;
    if (db.vmc.periode) $('vmc-periode').value = db.vmc.periode;
    if (db.chaufCol.energie) { $('col-chauf-energie').value = db.chaufCol.energie; updateChaufGen('col-chauf-energie', 'col-chauf-gen', 'col-chauf-emetteur'); $('col-chauf-gen').value = db.chaufCol.gen || ''; $('col-chauf-emetteur').value = db.chaufCol.emetteur || ''; }
    $('col-chauf-annee').value = db.chaufCol.annee || ''; $('col-chauf-puissance').value = db.chaufCol.puissance || '';
    if (db.ecsCol.energie) { $('col-ecs-energie').value = db.ecsCol.energie; updateEcsGen('col-ecs-energie', 'col-ecs-type'); $('col-ecs-type').value = db.ecsCol.type || ''; }
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
    cloneItems('murs', 'aid'); cloneItems('fens', 'aid'); cloneItems('portes', 'aid'); cloneItems('plfs', 'aid'); cloneItems('plas', 'aid'); cloneItems('chaufs', 'aptId'); cloneItems('ecss', 'aptId');
    curAppt = newId; curNivInt = 0; expAppts[newId] = true; sauvegarderLocal(); renderApptsList(); updateDashboard(); toast('Appartement dupliqué sous ' + newNumStr + ' ✓');
}
function toggleAppt(id) { expAppts[id] = !expAppts[id]; renderApptCard(id); }
async function suppAppt(id) {
    const targetId = String(id); const apt = db.appts.find(a => String(a.id) === targetId); if (!apt) return;
    if (!await Dialogue.confirmer({ titre: `Supprimer le lot ${apt.num} ?`, message: 'L’appartement et toutes ses parois, systèmes et plans seront définitivement supprimés.', ok: 'Supprimer', danger: true })) return;
    db.docs = db.docs.filter(d => !d.name.startsWith(`Croquis_${apt.num}_`));
    db.appts = db.appts.filter(a => String(a.id) !== targetId);
    ['murs', 'fens', 'portes', 'plfs', 'plas'].forEach(k => { db[k] = db[k].filter(m => String(m.aid) !== targetId); });
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
    el.innerHTML = `<span class="badge-elem">🧱 ${m}</span> <span class="badge-elem">🪟 ${n('fens')}</span> <span class="badge-elem">🚪 ${n('portes')}</span> <span class="badge-elem">🔝 ${n('plfs')}</span> <span class="badge-elem">🔽 ${n('plas')}</span> <span class="badge-elem ${myC ? 'badge-ok' : 'badge-warn'}">🔥 ${myC}</span> <span class="badge-elem ${myE ? 'badge-ok' : 'badge-warn'}">🚿 ${myE}</span> ${badgeSchema}`;
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
    $(`ifc-energie-${aptId}`).value = c.energie; updateChaufGen(`ifc-energie-${aptId}`, `ifc-gen-${aptId}`, `ifc-emetteur-${aptId}`);
    $(`ifc-gen-${aptId}`).value = c.gen; $(`ifc-emetteur-${aptId}`).value = c.emetteur || ''; $(`ifc-annee-${aptId}`).value = c.annee || ''; $(`ifc-puissance-${aptId}`).value = c.puissance || '';
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
    $(`ife-energie-${aptId}`).value = e.energie; updateEcsGen(`ife-energie-${aptId}`, `ife-type-${aptId}`);
    $(`ife-type-${aptId}`).value = e.type; $(`ife-annee-${aptId}`).value = e.annee || ''; $(`ife-vol-${aptId}`).value = e.vol || '';
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
    plas:   { vue: 'planchers', list: 'list-plas',   sel: 'pla-target',  niv: 'pla-niv-container',  form: 'form-planchers', nom: 'ce plancher', nomF: 'Plancher' }
};
const TYPE_PAR_VUE = { murs: 'murs', fen: 'fens', fens: 'fens', portes: 'portes', plafonds: 'plfs', plfs: 'plfs', planchers: 'plas', plas: 'plas' };
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
function changeTargetApt(val, tab) { resetEditParoi(); curAppt = val; curNivInt = 0; verifierAptActif(tab); renderElementsList(tab); if (tab === 'murs') drawCroquis(); majBarreAction(); }
function setNivInt(i, tab) { resetEditParoi(); curNivInt = i; verifierAptActif(tab); renderElementsList(tab); if (tab === 'murs') drawCroquis(); majBarreAction(); }
Actions.setNiv = d => setNivInt(parseInt(d.i), d.tab);

function sauverParoi(type) {
    if (!curAppt) curAppt = 'copro';
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
    } else if (type === 'portes') {
        if (!v('po-l') || !v('po-h')) { toast('⚠️ Largeur et hauteur requises'); $(v('po-l') ? 'po-h' : 'po-l').focus(); return; }
        el.type = v('po-type'); el.mat = v('po-mat'); el.donne = v('po-donne'); el.iso = v('po-iso'); el.sas = v('po-sas'); el.l = v('po-l'); el.h = v('po-h');
    } else if (type === 'plfs') {
        if (!v('p-s') && !(v('p-l') && v('p-larg'))) { toast('⚠️ Dimensions ou surface requises'); $('p-l').focus(); return; }
        el.type = v('p-type'); el.donne = v('p-donne'); el.l = v('p-l'); el.larg = v('p-larg'); el.s = v('p-s'); el.iso = v('p-iso'); el.isoEp = v('p-iso-ep');
    } else if (type === 'plas') {
        if (!v('s-s') && !(v('s-l') && v('s-larg'))) { toast('⚠️ Dimensions ou surface requises'); $('s-l').focus(); return; }
        el.type = v('s-type'); el.donne = v('s-donne'); el.l = v('s-l'); el.larg = v('s-larg'); el.s = v('s-s'); el.iso = v('s-iso'); el.isoEp = v('s-iso-ep');
    }
    const etaitEdition = !!editParoiId;
    if (!editParoiId) db[type].push(el);
    editParoiId = null;
    sauvegarderLocal(); renderElementsList(type); majBarreAction();
    if (curAppt !== 'copro') updateApptBadges(curAppt);
    // Mémoire de saisie : on ne vide que les dimensions, les propriétés restent pour l'élément suivant.
    if (type === 'murs') { $('m-l').value = ''; drawCroquis(); $('m-l').focus(); }
    else if (type === 'fens') { $('f-l').value = ''; $('f-h').value = ''; $('f-diam').value = ''; }
    else if (type === 'portes') { $('po-l').value = ''; $('po-h').value = ''; }
    else if (type === 'plfs') { $('p-l').value = ''; $('p-larg').value = ''; $('p-s').value = ''; }
    else if (type === 'plas') { $('s-l').value = ''; $('s-larg').value = ''; $('s-s').value = ''; }
    toast(etaitEdition ? 'Modification enregistrée ✓' : 'Enregistré ✓ Propriétés conservées.');
}
function editerParoi(type, id) {
    const p = db[type].find(x => String(x.id) === String(id)); if (!p) return;
    editParoiId = p.id; const set = (i, val) => { const e = $(i); if (e) e.value = val; };
    if (type === 'murs') {
        set('m-ori', p.ori); set('m-donne', p.donne); set('m-mat', p.mat); set('m-l', p.l); set('m-h', p.h); set('m-ep', p.ep || ''); set('m-doub', p.doub || 'ABSENT'); set('m-iso', p.iso || 'Non'); set('m-iso-ep', p.isoEp || '');
        if ((p.iso && p.iso !== 'Non') || (p.doub && p.doub !== 'ABSENT')) ouvrirAcc('acc-iso-murs'); majResumeIso();
    } else if (type === 'fens') {
        set('f-ori', p.ori || 'Nord'); set('f-type', p.type); toggleFenType(); set('f-mat', p.mat); set('f-vit', p.vit); set('f-ep', p.ep || ''); set('f-fer', p.fer); set('f-l', p.l || ''); set('f-h', p.h || ''); set('f-diam', p.diam || ''); set('f-nb', p.nb || '1'); set('f-motifs', p.motifs || '1');
    } else if (type === 'portes') {
        set('po-type', p.type || 'Porte opaque pleine'); set('po-mat', p.mat || 'Bois'); set('po-donne', p.donne || 'Extérieur'); set('po-iso', p.iso || 'Non isolée / Inconnue'); set('po-sas', p.sas || 'Non'); set('po-l', p.l || ''); set('po-h', p.h || '');
    } else if (type === 'plfs') {
        set('p-type', p.type); set('p-donne', p.donne); set('p-l', p.l || ''); set('p-larg', p.larg || ''); set('p-s', p.s || ''); set('p-iso', p.iso || 'Non'); set('p-iso-ep', p.isoEp || '');
    } else if (type === 'plas') {
        set('s-type', p.type); set('s-donne', p.donne); set('s-l', p.l || ''); set('s-larg', p.larg || ''); set('s-s', p.s || ''); set('s-iso', p.iso || 'Non'); set('s-iso-ep', p.isoEp || '');
    }
    majBarreAction(); scrollVers(PAROIS[type].form);
}
function clonerParoi(type, id) { const src = db[type].find(x => String(x.id) === String(id)); if (!src) return; db[type].push({ ...src, id: Date.now() + Math.random(), nivInt: curNivInt }); sauvegarderLocal(); renderElementsList(type); if (type === 'murs') drawCroquis(); if (curAppt !== 'copro') updateApptBadges(curAppt); toast('Élément cloné ✓'); }
function suppElement(type, id) {
    const idx = db[type].findIndex(x => String(x.id) === String(id)); if (idx < 0) return;
    const item = db[type][idx]; db[type].splice(idx, 1);
    if (editParoiId === item.id) { editParoiId = null; majBarreAction(); }
    const apres = () => { sauvegarderLocal(); renderElementsList(type); if (type === 'murs') drawCroquis(); if (curAppt !== 'copro') updateApptBadges(curAppt); updateDashboard(); };
    apres();
    toastAnnuler('Élément supprimé', () => { db[type].splice(idx, 0, item); apres(); });
}
Actions.clonerParoi = d => clonerParoi(d.type, d.id);
Actions.editerParoi = d => editerParoi(d.type, d.id);
Actions.suppElement = d => suppElement(d.type, d.id);

function renderElementsList(tabId) {
    if (!curAppt) curAppt = 'copro';
    const type = TYPE_PAR_VUE[tabId]; if (!type) return; const cont = $(PAROIS[type].list); const data = db[type];
    cont.innerHTML = data.filter(x => x.aid === curAppt && (x.nivInt || 0) === curNivInt).map(x => {
        let dimText = ''; let titleText = x.mat || x.type;
        if (type === 'fens') {
            dimText = x.type === 'Hublot' ? `Ø: ${esc(x.diam || '?')}cm (Surf: ${esc(x.surf || '?')}m²) | Lame: ${esc(x.ep || '?')}mm | Qté: ${esc(x.nb || 1)} (Motifs: ${esc(x.motifs || 1)})` : `Dim: ${esc(x.l || '?')}x${esc(x.h || '?')}cm | Lame: ${esc(x.ep || '?')}mm | Qté: ${esc(x.nb || 1)} (Motifs: ${esc(x.motifs || 1)})`;
            titleText = `${x.nom ? esc(x.nom) + ' - ' : ''}${esc(x.type || '')}`;
            dimText = `${esc(x.mat || '')} | ${esc(x.vit || '')}<br>Fermeture : ${esc(x.fer || 'Absence')}<br>` + dimText;
        } else if (type === 'plfs' || type === 'plas') {
            dimText = x.s ? `Surf: ${esc(x.s)}m²` : `Dim: ${esc(x.l || '?')} x ${esc(x.larg || '?')}m`;
            if (x.iso && x.iso !== 'Non') dimText += ` | Iso: ${esc(x.iso)}${x.isoEp ? ' ' + esc(x.isoEp) + 'cm' : ''}`; titleText = esc(titleText);
        } else if (type === 'murs') {
            dimText = `Dim: ${esc(x.l || '?')} x ${esc(x.h || '?')}m`; if (x.ep) dimText += ` | Ep: ${esc(x.ep)}cm`;
            if (x.iso && x.iso !== 'Non') dimText += ` | Iso: ${esc(x.iso)}${x.isoEp ? ' ' + esc(x.isoEp) + 'cm' : ''}`;
            titleText = (x.vectX !== undefined) ? 'Mur (Fermeture auto)' : esc(titleText);
        } else if (type === 'portes') { dimText = `Dim: ${esc(x.l || '?')} x ${esc(x.h || '?')}m | Iso: ${esc(x.iso || 'Non')} | Sas: ${esc(x.sas || 'Non')}`; titleText = `${esc(x.type)} (${esc(x.mat || '?')})`; }
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
    $('f-ori').value = m.ori || 'Nord'; $('f-type').value = m.type; toggleFenType(); $('f-mat').value = m.mat; $('f-vit').value = m.vit; $('f-ep').value = m.ep || ''; $('f-fer').value = m.fer;
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
    const rep = f.nom || 'F?'; let typeAbr = '';
    if (f.type) { if (f.type === 'Fenêtres battantes') typeAbr = 'FB'; else if (f.type === 'Fenêtres coulissantes') typeAbr = 'FC'; else if (f.type === 'Portes-fenêtres coulissantes') typeAbr = 'PFC'; else if (f.type.includes('Portes-fenêtres battantes')) typeAbr = 'PFB'; else if (f.type.includes('sans ouverture')) typeAbr = 'Fixe'; else if (f.type.includes('toit')) typeAbr = 'Velux'; else if (f.type === 'Hublot') typeAbr = 'Hublot'; }
    const dim = f.type === 'Hublot' ? `Ø${f.diam}` : `${f.l}x${f.h}`; let matAbr = '';
    if (f.mat) { if (f.mat.includes('PVC')) matAbr = 'PVC'; else if (f.mat.includes('bois/métal')) matAbr = 'Bois/Métal'; else if (f.mat.includes('bois')) matAbr = 'Bois'; else if (f.mat.includes('avec rupture')) matAbr = 'Métal RPT'; else if (f.mat.includes('sans rupture')) matAbr = 'Métal'; }
    let vitAbr = '';
    if (f.vit) { if (f.vit.includes('Simple')) vitAbr = 'SV'; else if (f.vit.includes('Double')) vitAbr = 'DV' + (f.ep ? ` 4/${f.ep}/4` : ''); else if (f.vit.includes('Triple')) vitAbr = 'TV' + (f.ep ? ` 4/${f.ep}/4/${f.ep}/4` : ''); else if (f.vit.includes('Survitrage')) vitAbr = 'Surv.'; else if (f.vit.includes('Brique')) vitAbr = 'Brique'; else if (f.vit.includes('Polycarbonate')) vitAbr = 'Poly.'; }
    let ferAbr = '';
    if (f.fer) { if (f.fer === 'Absence') ferAbr = 'sFerm'; else if (f.fer.includes('volets roulants Alu')) ferAbr = 'aVR Alu'; else if (f.fer.includes('Volet roulant')) ferAbr = 'aVR'; else if (f.fer.includes('Persienne')) ferAbr = 'aPers.'; else if (f.fer.includes('Jalousie')) ferAbr = 'aJalousie'; }
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
    feuille(db.fens.map(f => ({ "Lot": getAptNum(f.aid), "Niveau": f.nivInt || 0, "Code ANALYSIMMO": genererCodeFen(f), "Repère": f.nom || "", "Orientation": f.ori || "", "Type": f.type || "", "Matériau": f.mat || "", "Vitrage": f.vit || "", "Ép. Lame (mm)": f.ep || "", "Fermeture": f.fer || "", "Largeur (cm)": f.l || "", "Hauteur (cm)": f.h || "", "Diamètre (cm)": f.diam || "", "Surface Unitaire (m²)": f.surf || "", "Quantité": f.nb || 1, "Motifs": f.motifs || 1 })), 'Fenêtres');
    feuille(db.portes.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type": p.type || "", "Matériau": p.mat || "", "Donne sur": p.donne || "", "Isolation": p.iso || "", "Sas": p.sas || "", "Largeur (m)": p.l || "", "Hauteur (m)": p.h || "" })), 'Portes');
    feuille(db.plfs.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type ADN": p.type || "", "Donne sur": p.donne || "", "Longueur (m)": p.l || "", "Largeur (m)": p.larg || "", "Surface (m²)": p.s || "", "Isolant": p.iso || "", "Ép. Isolant (cm)": p.isoEp || "" })), 'Plafonds');
    feuille(db.plas.map(p => ({ "Lot": getAptNum(p.aid), "Niveau": p.nivInt || 0, "Type ADN": p.type || "", "Donne sur": p.donne || "", "Longueur (m)": p.l || "", "Largeur (m)": p.larg || "", "Surface (m²)": p.s || "", "Isolant": p.iso || "", "Ép. Isolant (cm)": p.isoEp || "" })), 'Planchers');
    feuille(db.chaufs.map(c => ({ "Lot": getAptNum(c.aptId), "Énergie": c.energie || "", "Générateur": c.gen || "", "Émetteur": c.emetteur || "", "Année": c.annee || "", "Puissance (kW)": c.puissance || "" })), 'Chauffages');
    feuille(db.ecss.map(e => ({ "Lot": getAptNum(e.aptId), "Énergie": e.energie || "", "Type/Générateur": e.type || "", "Année": e.annee || "", "Volume (L)": e.vol || "" })), 'ECS');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (await Plateforme.enregistrerFichier(blob, `Export_MyDiag_${db.copro.ref || 'Projet'}_${horodatage()}.xlsx`)) toast('Fichier Excel enregistré ✓');
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
    if (migration || Medias.contientInline()) {
        await Medias.externaliser(); await localforage.setItem(CLE_DB, db);
        if (migration) { try { await localforage.removeItem(CLE_DB_ANCIENNE); } catch (e) { /* ignoré */ } }
    }
    $('hd-version').textContent = 'v' + APP_VERSION; const av = $('aide-version'); if (av) av.textContent = APP_VERSION;
    construireNavigation(); brancherUploader(); peuplerSelects(); chargerFormulaireCopro();
    renderDocs(); renderCoproPhotos(); renderApptsList(); renderBibliFens(); updateDashboard();
    const vueInitiale = location.hash.replace('#', '');
    history.replaceState({ vue: ZONE_PAR_VUE[vueInitiale] ? vueInitiale : 'accueil' }, '', location.pathname + location.search + (ZONE_PAR_VUE[vueInitiale] ? '#' + vueInitiale : ''));
    goTab(ZONE_PAR_VUE[vueInitiale] ? vueInitiale : 'accueil', { historique: false });
    enregistrerServiceWorker();
}
document.addEventListener('DOMContentLoaded', () => { init().catch(err => { console.error('Initialisation impossible', err); toast('⚠️ Erreur au démarrage : ' + err.message, { duree: 8000 }); }); });
