(function (root) {
    function safeUrl(value) {
        if (typeof value !== 'string' || value.length > 8192) return null;
        try {
            const url = new URL(value);
            return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
        } catch { return null; }
    }

    function hostMatches(url, domains) {
        return domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
    }

    function youtubeVideo(value) {
        const url = safeUrl(value);
        if (!url) return null;
        let id;
        if (hostMatches(url, ['youtu.be'])) id = url.pathname.split('/')[1];
        else if (hostMatches(url, ['youtube.com', 'youtube-nocookie.com'])) {
            if (url.pathname === '/watch') id = url.searchParams.get('v');
            else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1];
        }
        if (!/^[\w-]{11}$/.test(id || '')) return null;
        const time = url.searchParams.get('start') || url.searchParams.get('t') || new URLSearchParams(url.hash.slice(1)).get('t') || '';
        const match = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
        return { id, start: Number.isSafeInteger(seconds) ? seconds : 0, ...(/^\/shorts\//.test(url.pathname) ? { portrait: true } : {}) };
    }

    function tenorPage(value) {
        const url = safeUrl(value);
        return Boolean(url && url.protocol === 'https:' && !url.port &&
            ['tenor.com', 'www.tenor.com'].includes(url.hostname) &&
            /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?view\/[^/]+-\d+\/?$/.test(url.pathname));
    }

    function gifPage(value) {
        if (tenorPage(value)) return 'tenor';
        const url = safeUrl(value);
        if (!url || url.protocol !== 'https:' || url.port) return null;
        if (['giphy.com', 'www.giphy.com'].includes(url.hostname) &&
            /^\/(?:gifs|stickers|embed)\/(?:[\w-]+-)?[A-Za-z0-9]+\/?$/.test(url.pathname)) return 'giphy';
        if (['gifdb.com', 'www.gifdb.com'].includes(url.hostname) &&
            /^\/gif\/[a-zA-Z0-9-]+\.html$/.test(url.pathname)) return 'gifdb';
        return null;
    }

    function gifLink(value) {
        const url = safeUrl(value);
        return Boolean(gifPage(value) || (url && /\.(gif|webp)$/i.test(url.pathname)));
    }

    const api = { safeUrl, hostMatches, youtubeVideo, tenorPage, gifPage, gifLink };
    if (typeof module !== 'undefined') module.exports = api;
    else root.MediaUtils = api;
})(globalThis);
