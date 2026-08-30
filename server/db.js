// server/db.js
//
// Единая точка доступа к данным.
// Если задан DATABASE_URL — работаем через PostgreSQL (так на Railway).
// Если нет — держим всё в памяти процесса, чтобы сайт можно было
// поднять и проверить локально без базы данных (данные пропадут при рестарте).

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Railway отдаёт внутренний Postgres без валидного сертификата для SSL,
    // поэтому проверку сертификата отключаем, а само шифрование оставляем.
    ssl: DATABASE_URL.includes('railway') || process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : false
  });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lang TEXT,
  traffic_type TEXT,
  geo TEXT,
  vertical TEXT,
  platforms TEXT,
  followers TEXT,
  views TEXT,
  ftd TEXT,
  partners_current TEXT[] NOT NULL DEFAULT '{}',
  partners_past TEXT[] NOT NULL DEFAULT '{}',
  desired_models TEXT[] NOT NULL DEFAULT '{}',
  desired_rate TEXT,
  comment TEXT,
  telegram_chat_id BIGINT,
  telegram_username TEXT,
  connect_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  geo TEXT,
  rate TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  telegram_message_id BIGINT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_name TEXT,
  product_link TEXT,
  conversion_rate TEXT,
  admin_fee TEXT,
  potential_earnings TEXT,
  manager_username TEXT,
  is_best BOOLEAN NOT NULL DEFAULT false,
  cr_click_reg TEXT,
  cr_reg_dep TEXT,
  epc TEXT
);

CREATE TABLE IF NOT EXISTS offer_presets (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  partner_name TEXT NOT NULL,
  product_name TEXT,
  product_link TEXT,
  rate TEXT,
  conversion_rate TEXT,
  admin_fee TEXT,
  potential_earnings TEXT,
  manager_username TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_best BOOLEAN NOT NULL DEFAULT false,
  cr_click_reg TEXT,
  cr_reg_dep TEXT,
  epc TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ALTER ... ADD COLUMN IF NOT EXISTS — на случай, если таблица offers уже
-- существует в базе с более раннего деплоя (CREATE TABLE IF NOT EXISTS выше
-- в этом случае новые столбцы сам не добавит).
ALTER TABLE offers ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS product_link TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS conversion_rate TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS admin_fee TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS potential_earnings TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS manager_username TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS is_best BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS cr_click_reg TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS cr_reg_dep TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS epc TEXT;

-- то же самое для offer_presets — таблица уже могла быть создана более
-- ранним деплоем без этих столбцов.
ALTER TABLE offer_presets ADD COLUMN IF NOT EXISTS cr_click_reg TEXT;
ALTER TABLE offer_presets ADD COLUMN IF NOT EXISTS cr_reg_dep TEXT;
ALTER TABLE offer_presets ADD COLUMN IF NOT EXISTS epc TEXT;
`;

// ---------------------------------------------------------------------------
// In-memory fallback (used only when DATABASE_URL is not set)
// ---------------------------------------------------------------------------
const mem = {
  applications: [],
  offers: [],
  attachments: [],
  offerPresets: [],
  nextAppId: 1,
  nextOfferId: 1,
  nextAttachmentId: 1,
  nextPresetId: 1
};

function memClone(row) {
  return row ? JSON.parse(JSON.stringify(row)) : row;
}

// ---------------------------------------------------------------------------

async function init() {
  if (!pool) {
    console.warn('[db] DATABASE_URL не задан — данные будут храниться в памяти процесса (не переживут рестарт).');
    return;
  }
  await pool.query(SCHEMA);
  console.log('[db] Подключение к PostgreSQL установлено, схема проверена.');
}

function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

async function createApplication(data) {
  const connectToken = randomToken();
  const base = {
    lang: data.lang || null,
    traffic_type: data.trafficType || null,
    geo: data.geo || null,
    vertical: data.vertical || null,
    platforms: data.platforms || null,
    followers: data.followers || null,
    views: data.views || null,
    ftd: data.ftd || null,
    partners_current: Array.isArray(data.partnersCurrent) ? data.partnersCurrent : [],
    partners_past: Array.isArray(data.partnersPast) ? data.partnersPast : [],
    desired_models: Array.isArray(data.desiredModels) ? data.desiredModels : [],
    desired_rate: data.desiredRate || null,
    comment: data.comment || null
  };

  if (!pool) {
    const row = {
      id: mem.nextAppId++,
      created_at: new Date().toISOString(),
      ...base,
      telegram_chat_id: null,
      telegram_username: null,
      connect_token: connectToken,
      status: 'new'
    };
    mem.applications.push(row);
    return memClone(row);
  }

  const { rows } = await pool.query(
    `INSERT INTO applications
      (lang, traffic_type, geo, vertical, platforms, followers, views, ftd,
       partners_current, partners_past, desired_models, desired_rate, comment, connect_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11::text[],$12,$13,$14)
     RETURNING *`,
    [
      base.lang, base.traffic_type, base.geo, base.vertical, base.platforms,
      base.followers, base.views, base.ftd,
      base.partners_current, base.partners_past, base.desired_models,
      base.desired_rate, base.comment, connectToken
    ]
  );
  return rows[0];
}

async function getApplication(id) {
  if (!pool) {
    return memClone(mem.applications.find((a) => String(a.id) === String(id)));
  }
  const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getApplicationByToken(token) {
  if (!pool) {
    return memClone(mem.applications.find((a) => a.connect_token === token));
  }
  const { rows } = await pool.query('SELECT * FROM applications WHERE connect_token = $1', [token]);
  return rows[0] || null;
}

async function findApplicationByChatId(chatId) {
  if (!pool) {
    return memClone(mem.applications.find((a) => String(a.telegram_chat_id) === String(chatId)));
  }
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE telegram_chat_id = $1 ORDER BY created_at DESC LIMIT 1',
    [chatId]
  );
  return rows[0] || null;
}

async function listApplications() {
  if (!pool) {
    return memClone(mem.applications).sort((a, b) => b.id - a.id);
  }
  const { rows } = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
  return rows;
}

async function linkTelegram(applicationId, chatId, username) {
  if (!pool) {
    const row = mem.applications.find((a) => String(a.id) === String(applicationId));
    if (!row) return null;
    row.telegram_chat_id = chatId;
    row.telegram_username = username || null;
    row.status = 'connected';
    return memClone(row);
  }
  const { rows } = await pool.query(
    `UPDATE applications
     SET telegram_chat_id = $2, telegram_username = $3, status = 'connected'
     WHERE id = $1 RETURNING *`,
    [applicationId, chatId, username || null]
  );
  return rows[0] || null;
}

async function updateApplicationStatus(id, status) {
  if (!pool) {
    const row = mem.applications.find((a) => String(a.id) === String(id));
    if (!row) return null;
    row.status = status;
    return memClone(row);
  }
  const { rows } = await pool.query(
    'UPDATE applications SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return rows[0] || null;
}

async function createOffer(applicationId, offer) {
  const base = {
    partner_name: offer.partnerName,
    geo: offer.geo || null,
    rate: offer.rate || null,
    tags: Array.isArray(offer.tags) ? offer.tags : [],
    product_name: offer.productName || null,
    product_link: offer.productLink || null,
    conversion_rate: offer.conversionRate || null,
    admin_fee: offer.adminFee || null,
    potential_earnings: offer.potentialEarnings || null,
    manager_username: offer.managerUsername || null,
    is_best: Boolean(offer.isBest),
    cr_click_reg: offer.crClickReg || null,
    cr_reg_dep: offer.crRegDep || null,
    epc: offer.epc || null
  };

  if (!pool) {
    const row = {
      id: mem.nextOfferId++,
      application_id: Number(applicationId),
      ...base,
      telegram_message_id: null,
      status: 'sent',
      created_at: new Date().toISOString()
    };
    mem.offers.push(row);
    return memClone(row);
  }

  const { rows } = await pool.query(
    `INSERT INTO offers (
       application_id, partner_name, geo, rate, tags,
       product_name, product_link, conversion_rate, admin_fee,
       potential_earnings, manager_username, is_best,
       cr_click_reg, cr_reg_dep, epc
     )
     VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      applicationId, base.partner_name, base.geo, base.rate, base.tags,
      base.product_name, base.product_link, base.conversion_rate, base.admin_fee,
      base.potential_earnings, base.manager_username, base.is_best,
      base.cr_click_reg, base.cr_reg_dep, base.epc
    ]
  );
  return rows[0];
}

async function getOffer(id) {
  if (!pool) {
    return memClone(mem.offers.find((o) => String(o.id) === String(id)));
  }
  const { rows } = await pool.query('SELECT * FROM offers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setOfferTelegramMessageId(id, messageId) {
  if (!pool) {
    const row = mem.offers.find((o) => String(o.id) === String(id));
    if (row) row.telegram_message_id = messageId;
    return;
  }
  await pool.query('UPDATE offers SET telegram_message_id = $2 WHERE id = $1', [id, messageId]);
}

async function updateOfferStatus(id, status) {
  if (!pool) {
    const row = mem.offers.find((o) => String(o.id) === String(id));
    if (!row) return null;
    row.status = status;
    return memClone(row);
  }
  const { rows } = await pool.query(
    'UPDATE offers SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return rows[0] || null;
}

async function listOffersForApplication(applicationId) {
  if (!pool) {
    return memClone(mem.offers.filter((o) => String(o.application_id) === String(applicationId)));
  }
  const { rows } = await pool.query(
    'SELECT * FROM offers WHERE application_id = $1 ORDER BY created_at DESC',
    [applicationId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Пресеты офферов — сохранённые «профили партнёрок» (обычно с так себе
// конверсией/условиями и высоким admin fee), чтобы не набирать их вручную
// каждый раз, а быстро отправлять пачкой в несколько кликов.
// ---------------------------------------------------------------------------

function presetBase(preset) {
  return {
    partner_name: preset.partnerName,
    product_name: preset.productName || null,
    product_link: preset.productLink || null,
    rate: preset.rate || null,
    conversion_rate: preset.conversionRate || null,
    admin_fee: preset.adminFee || null,
    potential_earnings: preset.potentialEarnings || null,
    manager_username: preset.managerUsername || null,
    tags: Array.isArray(preset.tags) ? preset.tags : [],
    is_best: Boolean(preset.isBest),
    cr_click_reg: preset.crClickReg || null,
    cr_reg_dep: preset.crRegDep || null,
    epc: preset.epc || null
  };
}

async function createOfferPreset(preset) {
  const base = presetBase(preset);

  if (!pool) {
    const row = {
      id: mem.nextPresetId++,
      created_at: new Date().toISOString(),
      ...base
    };
    mem.offerPresets.push(row);
    return memClone(row);
  }

  const { rows } = await pool.query(
    `INSERT INTO offer_presets (
       partner_name, product_name, product_link, rate, conversion_rate,
       admin_fee, potential_earnings, manager_username, tags, is_best,
       cr_click_reg, cr_reg_dep, epc
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13) RETURNING *`,
    [
      base.partner_name, base.product_name, base.product_link, base.rate, base.conversion_rate,
      base.admin_fee, base.potential_earnings, base.manager_username, base.tags, base.is_best,
      base.cr_click_reg, base.cr_reg_dep, base.epc
    ]
  );
  return rows[0];
}

async function listOfferPresets() {
  if (!pool) {
    return memClone(mem.offerPresets).sort((a, b) => a.id - b.id);
  }
  const { rows } = await pool.query('SELECT * FROM offer_presets ORDER BY id ASC');
  return rows;
}

async function getOfferPreset(id) {
  if (!pool) {
    return memClone(mem.offerPresets.find((p) => String(p.id) === String(id)));
  }
  const { rows } = await pool.query('SELECT * FROM offer_presets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateOfferPreset(id, preset) {
  const base = presetBase(preset);

  if (!pool) {
    const row = mem.offerPresets.find((p) => String(p.id) === String(id));
    if (!row) return null;
    Object.assign(row, base);
    return memClone(row);
  }

  const { rows } = await pool.query(
    `UPDATE offer_presets SET
       partner_name=$2, product_name=$3, product_link=$4, rate=$5, conversion_rate=$6,
       admin_fee=$7, potential_earnings=$8, manager_username=$9, tags=$10::text[], is_best=$11,
       cr_click_reg=$12, cr_reg_dep=$13, epc=$14
     WHERE id=$1 RETURNING *`,
    [
      id, base.partner_name, base.product_name, base.product_link, base.rate, base.conversion_rate,
      base.admin_fee, base.potential_earnings, base.manager_username, base.tags, base.is_best,
      base.cr_click_reg, base.cr_reg_dep, base.epc
    ]
  );
  return rows[0] || null;
}

async function deleteOfferPreset(id) {
  if (!pool) {
    const idx = mem.offerPresets.findIndex((p) => String(p.id) === String(id));
    if (idx >= 0) mem.offerPresets.splice(idx, 1);
    return;
  }
  await pool.query('DELETE FROM offer_presets WHERE id = $1', [id]);
}

async function createAttachment(applicationId, file) {
  const base = {
    filename: file.filename || null,
    mime_type: file.mimeType || null,
    size_bytes: file.data ? file.data.length : 0
  };

  if (!pool) {
    const row = {
      id: mem.nextAttachmentId++,
      application_id: Number(applicationId),
      ...base,
      data: file.data,
      created_at: new Date().toISOString()
    };
    mem.attachments.push(row);
    // не клонируем через JSON — это уничтожило бы Buffer
    return { ...row };
  }

  const { rows } = await pool.query(
    `INSERT INTO attachments (application_id, filename, mime_type, size_bytes, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, application_id, filename, mime_type, size_bytes, created_at`,
    [applicationId, base.filename, base.mime_type, base.size_bytes, file.data]
  );
  return rows[0];
}

async function listAttachments(applicationId) {
  // только метаданные — без самого файла, чтобы список заявок оставался лёгким
  if (!pool) {
    return mem.attachments
      .filter((a) => String(a.application_id) === String(applicationId))
      .map(({ data, ...meta }) => meta);
  }
  const { rows } = await pool.query(
    'SELECT id, application_id, filename, mime_type, size_bytes, created_at FROM attachments WHERE application_id = $1 ORDER BY created_at ASC',
    [applicationId]
  );
  return rows;
}

async function getAttachment(id) {
  if (!pool) {
    const row = mem.attachments.find((a) => String(a.id) === String(id));
    return row ? { ...row } : null;
  }
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listConnectedApplications() {
  if (!pool) {
    return memClone(mem.applications.filter((a) => a.telegram_chat_id));
  }
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE telegram_chat_id IS NOT NULL ORDER BY created_at DESC'
  );
  return rows;
}

module.exports = {
  init,
  isPersistent: () => Boolean(pool),
  createApplication,
  getApplication,
  getApplicationByToken,
  findApplicationByChatId,
  listApplications,
  linkTelegram,
  updateApplicationStatus,
  createOffer,
  getOffer,
  setOfferTelegramMessageId,
  updateOfferStatus,
  listOffersForApplication,
  createOfferPreset,
  listOfferPresets,
  getOfferPreset,
  updateOfferPreset,
  deleteOfferPreset,
  createAttachment,
  listAttachments,
  getAttachment,
  listConnectedApplications
};
