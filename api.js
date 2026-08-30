// server/routes/api.js — публичный API сайта (анкета трафика)
const express = require('express');
const multer = require('multer');
const db = require('../db');

const router = express.Router();
const BOT_USERNAME = process.env.BOT_USERNAME || 'BIDLY_bot';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8 МБ на файл
    files: 5
  },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Разрешены только изображения и PDF.'), ok);
  }
});

function clean(value, max = 4000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanJsonArray(value, max = 20) {
  let arr;
  try {
    arr = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (e) {
    arr = [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().slice(0, 80))
    .slice(0, max);
}

router.get('/config', (req, res) => {
  res.json({ botUsername: BOT_USERNAME });
});

router.post('/applications', (req, res) => {
  upload.array('screenshots', 5)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Не удалось загрузить файлы.' });
    }

    const body = req.body || {};
    const geo = clean(body.geo, 200);
    const trafficType = clean(body.trafficType, 100);

    if (!geo || !trafficType) {
      return res.status(400).json({ error: 'Заполните тип трафика и GEO.' });
    }

    try {
      const application = await db.createApplication({
        lang: clean(body.lang, 5) || 'ru',
        trafficType,
        geo,
        vertical: clean(body.vertical, 100),
        platforms: clean(body.platforms, 2000),
        followers: clean(body.followers, 200),
        views: clean(body.views, 200),
        ftd: clean(body.ftd, 200),
        partnersCurrent: cleanJsonArray(body.partnersCurrent),
        partnersPast: cleanJsonArray(body.partnersPast),
        desiredModels: cleanJsonArray(body.desiredModels, 12),
        desiredRate: clean(body.desiredRate, 200),
        comment: clean(body.comment, 3000)
      });

      const files = req.files || [];
      for (const file of files) {
        await db.createAttachment(application.id, {
          filename: file.originalname,
          mimeType: file.mimetype,
          data: file.buffer
        });
      }

      return res.status(201).json({
        id: application.id,
        connectToken: application.connect_token,
        telegramLink: `https://t.me/${BOT_USERNAME}?start=${application.connect_token}`
      });
    } catch (e) {
      console.error('[api] Не удалось сохранить заявку:', e);
      return res.status(500).json({ error: 'Не получилось сохранить заявку, попробуйте ещё раз.' });
    }
  });
});

module.exports = router;
