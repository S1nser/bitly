// server/routes/admin.js — внутренняя панель BIDLY: список заявок, отправка офферов,
// просмотр загруженных скринов и рассылка объявлений всем подключённым в Telegram.
// Доступ закрыт HTTP Basic Auth (см. server/index.js, переменные ADMIN_USER / ADMIN_PASSWORD).
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { sendOfferToApplicant, sendOffersToApplicant, broadcastToApplicants } = require('../bot');

function presetFieldsFromBody(body) {
  const {
    partnerName, productName, productLink, rate,
    crClickReg, crRegDep, epc,
    adminFee, potentialEarnings, managerUsername, tags, isBest
  } = body || {};
  return {
    partnerName: partnerName ? String(partnerName).trim().slice(0, 120) : '',
    productName: productName ? String(productName).trim().slice(0, 160) : null,
    productLink: productLink ? String(productLink).trim().slice(0, 500) : null,
    rate: rate ? String(rate).trim().slice(0, 120) : null,
    crClickReg: crClickReg ? String(crClickReg).trim().slice(0, 60) : null,
    crRegDep: crRegDep ? String(crRegDep).trim().slice(0, 60) : null,
    epc: epc ? String(epc).trim().slice(0, 60) : null,
    adminFee: adminFee ? String(adminFee).trim().slice(0, 60) : null,
    potentialEarnings: potentialEarnings ? String(potentialEarnings).trim().slice(0, 160) : null,
    managerUsername: managerUsername ? String(managerUsername).trim().slice(0, 60) : null,
    tags: Array.isArray(tags) ? tags.filter(Boolean).map((t) => String(t).slice(0, 60)) : [],
    isBest: Boolean(isBest)
  };
}

const broadcastUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('Для рассылки можно приложить только изображение.'), ok);
  }
});

// Столбцы выгрузки заявок в CSV (открывается и в Google Таблицах, и в Excel).
const EXPORT_COLUMNS = [
  ['id', 'ID'],
  ['created_at', 'Дата'],
  ['lang', 'Язык анкеты'],
  ['traffic_type', 'Тип трафика'],
  ['geo', 'GEO'],
  ['vertical', 'Вертикаль'],
  ['platforms', 'Площадки'],
  ['followers', 'Подписчики / охват'],
  ['views', 'Просмотры'],
  ['ftd', 'FTD в месяц'],
  ['partners_current', 'Партнёры сейчас'],
  ['partners_past', 'Партнёры раньше'],
  ['desired_models', 'Желаемые модели'],
  ['desired_rate', 'Желаемая ставка'],
  ['comment', 'Комментарий'],
  ['telegram_username', 'Telegram username'],
  ['telegram_chat_id', 'Telegram chat id'],
  ['status', 'Статус']
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function applicationsToCsv(applications) {
  const header = EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const rows = applications.map((app) => EXPORT_COLUMNS.map(([key]) => csvCell(app[key])).join(','));
  // ﻿ (BOM) — чтобы кириллица не превращалась в кракозябры при открытии в Excel.
  return '﻿' + [header].concat(rows).join('\r\n') + '\r\n';
}

module.exports = function createAdminRouter(getBot) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
  });

  router.get('/api/applications', async (req, res) => {
    try {
      const applications = await db.listApplications();
      res.json(applications);
    } catch (err) {
      console.error('[admin] listApplications:', err);
      res.status(500).json({ error: 'Не удалось получить список заявок.' });
    }
  });

  // Выгрузка всех заявок в CSV — открывается импортом в Google Таблицы (Файл →
  // Импорт → Загрузка) или двойным кликом в Excel.
  router.get('/api/export.csv', async (req, res) => {
    try {
      const applications = await db.listApplications();
      const csv = applicationsToCsv(applications);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bidly-applications-${stamp}.csv"`);
      res.send(csv);
    } catch (err) {
      console.error('[admin] export:', err);
      res.status(500).send('Не удалось выгрузить данные.');
    }
  });

  router.get('/api/applications/:id', async (req, res) => {
    try {
      const application = await db.getApplication(req.params.id);
      if (!application) return res.status(404).json({ error: 'Заявка не найдена.' });
      const offers = await db.listOffersForApplication(req.params.id);
      const attachments = await db.listAttachments(req.params.id);
      res.json({ application, offers, attachments });
    } catch (err) {
      console.error('[admin] getApplication:', err);
      res.status(500).json({ error: 'Не удалось получить заявку.' });
    }
  });

  router.get('/api/attachments/:id/file', async (req, res) => {
    try {
      const attachment = await db.getAttachment(req.params.id);
      if (!attachment) return res.status(404).send('Не найдено');
      res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      if (attachment.filename) {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
      }
      res.send(attachment.data);
    } catch (err) {
      console.error('[admin] getAttachment:', err);
      res.status(500).send('Ошибка сервера');
    }
  });

  router.post('/api/applications/:id/offers', async (req, res) => {
    const {
      partnerName, geo, rate, tags,
      productName, productLink, crClickReg, crRegDep, epc,
      adminFee, potentialEarnings, managerUsername, isBest
    } = req.body || {};
    if (!partnerName || !String(partnerName).trim()) {
      return res.status(400).json({ error: 'Укажите название партнёрки.' });
    }

    try {
      const application = await db.getApplication(req.params.id);
      if (!application) return res.status(404).json({ error: 'Заявка не найдена.' });
      if (!application.telegram_chat_id) {
        return res.status(409).json({ error: 'У этой заявки ещё не подключён Telegram — оффер некуда слать.' });
      }

      const offer = await db.createOffer(req.params.id, {
        partnerName: String(partnerName).trim().slice(0, 120),
        geo: geo ? String(geo).trim().slice(0, 120) : null,
        rate: rate ? String(rate).trim().slice(0, 120) : null,
        tags: Array.isArray(tags) ? tags.filter(Boolean).map((t) => String(t).slice(0, 60)) : [],
        productName: productName ? String(productName).trim().slice(0, 160) : null,
        productLink: productLink ? String(productLink).trim().slice(0, 500) : null,
        crClickReg: crClickReg ? String(crClickReg).trim().slice(0, 60) : null,
        crRegDep: crRegDep ? String(crRegDep).trim().slice(0, 60) : null,
        epc: epc ? String(epc).trim().slice(0, 60) : null,
        adminFee: adminFee ? String(adminFee).trim().slice(0, 60) : null,
        potentialEarnings: potentialEarnings ? String(potentialEarnings).trim().slice(0, 160) : null,
        managerUsername: managerUsername ? String(managerUsername).trim().slice(0, 60) : null,
        isBest: Boolean(isBest)
      });

      const bot = getBot();
      if (!bot) {
        return res.status(503).json({
          error: 'Бот не запущен (нет BOT_TOKEN на сервере). Оффер сохранён, но не отправлен.',
          offer
        });
      }

      await sendOfferToApplicant(bot, application, offer);
      await db.updateApplicationStatus(application.id, 'offer_sent');

      res.status(201).json({ offer });
    } catch (err) {
      console.error('[admin] createOffer:', err);
      res.status(500).json({ error: err.message || 'Не удалось отправить оффер.' });
    }
  });

  // Пресеты офферов — сохранённые «профили партнёрок» (обычно с так себе
  // условиями и высоким admin fee), чтобы быстро пачкой отправлять несколько
  // штук в заявку, не набирая каждую вручную заново.
  router.get('/api/presets', async (req, res) => {
    try {
      const presets = await db.listOfferPresets();
      res.json(presets);
    } catch (err) {
      console.error('[admin] listOfferPresets:', err);
      res.status(500).json({ error: 'Не удалось получить пресеты.' });
    }
  });

  router.post('/api/presets', async (req, res) => {
    const fields = presetFieldsFromBody(req.body);
    if (!fields.partnerName) {
      return res.status(400).json({ error: 'Укажите название партнёрки.' });
    }
    try {
      const preset = await db.createOfferPreset(fields);
      res.status(201).json({ preset });
    } catch (err) {
      console.error('[admin] createOfferPreset:', err);
      res.status(500).json({ error: 'Не удалось сохранить пресет.' });
    }
  });

  router.put('/api/presets/:id', async (req, res) => {
    const fields = presetFieldsFromBody(req.body);
    if (!fields.partnerName) {
      return res.status(400).json({ error: 'Укажите название партнёрки.' });
    }
    try {
      const preset = await db.updateOfferPreset(req.params.id, fields);
      if (!preset) return res.status(404).json({ error: 'Пресет не найден.' });
      res.json({ preset });
    } catch (err) {
      console.error('[admin] updateOfferPreset:', err);
      res.status(500).json({ error: 'Не удалось обновить пресет.' });
    }
  });

  router.delete('/api/presets/:id', async (req, res) => {
    try {
      await db.deleteOfferPreset(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin] deleteOfferPreset:', err);
      res.status(500).json({ error: 'Не удалось удалить пресет.' });
    }
  });

  // Массовая отправка: берёт несколько сохранённых пресетов и отправляет их
  // все подряд одной заявке, каждый как отдельный оффер (GEO подставляется
  // из самой заявки, как и в обычной форме одного оффера).
  router.post('/api/applications/:id/offers/bulk', async (req, res) => {
    const { presetIds } = req.body || {};
    if (!Array.isArray(presetIds) || !presetIds.length) {
      return res.status(400).json({ error: 'Выберите хотя бы один пресет.' });
    }

    try {
      const application = await db.getApplication(req.params.id);
      if (!application) return res.status(404).json({ error: 'Заявка не найдена.' });
      if (!application.telegram_chat_id) {
        return res.status(409).json({ error: 'У этой заявки ещё не подключён Telegram — офферы некуда слать.' });
      }

      const createdOffers = [];
      for (const presetId of presetIds) {
        const preset = await db.getOfferPreset(presetId);
        if (!preset) continue;
        const offer = await db.createOffer(req.params.id, {
          partnerName: preset.partner_name,
          geo: application.geo || null,
          rate: preset.rate,
          tags: preset.tags,
          productName: preset.product_name,
          productLink: preset.product_link,
          crClickReg: preset.cr_click_reg,
          crRegDep: preset.cr_reg_dep,
          epc: preset.epc,
          adminFee: preset.admin_fee,
          potentialEarnings: preset.potential_earnings,
          managerUsername: preset.manager_username,
          isBest: preset.is_best
        });
        createdOffers.push(offer);
      }

      if (!createdOffers.length) {
        return res.status(400).json({ error: 'Ни один из выбранных пресетов не найден.' });
      }

      const bot = getBot();
      if (!bot) {
        return res.status(503).json({
          error: 'Бот не запущен (нет BOT_TOKEN на сервере). Офферы сохранены, но не отправлены.',
          offers: createdOffers
        });
      }

      const results = await sendOffersToApplicant(bot, application, createdOffers);
      await db.updateApplicationStatus(application.id, 'offer_sent');

      const sent = results.filter((r) => r.ok).length;
      const failed = results.length - sent;
      res.status(201).json({ offers: createdOffers, sent, failed });
    } catch (err) {
      console.error('[admin] bulk offers:', err);
      res.status(500).json({ error: err.message || 'Не удалось отправить офферы.' });
    }
  });

  // Рассылка объявления всем заявкам с подключённым Telegram
  router.post('/api/broadcast', (req, res) => {
    broadcastUpload.single('photo')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });

      const text = (req.body && req.body.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Введите текст сообщения.' });

      const bot = getBot();
      if (!bot) return res.status(503).json({ error: 'Бот не запущен (нет BOT_TOKEN на сервере).' });

      try {
        const recipients = await db.listConnectedApplications();
        const photo = req.file ? req.file.buffer : null;
        const result = await broadcastToApplicants(bot, recipients, text, photo);
        res.json(result);
      } catch (e) {
        console.error('[admin] broadcast:', e);
        res.status(500).json({ error: 'Не удалось выполнить рассылку.' });
      }
    });
  });

  return router;
};
