// server/routes/api.js — публичный API сайта (анкета трафика)
const express = require('express');
const db = require('../db');

const router = express.Router();
const BOT_USERNAME = process.env.BOT_USERNAME || 'BIDLY_bot';

function clean(value, max = 4000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().slice(0, 80))
    .slice(0, max);
}

router.post('/applications', async (req, res) => {
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
      partnersCurrent: cleanArray(body.partnersCurrent),
      partnersPast: cleanArray(body.partnersPast),
      desiredModels: cleanArray(body.desiredModels, 12),
      desiredRate: clean(body.desiredRate, 200),
      comment: clean(body.comment, 3000)
    });

    return res.status(201).json({
      id: application.id,
      connectToken: application.connect_token,
      telegramLink: `https://t.me/${BOT_USERNAME}?start=${application.connect_token}`
    });
  } catch (err) {
    console.error('[api] Не удалось сохранить заявку:', err);
    return res.status(500).json({ error: 'Не получилось сохранить заявку, попробуйте ещё раз.' });
  }
});

module.exports = router;
