// public/js/i18n.js
//
// Определяет язык посетителя (браузер -> сохранённый выбор -> переключатель)
// и подставляет тексты из /i18n/<lang>.json во все элементы с data-i18n.

(function () {
  var SUPPORTED = ['ru', 'en', 'uz', 'ar'];
  var RTL = ['ar'];
  var STORAGE_KEY = 'bidly_lang';
  var cache = {};

  function detectLanguage() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* приватный режим — просто пропускаем */ }

    var candidates = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || navigator.userLanguage || 'en'];

    for (var i = 0; i < candidates.length; i++) {
      var code = String(candidates[i]).toLowerCase().split('-')[0];
      if (SUPPORTED.indexOf(code) !== -1) return code;
    }
    return 'en';
  }

  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return null;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function loadLocale(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    return fetch('/i18n/' + lang + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('i18n fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (dict) {
        cache[lang] = dict;
        return dict;
      });
  }

  function applyTranslations(dict, lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.indexOf(lang) !== -1 ? 'rtl' : 'ltr';

    var title = getPath(dict, 'meta.title');
    if (title) document.title = title;

    var descEl = document.querySelector('meta[name="description"]');
    var desc = getPath(dict, 'meta.description');
    if (descEl && desc) descEl.setAttribute('content', desc);

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      var val = getPath(dict, key);
      if (typeof val === 'string') nodes[i].textContent = val;
    }

    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholders.length; j++) {
      var pKey = placeholders[j].getAttribute('data-i18n-placeholder');
      var pVal = getPath(dict, pKey);
      if (typeof pVal === 'string') placeholders[j].setAttribute('placeholder', pVal);
    }

    var langBtnLabel = document.getElementById('langBtnLabel');
    if (langBtnLabel) langBtnLabel.textContent = lang.toUpperCase();

    var menuButtons = document.querySelectorAll('#langMenu [data-lang]');
    for (var k = 0; k < menuButtons.length; k++) {
      menuButtons[k].setAttribute('aria-current', menuButtons[k].getAttribute('data-lang') === lang ? 'true' : 'false');
    }

    window.BIDLY_I18N = { lang: lang, dict: dict };
    document.dispatchEvent(new CustomEvent('bidly:lang-ready', { detail: { lang: lang, dict: dict } }));
  }

  function setLanguage(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = 'en';
    loadLocale(lang)
      .catch(function () {
        // если запрошенный язык не подгрузился — держим то, что уже было (или ru по умолчанию)
        return loadLocale('ru');
      })
      .then(function (dict) {
        applyTranslations(dict, lang);
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        document.body.classList.add('i18n-ready');
      });
  }

  window.BIDLY_setLanguage = setLanguage;

  document.addEventListener('DOMContentLoaded', function () {
    setLanguage(detectLanguage());

    var langBtn = document.getElementById('langBtn');
    var langMenu = document.getElementById('langMenu');
    if (langBtn && langMenu) {
      langBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = langMenu.classList.toggle('open');
        langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      langMenu.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-lang]');
        if (!btn) return;
        setLanguage(btn.getAttribute('data-lang'));
        langMenu.classList.remove('open');
        langBtn.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('click', function () {
        langMenu.classList.remove('open');
        langBtn.setAttribute('aria-expanded', 'false');
      });
    }

    // safety net: reveal the page even if a locale fails to load for some reason
    setTimeout(function () { document.body.classList.add('i18n-ready'); }, 1500);
  });
})();
