// server/bot.js
//
// Telegram-бот BIDLY.
//   1. Пользователь жмёт на сайте "Получать предложения в Telegram" —
//      его перекидывает на t.me/<bot>?start=<connect_token>.
//   2. Бот в /start находит заявку по токену и привязывает к ней chat_id.
//   3. Когда менеджер BIDLY отправляет оффер из /admin, бот шлёт
//      пользователю карточку с кнопкой "Получить предложение".
//   4. Если пользователь жмёт кнопку — это и есть "горячий лид":
//      бот уведомляет админ-чат со всеми контактами и статистикой.

const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const STR = {
  ru: {
    startLinked: (id) =>
      `✅ Готово! Ваша заявка #${id} подключена к Telegram.\n\n` +
      `Как только бренды пришлют подходящие условия под ваш трафик — вы получите уведомление здесь. Обычно это занимает от пары часов до суток.`,
    startNoToken:
      `👋 Это бот BIDLY.\n\n` +
      `Чтобы начать получать офферы, сначала заполните анкету трафика на сайте — в конце нажмите «Получать предложения в Telegram», и бот сам свяжется с вашей заявкой.`,
    startTokenNotFound:
      `Не нашли заявку по этой ссылке 🤔 Похоже, ссылка устарела. Заполните анкету на сайте ещё раз и нажмите кнопку подключения Telegram.`,
    offerHeader: '🔔 Для вашего трафика найдено новое предложение',
    offerButton: '✅ Получить предложение',
    offerAccepted: (partner) =>
      `Отлично! Мы передали ваш контакт менеджеру ${partner}. Он свяжется с вами в ближайшее время 🚀`,
    offerAlreadyAccepted: 'Вы уже откликнулись на этот оффер — контакт передан.',
    geoLabel: 'GEO',
    rateLabel: 'Ставка',
    bestBadge: '💍 💎 ЛУЧШЕЕ ПРЕДЛОЖЕНИЕ 💍 💎',
    productLinkText: '🔗 Ссылка на оффер',
    conversionLabel: '📈 Конверсия',
    adminFeeLabel: '🏷 Admin fee',
    earningsLabel: '💵 Потенциальный доход/мес',
    managerLabel: '👤 Ваш менеджер'
  },
  en: {
    startLinked: (id) =>
      `✅ All set! Your application #${id} is now linked to Telegram.\n\n` +
      `As soon as a brand sends a matching offer for your traffic, you'll get a notification right here. Usually within a few hours to a day.`,
    startNoToken:
      `👋 This is the BIDLY bot.\n\n` +
      `To start receiving offers, first fill in the traffic application on the website — at the end tap "Get offers in Telegram" and the bot will link itself to your application automatically.`,
    startTokenNotFound:
      `Couldn't find an application for this link 🤔 It looks outdated. Please submit the form on the website again and tap the Telegram button once more.`,
    offerHeader: '🔔 A new offer is available for your traffic',
    offerButton: '✅ Get this offer',
    offerAccepted: (partner) =>
      `Great! We've shared your contact with the ${partner} manager. They'll reach out shortly 🚀`,
    offerAlreadyAccepted: "You've already accepted this offer — your contact was shared.",
    geoLabel: 'GEO',
    rateLabel: 'Rate',
    bestBadge: '💍 💎 BEST OFFER 💍 💎',
    productLinkText: '🔗 Offer link',
    conversionLabel: '📈 Conversion',
    adminFeeLabel: '🏷 Admin fee',
    earningsLabel: '💵 Potential monthly income',
    managerLabel: '👤 Your manager'
  },
  uz: {
    startLinked: (id) =>
      `✅ Tayyor! Sizning #${id} arizangiz Telegramga ulandi.\n\n` +
      `Brendlar trafikingizga mos shartlarni yuborishi bilan shu yerda xabar olasiz. Odatda bir necha soatdan bir sutkagacha vaqt ketadi.`,
    startNoToken:
      `👋 Bu — BIDLY boti.\n\n` +
      `Takliflarni olishni boshlash uchun avval saytda trafik anketasini to'ldiring — oxirida "Telegram orqali takliflar olish" tugmasini bosing, bot arizangizga o'zi ulanadi.`,
    startTokenNotFound:
      `Bu havola bo'yicha ariza topilmadi 🤔 Havola eskirgan bo'lishi mumkin. Saytda anketani qaytadan to'ldiring va Telegramni ulash tugmasini bosing.`,
    offerHeader: '🔔 Trafikingiz uchun yangi taklif topildi',
    offerButton: '✅ Taklifni olish',
    offerAccepted: (partner) =>
      `Ajoyib! Kontaktingiz ${partner} menejeriga yuborildi. Tez orada siz bilan bog'lanadi 🚀`,
    offerAlreadyAccepted: 'Siz allaqachon bu taklifga rozilik bildirdingiz — kontakt yuborilgan.',
    geoLabel: 'GEO',
    rateLabel: 'Stavka',
    bestBadge: '💍 💎 ENG YAXSHI TAKLIF 💍 💎',
    productLinkText: "🔗 Taklif havolasi",
    conversionLabel: '📈 Konversiya',
    adminFeeLabel: '🏷 Admin fee',
    earningsLabel: "💵 Oyiga potentsial daromad",
    managerLabel: '👤 Sizning menejeringiz'
  },
  ar: {
    startLinked: (id) =>
      `✅ تم! تم ربط طلبك رقم ${id} بتيليجرام.\n\n` +
      `بمجرد أن يرسل أحد البراندات عرضًا مناسبًا لحركة المرور الخاصة بك، ستصلك رسالة هنا. عادة خلال ساعات قليلة إلى يوم واحد.`,
    startNoToken:
      `👋 هذا بوت BIDLY.\n\n` +
      `لتبدأ باستلام العروض، عليك أولاً تعبئة استمارة حركة المرور على الموقع — وفي النهاية اضغط "استلام العروض عبر تيليجرام"، وسيقوم البوت بربط نفسه بطلبك تلقائيًا.`,
    startTokenNotFound:
      `لم نجد طلبًا مرتبطًا بهذا الرابط 🤔 يبدو أن الرابط قديم. الرجاء تعبئة الاستمارة مجددًا على الموقع ثم الضغط على زر ربط تيليجرام.`,
    offerHeader: '🔔 تم العثور على عرض جديد لحركة المرور الخاصة بك',
    offerButton: '✅ استلام العرض',
    offerAccepted: (partner) =>
      `ممتاز! تم إرسال بياناتك إلى مدير ${partner} وسيتواصل معك قريبًا 🚀`,
    offerAlreadyAccepted: 'لقد وافقت بالفعل على هذا العرض — تم إرسال بياناتك.',
    geoLabel: 'GEO',
    rateLabel: 'المعدل',
    bestBadge: '💍 💎 أفضل عرض 💍 💎',
    productLinkText: '🔗 رابط العرض',
    conversionLabel: '📈 التحويل',
    adminFeeLabel: '🏷 Admin fee',
    earningsLabel: '💵 الدخل الشهري المحتمل',
    managerLabel: '👤 مديرك'
  }
};

function t(lang) {
  return STR[lang] || STR.ru;
}

const SUPPORTED_LANGS = ['ru', 'en', 'uz', 'ar'];

// Пока заявка ещё не найдена (нет анкеты -> нет lang), угадываем язык
// по языку интерфейса Telegram у самого пользователя.
function detectTelegramLang(ctx) {
  const code = String((ctx.from && ctx.from.language_code) || '').toLowerCase().split('-')[0];
  return SUPPORTED_LANGS.includes(code) ? code : 'ru';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Приводит ссылку к виду, который Telegram примет как валидный href
// (добавляет https://, если протокол не указан).
function normalizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Ник менеджера -> ссылка вида t.me/username, даже если ввели с "@" или без.
function managerLink(username) {
  const clean = String(username || '').trim().replace(/^@/, '');
  if (!clean) return null;
  return { handle: clean, url: `https://t.me/${clean}` };
}

function buildOfferMessage(application, offer) {
  const lang = t(application.lang);
  const tagsLine = (offer.tags || []).filter(Boolean).join('  ·  ');
  const productLink = normalizeUrl(offer.product_link);
  const manager = managerLink(offer.manager_username);

  const titleLine = offer.product_name
    ? `⭐ <b>${escapeHtml(offer.partner_name)}</b> — ${escapeHtml(offer.product_name)}`
    : `⭐ <b>${escapeHtml(offer.partner_name)}</b>`;

  const lines = [
    offer.is_best ? `<b>${escapeHtml(lang.bestBadge)}</b>` : null,
    offer.is_best ? '' : null,
    lang.offerHeader,
    '',
    titleLine,
    productLink ? `<a href="${escapeHtml(productLink)}">${escapeHtml(lang.productLinkText)}</a>` : null,
    '',
    offer.geo ? `🌍 ${lang.geoLabel}: <b>${escapeHtml(offer.geo)}</b>` : null,
    offer.rate ? `💰 ${lang.rateLabel}: <b>${escapeHtml(offer.rate)}</b>` : null,
    offer.conversion_rate ? `${lang.conversionLabel}: <b>${escapeHtml(offer.conversion_rate)}</b>` : null,
    offer.admin_fee ? `${lang.adminFeeLabel}: <b>${escapeHtml(offer.admin_fee)}</b>` : null,
    offer.potential_earnings ? `${lang.earningsLabel}: <b>${escapeHtml(offer.potential_earnings)}</b>` : null,
    tagsLine ? `\n<i>${escapeHtml(tagsLine)}</i>` : null,
    manager ? `\n${lang.managerLabel}: <a href="${escapeHtml(manager.url)}">@${escapeHtml(manager.handle)}</a>` : null
  ].filter((line) => line !== null);

  return lines.join('\n');
}

function createBot() {
  if (!BOT_TOKEN) {
    console.warn('[bot] BOT_TOKEN не задан — Telegram-бот отключён (сайт продолжит работать без него).');
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    const payload = ctx.startPayload && ctx.startPayload.trim();

    if (!payload) {
      return ctx.reply(t(detectTelegramLang(ctx)).startNoToken);
    }

    const application = await db.getApplicationByToken(payload);
    if (!application) {
      return ctx.reply(t(detectTelegramLang(ctx)).startTokenNotFound);
    }

    await db.linkTelegram(application.id, ctx.chat.id, ctx.from.username || null);
    return ctx.reply(t(application.lang).startLinked(application.id));
  });

  bot.action(/^offer:(\d+)$/, async (ctx) => {
    const offerId = ctx.match[1];
    const offer = await db.getOffer(offerId);
    if (!offer) {
      return ctx.answerCbQuery('Оффер не найден', { show_alert: true });
    }

    const application = await db.getApplication(offer.application_id);
    const lang = t(application ? application.lang : 'ru');

    if (offer.status === 'interested') {
      return ctx.answerCbQuery(lang.offerAlreadyAccepted, { show_alert: true });
    }

    await db.updateOfferStatus(offerId, 'interested');
    await db.updateApplicationStatus(offer.application_id, 'interested');

    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.reply(lang.offerAccepted(offer.partner_name));

    if (ADMIN_CHAT_ID) {
      const contact = ctx.from.username ? `@${ctx.from.username}` : `id ${ctx.from.id}`;
      const app = application || {};
      const details = [
        `🔥 *Горячий лид* — заявка #${app.id}`,
        `Оффер: ${offer.partner_name}${offer.product_name ? ' — ' + offer.product_name : ''} (${offer.geo || '—'}, ${offer.rate || '—'})`,
        offer.product_link ? `Ссылка на оффер: ${offer.product_link}` : null,
        offer.manager_username ? `Менеджер по офферу: @${String(offer.manager_username).replace(/^@/, '')}` : null,
        `Telegram: ${contact}`,
        `GEO трафика: ${app.geo || '—'}`,
        `Тип трафика: ${app.traffic_type || '—'}`,
        `Площадки: ${app.platforms || '—'}`,
        `Подписчики/охват: ${app.followers || '—'}`,
        `FTD/мес: ${app.ftd || '—'}`,
        `Работал(а) с: ${(app.partners_past || []).join(', ') || '—'}`,
        `Работает с: ${(app.partners_current || []).join(', ') || '—'}`,
        `Комментарий: ${app.comment || '—'}`
      ].filter((line) => line !== null).join('\n');
      await bot.telegram.sendMessage(ADMIN_CHAT_ID, details, { parse_mode: 'Markdown' }).catch((e) => {
        console.error('[bot] Не удалось отправить уведомление в админ-чат:', e.message);
      });
    }
  });

  bot.catch((err) => {
    console.error('[bot] Ошибка обработчика:', err);
  });

  return bot;
}

async function sendOfferToApplicant(bot, application, offer) {
  if (!bot) throw new Error('Бот не запущен (нет BOT_TOKEN)');
  if (!application.telegram_chat_id) {
    throw new Error('У этой заявки ещё не подключён Telegram');
  }

  const lang = t(application.lang);
  const text = buildOfferMessage(application, offer);
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback(lang.offerButton, `offer:${offer.id}`)
  ]);

  const message = await bot.telegram.sendMessage(application.telegram_chat_id, text, {
    parse_mode: 'HTML',
    ...keyboard
  });

  await db.setOfferTelegramMessageId(offer.id, message.message_id);
  return message;
}

// Рассылает одно объявление всем заявкам с подключённым Telegram.
// Не валит всю рассылку из-за одного заблокировавшего бота пользователя —
// просто считает успехи/ошибки и делает небольшую паузу между отправками,
// чтобы не упереться в лимиты Telegram на количество сообщений в секунду.
async function broadcastToApplicants(bot, applications, text, photoBuffer) {
  if (!bot) throw new Error('Бот не запущен (нет BOT_TOKEN)');

  let sent = 0;
  let failed = 0;

  for (const app of applications) {
    try {
      if (photoBuffer) {
        await bot.telegram.sendPhoto(
          app.telegram_chat_id,
          { source: photoBuffer },
          { caption: text }
        );
      } else {
        await bot.telegram.sendMessage(app.telegram_chat_id, text);
      }
      sent++;
    } catch (e) {
      failed++;
      console.error(`[bot] Рассылка: не удалось отправить заявке #${app.id}:`, e.message);
    }
    // небольшая пауза между сообщениями, чтобы не словить flood-лимит Telegram
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  return { total: applications.length, sent, failed };
}

module.exports = { createBot, sendOfferToApplicant, broadcastToApplicants };
