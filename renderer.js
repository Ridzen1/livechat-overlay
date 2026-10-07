
    let ws = null;
    
    const widget = document.getElementById('widget-container');
    const container = document.getElementById('media-container');
    const textContainer = document.getElementById('text-container');
    const authorAvatar = document.getElementById('author-avatar');
    const authorName = document.getElementById('author-name');
    const authorContainer = document.getElementById('author-container');
    const volumeIndicator = document.getElementById('volume-indicator');
    const volumeBar = document.getElementById('volume-bar');

    let mediaTimeout = null;
    let currentScale = 0.7; // Variable de la taille actuelle
    let currentVolume = 1; // Volume actuel (0 à 1), 100% par défaut
    let volumeIndicatorTimeout = null;

    const { safeUrl, hostMatches, youtubeVideo } = MediaUtils;
    let generation = 0;
    let resolutionController = null;
    let youtubePlayer = null;
    let youtubeApiPromise = null;
    let youtubeReady = false;
    let captionsInterval = null;
    let currentYoutubeFormat = 'auto';
    let youtubeIsShort = false;
    let mediaControlActive = false;

    function updateMediaControlPosition() {
        if (!mediaControlActive || !authorContainer.getBoundingClientRect) return;
        const rect = authorContainer.getBoundingClientRect();
        window.electronAPI?.setMediaControlBounds?.({ x: rect.right + 8, y: rect.top + rect.height / 2 - 16 });
    }

    function setMediaControlActive(active) {
        mediaControlActive = active;
        authorContainer.style.marginRight = active ? 'calc(40px / var(--widget-scale))' : '';
        if (active) updateMediaControlPosition();
        window.electronAPI?.setMediaActive?.(active);
    }

    if (typeof ResizeObserver !== 'undefined') {
        const controlObserver = new ResizeObserver(updateMediaControlPosition);
        controlObserver.observe(widget);
        controlObserver.observe(authorContainer);
    }
    window.addEventListener?.('resize', updateMediaControlPosition);

    function youtubeSize() {
        const portrait = currentYoutubeFormat === 'portrait' || (currentYoutubeFormat === 'auto' && youtubeIsShort);
        const height = portrait ? Math.max(600, 200 * 16 / 9 / currentScale) : Math.max(450, 200 / currentScale);
        return { width: height * (portrait ? 9 / 16 : 16 / 9), height };
    }

    function hideWidget() {
        generation++;
        setMediaControlActive(false);
        clearInterval(captionsInterval);
        captionsInterval = null;
        resolutionController?.abort();
        resolutionController = null;
        clearTimeout(mediaTimeout);
        mediaTimeout = null;
        youtubeReady = false;
        if (youtubePlayer) {
            youtubePlayer.destroy();
            youtubePlayer = null;
        }
        const video = container.querySelector('video');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
        container.replaceChildren();
        widget.style.display = 'none';
        textContainer.innerText = '';
        authorAvatar.removeAttribute('src');
        authorAvatar.style.display = 'none';
        authorName.innerText = '';
    }

    function mediaElement(url, video = false) {
        const parsed = safeUrl(url);
        if (!parsed) throw new Error('URL média invalide');
        const element = document.createElement(video || /\.(mp4|webm|ogg|mov)(?:[?#]|$)/i.test(parsed.href) ? 'video' : 'img');
        element.src = parsed.href;
        if (element.tagName === 'VIDEO') {
            element.playsInline = true;
            element.volume = currentVolume;
        } else element.alt = '';
        return element;
    }

    async function fetchJson(url, signal) {
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    // --- EXTRACTION DE VIDÉOS DEPUIS TWITTER/X, TIKTOK, INSTAGRAM ---

    function extractTweetId(url) {
        const m = new URL(url).pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/i);
        return m ? m[1] : null;
    }

    async function resolveTwitterVideo(tweetId, signal) {
        // On essaie l'API vxtwitter, puis fxtwitter en secours.
        const endpoints = [
            `https://api.vxtwitter.com/i/status/${tweetId}`,
            `https://api.fxtwitter.com/status/${tweetId}`
        ];
        for (const endpoint of endpoints) {
            try {
                const json = await fetchJson(endpoint, signal);

                // Format renvoyé par vxtwitter
                if (json.media_extended && json.media_extended.length > 0) {
                    const video = json.media_extended.find(m => m.type === 'video' || m.type === 'gif');
                    if (video) return video.url;
                }

                // Format renvoyé par fxtwitter
                if (json.tweet && json.tweet.media && json.tweet.media.videos && json.tweet.media.videos.length > 0) {
                    return json.tweet.media.videos[0].url;
                }
            } catch (e) {
                if (signal.aborted) throw e;
                console.warn('Échec extraction Twitter via', endpoint, e);
            }
        }
        return null;
    }

    async function resolveTikTokVideo(url, signal) {
        try {
            const json = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, signal);
            if (json.data && json.data.play) {
                return json.data.play;
            }
        } catch (e) {
            console.warn('Échec extraction TikTok', e);
        }
        return null;
    }

    async function resolveInstagramVideo(url) {
        // On convertit d'abord vers une URL instagram.com standard (au cas où le lien donné
        // utilise kkinstagram, kkclip, etc.)
        const igUrl = url.replace(
            /(?:www\.)?(?:kkinstagram|kkclip|ddinstagram|instagramez|fxinstagram|uuinstagram)\.com/i,
            'instagram.com'
        ).replace('/reels/', '/reel/'); // l'endpoint embed/captioned attend "/reel/" au singulier
        const cleanUrl = igUrl.split('?')[0].replace(/\/$/, '');
        const embedUrl = `${cleanUrl}/embed/captioned/`;

        // Instagram injecte la vidéo via JavaScript après le chargement de la page :
        // impossible à récupérer avec un simple fetch(). On délègue donc au processus
        // principal, qui ouvre une vraie fenêtre Chromium invisible pour la charger.
        console.log(`[Instagram] Ouverture en arrière-plan de ${embedUrl}...`);
        try {
            const videoUrl = await window.electronAPI.resolveInstagramVideo(embedUrl);
            if (videoUrl) {
                console.log(`[Instagram] Vidéo trouvée : ${videoUrl}`);
                return videoUrl;
            }
            console.error('[Instagram] Aucune vidéo trouvée après chargement complet de la page.');
        } catch (e) {
            console.error('[Instagram] Erreur lors de la résolution :', e.message || e);
        }
        return null;
    }

    async function buildMediaElement(value, signal) {
        const url = safeUrl(value);
        if (!url) throw new Error('URL média invalide');
        let resolved = null;
        if (hostMatches(url, ['twitter.com', 'x.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com'])) {
            const id = extractTweetId(url.href);
            if (id) resolved = await resolveTwitterVideo(id, signal);
        } else if (hostMatches(url, ['tiktok.com'])) {
            resolved = await resolveTikTokVideo(url.href, signal);
        } else if (hostMatches(url, ['instagram.com', 'kkinstagram.com', 'kkclip.com', 'ddinstagram.com', 'instagramez.com', 'fxinstagram.com', 'uuinstagram.com']) && /^\/(reels?|p|tv)\//.test(url.pathname)) {
            // Build the destination from a validated path, never a substring replacement.
            resolved = await resolveInstagramVideo(`https://www.instagram.com${url.pathname}`);
        }
        return mediaElement(resolved || url.href, Boolean(resolved));
    }

    function loadYouTubeApi() {
        if (window.YT?.Player) return Promise.resolve(window.YT);
        if (youtubeApiPromise) return youtubeApiPromise;
        youtubeApiPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const timeout = setTimeout(() => fail(), 15000);
            function fail() {
                clearTimeout(timeout);
                script.remove();
                youtubeApiPromise = null;
                reject(new Error('Chargement du lecteur YouTube impossible'));
            }
            window.onYouTubeIframeAPIReady = () => {
                clearTimeout(timeout);
                resolve(window.YT);
            };
            script.onerror = fail;
            script.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(script);
        });
        return youtubeApiPromise;
    }

    function armTimeout(token, delay, action = hideWidget) {
        clearTimeout(mediaTimeout);
        mediaTimeout = setTimeout(() => {
            if (token === generation) action();
        }, delay);
    }

    function mediaFailure(token, message) {
        if (token !== generation) return;
        hideWidget();
        widget.style.display = 'flex';
        authorName.innerText = '⚙️ MÉDIA';
        textContainer.innerText = message;
        armTimeout(generation, 5000);
    }

    async function playYouTube(info, token) {
        const YT = await loadYouTubeApi();
        if (token !== generation) return;
        const mount = document.createElement('div');
        youtubeIsShort = Boolean(info.portrait);
        container.appendChild(mount);
        const failed = message => mediaFailure(token, message);
        // cc_load_policy=0 alone does not override a viewer's caption preferences.
        // unloadModule is exposed by the current player, but is not a documented
        // stable API: feature-detect it and preserve playback if YouTube changes it.
        const disableCaptions = event => {
            if (token !== generation) return;
            try {
                const player = event.target;
                const track = player.getOption?.('captions', 'track');
                if (track && Object.keys(track).length === 0) return;
                if (player.getOptions?.()?.includes('captions')) player.unloadModule?.('captions');
            } catch (error) { console.warn('[YouTube] Sous-titres non désactivés :', error); }
        };
        armTimeout(token, 25000, () => failed('YouTube : délai de lecture dépassé'));
        youtubePlayer = new YT.Player(mount, {
            ...youtubeSize(),
            videoId: info.id,
            playerVars: { autoplay: 0, playsinline: 1, start: info.start, origin: location.origin },
            events: {
                onReady: event => {
                    if (token !== generation) return;
                    youtubeReady = true;
                    disableCaptions(event);
                    // Module metadata can arrive after onApiChange. Check again
                    // while this player is active, including after delayed loads.
                    clearInterval(captionsInterval);
                    captionsInterval = setInterval(() => disableCaptions(event), 500);
                    const size = youtubeSize();
                    event.target.setSize?.(size.width, size.height);
                    event.target.setVolume(Math.round(currentVolume * 100));
                    event.target.playVideo();
                },
                onStateChange: event => {
                    if (token !== generation) return;
                    if (event.data === YT.PlayerState.ENDED) hideWidget();
                    else if (event.data === YT.PlayerState.PLAYING) {
                        clearTimeout(mediaTimeout);
                        disableCaptions(event);
                    }
                    else if ([YT.PlayerState.BUFFERING, YT.PlayerState.PAUSED].includes(event.data)) {
                        armTimeout(token, 30000, () => failed('YouTube : lecture interrompue'));
                    }
                },
                onApiChange: disableCaptions,
                onError: event => failed(`YouTube : vidéo indisponible ou intégration refusée (code ${event.data})`),
                onAutoplayBlocked: () => failed('YouTube : lecture automatique bloquée')
            }
        });
        youtubePlayer.getIframe().setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
    }

    async function handleMessage(event) {
        let data;
        try { data = JSON.parse(event.data); }
        catch { console.warn('Message WebSocket non JSON ignoré'); return; }
        if (!data || data.type !== 'play_media') return;
        hideWidget();
        const token = generation;
        if (window.electronAPI?.prepareMedia) {
            const ready = await window.electronAPI.prepareMedia();
            if (!ready || token !== generation) return;
        }
        resolutionController = new AbortController();
        const signal = resolutionController.signal;
        widget.style.display = 'flex';
        textContainer.innerText = typeof data.text === 'string' ? data.text.slice(0, 4000) : '';
        authorName.innerText = typeof data.author === 'string' ? data.author.slice(0, 200) : '';
        const avatar = safeUrl(data.avatar);
        if (avatar) {
            authorAvatar.src = avatar.href;
            authorAvatar.style.display = 'block';
            authorAvatar.onerror = () => { authorAvatar.style.display = 'none'; };
        }
        setMediaControlActive(true);
        armTimeout(token, 30000, () => mediaFailure(token, 'Chargement du média impossible'));
        try {
            // Some bots forward plain text without populating the URL field.
            const textLink = typeof data.text === 'string' ? data.text.match(/https?:\/\/[^\s<>]+/g)?.find(link => youtubeVideo(link)) : null;
            const value = data.url || textLink;
            if (!value) { armTimeout(token, 10000); return; }
            const youtube = youtubeVideo(value);
            if (youtube) { await playYouTube(youtube, token); return; }
            const element = await buildMediaElement(value, signal);
            if (token !== generation) return;
            const fail = () => mediaFailure(token, 'Impossible de lire ce média');
            element.onerror = fail;
            if (element.tagName === 'VIDEO') {
                element.volume = currentVolume;
                element.onended = () => { if (token === generation) hideWidget(); };
                element.onplaying = () => { if (token === generation) clearTimeout(mediaTimeout); };
                element.onwaiting = element.onstalled = () => {
                    if (token === generation) armTimeout(token, 30000, fail);
                };
                container.appendChild(element);
                // Keep native audio: MediaElementSource silences remote media without CORS.
                element.play().catch(fail);
            } else {
                element.onload = () => { if (token === generation) armTimeout(token, 10000); };
                container.appendChild(element);
                if (element.complete && element.naturalWidth > 0) armTimeout(token, 10000);
            }
        } catch (error) {
            if (token !== generation) return;
            console.warn('[Média]', error);
            mediaFailure(token, 'Chargement du média impossible');
        }
    }

    function showLaunchAnnouncement() {
        hideWidget();
        widget.style.display = 'flex';
        authorName.innerText = '⚙️ SYSTÈME';
        authorAvatar.style.display = 'none'; 
        textContainer.innerText = 'OVERLAY LIVECHAT ACTIF !';
        
        mediaTimeout = setTimeout(() => {
            hideWidget();
        }, 5000);
    }

    // --- COMPOSANT PARTAGÉ : barre à segments façon OSD (volume, zoom...) ---
    // fillPercent : 0 à 100, correspond au pourcentage de segments allumés.
    function buildBarSegmentsHtml(fillPercent) {
        const totalSegments = 10;
        const clamped = Math.max(0, Math.min(100, fillPercent));
        const filledSegments = Math.round((clamped / 100) * totalSegments);

        let html = '';
        for (let i = 0; i < totalSegments; i++) {
            html += `<div class="bar-segment${i < filledSegments ? ' filled' : ''}"></div>`;
        }
        return html;
    }

    // --- GESTION DE LA TAILLE ---
    const MIN_SCALE = 0.3;
    const MAX_SCALE = 1.5;

    function changeSize(step) {
        currentScale += step;

        // On limite la taille pour éviter que ça devienne invisible ou monstrueux
        if (currentScale < MIN_SCALE) currentScale = MIN_SCALE;
        if (currentScale > MAX_SCALE) currentScale = MAX_SCALE;

        // On applique le nouveau zoom au CSS
        document.documentElement.style.setProperty('--widget-scale', currentScale);
        updateMediaControlPosition();

        showOsd(`ZOOM ${Math.round(currentScale * 100)} %`, ((currentScale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100);

        saveSettings();
    }

    // --- GESTION DU VOLUME ---
    // Les réglages utilisent un indicateur séparé pour préserver la lecture.
    function changeVolume(step) {
        currentVolume += step;

        if (currentVolume < 0) currentVolume = 0;
        if (currentVolume > 1) currentVolume = 1;

        // On applique le nouveau volume à la vidéo en cours de lecture, s'il y en a une
        const videoElement = container.querySelector('video');
        if (videoElement) {
            videoElement.volume = currentVolume;
        }

        if (youtubeReady) youtubePlayer.setVolume(Math.round(currentVolume * 100));
        showOsd(`VOLUME ${Math.round(currentVolume * 100)} %`, currentVolume * 100);

        saveSettings();
    }

    function showOsd(label, percent) {
        document.getElementById('osd-label').textContent = label;
        volumeBar.innerHTML = percent === undefined ? '' : buildBarSegmentsHtml(percent);
        volumeIndicator.style.display = 'flex';
        clearTimeout(volumeIndicatorTimeout);
        volumeIndicatorTimeout = setTimeout(() => { volumeIndicator.style.display = 'none'; }, 2000);
    }

    // --- GESTION DU POSITIONNEMENT ---
    const positions = [
        // NOUVEAU : Ajout de la variable "origin" pour que le zoom se fasse depuis le bon angle
        { name: 'HAUT DROITE', top: '10px', right: '10px', bottom: 'auto', left: 'auto', align: 'flex-end', text: 'right', origin: 'top right' },
        { name: 'BAS DROITE', top: 'auto', right: '10px', bottom: '10px', left: 'auto', align: 'flex-end', text: 'right', origin: 'bottom right' },
        { name: 'BAS GAUCHE', top: 'auto', right: 'auto', bottom: '10px', left: '10px', align: 'flex-start', text: 'left', origin: 'bottom left' },
        { name: 'HAUT GAUCHE', top: '10px', right: 'auto', bottom: 'auto', left: '10px', align: 'flex-start', text: 'left', origin: 'top left' }
    ];
    let currentPosIndex = 0;

    // Applique une position donnée sans afficher de feedback ni toucher au
    // média en cours — utilisé à la fois par cyclePosition() et par la restauration des réglages au
    // démarrage (où on ne veut pas de popup "POSITION : ...").
    function applyPosition(pos) {
        widget.style.top = pos.top;
        widget.style.right = pos.right;
        widget.style.bottom = pos.bottom;
        widget.style.left = pos.left;
        widget.style.alignItems = pos.align;
        textContainer.style.textAlign = pos.text;
        widget.style.transformOrigin = pos.origin;
        updateMediaControlPosition();
    }

    function cyclePosition() {
        currentPosIndex = (currentPosIndex + 1) % positions.length;
        const pos = positions[currentPosIndex];

        applyPosition(pos);

        showOsd('POSITION : ' + pos.name);

        saveSettings();
    }

    // --- PERSISTANCE DES RÉGLAGES (volume, taille, position) ---
    // Sauvegardés côté processus principal (fichier JSON dans le dossier de
    // données utilisateur), rechargés au démarrage. On "fire-and-forget" la
    // sauvegarde : pas besoin d'attendre la confirmation d'écriture.
    function saveSettings() {
        if (window.electronAPI && window.electronAPI.saveSettings) {
            window.electronAPI.saveSettings({
                volume: currentVolume,
                scale: currentScale,
                positionIndex: currentPosIndex
            }).catch(() => {});
        }
    }

    function applySettings(saved) {
        if (!saved) return;
        if (Number.isFinite(saved.volume)) currentVolume = Math.max(0, Math.min(1, saved.volume));
        if (Number.isFinite(saved.scale)) currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, saved.scale));
        if (Number.isInteger(saved.positionIndex) && positions[saved.positionIndex]) currentPosIndex = saved.positionIndex;
        if (['auto', 'portrait', 'landscape'].includes(saved.youtubeFormat)) currentYoutubeFormat = saved.youtubeFormat;
        document.documentElement.style.setProperty('--widget-scale', currentScale);
        applyPosition(positions[currentPosIndex]);
        const video = container.querySelector('video');
        if (video) video.volume = currentVolume;
        if (youtubeReady) youtubePlayer.setVolume(Math.round(currentVolume * 100));
        if (youtubeReady) {
            const size = youtubeSize();
            youtubePlayer.setSize?.(size.width, size.height);
        }
    }

    async function restoreSavedSettings() {
        try { applySettings(await window.electronAPI?.loadSettings()); }
        catch (error) { console.warn('[Réglages]', error); }
    }

    function showConfigurationPreview() {
        hideWidget();
        widget.style.display = 'flex';
        authorName.innerText = 'APERÇU · LIVECHAT';
        textContainer.innerText = 'Votre overlay apparaît ici !';
        armTimeout(generation, 10000);
    }

    window.electronAPI?.onSettingsChanged?.(applySettings);

    // --- CONNEXION WEBSOCKET ---
    let hasShownLaunchAnnouncement = false;
    let pingInterval = null;

    function connectWebSocket() {
        ws = new WebSocket('wss://livechat-bot-0m01.onrender.com');

        ws.onopen = () => {
            console.log('Connecté au serveur Render !');

            // Le serveur (hébergé sur Render) peut couper/relancer la connexion
            // périodiquement sans que l'app elle-même redémarre (ex : mise en
            // veille du serveur après inactivité). Sans ce garde-fou, chaque
            // reconnexion réaffichait "OVERLAY LIVECHAT ACTIF !" comme si l'app
            // venait de démarrer. On ne l'affiche donc qu'une seule fois par
            // lancement de l'app.
            if (!hasShownLaunchAnnouncement) {
                showLaunchAnnouncement();
                hasShownLaunchAnnouncement = true;
            }

            // On évite aussi d'empiler un nouvel interval de ping à chaque
            // reconnexion (sinon, au bout de plusieurs reconnexions, plusieurs
            // pings partent en double toutes les 30s).
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        ws.onmessage = handleMessage;

        ws.onclose = () => {
            clearInterval(pingInterval);
            pingInterval = null;
            console.log('Connexion perdue. Reconnexion dans 5 secondes...');
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (err) => {
            console.error('Erreur WebSocket, fermeture forcée...');
            ws.close(); 
        };
    }

    (async () => {
        await restoreSavedSettings();
        connectWebSocket();
    })();
