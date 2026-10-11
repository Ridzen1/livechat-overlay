const test = require('node:test');
const assert = require('node:assert/strict');
const { tenorPage } = require('../media-utils');
const { extractGif: extractTenorGif, resolveGif: resolveTenorGif } = require('../gif-sources');
const page = 'https://tenor.com/fr/view/the-rock-stare-thinking-gif-5680807550909397990';
const gif = 'https://media1.tenor.com/m/TtZIXo1Pu-YAAAAC/the-rock-stare.gif';
test('Tenor page validation accepts localized links but rejects other destinations', () => {
    assert.ok(tenorPage(page));
    assert.ok(tenorPage(page.replace('/fr/', '/')));
    for (const url of [page.replace('tenor.com', 'tenor.com.evil.test'), page.replace('https:', 'http:'), 'https://tenor.com/search/cat', 'https://user:pass@tenor.com/view/cat-123']) assert.equal(tenorPage(url), false);
});
test('Tenor metadata selects the GIF rather than a related video or untrusted media', () => {
    assert.equal(extractTenorGif(`<meta property="og:video" content="https://media.tenor.com/a.mp4"><meta content='${gif}?a=1&amp;b=2' property='og:image'>`), gif + '?a=1&b=2');
    assert.throws(() => extractTenorGif('<meta property="og:image" content="https://evil.test/a.gif">'));
    assert.throws(() => extractTenorGif('<meta property="og:image" content="https://media.tenor.com/a.png">'));
});
test('Tenor resolver limits responses and rejects failures or cancellation', async () => {
    const controller = new AbortController();
    const response = html => new Response(html, { headers: { 'content-type': 'text/html' } });
    assert.equal(await resolveTenorGif(page, async (url, options) => {
        assert.equal(url, page); assert.equal(options.redirect, 'error');
        return response(`<meta property="og:image" content="${gif}">`);
    }, controller.signal), gif);
    await assert.rejects(resolveTenorGif(page, async () => new Response('', {status:404}), controller.signal), /404/);
    await assert.rejects(resolveTenorGif(page, async () => response('x'.repeat(1024 * 1024 + 1)), controller.signal), /volumineuse/);
    controller.abort();
    await assert.rejects(resolveTenorGif(page, async (_url, options) => { options.signal.throwIfAborted(); }, controller.signal));
});
