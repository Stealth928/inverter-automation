(function () {
    'use strict';

    var INDEX_URL = '/data/aemo-market-insights/index.json';
    var indexCache = null;
    var regionCache = new Map();

    function withCacheBust(url) {
        var separator = String(url).indexOf('?') === -1 ? '?' : '&';
        return url + separator + 'ts=' + Date.now();
    }

    async function fetchJson(url) {
        var response = await fetch(withCacheBust(url), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
            credentials: 'same-origin'
        });
        if (!response.ok) throw new Error('Failed to load ' + url);
        return response.json();
    }

    async function loadIndex() {
        if (indexCache) return indexCache;
        indexCache = await fetchJson(INDEX_URL);
        return indexCache;
    }

    async function loadRegion(region, index) {
        if (regionCache.has(region)) return regionCache.get(region);
        var activeIndex = index || await loadIndex();
        var path = activeIndex && activeIndex.files ? activeIndex.files[region] : '';
        if (!path) throw new Error('Missing market data for ' + region);
        var payload = await fetchJson(path);
        regionCache.set(region, payload);
        return payload;
    }

    window.AemoMarketData = {
        loadIndex: loadIndex,
        loadRegion: loadRegion
    };
})();