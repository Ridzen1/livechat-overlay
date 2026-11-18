// Identity sent to YouTube instead of the loopback overlay address. YouTube
// asks apps that embed its player to identify themselves with an HTTPS
// Referer built from an application id. Labels block music videos for
// unidentified embedders (localhost/IP), which surfaces as errors 101/150/153.
const YOUTUBE_REFERER = 'https://com.livechat.overlay/';
const YOUTUBE_URLS = ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'];
const TWITTER_URLS = ['https://video.twimg.com/*'];

// Electron keeps one onBeforeSendHeaders listener per session, so Twitter and
// YouTube header changes share this single handler.
function configureMediaRequests(session, userAgent = session.getUserAgent?.()) {
    // The default Electron user agent names the app and Electron, which YouTube
    // can treat as an unknown application. Send the plain Chrome equivalent.
    const browserAgent = typeof userAgent === 'string'
        ? userAgent.replace(/\s(?:livechat-overlay|Electron)\/\S+/g, '')
        : null;
    session.webRequest.onBeforeSendHeaders({ urls: [...TWITTER_URLS, ...YOUTUBE_URLS] }, (details, callback) => {
        const headers = { ...details.requestHeaders };
        const host = new URL(details.url).hostname;
        const setHeader = (name, value) => {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
            }
            if (value !== undefined) headers[name] = value;
        };
        if (host === 'video.twimg.com') {
            // Twitter rejects media requests carrying the loopback Referer.
            if (details.resourceType === 'media') setHeader('Referer');
        } else {
            const referer = Object.entries(headers).find(([key]) => key.toLowerCase() === 'referer')?.[1];
            // Only the player document loaded by the overlay: YouTube's own
            // requests keep their youtube.com Referer.
            if (details.resourceType === 'subFrame' && referer && /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(referer)) {
                setHeader('Referer', YOUTUBE_REFERER);
            }
            if (browserAgent) setHeader('User-Agent', browserAgent);
        }
        callback({ requestHeaders: headers });
    });
}
module.exports = { configureMediaRequests, YOUTUBE_REFERER };
