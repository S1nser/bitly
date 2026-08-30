// server/index.js — точка входа. Поднимает Express, статику сайта,
// публичный API анкеты, защищённую админку и Telegram-бота.
require('dotenv').config();

const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');

const db = require('./db');
const { createBot } = require('./bot');
const apiRouter = require('./routes/api');
const createAdminRouter = require('./routes/admin');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'bidly';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'bidly-webhook';
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true, persistent: db.isPersistent() }));

app.use('/api', apiRouter);

let bot = null;

if (!ADMIN_PASSWORD) {
  console.warn('[admin] ADMIN_PASSWORD не задан — панель /admin будет закрыта до тех пор, пока вы его не зададите.');
}

app.use(
  '/admin',
  basicAuth({
    users: { [ADMIN_USER]: ADMIN_PASSWORD || require('crypto').randomBytes(16).toString('hex') },
    challenge: true,
    realm: 'BIDLY Admin'
  }),
  createAdminRouter(() => bot)
);

async function start() {
  await db.init();

  bot = createBot();

  if (bot) {
    if (PUBLIC_URL) {
      const webhookPath = `/telegram/webhook/${WEBHOOK_SECRET}`;
      app.use(bot.webhookCallback(webhookPath));
      try {
        await bot.telegram.setWebhook(`${PUBLIC_URL}${webhookPath}`);
        console.log(`[bot] Вебхук установлен: ${PUBLIC_URL}${webhookPath}`);
      } catch (err) {
        console.error('[bot] Не удалось установить вебхук, переключаюсь на long polling:', err.message);
        await bot.launch();
      }
    } else {
      await bot.launch();
      console.log('[bot] Запущен в режиме long polling (PUBLIC_URL не задан — это нормально для локальной разработки).');
    }

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }

  app.listen(PORT, () => {
    console.log(`[server] BIDLY запущен на порту ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Фатальная ошибка при запуске:', err);
  process.exit(1);
});
