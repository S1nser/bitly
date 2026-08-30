// public/js/main.js — интерактивность лендинга: пошаговая анкета (мастер),
// теги партнёров, чипы условий, зона загрузки скринов, отправка анкеты
// и курсор-подсветка в хиро.

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

  // ---------- зона загрузки файлов ----------
  function setupUpload() {
    var zone = document.getElementById('uploadZone');
    var input = document.getElementById('uploadInput');
    var list = document.getElementById('uploadFiles');
    if (!zone || !input || !list) return;

    function renderFiles() {
      list.innerHTML = '';
      Array.prototype.forEach.call(input.files, function (f) {
        var span = document.createElement('span');
        span.textContent = f.name + ' (' + Math.round(f.size / 1024) + ' КБ)';
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

  // ---------- анкета: мастер шагов + отправка ----------
  function setupApplyForm() {
    var form = document.getElementById('bidlyForm');
    if (!form) return;

    var status = document.getElementById('formStatus');
    var submitBtn = document.getElementById('submitBtn');
    var backBtn = document.getElementById('wizardBack');
    var nextBtn = document.getElementById('wizardNext');
    var fill = document.getElementById('wizardBarFill');
    var stepLabel = document.getElementById('wizardStepLabel');
    var dots = Array.prototype.slice.call(document.querySelectorAll('.wizard-dot'));
    var steps = Array.prototype.slice.call(form.querySelectorAll('.wizard-step'));
    var total = steps.length || 4;
    var current = 1;

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

    var connectStatusTimer = null;

    function markTelegramConnected(telegramLink) {
      var icon = document.getElementById('wsIcon');
      var pending = document.getElementById('wsPending');
      var done = document.getElementById('wsDone');
      var doneLink = document.getElementById('wizardSuccessLinkDone');

      if (icon) icon.classList.add('is-connected');
      if (doneLink) doneLink.href = telegramLink || '#';
      if (done) done.hidden = false;
      if (pending) pending.hidden = true;
    }

    function pollConnectStatus(connectToken, telegramLink) {
      if (!connectToken) return;
      if (connectStatusTimer) clearInterval(connectStatusTimer);

      var attempts = 0;
      var maxAttempts = 90; // ~6 минут опроса каждые 4 секунды

      connectStatusTimer = setInterval(function () {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(connectStatusTimer);
          connectStatusTimer = null;
          return;
        }
        fetch('/api/applications/status/' + encodeURIComponent(connectToken))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.connected) {
              clearInterval(connectStatusTimer);
              connectStatusTimer = null;
              markTelegramConnected(telegramLink);
            }
          })
          .catch(function () { /* тихо пробуем на следующем тике */ });
      }, 4000);
    }

    function showStatusSuccess(telegramLink, connectToken) {
      // Успех показываем на весь блок анкеты — крупная цветная плашка вместо
      // маленькой строчки статуса, чтобы результат отправки было видно сразу.
      var progress = document.getElementById('wizardProgress');
      var successPanel = document.getElementById('wizardSuccess');
      var successLink = document.getElementById('wizardSuccessLink');
      var icon = document.getElementById('wsIcon');
      var pending = document.getElementById('wsPending');
      var done = document.getElementById('wsDone');

      // сбрасываем состояние на случай повторной отправки анкеты
      if (icon) icon.classList.remove('is-connected');
      if (pending) pending.hidden = false;
      if (done) done.hidden = true;

      if (progress) progress.style.display = 'none';
      form.style.display = 'none';
      if (successLink) successLink.href = telegramLink || '#';
      if (successPanel) {
        successPanel.classList.add('show');
        successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      pollConnectStatus(connectToken, telegramLink);
    }

    function renderStep() {
      steps.forEach(function (el) {
        el.classList.toggle('active', Number(el.getAttribute('data-step')) === current);
      });
      if (fill) fill.style.width = (current / total * 100) + '%';
      dots.forEach(function (d) {
        var s = Number(d.getAttribute('data-dot'));
        d.classList.toggle('active', s === current);
        d.classList.toggle('done', s < current);
      });
      if (stepLabel) {
        var tmpl = t('apply.step_label', 'Шаг {n} из {total}');
        var text = tmpl.replace('{n}', current).replace('{total}', total);
        var groupLabel = t('apply.group' + current + '_label', '');
        stepLabel.textContent = groupLabel ? text + ' — ' + groupLabel : text;
      }
      if (backBtn) backBtn.style.visibility = current === 1 ? 'hidden' : 'visible';
      if (nextBtn) nextBtn.style.display = current === total ? 'none' : 'inline-flex';
      if (submitBtn) submitBtn.style.display = current === total ? 'inline-flex' : 'none';
    }

    function goToStep(n) {
      current = n;
      renderStep();
      var progress = document.getElementById('wizardProgress');
      if (progress) progress.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function validateStep1() {
      var geo = form.geo.value.trim();
      var trafficType = form.trafficType.value;
      if (!geo || !trafficType) {
        showStatus('err', t('apply.status_error_required', 'Заполните тип трафика и GEO.'));
        return false;
      }
      return true;
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (current === 1 && !validateStep1()) return;
        status.className = '';
        if (current < total) goToStep(current + 1);
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (current > 1) goToStep(current - 1);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // подстраховка: если форма отправилась не с последнего шага (например,
      // клавишей Enter) — просто переходим дальше вместо реальной отправки
      if (current !== total) {
        if (nextBtn) nextBtn.click();
        return;
      }

      if (!validateStep1()) { current = 1; renderStep(); return; }

      var chips = Array.prototype.filter.call(
        document.querySelectorAll('#chipRow input[type="checkbox"]'),
        function (c) { return c.checked; }
      ).map(function (c) { return c.value; });

      var fd = new FormData();
      fd.append('lang', (window.BIDLY_I18N && window.BIDLY_I18N.lang) || 'ru');
      fd.append('trafficType', form.trafficType.value);
      fd.append('geo', form.geo.value.trim());
      fd.append('vertical', form.vertical.value);
      fd.append('platforms', form.platforms.value.trim());
      fd.append('followers', form.followers.value.trim());
      fd.append('views', form.views.value.trim());
      fd.append('ftd', form.ftd.value.trim());
      fd.append('partnersCurrent', JSON.stringify(readTags('tagsCurrent')));
      fd.append('partnersPast', JSON.stringify(readTags('tagsPast')));
      fd.append('desiredModels', JSON.stringify(chips));
      fd.append('desiredRate', form.desiredRate.value.trim());
      fd.append('comment', form.comment.value.trim());

      var uploadInput = document.getElementById('uploadInput');
      if (uploadInput && uploadInput.files) {
        Array.prototype.forEach.call(uploadInput.files, function (file) {
          fd.append('screenshots', file);
        });
      }

      submitBtn.disabled = true;
      var originalHTML = submitBtn.innerHTML;
      submitBtn.textContent = t('apply.submit_sending', 'Отправляем…');

      fetch('/api/applications', { method: 'POST', body: fd })
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

          showStatusSuccess(res.data.telegramLink, res.data.connectToken);
          form.reset();
          document.getElementById('tagsCurrent').querySelectorAll('.tag').forEach(function (el) { el.remove(); });
          document.getElementById('tagsPast').querySelectorAll('.tag').forEach(function (el) { el.remove(); });
          document.getElementById('uploadFiles').innerHTML = '';
          current = 1;
          renderStep();
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHTML;
          showStatus('err', t('apply.status_error', 'Не получилось отправить анкету.'));
        });
    });

    document.addEventListener('bidly:lang-ready', renderStep);
    renderStep();
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

  // ---------- реальный username бота (вместо захардкоженной заглушки) ----------
  function setupBotLink() {
    var link = document.getElementById('openBotLink');
    if (!link) return;
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.botUsername) {
          link.href = 'https://t.me/' + data.botUsername;
        }
      })
      .catch(function () { /* оставляем ссылку как есть, если конфиг не отдался */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    tagInput('tagsCurrent');
    tagInput('tagsPast');
    setupUpload();
    setupApplyForm();
    setupHeroSpotlight();
    setupBotLink();
  });
})();
