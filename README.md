# Âge bio

Âge biologique, rythme de vieillissement et sommeil, calculés **dans le navigateur du téléphone** à partir d'un bracelet Xiaomi Smart Band 7 Pro synchronisé avec [Gadgetbridge](https://gadgetbridge.org), et des prises de sang saisies dans l'app. Sans compte, sans serveur, sans abonnement.

Inspiration : WHOOP Age et Pace of Aging. Formule propre au projet, fondée sur des méta-analyses de mortalité toutes causes ; prise de sang : les 9 analyses et coefficients de PhenoAge (Levine 2018), comparées à la médiane des adultes du même âge et du même sexe (NHANES 1999-2010). Section *Méthode* de l'app, constantes et sources dans `CONFIG` (`calc.js`).

> Estimation personnelle fondée sur la littérature scientifique. Pas un avis médical.

## Confidentialité

- L'export choisi est lu en mémoire, analysé puis libéré : rien n'est conservé, rien n'est envoyé.
- Le profil (naissance, sexe, taille, poids) vient de Gadgetbridge, via l'export : aucune saisie, rien dans le stockage du navigateur.
- Les **prises de sang** saisies, et l'unité choisie pour chaque analyse, restent dans la mémoire de l'app, sur le téléphone (stockage local du navigateur) : jamais envoyées, jamais dans le Diagnostic, jamais dans le code publié. Effacer les données de Chrome les efface : *Prises de sang → Sauvegarder dans un fichier* (Téléchargements du téléphone). Tous les sites GitHub Pages d'un même compte partagent ce stockage : n'y publier aucun code tiers.
- Le **Diagnostic** ne contient que la structure de l'export et des comptages : c'est le seul texte à transmettre pour la mise au point.
- Aucune requête hors des fichiers du site (CSP de `index.html`) : ni analytics, ni police web, ni CDN.
- Ne jamais copier un export (`*.db`, `*.zip`) ni une sauvegarde de prises de sang (`*.json`) dans ce dossier (`.gitignore` les écarte).

## Utilisation

1. Ouvrir la page publiée dans Chrome, puis ⋮ → **Installer l'application**. Elle s'ouvre ensuite hors ligne.
2. Le soir, avant minuit : synchroniser dans Gadgetbridge (le bracelet ne transmet que le jour en cours).
3. Gadgetbridge : Paramètres → *Automations* → **Run AutoExport now** (ou attendre l'export automatique).
4. Dans l'app : **Synchroniser** → *Documents* → le fichier de l'export.
5. Après une prise de sang : *Plus* → **Prises de sang** → *Ajouter*. Le formulaire ne demande que les 9 analyses de l'âge bio, de la plus à la moins influente, chacune dans l'unité du compte rendu (G/L ou /mm³, g/L ou mmol/L…). À demander au laboratoire, par ordre d'importance : NFS avec IDR (IDR, VGM, leucocytes, lymphocytes), glycémie à jeun, créatinine, albumine, CRP (ultrasensible si possible), phosphatases alcalines.

L'âge bio s'affiche dès la première nuit ou journée valide, en valeur provisoire, avec un score de fiabilité qui grandit avec les données (100 % à 90 jours). La valeur officielle se calcule chaque dimanche et prend le relais avec 21 nuits valides sur les 31 derniers jours. Démo : `index.html?demo` (ou `?demo=nouveau`, `?demo=pause`).

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
| `app.js` | interface : écrans, navigation, affichage, saisie et sauvegarde des prises de sang |
| `calc.js` | moteur : lecture de l'export, Diagnostic, profil, calcul (`CONFIG`), prises de sang, base de démo |
| `sql-wasm.js`, `sql-wasm.wasm` | [sql.js](https://github.com/sql-js/sql.js) v1.15.2, release officielle |
| `sw.js`, `manifest.webmanifest` | installation et usage hors ligne |

## Développement

- Ni build ni dépendance hormis sql.js. Servir le dossier avec un serveur statique local, jamais en `file://`.
- À chaque livraison : incrémenter `CACHE` dans `sw.js` et `APP_VERSION` dans `calc.js` (affichée en pied de page).
- Publication : GitHub Pages, branche `main`, dossier racine.
