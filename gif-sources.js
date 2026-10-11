const { gifPage, safeUrl } = require('./media-utils');

function validatedGif(value, provider) {
    const url = safeUrl(value);
    const hosts = { tenor: /^media\d*\.tenor\.com$/, giphy: /^media\d*\.giphy\.com$/, gifdb: /^(?:www\.)?gifdb\.com$/ };
    if (url && url.protocol === 'https:' && !url.port && hosts[provider]?.test(url.hostname) && /\.gif$/i.test(url.pathname)) return url.href;
    throw new Error('URL GIF invalide');
}

function extractGif(html, provider = 'tenor') {
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
        const attributes = {};
        for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1].toLowerCase()] = match[3];
        if (attributes.property !== 'og:image') continue;
        try { return validatedGif(attributes.content?.replace(/&amp;/g, '&'), provider); }
        catch { /* Ignore thumbnails and continue looking for a provider GIF. */ }
    }
    throw new Error('GIF introuvable');
}

async function resolveGif(value, fetchPage, signal) {
    const provider = gifPage(value);
    if (!provider) throw new Error('Lien de page GIF invalide');
    const url = new URL(value);
    url.search = ''; url.hash = '';
    url.hostname = { tenor: 'tenor.com', giphy: 'giphy.com', gifdb: 'gifdb.com' }[provider];
    if (provider === 'giphy') {
        const id = url.pathname.replace(/\/$/, '').split('/').at(-1).split('-').at(-1);
        url.pathname = '/gifs/' + id;
    }
    const endpoint = provider === 'giphy' ? 'https://giphy.com/services/oembed?url=' + encodeURIComponent(url.href) : url.href;
    const response = await fetchPage(endpoint, {
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)])
    });
    if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
    const contentType = provider === 'giphy' ? 'application/json' : 'text/html';
    if (!response.headers.get('content-type')?.includes(contentType)) throw new Error('Réponse GIF invalide');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1024 * 1024) throw new Error('Page GIF trop volumineuse');
            chunks.push(Buffer.from(value));
        }
    } finally { await reader.cancel(); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (provider === 'giphy') {
        const data = JSON.parse(text);
        return validatedGif(data.url || data.thumbnail_url, provider);
    }
    return extractGif(text, provider);
}
module.exports = { extractGif, resolveGif };
