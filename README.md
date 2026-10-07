# Livechat Overlay

Overlay transparent, sans bordure et toujours au premier plan, qui permet d'afficher du contenu (texte, images, vidéos, GIFs) par-dessus n'importe quelle application ouverte sur l'écran. Pensé pour un usage entre amis, à but humoristique — pas pour du stream OBS.

Le contenu à afficher est envoyé en temps réel via un serveur WebSocket (bot de chat), et s'affiche automatiquement à l'écran pendant quelques secondes avant de disparaître.

## Fonctionnalités

- Fenêtre transparente, sans bordure, toujours au premier plan, invisible aux clics de souris et absente de la barre des tâches.
- Réception des médias en temps réel via WebSocket, avec reconnexion automatique en cas de coupure.
- Affichage de l'auteur du message (nom + avatar), d'un texte et d'un média.
- Extraction automatique de la vidéo directe depuis des liens Twitter/X, TikTok et Instagram (lecture du flux brut, sans passer par le lecteur/l'interface d'origine de ces plateformes).
- Lecture YouTube via le lecteur officiel : liens `watch`, `youtu.be`, `shorts`, `live` et `embed`, avec prise en charge du temps de départ (`t=90`, `t=1m30s`, `start=90`).
- Repositionnement à l'écran (4 coins) et zoom (de 30 % à 150 %) à la volée, sans redémarrer l'app.
- Contrôle via l'icône dans la zone de notification (tray) ou via des raccourcis clavier globaux.

## Configuration

Double-cliquer sur l'icône de notification ou utiliser `Ctrl+Alt+O` pour ouvrir la fenêtre de configuration. Volume, taille et position s'appliquent immédiatement et sont sauvegardés pour le prochain lancement. Les raccourcis et la fenêtre restent synchronisés.

Un aperçu schématique accompagne les réglages. Le bouton de test affiche un message pendant 10 secondes en remplaçant le média en cours. Le bouton de remise à zéro restaure le volume à 100 %, la taille à 70 %, la position en haut à droite et le format automatique.

La petite croix à droite du pseudo de l'émetteur apparaît uniquement lorsqu'un média ou un message reçu est en cours d'affichage, y compris pendant son chargement. Elle arrête ce contenu sans quitter l'application, puis disparaît. Le pseudo réserve un peu d'espace à sa droite ; la croix suit sa ligne lors des changements de position, de taille et de média, sans décaler l'overlay vers le bas. Le reste de l'overlay laisse passer les clics. Pour quitter l'application, utiliser « Quitter » dans le menu de notification.

Le format YouTube **Automatique** utilise un lecteur vertical 9:16 pour les liens `/shorts/` et horizontal 16:9 pour les autres liens. Pour une vidéo verticale partagée avec un lien `youtu.be` ou `watch`, choisir **Vertical**. Le changement redimensionne le lecteur en cours sans relancer la vidéo. Cela évite les bandes latérales dues au lecteur horizontal, mais ne supprime pas les bandes encodées dans la vidéo. À faible zoom, le lecteur conserve une surface minimale de 200 × 200 pixels.

## Application et cache

Dans **Application & maintenance**, la case **Démarrer avec Windows** permet d'activer ou désactiver le démarrage automatique de l'exécutable portable. Au premier lancement de cette version, le choix déjà présent dans Windows est conservé. La remise à zéro des réglages d'affichage ne modifie pas ce choix. En développement, cette case ne modifie pas le démarrage de Windows.

Le cache réseau est vidé au premier moment sans lecture, puis au plus tôt tous les sept jours pendant que l'application fonctionne. La date du dernier nettoyage est conservée entre les lancements. **Vider le cache maintenant** déclenche aussi ce nettoyage ; si un média est en cours, la demande attend sa fin. Le cache principal correspond normalement à `%APPDATA%\livechat-overlay\Cache\Cache_Data`. Le nettoyage utilise l'API Electron et préserve les cookies, le stockage local et les réglages. Les données du cache peuvent réapparaître dès qu'une nouvelle requête les recrée.

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+Alt+O` | Ouvrir la configuration |
| `Ctrl+Alt+P` | Changer de position à l'écran (cycle entre les 4 coins) |
| `Ctrl+Alt+↑` | Agrandir l'overlay (+10 %) |
| `Ctrl+Alt+↓` | Réduire l'overlay (-10 %) |
| `Ctrl+Alt+→` | Augmenter le volume (+10 %) |
| `Ctrl+Alt+←` | Réduire le volume (-10 %) |
| `Ctrl+Alt+X` | Arrêter et masquer le média en cours |

Ces mêmes actions sont aussi disponibles depuis le menu de l'icône dans la zone de notification (clic droit), et un double-clic sur l'icône ouvre la configuration.

## Prérequis

- [Node.js](https://nodejs.org/)
- Windows (l'application n'est packagée que pour Windows pour l'instant)

## Installation / lancement en développement

```bash
npm install
npm start
```

## Générer l'exécutable Windows

Depuis Windows, installer Node.js, puis ouvrir PowerShell dans le dossier du projet. Installer les dépendances à partir du fichier de verrouillage et lancer les tests avant de compiler :

```powershell
npm ci
npm test
npm run build
```

Le fichier **portable à récupérer et à distribuer** est :

```text
dist\livechat-overlay 1.0.0.exe
```

Le numéro dans le nom correspond à la version définie dans `package.json`. Ce fichier contient l'application et ses dépendances ; il peut être copié seul sur un autre PC Windows x64. Pour une release GitHub, joindre ce fichier à la release. Il peut être renommé `livechat-overlay.exe` après compilation.

**Ne pas distribuer seul `dist\win-unpacked\livechat-overlay.exe`.** Cet exécutable dépend des DLL, du dossier `resources` et des autres fichiers présents dans `win-unpacked`. Copié seul, il ne peut pas lancer l'application correctement. Pour distribuer cette variante, il faut zipper le dossier `win-unpacked` complet, puis extraire toute l'archive avant de lancer l'exécutable.

Au lancement, l'overlay reste transparent tant qu'aucun message n'arrive. Son icône apparaît dans la zone de notification de Windows, éventuellement derrière la flèche des icônes masquées. Double-cliquer dessus ou utiliser `Ctrl+Alt+O` pour ouvrir la configuration et afficher un message de test.

Le build est non signé et désactive l'édition des ressources de l'exécutable (`signAndEditExecutable: false`) pour éviter le besoin de liens symboliques/privilèges supplémentaires avec l'outil de packaging. L'exécutable conserve donc les ressources Electron par défaut ; l'icône de notification utilise `icon.png`. Seuls les fichiers nécessaires à l'application sont inclus ; les anciens fichiers `*-player-script.js` ne sont ni exécutés ni distribués.

## Envoyer une vidéo YouTube

Le bot doit transmettre ce message sur la connexion WebSocket existante :

```json
{
  "type": "play_media",
  "url": "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=30",
  "text": "Regarde cette vidéo !",
  "author": "Alice",
  "avatar": "https://example.com/avatar.png"
}
```

Un lien YouTube dans `text` est aussi reconnu lorsque `url` est absent. Le code du bot n'est pas dans ce dépôt : si le bot filtre les liens YouTube avant de les transmettre, il faudra adapter ce filtre côté bot. Aucun téléchargement ni clé API YouTube n'est nécessaire. Le volume s'applique au lecteur et la fin de la vidéo masque l'overlay. Une nouvelle demande remplace la précédente. Pour un direct, utiliser le raccourci d'arrêt.

L'application sert uniquement ses fichiers d'interface sur une adresse locale `127.0.0.1` avec un port attribué au lancement. Cela fournit au lecteur YouTube un contexte Web et l'en-tête `Referer` requis, absents avec un simple chargement `file://`. Voir les [exigences du lecteur intégré](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity) et l'[API officielle](https://developers.google.com/youtube/iframe_api_reference).

Les sous-titres ajoutés par le lecteur YouTube sont désactivés automatiquement, y compris lorsqu'ils se chargent après le début de la lecture. Cette désactivation utilise une fonction exposée par le lecteur actuel mais non garantie par son API documentée ; si YouTube la retire, la vidéo continue de jouer. Les textes incrustés dans les images de la vidéo restent visibles.

Les requêtes vidéo vers `video.twimg.com` omettent l’en-tête `Referer` local, que le serveur Twitter refuse avec une erreur 403. Cette règle est limitée aux vidéos Twitter et conserve le `Referer` nécessaire au lecteur YouTube.

## Vérifications

```bash
npm test
npm run test:electron
npm run test:settings
npm run test:twitter
```

Le test `test:settings` utilise un profil isolé, bloque le serveur de chat et vérifie les contrôles réels, la sauvegarde, la synchronisation, les formats, le test d’affichage, la remise à zéro et l’apparition conditionnelle de la croix et l’arrêt du média sans quitter l’application. Il affiche brièvement la configuration pour capturer et vérifier sa mise en page.

Le test `test:twitter` vérifie une lecture réelle sur le lien public ayant déclenché la régression. La variable `TWITTER_URL` permet de tester un autre lien. Il dépend des services Twitter et bloque la connexion au bot.

Les tests Node couvrent les URL, les messages invalides, les chargements concurrents, les événements périmés, le cycle de vie YouTube simulé et l'accès au serveur local. Le test Electron vérifie le DOM et le preload dans une fenêtre cachée ; il bloque la connexion au serveur de chat. Pour vérifier aussi une lecture YouTube réelle sous PowerShell :

```powershell
$env:LIVE_YOUTUBE = '1'
npm run test:electron
Remove-Item Env:LIVE_YOUTUBE
```

Le zoom, la position et le volume ne coupent plus la lecture. L'audio des médias directs reste natif : l'ancien traitement Web Audio pouvait rendre muettes les vidéos distantes dépourvues d'autorisation CORS.

> ⚠️ L'exécutable n'est pas signé numériquement. Windows Defender / SmartScreen peut donc afficher un avertissement au premier lancement. Il suffit de cliquer sur **Plus d'infos** puis **Exécuter quand même**.

## Limites connues

L'extraction des vidéos Twitter/X, TikTok et Instagram dépend de la structure interne de ces plateformes (et de services tiers comme vxtwitter/fxtwitter et tikwm). Ces plateformes changent régulièrement leur fonctionnement, ce qui peut casser l'extraction sans préavis. Les restrictions de connexion, de CORS, les vidéos privées et certains formats restent susceptibles de bloquer la lecture. Une erreur de média est affichée brièvement puis masquée ; un chargement bloqué est limité dans le temps.

YouTube peut refuser l'intégration d'une vidéo, demander une connexion ou bloquer la lecture selon le réseau ou le contenu. L'overlay est invisible aux clics : il ne permet pas de répondre à une demande de connexion ou de consentement dans le lecteur. Ces cas sont signalés ou interrompus après expiration du délai de chargement.

Le serveur WebSocket de production et le bot sont externes à ce dépôt. Les tests locaux ne valident ni leur filtrage, ni leur authentification, ni la livraison de bout en bout. Le lancement automatique Windows est configuré uniquement pour l'application packagée, avec le chemin du portable plutôt que son dossier temporaire d'extraction.
