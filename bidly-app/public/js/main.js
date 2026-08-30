// public/js/main.js — интерактивность лендинга: теги партнёров, чипы условий,
// зона загрузки скринов, отправка анкеты и курсор-подсветка в хиро.

(function () {
  function t(key, fallback) {
    var dict = window.BIDLY_I18N && window.BIDLY_I18N.dict;
    if (!dict) return fallback;
    var parts = key.split('.');
    var cur = dict;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }
    return typeof cur === 'string' ? cur : fallback;
  }

  // ---------- тег-инпуты (партнёрки) ----------
  function tagInput(containerId) {
    var box = document.getElementById(containerId);
    if (!box) return;
    var addWrap = box.querySelector('.tag-add');
    var input = addWrap.querySelector('input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        addTag(box, addWrap, input.value.trim());
        input.value = '';
      }
    });
  }

  function addTag(box, addWrap, text) {
    var tag = document.createElement('span');
    tag.className = 'tag';
    var label = document.createElement('span');
    label.textContent = text;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.setAttribute('aria-label', 'remove');
    btn.addEventListener('click', function () { tag.remove(); });
    tag.appendChild(label);
    tag.appendChild(btn);
    box.insertBefore(tag, addWrap);
  }

  function readTags(containerId) {
    var box = document.getElementById(containerId);
    if (!box) return [];
    var spans = box.querySelectorAll('.tag > span:first-child');
    return Array.prototype.map.call(spans, function (s) { return s.textContent; });
  }

  // ---------- зона загрузки файлов (только имена — без реальной передачи бинарных данных) ----------
  function setupUpload() {
    var zone = document.getElementById('uploadZone');
    var input = document.getElementById('uploadInput');
    var list = document.getElementById('uploadFiles');
    if (!zone || !input || !list) return;

    function renderFiles() {
      list.innerHTML = '';
      Array.prototype.forEach.call(input.files, function (f) {
        var span = document.createElement('span');
        span.textContent = f.name;
        list.appendChild(span);
      });
    }

    input.addEventListener('change', renderFiles);

    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        renderFiles();
      }
    });
  }

  function readFileNames() {
    var input = document.getElementById('uploadInput');
    if (!input || !input.files || !input.files.length) return [];
    return Array.prototype.map.call(input.files, function (f) { return f.name; });
  }

  // ---------- форма ----------
  function setupForm() {
    var form = document.getElementById('bidlyForm');
    var status = document.getElementById('formStatus');
    var submitBtn = document.getElementById('submitBtn');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var geo = form.geo.value.trim();
      var trafficType = form.trafficType.value;

      if (!geo || !trafficType) {
        showStatus('err', t('apply.status_error_required', 'Заполните тип трафика и GEO.'));
        return;
      }

      var chips = Array.prototype.filter.call(
        document.querySelectorAll('#chipRow input[type="checkbox"]'),
        function (c) { return c.checked; }
      ).map(function (c) { return c.value; });

      var fileNames = readFileNames();
      var comment = form.comment.value.trim();
      if (fileNames.length) {
        comment = (comment ? comment + '\n\n' : '') + 'Файлы (только имена, без содержимого): ' + fileNames.join(', ');
      }

      var payload = {
        lang: (window.BIDLY_I18N && window.BIDLY_I18N.lang) || 'ru',
        trafficType: trafficType,
        geo: geo,
        vertical: form.vertical.value,
        platforms: form.platforms.value.trim(),
        followers: form.followers.value.trim(),
        views: form.views.value.trim(),
        ftd: form.ftd.value.trim(),
        partnersCurrent: readTags('tagsCurrent'),
        partnersPast: readTags('tagsPast'),
        desiredModels: chips,
        desiredRate: form.desiredRate.value.trim(),
        comment: comment
      };

      submitBtn.disabled = true;
      var originalHTML = submitBtn.innerHTML;
      submitBtn.textContent = t('apply.submit_sending', 'Отправляем…');

      fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, data: data }; });
        })
        .then(function (res) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHTML;

          if (!res.ok) {
            showStatus('err', res.data.error || t('apply.status_error', 'Не получилось отправить анкету.'));
            return;
          }

          showStatusSuccess(res.data.telegramLink);
          form.reset();
          document.getElementById('tagsCurrent').querySelectorAll('.tag').forEach(function (el) { el.remove(); });
          document.getElementById('tagsPast').querySelectorAll('.tag').forEach(function (el) { el.remove(); });
          document.getElementById('uploadFiles').innerHTML = '';
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHTML;
          showStatus('err', t('apply.status_error', 'Не получилось отправить анкету.'));
        });
    });

    function showStatus(kind, message) {
      status.className = 'show ' + kind;
      status.innerHTML = '';
      var icon = document.createElement('span');
      icon.textContent = kind === 'ok' ? '✅' : '⚠️';
      var text = document.createElement('span');
      text.textContent = message;
      status.appendChild(icon);
      status.appendChild(text);
      status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function showStatusSuccess(telegramLink) {
      status.className = 'show ok';
      status.innerHTML = '';
      var icon = document.createElement('span');
      icon.textContent = '✅';
      var wrap = document.createElement('div');
      var text = document.createElement('div');
      text.textContent = t('apply.status_success', 'Анкета сохранена.');
      wrap.appendChild(text);
      if (telegramLink) {
        var link = document.createElement('a');
        link.href = telegramLink;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'btn btn-violet';
        link.style.marginTop = '12px';
        link.style.display = 'inline-flex';
        link.textContent = 'Telegram →';
        wrap.appendChild(link);
      }
      status.appendChild(icon);
      status.appendChild(wrap);
      status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ---------- лёгкая подсветка курсора в хиро ("сияние") ----------
  function setupHeroSpotlight() {
    var hero = document.getElementById('heroSection');
    if (!hero || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    hero.addEventListener('pointermove', function (e) {
      var rect = hero.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      hero.style.setProperty('--mx', x + '%');
      hero.style.setProperty('--my', y + '%');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    tagInput('tagsCurrent');
    tagInput('tagsPast');
    setupUpload();
    setupForm();
    setupHeroSpotlight();
  });
})();
