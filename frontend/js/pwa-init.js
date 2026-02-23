(function (window, document) {
  function ensurePwaHeadTags() {
    const head = document.head;
    if (!head) return;

    const ensureMeta = (name, content, attribute = 'name') => {
      let meta = head.querySelector(`meta[${attribute}="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, name);
        head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    const ensureLink = (rel, href) => {
      let link = head.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', rel);
        head.appendChild(link);
      }
      link.setAttribute('href', href);
    };

    ensureLink('manifest', '/manifest.webmanifest');
    ensureLink('apple-touch-icon', '/icons/apple-touch-icon.png');
    ensureMeta('theme-color', '#0d1117');
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-title', 'FoxESS Automation');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (window.location.protocol !== 'https:' && !isLocalhost) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('[PWA] Service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
  }

  ensurePwaHeadTags();
  registerServiceWorker();
})(window, document);
