const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, pickDownload, checkForUpdate, isGithubUrl } = require('../update-check');

const release = (overrides = {}) => ({
    tag_name: '2.2', name: '2.2', body: 'Corrections', html_url: 'https://github.com/Ridzen1/livechat-overlay/releases/tag/2.2',
    draft: false, prerelease: false,
    assets: [
        { name: 'Livechat.zip', browser_download_url: 'https://github.com/Ridzen1/livechat-overlay/releases/download/2.2/Livechat.zip' },
        { name: 'livechat-overlay.exe', browser_download_url: 'https://github.com/Ridzen1/livechat-overlay/releases/download/2.2/livechat-overlay.exe' }
    ],
    ...overrides
});
const fakeFetch = (body, ok = true) => async (url, options) => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/Ridzen1\/livechat-overlay\/releases\/latest$/);
    assert.ok(options.headers['User-Agent']);
    return { ok, status: ok ? 200 : 403, json: async () => body };
};

test('versions from existing release tags are parsed and compared', () => {
    assert.deepEqual(parseVersion('v1.06'), [1, 6, 0]);
    assert.deepEqual(parseVersion('2.1'), [2, 1, 0]);
    assert.deepEqual(parseVersion('2.2.0'), [2, 2, 0]);
    assert.equal(parseVersion('beta'), null);
    assert.equal(compareVersions('2.2', '2.1.0'), 1);
    assert.equal(compareVersions('v2.1', '2.1.0'), 0);
    assert.equal(compareVersions('1.9', '2.0.0'), -1);
    assert.equal(compareVersions('2.10', '2.9.0'), 1);
});

test('the portable exe is preferred, then a zip, and only GitHub links are kept', () => {
    assert.equal(pickDownload(release()).name, 'livechat-overlay.exe');
    assert.equal(pickDownload(release({ assets: [release().assets[0]] })).name, 'Livechat.zip');
    assert.equal(pickDownload(release({ assets: [{ name: 'x.exe', browser_download_url: 'https://evil.test/x.exe' }] })), null);
    assert.equal(isGithubUrl('http://github.com/a'), false);
    assert.equal(isGithubUrl('https://github.com.evil.test/a'), false);
});

test('a newer release is offered with its download link', async () => {
    const update = await checkForUpdate({ currentVersion: '2.1.0', fetch: fakeFetch(release()) });
    assert.equal(update.version, '2.2');
    assert.equal(update.downloadUrl, 'https://github.com/Ridzen1/livechat-overlay/releases/download/2.2/livechat-overlay.exe');
    assert.equal(update.notes, 'Corrections');
});

test('same, older, draft and prerelease versions are ignored', async () => {
    assert.equal(await checkForUpdate({ currentVersion: '2.2.0', fetch: fakeFetch(release()) }), null);
    assert.equal(await checkForUpdate({ currentVersion: '3.0.0', fetch: fakeFetch(release()) }), null);
    assert.equal(await checkForUpdate({ currentVersion: '2.1.0', fetch: fakeFetch(release({ prerelease: true })) }), null);
    assert.equal(await checkForUpdate({ currentVersion: '2.1.0', fetch: fakeFetch(release({ tag_name: 'nightly' })) }), null);
});

test('a release without assets falls back to its page and errors are reported', async () => {
    const update = await checkForUpdate({ currentVersion: '2.1.0', fetch: fakeFetch(release({ assets: [] })) });
    assert.equal(update.downloadUrl, null);
    assert.equal(update.pageUrl, 'https://github.com/Ridzen1/livechat-overlay/releases/tag/2.2');
    await assert.rejects(checkForUpdate({ currentVersion: '2.1.0', fetch: fakeFetch({}, false) }), /403/);
});
