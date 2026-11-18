// Vérification des mises à jour via les releases GitHub.
// Ce module ne dépend pas d'Electron pour pouvoir être testé avec `node --test`.
const REPOSITORY = 'Ridzen1/livechat-overlay';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;

// Accepte "2.1", "v2.1.0", "1.07"... et renvoie [majeur, mineur, correctif].
function parseVersion(value) {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i.exec(String(value ?? '').trim());
    if (!match) return null;
    return [match[1], match[2], match[3]].map(part => Number(part ?? 0));
}

function compareVersions(a, b) {
    const left = parseVersion(a), right = parseVersion(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    return 0;
}

// Seuls les liens GitHub sont ouverts, pour ne jamais lancer une URL arbitraire.
function isGithubUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port;
    } catch { return false; }
}

// Préfère l'exécutable portable, sinon une archive .zip, sinon la page de la release.
function pickDownload(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    for (const extension of ['.exe', '.zip']) {
        const asset = assets.find(item => typeof item?.name === 'string' && item.name.toLowerCase().endsWith(extension) && isGithubUrl(item.browser_download_url));
        if (asset) return { name: asset.name, url: asset.browser_download_url };
    }
    return null;
}

async function fetchLatestRelease(fetch, signal) {
    const response = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'livechat-overlay-updater' },
        signal
    });
    if (!response.ok) throw new Error(`GitHub a répondu ${response.status}`);
    return response.json();
}

// Renvoie la mise à jour disponible, ou null si l'application est à jour.
async function checkForUpdate({ currentVersion, fetch, signal }) {
    const release = await fetchLatestRelease(fetch, signal);
    if (!release || release.draft || release.prerelease) return null;
    const version = String(release.tag_name ?? '').trim();
    if (!parseVersion(version) || compareVersions(version, currentVersion) <= 0) return null;
    const download = pickDownload(release);
    return {
        version: version.replace(/^v/i, ''),
        name: typeof release.name === 'string' && release.name.trim() ? release.name.trim() : version,
        notes: typeof release.body === 'string' ? release.body.trim().slice(0, 600) : '',
        pageUrl: isGithubUrl(release.html_url) ? release.html_url : RELEASES_PAGE,
        downloadUrl: download?.url ?? null,
        downloadName: download?.name ?? null
    };
}

module.exports = { parseVersion, compareVersions, isGithubUrl, pickDownload, checkForUpdate, RELEASES_PAGE, LATEST_RELEASE_API };
