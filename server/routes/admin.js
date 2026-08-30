// server/routes/admin.js — внутренняя панель BIDLY: список заявок, отправка офферов,
// просмотр загруженных скринов и рассылка объявлений всем подключённым в Telegram.
// Доступ закрыт HTTP Basic Auth (см. server/index.js, переменные ADMIN_USER / ADMIN_PASSWORD).
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { sendOfferToApplicant, broadcastToApplicants } = require('../bot');

const broadcastUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('Для рассылки можно приложить только изображение.'), ok);
  }
});

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
    const { partnerName, geo, rate, tags } = req.body || {};
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
        tags: Array.isArray(tags) ? tags.filter(Boolean).map((t) => String(t).slice(0, 60)) : []
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
