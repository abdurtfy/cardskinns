const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const tls = require("node:tls");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const WEBHOOK_EVENTS_FILE = path.join(DATA_DIR, "webhook-events.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const adminSessions = new Set();

const baseProducts = [
  { id: "noir-neon", name: "Noir Neon", price: 99 },
  { id: "cyber-wave", name: "Cyber Wave", price: 99 },
  { id: "metro-midnight", name: "Metro Midnight", price: 99 },
  { id: "anime-surge", name: "Anime Surge", price: 99 },
  { id: "black-gold", name: "Black Gold", price: 99 },
  { id: "pixel-pop", name: "Pixel Pop", price: 99 },
  { id: "carbon-rush", name: "Carbon Rush", price: 99 },
  { id: "silver-static", name: "Silver Static", price: 99 },
];

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USE_KV = Boolean(KV_URL && KV_TOKEN);

async function kvGet(key) {
  const response = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (data.result == null) return null;
  try {
    return JSON.parse(data.result);
  } catch {
    return data.result;
  }
}

async function kvSet(key, value) {
  const response = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`KV set failed: ${response.status} ${await response.text()}`);
  }
}

async function loadStore(key, file, fallback) {
  if (USE_KV) {
    const value = await kvGet(key);
    return value == null ? fallback : value;
  }
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function saveStore(key, file, value) {
  if (USE_KV) {
    await kvSet(key, value);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function readProductOverrides() {
  return loadStore("products", PRODUCTS_FILE, {});
}

async function writeProductOverrides(data) {
  await saveStore("products", PRODUCTS_FILE, data);
}

async function getProducts() {
  const overrides = await readProductOverrides();
  return baseProducts.map((p) => {
    const o = overrides[p.id] || {};
    return {
      ...p,
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : p.name,
      price: typeof o.price === "number" ? o.price : p.price,
      stock: typeof o.stock === "number" ? o.stock : 100,
      image: typeof o.image === "string" ? o.image : null,
      description: typeof o.description === "string" ? o.description : "",
    };
  });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const env = fs.readFileSync(filePath, "utf8");
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const cookie of header.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function createSession() {
  const token = crypto.randomBytes(32).toString("base64url");
  adminSessions.add(token);
  return token;
}

function isAdminRequest(req) {
  const token = parseCookies(req).cds_admin_session;
  return Boolean(token && adminSessions.has(token));
}

function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `cds_admin_session=${maxAge ? "" : "deleted"}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function safeCompare(value, expected) {
  const first = Buffer.from(String(value || ""));
  const second = Buffer.from(String(expected || ""));
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

async function readOrders() {
  return loadStore("orders", ORDERS_FILE, []);
}

async function writeOrders(orders) {
  await saveStore("orders", ORDERS_FILE, orders);
}

async function hasProcessedWebhook(id) {
  if (!id) return false;
  const events = await loadStore("webhook_events", WEBHOOK_EVENTS_FILE, []);
  return events.some((event) => event.id === id);
}

async function saveProcessedWebhook(id, source, event) {
  if (!id) return;
  const events = await loadStore("webhook_events", WEBHOOK_EVENTS_FILE, []);
  events.unshift({ id, source, event, processed_at: new Date().toISOString() });
  await saveStore("webhook_events", WEBHOOK_EVENTS_FILE, events.slice(0, 500));
}

async function saveOrder(order) {
  const orders = await readOrders();
  const existingIndex = orders.findIndex((item) => item.id === order.id);
  if (existingIndex >= 0) orders[existingIndex] = order;
  else orders.unshift(order);
  await writeOrders(orders);
  return order;
}

async function updateOrder(id, patch) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id || item.razorpay_order_id === id);
  if (!order) return null;
  Object.assign(order, patch, { updated_at: new Date().toISOString() });
  await writeOrders(orders);
  return order;
}

function publicOrder(order) {
  return {
    id: order.id,
    razorpay_order_id: order.razorpay_order_id,
    razorpay_payment_id: order.razorpay_payment_id,
    shiprocket_order_id: order.shiprocket_order_id,
    awb_code: order.awb_code,
    status: order.status,
    payment_status: order.payment_status,
    shipping_status: order.shipping_status,
    customer: order.customer,
    lines: order.lines,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    email_status: order.email_status,
    shipping_email_status: order.shipping_email_status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    error: order.error,
  };
}

function confirmationOrder(order) {
  return {
    id: order.id,
    status: order.status,
    payment_status: order.payment_status,
    shipping_status: order.shipping_status,
    shiprocket_order_id: order.shiprocket_order_id,
    awb_code: order.awb_code,
    lines: order.lines,
    total: order.total,
    email_status: order.email_status,
    shipping_email_status: order.shipping_email_status,
  };
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve({ raw: body, json: body ? JSON.parse(body) : {} });
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

async function calculateOrder(items = []) {
  const catalog = await getProducts();
  const lines = items.map((item) => {
    const product = catalog.find((candidate) => candidate.id === item.id);
    const quantity = Number(item.quantity || 0);
    if (!product || quantity < 1) return null;
    if (product.stock <= 0 || quantity > product.stock) {
      throw new Error(`${product.name} is out of stock`);
    }
    return { ...product, quantity };
  });

  if (lines.some((line) => !line) || !lines.length) {
    throw new Error("Invalid cart items");
  }

  const grossSubtotal = lines.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const unitPrices = [];
  lines.forEach((item) => {
    for (let i = 0; i < item.quantity; i += 1) unitPrices.push(item.price);
  });
  unitPrices.sort((a, b) => a - b);
  const freeCount = Math.floor(unitPrices.length / 3);
  let discount = 0;
  for (let i = 0; i < freeCount; i += 1) discount += unitPrices[i];

  const subtotal = grossSubtotal - discount;
  const shipping = subtotal >= 499 || subtotal === 0 ? 0 : 49;
  return { lines, grossSubtotal, discount, subtotal, shipping, total: subtotal + shipping };
}

async function shiprocketRequest(pathname, options = {}) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    return { demo: true };
  }

  const login = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });
  const auth = await login.json();
  if (!login.ok) throw new Error(auth.message || "Shiprocket auth failed");

  const response = await fetch(`https://apiv2.shiprocket.in/v1/external${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Shiprocket error", response.status, "on", pathname, "->", JSON.stringify(data));
    const detail = data.errors ? ` (${JSON.stringify(data.errors)})` : "";
    throw new Error((data.message || "Shiprocket request failed") + detail);
  }
  return data;
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { status: "missing_recipient" };
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM) {
    await sendSmtpEmail({ to, subject, html });
    return { status: "sent_smtp" };
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { status: "demo_not_sent" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Email send failed");
  return { status: "sent", provider_id: data.id };
}

function sendSmtpEmail({ to, subject, html }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.EMAIL_FROM;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const message = [
    `From: carddesign.skin <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => {
      const commands = [
        `EHLO carddesign.skin`,
        "AUTH LOGIN",
        Buffer.from(user).toString("base64"),
        Buffer.from(pass).toString("base64"),
        `MAIL FROM:<${from}>`,
        `RCPT TO:<${to}>`,
        "DATA",
        `${message.replace(/\r?\n\./g, "\r\n..")}\r\n.`,
        "QUIT",
      ];
      let index = 0;
      const sendNext = () => {
        if (index < commands.length) socket.write(`${commands[index++]}\r\n`);
      };

      socket.on("data", (chunk) => {
        const response = chunk.toString();
        if (/^[45]\d\d/m.test(response)) {
          socket.destroy();
          reject(new Error("SMTP send failed"));
          return;
        }
        if (response.includes("221")) resolve();
        else sendNext();
      });
      sendNext();
    });
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error("SMTP timed out"));
    });
    socket.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatINR(amount) {
  const value = Number(amount || 0);
  return `&#8377;${value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatOrderDate(value) {
  try {
    const d = value ? new Date(value) : new Date();
    return d.toLocaleString("en-IN", {
      day: "numeric", month: "long", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch { return ""; }
}

function buildOrderConfirmationEmail(order) {
  const c = order.customer || {};
  const placedOn = formatOrderDate(order.created_at);
  const itemRows = (order.lines || []).map((item) => `
    <tr>
      <td style="padding:14px 16px;border-bottom:1px solid #1f1f1f;color:#f5f0e6;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.4;">
        <div style="font-weight:600;color:#f5f0e6;">${escapeHtml(item.name)}</div>
        <div style="color:#8a8275;font-size:12px;margin-top:4px;letter-spacing:0.06em;text-transform:uppercase;">SKU&nbsp;&middot;&nbsp;${escapeHtml(item.id)}</div>
      </td>
      <td align="center" style="padding:14px 16px;border-bottom:1px solid #1f1f1f;color:#cfc7b3;font-family:Georgia,'Times New Roman',serif;font-size:15px;">${item.quantity}</td>
      <td align="right" style="padding:14px 16px;border-bottom:1px solid #1f1f1f;color:#f5f0e6;font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:600;">${formatINR(item.price * item.quantity)}</td>
    </tr>
  `).join("");

  const addressLine = [c.address, c.city, c.state, c.pin].filter(Boolean).map(escapeHtml).join(", ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Order confirmed &middot; carddesign.skin</title>
</head>
<body style="margin:0;padding:0;background:#050505;font-family:Georgia,'Times New Roman',serif;color:#f5f0e6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your carddesign.skin order ${escapeHtml(order.id)} is confirmed. Total ${formatINR(order.total)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#050505;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#0a0a0a;border:1px solid #1a1a1a;">
      <tr><td style="padding:36px 40px 24px;text-align:center;border-bottom:1px solid #1a1a1a;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.42em;color:#c9a961;text-transform:uppercase;">carddesign.skin</div>
        <h1 style="margin:18px 0 8px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;letter-spacing:0.04em;color:#f5f0e6;">Your order is confirmed</h1>
        <p style="margin:0;color:#8a8275;font-size:14px;letter-spacing:0.02em;">Thank you, ${escapeHtml((c.name || "").split(" ")[0] || "friend")} &mdash; we have received your order.</p>
      </td></tr>

      <tr><td style="padding:28px 40px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:11px;letter-spacing:0.32em;color:#8a8275;text-transform:uppercase;padding-bottom:6px;">Order ID</td>
            <td align="right" style="font-size:11px;letter-spacing:0.32em;color:#8a8275;text-transform:uppercase;padding-bottom:6px;">Placed on</td>
          </tr>
          <tr>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#c9a961;font-weight:600;">${escapeHtml(order.id)}</td>
            <td align="right" style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:#cfc7b3;">${escapeHtml(placedOn)}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:24px 40px 8px;">
        <div style="font-size:11px;letter-spacing:0.32em;color:#8a8275;text-transform:uppercase;margin-bottom:10px;">Items</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #1f1f1f;">
          ${itemRows}
        </table>
      </td></tr>

      <tr><td style="padding:8px 40px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:8px 0;color:#8a8275;font-size:14px;">Subtotal</td>
            <td align="right" style="padding:8px 0;color:#cfc7b3;font-size:14px;">${formatINR(order.subtotal)}</td>
          </tr>
          ${order.discount > 0 ? `<tr>
            <td style="padding:8px 0;color:#8a8275;font-size:14px;">Discount</td>
            <td align="right" style="padding:8px 0;color:#cfc7b3;font-size:14px;">&minus; ${formatINR(order.discount)}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:8px 0;color:#8a8275;font-size:14px;">Shipping</td>
            <td align="right" style="padding:8px 0;color:#cfc7b3;font-size:14px;">${order.shipping ? formatINR(order.shipping) : "FREE"}</td>
          </tr>
          <tr><td colspan="2" style="border-top:1px solid #1f1f1f;padding-top:14px;"></td></tr>
          <tr>
            <td style="padding:6px 0 18px;color:#f5f0e6;font-size:16px;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Total</td>
            <td align="right" style="padding:6px 0 18px;color:#c9a961;font-size:22px;font-weight:700;">${formatINR(order.total)}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111;border:1px solid #1f1f1f;">
          <tr><td style="padding:20px 22px;">
            <div style="font-size:11px;letter-spacing:0.32em;color:#c9a961;text-transform:uppercase;margin-bottom:10px;">Shipping to</div>
            <div style="color:#f5f0e6;font-size:15px;font-weight:600;margin-bottom:4px;">${escapeHtml(c.name || "")}</div>
            <div style="color:#cfc7b3;font-size:14px;line-height:1.6;">${addressLine}</div>
            <div style="color:#8a8275;font-size:13px;margin-top:8px;">${escapeHtml(c.phone || "")} &middot; ${escapeHtml(c.email || "")}</div>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 40px 32px;">
        <div style="background:#0d0d0d;border-left:2px solid #c9a961;padding:14px 18px;color:#cfc7b3;font-size:13px;line-height:1.7;">
          We are crafting your card skins with care. You will receive a shipping update with tracking details as soon as your order leaves our studio &mdash; usually within 1&ndash;2 business days.
        </div>
      </td></tr>

      <tr><td style="padding:24px 40px 32px;border-top:1px solid #1a1a1a;text-align:center;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.42em;color:#c9a961;text-transform:uppercase;margin-bottom:8px;">carddesign.skin</div>
        <div style="color:#6b6557;font-size:12px;line-height:1.6;">Premium card skins, handcrafted in India.<br/>Need help? Reply to this email and we will get back to you.</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildShippingEmail(order) {
  const c = order.customer || {};
  const tracking = order.awb_code || "Will be shared shortly";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Your order is on the way &middot; carddesign.skin</title>
</head>
<body style="margin:0;padding:0;background:#050505;font-family:Georgia,'Times New Roman',serif;color:#f5f0e6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#050505;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#0a0a0a;border:1px solid #1a1a1a;">
      <tr><td style="padding:36px 40px 24px;text-align:center;border-bottom:1px solid #1a1a1a;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.42em;color:#c9a961;text-transform:uppercase;">carddesign.skin</div>
        <h1 style="margin:18px 0 8px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;letter-spacing:0.04em;color:#f5f0e6;">Your order is on the way</h1>
        <p style="margin:0;color:#8a8275;font-size:14px;">Order ${escapeHtml(order.id)}</p>
      </td></tr>

      <tr><td style="padding:28px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111;border:1px solid #1f1f1f;">
          <tr><td style="padding:20px 22px;">
            <div style="font-size:11px;letter-spacing:0.32em;color:#c9a961;text-transform:uppercase;margin-bottom:10px;">Tracking</div>
            <div style="color:#f5f0e6;font-size:18px;font-weight:600;letter-spacing:0.04em;margin-bottom:6px;">${escapeHtml(tracking)}</div>
            <div style="color:#8a8275;font-size:13px;">Shiprocket reference: ${escapeHtml(order.shiprocket_order_id || "Pending")}</div>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 40px 28px;">
        <div style="font-size:11px;letter-spacing:0.32em;color:#8a8275;text-transform:uppercase;margin-bottom:10px;">Shipping to</div>
        <div style="color:#f5f0e6;font-size:15px;font-weight:600;margin-bottom:4px;">${escapeHtml(c.name || "")}</div>
        <div style="color:#cfc7b3;font-size:14px;line-height:1.6;">${[c.address, c.city, c.state, c.pin].filter(Boolean).map(escapeHtml).join(", ")}</div>
      </td></tr>

      <tr><td style="padding:24px 40px 32px;border-top:1px solid #1a1a1a;text-align:center;">
        <div style="color:#6b6557;font-size:12px;line-height:1.6;">Thank you for choosing carddesign.skin.<br/>Reply to this email for any questions about your shipment.</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendOrderEmails(order) {
  const confirmationEmail = await sendEmail({
    to: order.customer?.email,
    subject: `Your carddesign.skin order ${order.id} is confirmed`,
    html: buildOrderConfirmationEmail(order),
  });

  const shippingEmail = await sendEmail({
    to: order.customer?.email,
    subject: `Your carddesign.skin order ${order.id} is on the way`,
    html: buildShippingEmail(order),
  });

  return { confirmationEmail, shippingEmail };
}

async function fulfillPaidOrder(order, payment = {}) {
  if (!order) throw new Error("Paid order not found");
  const shiprocketOrder = await createShiprocketOrder({
    items: order.lines.map(({ id, quantity }) => ({ id, quantity })),
    customer: order.customer,
    payment: {
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: payment.razorpay_payment_id || order.razorpay_payment_id,
    },
  });
  const updatedOrder = await updateOrder(order.id, {
    status: "ready_to_ship",
    shipping_status: shiprocketOrder.shipping_status || "created",
    shiprocket_order_id: shiprocketOrder.order_id || shiprocketOrder.shiprocket_order_id,
    awb_code: shiprocketOrder.awb_code,
  });
  await markOrderEmails(updatedOrder);
  return { updatedOrder, shiprocketOrder };
}

async function markOrderEmails(order) {
  try {
    const emails = await sendOrderEmails(order);
    await updateOrder(order.id, {
      email_status: emails.confirmationEmail.status,
      shipping_email_status: emails.shippingEmail.status,
    });
  } catch (emailError) {
    await updateOrder(order.id, {
      email_status: "failed",
      shipping_email_status: "failed",
      email_error: emailError.message,
    });
  }
}

function verifyRazorpayWebhook(rawBody, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return safeCompare(signature, expected);
}

async function findOrderFromWebhookPayload(payload) {
  const payment = payload.payload?.payment?.entity;
  const orderEntity = payload.payload?.order?.entity;
  const razorpayOrderId = payment?.order_id || orderEntity?.id;
  if (!razorpayOrderId) return null;
  const orders = await readOrders();
  return orders.find((order) => order.razorpay_order_id === razorpayOrderId);
}

async function findShiprocketOrder(payload) {
  const candidates = [
    payload.order_id,
    payload.shiprocket_order_id,
    payload.sr_order_id,
    payload.awb,
    payload.awb_code,
    payload.current_tracking_status?.awb_code,
    payload.shipment?.awb_code,
    payload.shipment?.order_id,
  ].filter(Boolean).map(String);
  const orders = await readOrders();
  return orders.find((order) =>
    candidates.includes(String(order.shiprocket_order_id)) ||
    candidates.includes(String(order.awb_code)) ||
    candidates.includes(String(order.razorpay_order_id)) ||
    candidates.includes(String(order.id)),
  );
}

async function createRazorpayOrder(payload) {
  const order = await calculateOrder(payload.items);
  const amount = order.total * 100;
  const localOrderId = `cds_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const confirmationToken = crypto.randomBytes(32).toString("base64url");

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    const demoOrderId = `order_demo_${Date.now()}`;
    await saveOrder({
      id: localOrderId,
      razorpay_order_id: demoOrderId,
      status: "payment_pending",
      payment_status: "created_demo",
      shipping_status: "not_created",
      confirmation_token: confirmationToken,
      customer: payload.customer,
      ...order,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return {
      demo: true,
      id: demoOrderId,
      local_order_id: localOrderId,
      amount,
      currency: "INR",
      order,
    };
  }

  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: localOrderId,
      notes: { customer_phone: payload.customer?.phone || "" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.description || "Razorpay order failed");
  await saveOrder({
    id: localOrderId,
    razorpay_order_id: data.id,
    status: "payment_pending",
    payment_status: data.status || "created",
    shipping_status: "not_created",
    confirmation_token: confirmationToken,
    customer: payload.customer,
    ...order,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return { ...data, key: process.env.RAZORPAY_KEY_ID, local_order_id: localOrderId, order };
}

function verifyRazorpaySignature(payment) {
  if (!process.env.RAZORPAY_KEY_SECRET) return true;

  const payload = `${payment.razorpay_order_id}|${payment.razorpay_payment_id}`;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(payload).digest("hex");
  return expected === payment.razorpay_signature;
}

async function createShiprocketOrder({ items, customer, payment }) {
  const order = await calculateOrder(items);
  const fullName = String(customer.name || "").trim();
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts.shift() || "Customer";
  const lastName = nameParts.join(" ") || ".";
  const body = {
    order_id: payment?.razorpay_order_id || `cds_${Date.now()}`,
    order_date: new Date().toISOString().slice(0, 10),
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: customer.address,
    billing_city: customer.city,
    billing_pincode: customer.pin,
    billing_state: customer.state,
    billing_country: "India",
    billing_email: customer.email,
    billing_phone: customer.phone,
    shipping_is_billing: true,
    order_items: order.lines.map((item) => ({
      name: item.name,
      sku: item.id,
      units: item.quantity,
      selling_price: item.price,
    })),
    payment_method: "Prepaid",
    sub_total: order.subtotal,
    length: 12,
    breadth: 9,
    height: 0.5,
    weight: 0.05,
  };

  const data = await shiprocketRequest("/orders/create/adhoc", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (data.demo) return { demo: true, shiprocket_order_id: `shiprocket_demo_${Date.now()}`, shipping_status: "created_demo" };
  return data;
}

async function handleApi(req, res, url) {
  try {
    const isUpload = req.method === "POST" && url.pathname === "/api/admin/products/upload";
    const body = req.method === "GET" ? { raw: "", json: {} } : await readBody(req, isUpload ? 6_000_000 : 1_000_000);
    const payload = body.json;

    if (req.method === "GET" && url.pathname === "/api/products") {
      return json(res, 200, { products: await getProducts() });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      if (!process.env.ADMIN_PASSWORD) {
        return json(res, 500, { error: "Admin password is not configured" });
      }
      if (!safeCompare(payload.password, process.env.ADMIN_PASSWORD)) {
        return json(res, 401, { error: "Wrong password" });
      }
      res.setHeader("Set-Cookie", cookieOptions(60 * 60 * 12).replace("cds_admin_session=", `cds_admin_session=${createSession()}`));
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/logout") {
      const token = parseCookies(req).cds_admin_session;
      if (token) adminSessions.delete(token);
      res.setHeader("Set-Cookie", cookieOptions(0));
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/api/admin/") && !isAdminRequest(req)) {
      return json(res, 401, { error: "Admin login required" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/orders") {
      const orders = await readOrders();
      return json(res, 200, { orders: orders.map(publicOrder) });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/products") {
      return json(res, 200, { products: await getProducts() });
    }

    if (req.method === "PUT" && url.pathname === "/api/admin/products") {
      const id = String(payload.id || "");
      const product = baseProducts.find((p) => p.id === id);
      if (!product) return json(res, 404, { error: "Product not found" });
      const overrides = await readProductOverrides();
      const current = overrides[id] || {};
      const next = { ...current };
      if (payload.name !== undefined) {
        const name = String(payload.name || "").trim();
        if (!name || name.length > 80) {
          return json(res, 400, { error: "Invalid name" });
        }
        next.name = name;
      }
      if (payload.price !== undefined) {
        const price = Number(payload.price);
        if (!Number.isFinite(price) || price < 0) {
          return json(res, 400, { error: "Invalid price" });
        }
        next.price = Math.round(price);
      }
      if (payload.stock !== undefined) {
        const stock = Number(payload.stock);
        if (!Number.isFinite(stock) || stock < 0) {
          return json(res, 400, { error: "Invalid stock" });
        }
        next.stock = Math.floor(stock);
      }
      if (payload.description !== undefined) {
        const description = String(payload.description || "").trim();
        if (description.length > 200) {
          return json(res, 400, { error: "Description too long (max 200 chars)" });
        }
        next.description = description;
      }
      overrides[id] = next;
      await writeProductOverrides(overrides);
      const products = await getProducts();
      return json(res, 200, { product: products.find((p) => p.id === id) });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/products/upload") {
      const id = String(payload.id || "");
      const product = baseProducts.find((p) => p.id === id);
      if (!product) return json(res, 404, { error: "Product not found" });
      const dataUrl = String(payload.dataUrl || "");
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
      if (!match) return json(res, 400, { error: "Send a PNG, JPG, WEBP or GIF image" });
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 1_500_000) {
        return json(res, 400, { error: "Image must be under 1.5 MB. Compress or resize it first." });
      }
      const overrides = await readProductOverrides();
      overrides[id] = { ...(overrides[id] || {}), image: dataUrl };
      await writeProductOverrides(overrides);
      const products = await getProducts();
      return json(res, 200, { product: products.find((p) => p.id === id) });
    }

    if (req.method === "DELETE" && url.pathname === "/api/admin/products/image") {
      const id = String(payload.id || "");
      const product = baseProducts.find((p) => p.id === id);
      if (!product) return json(res, 404, { error: "Product not found" });
      const overrides = await readProductOverrides();
      if (overrides[id]) {
        const { image, ...rest } = overrides[id];
        overrides[id] = rest;
        await writeProductOverrides(overrides);
      }
      const products = await getProducts();
      return json(res, 200, { product: products.find((p) => p.id === id) });
    }

    if (req.method === "GET" && url.pathname === "/api/order/confirmation") {
      const id = url.searchParams.get("id");
      const token = url.searchParams.get("token");
      const orders = await readOrders();
      const order = orders.find((item) => item.id === id);
      if (!order || !order.confirmation_token || !token || !safeCompare(token, order.confirmation_token)) {
        return json(res, 404, { error: "Order not found" });
      }
      const paidStatuses = new Set(["paid", "ready_to_ship", "delivered", "paid_shipping_failed"]);
      if (!paidStatuses.has(order.status)) {
        return json(res, 404, { error: "Order not found" });
      }
      return json(res, 200, { order: confirmationOrder(order) });
    }

    if (req.method === "POST" && url.pathname === "/api/webhooks/razorpay") {
      const eventId = req.headers["x-razorpay-event-id"];
      if (!verifyRazorpayWebhook(body.raw, req.headers["x-razorpay-signature"])) {
        return json(res, 400, { error: "Invalid Razorpay webhook signature" });
      }
      if (await hasProcessedWebhook(eventId)) return json(res, 200, { ok: true, duplicate: true });

      const order = await findOrderFromWebhookPayload(payload);
      const payment = payload.payload?.payment?.entity || {};
      if (order && payload.event === "payment.captured") {
        const paidOrder = await updateOrder(order.id, {
          status: "paid",
          payment_status: "captured",
          razorpay_payment_id: payment.id,
        });
        if (paidOrder.shipping_status === "not_created" || paidOrder.shipping_status === "failed") {
          try {
            await fulfillPaidOrder(paidOrder, { razorpay_payment_id: payment.id });
          } catch (error) {
            await updateOrder(paidOrder.id, {
              status: "paid_shipping_failed",
              shipping_status: "failed",
              error: error.message,
            });
          }
        }
      } else if (order && payload.event === "payment.failed") {
        await updateOrder(order.id, {
          status: "payment_failed",
          payment_status: "failed",
          error: payment.error_description || "Payment failed",
        });
      } else if (order && payload.event === "payment.authorized") {
        await updateOrder(order.id, { payment_status: "authorized" });
      }

      await saveProcessedWebhook(eventId, "razorpay", payload.event);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/webhooks/shipping") {
      const token = req.headers["x-shiprocket-token"] || url.searchParams.get("token");
      if (process.env.SHIPROCKET_WEBHOOK_TOKEN && token !== process.env.SHIPROCKET_WEBHOOK_TOKEN) {
        return json(res, 401, { error: "Invalid webhook token" });
      }

      const order = await findShiprocketOrder(payload);
      if (order) {
        const shippingStatus =
          payload.current_status ||
          payload.shipment_status ||
          payload.status ||
          payload.current_tracking_status?.current_status ||
          "updated";
        await updateOrder(order.id, {
          shipping_status: shippingStatus,
          status: String(shippingStatus).toLowerCase().includes("delivered") ? "delivered" : order.status,
          shiprocket_order_id: payload.order_id || payload.shiprocket_order_id || payload.sr_order_id || order.shiprocket_order_id,
          awb_code: payload.awb || payload.awb_code || payload.current_tracking_status?.awb_code || order.awb_code,
        });
      }
      await saveProcessedWebhook(payload.event_id || payload.id || `${Date.now()}`, "shiprocket", payload.event || payload.status || "shipment_update");
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/razorpay/order") {
      return json(res, 200, await createRazorpayOrder(payload));
    }

    if (req.method === "POST" && url.pathname === "/api/razorpay/verify") {
      if (!verifyRazorpaySignature(payload.payment || {})) {
        await updateOrder(payload.payment?.razorpay_order_id, {
          status: "payment_failed",
          payment_status: "signature_failed",
          error: "Payment signature verification failed",
        });
        return json(res, 400, { error: "Payment signature verification failed" });
      }
      await updateOrder(payload.payment.razorpay_order_id, {
        status: "paid",
        payment_status: "captured",
        razorpay_payment_id: payload.payment.razorpay_payment_id,
      });
      try {
        const orders = await readOrders();
        const paidOrder = orders.find((order) => order.razorpay_order_id === payload.payment.razorpay_order_id);
        const { updatedOrder, shiprocketOrder } = await fulfillPaidOrder(paidOrder, payload.payment);
        return json(res, 200, {
          verified: true,
          order: publicOrder(updatedOrder),
          confirmation_token: updatedOrder.confirmation_token,
          ...shiprocketOrder,
        });
      } catch (error) {
        const updatedOrder = await updateOrder(payload.payment.razorpay_order_id, {
          status: "paid_shipping_failed",
          shipping_status: "failed",
          error: error.message,
        });
        try {
          const confirmationEmail = await sendEmail({
            to: updatedOrder.customer?.email,
            subject: `Order confirmed: ${updatedOrder.id}`,
            html: `<h1>Your carddesign.skin order is confirmed</h1><p>Order ID: <strong>${updatedOrder.id}</strong></p><p>We will follow up on shipping shortly.</p>`,
          });
          await updateOrder(updatedOrder.id, { email_status: confirmationEmail.status });
        } catch (emailError) {
          await updateOrder(updatedOrder.id, { email_status: "failed", email_error: emailError.message });
        }
        return json(res, 200, {
          verified: true,
          order: publicOrder(updatedOrder),
          confirmation_token: updatedOrder.confirmation_token,
          shipping_error: error.message,
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/shiprocket/serviceability") {
      const data = await shiprocketRequest(
        `/courier/serviceability/?pickup_postcode=${payload.pickup_postcode}&delivery_postcode=${payload.delivery_postcode}&cod=${payload.cod || 0}&weight=${payload.weight || 0.2}`,
      );
      if (data.demo) return json(res, 200, { demo: true, available: true, freight: 49 });
      const courier = data.data?.available_courier_companies?.[0];
      return json(res, 200, { available: Boolean(courier), freight: courier?.freight_charge || 0, courier });
    }

    return json(res, 404, { error: "API route not found" });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const baseName = path.basename(filePath);
  const isProtectedAdminAsset = requestedPath === "/admin.html" || requestedPath === "/admin.js";
  const isPrivateFile =
    baseName.startsWith(".") ||
    requestedPath.startsWith("/data/") ||
    requestedPath === "/server.js" ||
    requestedPath === "/README.md";

  if (isPrivateFile) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (isProtectedAdminAsset && !isAdminRequest(req)) {
    res.writeHead(302, { Location: "/admin-login.html" });
    res.end();
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const headers = {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    };
    if (process.env.NODE_ENV !== "production") {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}

function requestListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
}

if (require.main === module) {
  const HOST = process.env.HOST || "0.0.0.0";
  http.createServer(requestListener).listen(PORT, HOST, () => {
    console.log(`carddesign.skin running at http://${HOST}:${PORT}`);
  });
}

module.exports = requestListener;
module.exports.requestListener = requestListener;
module.exports.buildOrderConfirmationEmail = buildOrderConfirmationEmail;
module.exports.buildShippingEmail = buildShippingEmail;
