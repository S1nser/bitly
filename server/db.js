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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
`;

// ---------------------------------------------------------------------------
// In-memory fallback (used only when DATABASE_URL is not set)
// ---------------------------------------------------------------------------
const mem = {
  applications: [],
  offers: [],
  attachments: [],
  nextAppId: 1,
  nextOfferId: 1,
  nextAttachmentId: 1
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
    tags: Array.isArray(offer.tags) ? offer.tags : []
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
    `INSERT INTO offers (application_id, partner_name, geo, rate, tags)
     VALUES ($1,$2,$3,$4,$5::text[]) RETURNING *`,
    [applicationId, base.partner_name, base.geo, base.rate, base.tags]
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
  createAttachment,
  listAttachments,
  getAttachment,
  listConnectedApplications
};
