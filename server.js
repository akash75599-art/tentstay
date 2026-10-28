const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;

function loadEnvironmentFile() {
  const filePath = path.join(root, ".env");
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvironmentFile();

const dataDirectory = path.join(root, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const defaultsPath = path.join(root, "site-defaults.json");
const defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
const db = new DatabaseSync(path.join(dataDirectory, "misty-alphine.sqlite"));
const scrypt = promisify(crypto.scrypt);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const cookieSecure = isProduction;
const sessionLifetime = 8 * 60 * 60 * 1000;
const bodyLimit = 1024 * 1024;
const imageLimit = 4 * 1024 * 1024;
const defaultRoomKeys = ["room1Name", "room2Name", "room3Name"];
const imageKeys = ["heroImage", "room1Image", "room2Image", "room3Image", "experienceImage", "locationImage"];
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/content.js", ["content.js", "text/javascript; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
  ["/site-defaults.json", ["site-defaults.json", "application/json; charset=utf-8"]],
  ["/night-forest.svg", ["night-forest.svg", "image/svg+xml"]],
  ["/alpine-tent.svg", ["alpine-tent.svg", "image/svg+xml"]]
]);
const passwordSalt = crypto.createHash("sha256").update(`misty-alphine:${process.env.ADMIN_USERNAME || ""}`).digest();
const loginPasswordHash = process.env.ADMIN_PASSWORD
  ? crypto.scryptSync(process.env.ADMIN_PASSWORD, passwordSalt, 64)
  : null;
const loginUsernameHash = crypto.createHash("sha256").update(process.env.ADMIN_USERNAME || "").digest();
const loginAttempts = new Map();
const bookingAttempts = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateConfiguration() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  if (!process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME.length > 128) {
    throw new Error("Set ADMIN_USERNAME in .env before starting the website.");
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 14 || process.env.ADMIN_PASSWORD.length > 1024) {
    throw new Error("Set a unique ADMIN_PASSWORD of at least 14 characters in .env before starting the website.");
  }
  if (isProduction && host !== "127.0.0.1" && host !== "::1") {
    throw new Error("In production, bind HOST to localhost and place the site behind an HTTPS reverse proxy.");
  }
}

function initializeDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      guest_name TEXT NOT NULL,
      guest_email TEXT NOT NULL,
      guest_phone TEXT,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      room_name TEXT NOT NULL,
      price_per_night INTEGER NOT NULL,
      guests INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings(created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  `);
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function getClientAddress(request) {
  return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(map, key, maxAttempts, windowMs) {
  const now = Date.now();
  const record = map.get(key);
  if (!record || record.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  record.count += 1;
  return record.count > maxAttempts;
}

async function readJson(request, maxBytes = bodyLimit) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send JSON with the application/json content type.");
  }
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > maxBytes) throw new HttpError(413, "Request body is too large.");

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON body must be an object.");
    }
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a valid JSON object.");
  }
}

function getCurrentContent() {
  const result = db.prepare("SELECT value FROM settings WHERE key = 'site_content'").get();
  return result ? { ...defaults, ...JSON.parse(result.value) } : { ...defaults };
}

function validateSiteContent(input) {
  const content = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = input[key];
    if (imageKeys.includes(key)) {
      if (value === "" || value === null || value === undefined) {
        content[key] = "";
      } else if (typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) && db.prepare("SELECT id FROM images WHERE id = ?").get(value)) {
        content[key] = value;
      } else {
        throw new HttpError(400, `The ${key} image is not valid.`);
      }
    } else if (typeof defaultValue === "number") {
      const field = windowlessFields.find((entry) => entry.key === key);
      if (!Number.isSafeInteger(value) || !field || value < field.min || value > field.max) {
        throw new HttpError(400, `${key} must be a valid whole number.`);
      }
      content[key] = value;
    } else {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 1800) {
        throw new HttpError(400, `${key} must contain between 1 and 1,800 characters.`);
      }
      content[key] = value.trim();
    }
  }
  return content;
}

const windowlessFields = [
  { key: "tentCount", min: 1, max: 999 },
  { key: "elevation", min: 0, max: 99999 },
  { key: "room1Price", min: 0, max: 999999 },
  { key: "room2Price", min: 0, max: 999999 },
  { key: "room3Price", min: 0, max: 999999 }
];

function getCookie(request, name) {
  const cookies = request.headers.cookie || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0 && item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSession(request) {
  const token = getCookie(request, "misty_admin");
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db.prepare("SELECT token_hash, csrf_hash, expires_at FROM sessions WHERE token_hash = ?").get(tokenHash(token));
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.token_hash);
    return null;
  }
  return session;
}

function requireHttps(request) {
  if (isProduction && request.headers["x-forwarded-proto"] !== "https") {
    throw new HttpError(400, "Secure HTTPS access is required.");
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) throw new HttpError(403, "The request origin could not be verified.");
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, "The request origin could not be verified.");
  }
  const forwardedProtocol = isProduction ? "https" : "http";
  const requestOrigin = `${forwardedProtocol}://${request.headers.host}`;
  if (parsedOrigin.origin !== requestOrigin) throw new HttpError(403, "Cross-origin requests are not allowed.");
}

function requireAdmin(request, checkCsrf = false) {
  const session = getSession(request);
  if (!session) throw new HttpError(401, "Please sign in as an administrator.");
  if (checkCsrf) {
    requireSameOrigin(request);
    const token = request.headers["x-csrf-token"];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      throw new HttpError(403, "The request could not be verified.");
    }
    const supplied = Buffer.from(tokenHash(token), "hex");
    const expected = Buffer.from(session.csrf_hash, "hex");
    if (!crypto.timingSafeEqual(supplied, expected)) throw new HttpError(403, "The request could not be verified.");
  }
  return session;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidImage(mimeType, data) {
  if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/png") return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/webp") return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function getStatusCode(error) {
  return error instanceof HttpError ? error.status : 500;
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/content" && request.method === "GET") {
    sendJson(response, 200, getCurrentContent());
    return true;
  }

  if (pathname === "/api/admin/login" && request.method === "POST") {
    requireHttps(request);
    requireSameOrigin(request);
    const address = getClientAddress(request);
    if (checkRateLimit(loginAttempts, address, 5, 15 * 60 * 1000)) {
      throw new HttpError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
    }
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const usernameHash = crypto.createHash("sha256").update(username).digest();
    const passwordHash = await scrypt(password, passwordSalt, 64);
    const usernameMatches = crypto.timingSafeEqual(usernameHash, loginUsernameHash);
    const passwordMatches = crypto.timingSafeEqual(passwordHash, loginPasswordHash);
    if (!usernameMatches || !passwordMatches) {
      throw new HttpError(401, "The username or password is incorrect.");
    }

    loginAttempts.delete(address);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const csrfToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + sessionLifetime;
    db.prepare("INSERT INTO sessions (token_hash, csrf_hash, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash(sessionToken), tokenHash(csrfToken), expiresAt);
    const cookie = `misty_admin=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime / 1000}${cookieSecure ? "; Secure" : ""}`;
    sendJson(response, 200, { csrfToken }, { "Set-Cookie": cookie });
    return true;
  }

  if (pathname === "/api/admin/session" && request.method === "GET") {
    requireHttps(request);
    const session = getSession(request);
    if (!session) {
      sendJson(response, 200, { authenticated: false });
      return true;
    }
    const csrfToken = crypto.randomBytes(32).toString("hex");
    db.prepare("UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?").run(tokenHash(csrfToken), session.token_hash);
    sendJson(response, 200, { authenticated: true, csrfToken });
    return true;
  }

  if (pathname === "/api/admin/logout" && request.method === "POST") {
    requireHttps(request);
    requireAdmin(request, true);
    const session = getSession(request);
    if (session) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.token_hash);
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `misty_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure ? "; Secure" : ""}`
    });
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "PUT") {
    requireHttps(request);
    requireAdmin(request, true);
    const updated = validateSiteContent(await readJson(request));
    db.prepare("INSERT INTO settings (key, value) VALUES ('site_content', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(updated));
    sendJson(response, 200, { content: updated });
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "DELETE") {
    requireHttps(request);
    requireAdmin(request, true);
    const currentContent = getCurrentContent();
    const resetContent = { ...defaults };
    for (const key of imageKeys) resetContent[key] = currentContent[key];
    db.prepare("INSERT INTO settings (key, value) VALUES ('site_content', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(resetContent));
    sendJson(response, 200, { content: resetContent });
    return true;
  }

  if (pathname === "/api/admin/bookings" && request.method === "GET") {
    requireHttps(request);
    requireAdmin(request);
    const bookings = db.prepare(`
      SELECT id, guest_name AS guestName, guest_email AS guestEmail, guest_phone AS guestPhone,
        check_in AS checkIn, check_out AS checkOut, room_name AS roomName,
        price_per_night AS pricePerNight, guests, status, created_at AS createdAt
      FROM bookings ORDER BY created_at DESC
    `).all();
    sendJson(response, 200, { bookings });
    return true;
  }

  if (pathname === "/api/admin/images" && request.method === "POST") {
    requireHttps(request);
    requireAdmin(request, true);
    const body = await readJson(request, imageLimit * 2);
    if (!imageKeys.includes(body.key)) throw new HttpError(400, "Choose a valid image location.");
    if (typeof body.dataUrl !== "string" || body.dataUrl.length > imageLimit * 2) {
      throw new HttpError(413, "Image must be 4 MB or smaller.");
    }
    const match = body.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new HttpError(400, "Upload a JPG, PNG, or WebP image.");
    const imageData = Buffer.from(match[2], "base64");
    if (imageData.length > imageLimit) throw new HttpError(413, "Image must be 4 MB or smaller.");
    if (imageData.toString("base64") !== match[2] || !isValidImage(match[1], imageData)) {
      throw new HttpError(400, "The uploaded file is not a valid JPG, PNG, or WebP image.");
    }

    const currentContent = getCurrentContent();
    const oldImageId = currentContent[body.key];
    const imageId = crypto.randomUUID();
    db.prepare("INSERT INTO images (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)")
      .run(imageId, match[1], imageData, new Date().toISOString());
    currentContent[body.key] = imageId;
    db.prepare("INSERT INTO settings (key, value) VALUES ('site_content', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(currentContent));
    if (typeof oldImageId === "string" && imageKeys.every((key) => key === body.key || currentContent[key] !== oldImageId)) {
      db.prepare("DELETE FROM images WHERE id = ?").run(oldImageId);
    }
    sendJson(response, 201, { key: body.key, id: imageId, url: `/api/images/${imageId}` });
    return true;
  }

  const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/([a-f0-9-]{36})$/);
  if (bookingMatch && request.method === "PATCH") {
    requireHttps(request);
    requireAdmin(request, true);
    const body = await readJson(request);
    if (!["pending", "confirmed", "cancelled"].includes(body.status)) {
      throw new HttpError(400, "Choose pending, confirmed, or cancelled.");
    }
    const result = db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(body.status, bookingMatch[1]);
    if (result.changes === 0) throw new HttpError(404, "Booking request not found.");
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/bookings" && request.method === "POST") {
    requireHttps(request);
    requireSameOrigin(request);
    if (checkRateLimit(bookingAttempts, getClientAddress(request), 6, 60 * 60 * 1000)) {
      throw new HttpError(429, "Too many booking requests. Please try again later.");
    }
    const body = await readJson(request);
    const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
    const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim().toLowerCase() : "";
    const guestPhone = typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";
    if (guestName.length < 2 || guestName.length > 100 || /[\u0000-\u001f\u007f]/.test(guestName)) {
      throw new HttpError(400, "Enter a name between 2 and 100 characters.");
    }
    if (guestEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      throw new HttpError(400, "Enter a valid email address.");
    }
    if (guestPhone.length > 30 || (guestPhone && !/^[+\d\s().-]{5,30}$/.test(guestPhone))) {
      throw new HttpError(400, "Enter a valid phone number or leave it blank.");
    }
    if (!validDate(body.checkIn) || !validDate(body.checkOut) || body.checkOut <= body.checkIn) {
      throw new HttpError(400, "Choose a valid check-out date after check-in.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const nights = (Date.parse(`${body.checkOut}T00:00:00Z`) - Date.parse(`${body.checkIn}T00:00:00Z`)) / 86400000;
    if (body.checkIn < today || nights > 90) throw new HttpError(400, "Choose future dates for a stay of up to 90 nights.");
    if (!Number.isInteger(body.guests) || body.guests < 1 || body.guests > 4) {
      throw new HttpError(400, "Guest count must be between 1 and 4.");
    }
    const content = getCurrentContent();
    const roomIndex = defaultRoomKeys.findIndex((key) => content[key] === body.roomName);
    if (roomIndex === -1) throw new HttpError(400, "Choose one of the available tent options.");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO bookings (
        id, guest_name, guest_email, guest_phone, check_in, check_out,
        room_name, price_per_night, guests, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      guestName,
      guestEmail,
      guestPhone || null,
      body.checkIn,
      body.checkOut,
      content[defaultRoomKeys[roomIndex]],
      content[`room${roomIndex + 1}Price`],
      body.guests,
      createdAt
    );
    sendJson(response, 201, { id, status: "pending", message: "Your booking request is with our team. We’ll contact you to confirm availability." });
    return true;
  }

  const imageMatch = pathname.match(/^\/api\/images\/([a-f0-9-]{36})$/);
  if (imageMatch && request.method === "GET") {
    const image = db.prepare("SELECT mime_type, data FROM images WHERE id = ?").get(imageMatch[1]);
    if (!image) throw new HttpError(404, "Image not found.");
    response.writeHead(200, {
      "Content-Type": image.mime_type,
      "Content-Length": image.data.length,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(image.data);
    return true;
  }

  if (pathname.startsWith("/api/")) throw new HttpError(404, "API route not found.");
  return false;
}

function servePublicFile(response, pathname) {
  const publicFile = publicFiles.get(pathname);
  if (!publicFile) return false;
  const [filename, contentType] = publicFile;
  const data = fs.readFileSync(path.join(root, filename));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": filename.endsWith(".html") ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(data);
  return true;
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  if (isProduction) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  try {
    if (isProduction) requireHttps(request);
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const handled = await handleApi(request, response, url.pathname);
    if (handled) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "Method not allowed.");
    }
    if (!servePublicFile(response, url.pathname)) throw new HttpError(404, "Page not found.");
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) {
      console.error("Request failed:", error);
    }
    if (!response.headersSent) {
      const status = getStatusCode(error);
      sendJson(response, status, { error: status === 500 ? "The request could not be completed." : error.message });
    } else {
      response.destroy();
    }
  }
}

function start() {
  validateConfiguration();
  initializeDatabase();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  const server = http.createServer(handleRequest);
  server.listen(port, host, () => {
    console.log(`Misty Alphine is running at http://${host}:${port}`);
    console.log("Set up the administrator account in .env. Booking and admin changes are stored in data/misty-alphine.sqlite.");
    if (isProduction) console.log("Production mode requires an HTTPS reverse proxy that sets X-Forwarded-Proto: https.");
  });
  server.on("error", (error) => {
    console.error("The web server could not start:", error);
    process.exitCode = 1;
  });
}

start();
