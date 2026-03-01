/**
 * theme-init.js
 * Must be loaded as the FIRST script in <head> (before CSS) to prevent
 * a flash-of-wrong-theme when the user has selected light mode.
 * Dark is the unconditional default — no change occurs unless the user
 * has explicitly opted in via the profile dropdown toggle.
 */
(function () {
    try {
        var theme = localStorage.getItem('uiTheme');
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
        var head = document.head || document.getElementsByTagName('head')[0];
        if (head) {
            var meta = head.querySelector('meta[name="theme-color"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute('name', 'theme-color');
                head.appendChild(meta);
            }
            meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0d1117');
        }
        // Dark (default) needs no attribute — CSS :root vars are dark already.
    } catch (e) {
        // localStorage unavailable (private browsing edge case) — stay dark.
    }
})();
