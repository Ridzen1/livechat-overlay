const test = require('node:test');
const assert = require('node:assert/strict');
const { gifPage, gifLink } = require('../media-utils');
const { resolveGif, extractGif } = require('../gif-sources');

test('Recognize supported GIF pages and direct image links without matching unrelated hosts', () => {
    for (const path of ['gifs/confused-YsTs5ltWtEhnq', 'gifs/YsTs5ltWtEhnq', 'stickers/cat-abc123', 'embed/abc123']) assert.equal(gifPage('https://giphy.com/' + path), 'giphy');
    assert.equal(gifPage('https://gifdb.com/gif/happy-cat-abc123.html'), 'gifdb');
    for (const url of ['https://giphy.com.evil.test/gifs/abc', 'https://giphy.com/explore/cats', 'https://user:pass@giphy.com/gifs/abc', 'https://giphy.com:123/gifs/abc']) assert.equal(gifPage(url), null);
    assert.ok(gifLink('https://cdn.discordapp.com/attachments/a/b/a.gif?ex=123&hm=sig'));
    assert.ok(gifLink('https://example.com/animated.webp'));
    assert.equal(gifLink('https://example.com/page?file=a.gif'), false);
});

test('Giphy uses public oEmbed and validates its returned media host', async () => {
    const signal = new AbortController().signal;
    const url = 'https://giphy.com/gifs/confused-YsTs5ltWtEhnq?tracking=yes';
    const gif = 'https://media1.giphy.com/media/YsTs5ltWtEhnq/giphy.gif';
    assert.equal(await resolveGif(url, async (endpoint, options) => {
        assert.equal(new URL(endpoint).searchParams.get('url'), 'https://giphy.com/gifs/YsTs5ltWtEhnq');
        assert.equal(options.redirect, 'error');
        return Response.json({ type: 'photo', url: gif });
    }, signal), gif);
    for (const invalid of ['https://evil.test/a.gif', 'https://media1.giphy.com.evil.test/a.gif', 'file:///a.gif', 'https://media1.giphy.com/a.jpg']) {
        await assert.rejects(resolveGif(url, async () => Response.json({url: invalid}), signal), /URL GIF invalide/);
    }
    await assert.rejects(resolveGif(url, async () => new Response('bad json', {headers:{'content-type':'application/json'}}), signal));
});

test('GIFDB resolves only GIF media on its own domain', async () => {
    const gif = 'https://gifdb.com/images/high/cat.gif';
    const html = `<meta property="og:image" content="${gif}">`;
    assert.equal(extractGif(html, 'gifdb'), gif);
    assert.throws(() => extractGif(html, 'tenor'));
    assert.equal(await resolveGif('https://gifdb.com/gif/cat-abc.html', async () => new Response(html, {headers:{'content-type':'text/html'}}), new AbortController().signal), gif);
});
