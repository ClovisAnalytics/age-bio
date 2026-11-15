# Âge bio

Âge biologique, rythme de vieillissement et sommeil, calculés **dans le navigateur du téléphone** à partir d'un bracelet Xiaomi Smart Band 7 Pro synchronisé avec [Gadgetbridge](https://gadgetbridge.org). Sans compte, sans serveur, sans abonnement.

Inspiration : WHOOP Age et Pace of Aging. Formule propre au projet, fondée sur des méta-analyses de mortalité toutes causes : section *Méthode* de l'app, constantes et sources dans `CONFIG` (`calc.js`).

> Estimation personnelle fondée sur la littérature scientifique. Pas un avis médical.

## Confidentialité

- L'export choisi est lu en mémoire, analysé puis libéré : rien n'est conservé, rien n'est envoyé.
- Le profil (naissance, sexe, taille, poids) vient de Gadgetbridge, via l'export : aucune saisie, rien dans le stockage du navigateur.
- Le **Diagnostic** ne contient que la structure de l'export et des comptages : c'est le seul texte à transmettre pour la mise au point.
- Aucune requête hors des fichiers du site (CSP de `index.html`) : ni analytics, ni police web, ni CDN.
- Ne jamais copier un export (`*.db`, `*.zip`) dans ce dossier.

## Utilisation

1. Ouvrir la page publiée dans Chrome, puis ⋮ → **Installer l'application**. Elle s'ouvre ensuite hors ligne.
2. Le soir, avant minuit : synchroniser dans Gadgetbridge (le bracelet ne transmet que le jour en cours).
3. Gadgetbridge : Paramètres → *Automations* → **Run AutoExport now** (ou attendre l'export automatique).
4. Dans l'app : **Synchroniser** → *Documents* → le fichier de l'export.

L'âge bio officiel se calcule chaque dimanche et se débloque avec 21 nuits valides sur les 31 derniers jours. Démo : `index.html?demo` (ou `?demo=nouveau`, `?demo=pause`).

## Mise en place de Gadgetbridge

1. Installer Gadgetbridge depuis [F-Droid](https://f-droid.org/packages/nodomain.freeyourgadget.gadgetbridge/).
2. Récupérer la clé d'authentification du bracelet ([documentation](https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/)) : dans les journaux de Mi Fitness (`Android/data/com.xiaomi.wearable/files/log/`, chercher `encryptKey` ou `authKey`, prendre la dernière suite de 32 caractères hexadécimaux), sinon avec [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor). Ne jamais désappairer ni réinitialiser le bracelet dans Mi Fitness. La clé reste privée.
3. Retirer à Mi Fitness les autorisations Bluetooth et Appareils à proximité (ou le désinstaller).
4. Gadgetbridge : « + » → appui long sur le bracelet → *Auth key* → `0x` suivi de la clé → appairer.
5. Réglages :
   - Paramètres → *À propos de vous* : date de naissance, sexe, taille, poids (à tenir à jour).
   - Bracelet → *Mesure du pouls toute la journée* : **une fois par minute** ; *Utiliser le capteur cardiaque pour améliorer la détection du sommeil* : **activé**.
   - Paramètres → *Automations* : récupération au déverrouillage ; export automatique **de la base de données** (pas le ZIP) vers **Documents/**, intervalle le plus court.
   - Android → Applications → Gadgetbridge → Batterie : **Sans restriction**.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | page, CSP, texte de la méthode |
| `style.css` | styles, thèmes sombre et clair |
| `app.js` | interface : écrans, navigation, affichage |
| `calc.js` | moteur : lecture de l'export, Diagnostic, profil, calcul (`CONFIG`), base de démo |
| `sql-wasm.js`, `sql-wasm.wasm` | [sql.js](https://github.com/sql-js/sql.js) v1.15.2, release officielle |
| `sw.js`, `manifest.webmanifest` | installation et usage hors ligne |

## Développement

- Ni build ni dépendance hormis sql.js. Servir le dossier avec un serveur statique local, jamais en `file://`.
- À chaque livraison : incrémenter `CACHE` dans `sw.js` et `APP_VERSION` dans `calc.js` (affichée en pied de page).
- Publication : GitHub Pages, branche `main`, dossier racine.
