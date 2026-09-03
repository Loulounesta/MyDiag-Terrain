# Passage en application native (iOS et Android)

Notice de référence pour transformer MyDiag-DPE en application publiable
sur l'App Store et le Play Store, à l'aide de **Capacitor**.

L'application web actuelle est déjà préparée pour ce passage : aucune
dépendance réseau, et tous les accès système sont regroupés dans un seul
endroit du code.

---

## 1. Ce qui est déjà prêt

| Prérequis | État |
|---|---|
| Bibliothèques embarquées localement (`lib/`) | ✅ fait |
| Code séparé : `index.html`, `css/app.css`, `js/app.js` | ✅ fait |
| Rendu des plans PDF embarqué (`lib/pdf.min.js`) | ✅ fait |
| Aucun appel à un CDN externe | ✅ fait |
| Accès système regroupés dans l'objet `Plateforme` | ✅ fait |
| Manifeste et icône d'application | ✅ fait |
| Fonctionnement hors connexion | ✅ fait |

L'objet **`Plateforme`** (section 1 de `js/app.js`) est le
seul point à adapter. Il expose trois fonctions :

- `enregistrerFichier(blob, nom)` — export Excel, ZIP, backup JSON
- `ouvrirFichier(blob, nom)` — ouverture d'un PDF ou d'une image
- `demanderFichier(inputId)` — prise de photo / choix d'un fichier

En natif, elles délèguent à `window.CapacitorPlugins` si cet objet existe.
Il suffit donc de le définir : **le reste de l'application ne change pas.**

---

## 2. Prérequis

- **macOS** avec **Xcode** (compilation iPhone/iPad)
- **Android Studio** (compilation Android)
- **Node.js** (version 18 ou supérieure)
- Compte **Apple Developer** — 99 €/an, pour publier sur l'App Store
- Compte **Google Play Console** — 25 $ une seule fois

---

## 3. Mise en place

Depuis une copie du dépôt, sur le Mac :

```bash
npm init -y
npm install @capacitor/core @capacitor/cli
npm install @capacitor/filesystem @capacitor/share @capacitor/camera
npx cap init "MyDiag-DPE" "fr.mydiag.dpe" --web-dir=.
npx cap add ios
npx cap add android
```

> `--web-dir=.` indique que `index.html` se trouve à la racine du dépôt.

À chaque modification du code web :

```bash
npx cap sync
npx cap open ios      # ouvre Xcode
npx cap open android  # ouvre Android Studio
```

---

## 4. Brancher les fonctions natives

Créer un fichier `native.js`, puis l'ajouter dans `index.html`
**avant** le `<script src="js/app.js" defer>` principal :

```html
<script type="module" src="native.js"></script>
```

Contenu de `native.js` :

```js
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const versBase64 = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onloadend = () => resolve(String(r.result).split(',')[1]);
  r.readAsDataURL(blob);
});

window.CapacitorPlugins = {
  // Enregistre dans les documents de l'app, puis propose le partage
  async enregistrer(blob, nomFichier) {
    const data = await versBase64(blob);
    const res = await Filesystem.writeFile({
      path: nomFichier, data, directory: Directory.Documents
    });
    await Share.share({ title: nomFichier, url: res.uri });
    return true;
  },

  async ouvrir(blob, nomFichier) {
    const data = await versBase64(blob);
    const res = await Filesystem.writeFile({
      path: `tmp_${nomFichier}`, data, directory: Directory.Cache
    });
    await Share.share({ title: nomFichier, url: res.uri });
    return true;
  }
};
```

L'appareil photo continue de fonctionner via le champ de fichier HTML.
Pour une meilleure ergonomie, on pourra plus tard utiliser le module
`@capacitor/camera` dans `demanderFichier`.

---

## 5. Autorisations à déclarer

**iOS** — dans `ios/App/App/Info.plist` :

```xml
<key>NSCameraUsageDescription</key>
<string>Photographier les équipements et façades lors du relevé.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Joindre des photos existantes au dossier de diagnostic.</string>
```

**Android** — dans `android/app/src/main/AndroidManifest.xml` :

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

---

## 6. Points de vigilance

- **Les données existantes ne sont pas transférées.** Le stockage du
  navigateur et celui de l'application native sont séparés. Pour reprendre
  un dossier en cours : exporter un **backup JSON** depuis la version web,
  puis le **restaurer** dans l'application native.
- **Avantage majeur du natif :** les données deviennent des données
  d'application (sauvegardées avec iCloud / Google, jamais purgées),
  contrairement au stockage navigateur qui peut être effacé par le système.
- **Le calque de plan** utilise `lib/pdf.min.js` et son worker `lib/pdf.worker.min.js` :
  les deux fichiers doivent rester côte à côte dans `lib/`, y compris en natif.
- **Les photos sont stockées dans un store IndexedDB séparé** (`mydiag-medias`) ;
  le backup JSON les ré-intègre automatiquement, rien à faire côté natif.
- **Le service worker (`sw.js`) est inutile en natif** — les fichiers sont
  déjà embarqués. Il reste indispensable pour la version web.
- **Validation Apple :** compter 1 à 7 jours par version. Prévoir une
  politique de confidentialité (les données restent sur l'appareil).
- **Numéro de version :** à incrémenter dans Xcode et Android Studio à
  chaque publication, en plus de `APP_VERSION` dans `js/app.js` et
  du nom de cache dans `sw.js`.

---

## 7. Ordre conseillé

1. Publier d'abord sur **Android** (validation rapide, 25 $ une fois) —
   cela permet de valider toute la chaîne à moindre risque.
2. Puis **iOS**, une fois le fonctionnement confirmé.
3. Conserver la **version web** en parallèle : elle reste le moyen le plus
   simple de tester une correction immédiatement, sans passer par une
   validation de store.
