// Dasturxon: ko'p restoranli server. Har bir restoranning o'z Telegram boti bor.
// Talab: Node.js 18+ (paketlar kerak emas). Ishga tushirish: start.bat
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 3000;
const F = n => path.join(__dirname, n);
fs.mkdirSync(F("uploads"), { recursive: true });
let D; try { D = JSON.parse(fs.readFileSync(F("data.json"), "utf8")); } catch { D = {}; }
D.rs = D.rs || {}; D.orders = D.orders || [];
const save = () => fs.writeFileSync(F("data.json"), JSON.stringify(D));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomBytes(5).toString("hex");
const str = (s, n) => String(s == null ? "" : s).slice(0, n);
const ids = s => String(s || "").split(/[,\s]+/).filter(x => /^\d+$/.test(x));

const LABEL = { new: "Yangi", acc: "Qabul qilindi", ready: "Tayyor", out: "Kuryerda", done: "Yetkazildi", x: "Bekor qilindi" };
const FLOW = {
  qabul:      { from: ["new"],        to: "acc",   who: "op" },
  tayyor:     { from: ["acc"],        to: "ready", who: "op" },
  kuryer:     { from: ["ready"],      to: "out",   who: "op" },
  yetkazildi: { from: ["out"],        to: "done",  who: "courier" },
  bekor:      { from: ["new", "acc"], to: "x",     who: "op" },
};
const BTN = {
  new:   [["✅ Qabul qilish", "qabul"], ["❌ Bekor qilish", "bekor"]],
  acc:   [["🍳 Tayyor", "tayyor"]],
  ready: [["🚚 Kuryerga berish", "kuryer"]],
  out:   [["✅ Yetkazildi", "yetkazildi"]],
};
const kb = o => BTN[o.status] && { inline_keyboard: [BTN[o.status].map(([t, c]) => ({ text: t, callback_data: `${c}:${o.no}` }))] };
const total = o => o.items.reduce((a, i) => a + i.q * i.p, 0);
const nextNo = () => D.orders.reduce((m, o) => Math.max(m, o.no), 1000) + 1;
const text = o => `🍽 Buyurtma №${o.no} — ${o.restaurant}\n` + o.items.map(i => `• ${i.n} × ${i.q}`).join("\n") +
  `\nJami: ${total(o)} soʻm\nMijoz: ${o.name}, ${o.tel}\nManzil: ${o.addr}` +
  (o.loc ? `\nXarita: ${o.loc}` : "") + (o.note ? `\nIzoh: ${o.note}` : "") + `\nHolat: ${LABEL[o.status]}`;

// ---------- Telegram (har bir restoran uchun alohida bot) ----------
const tg = (tok, m, b) => fetch(`https://api.telegram.org/bot${tok}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(r => r.json());
const say = (r, chat, t, mk) => r.bot.token && tg(r.bot.token, "sendMessage", { chat_id: chat, text: t, reply_markup: mk }).catch(() => {});
async function broadcast(r, msg) {
  let ok = 0, bad = 0;
  for (const k of [...r.bot.subs]) {
    const x = await tg(r.bot.token, "sendMessage", { chat_id: k, text: msg }).catch(() => null);
    if (x && x.ok) ok++; else { bad++; if (x && x.error_code === 403) r.bot.subs = r.bot.subs.filter(s => s !== k); }
    await sleep(60);
  }
  save(); return { ok, bad };
}
const HELP = "Operator: /qabul N, /tayyor N, /kuryer N, /bekor N\nKuryer: /yetkazildi N\nIkkalasi: /buyurtmalar\nOperator: /yangilik matn";
function doAct(r, role, cmd, no, actor) {
  const c = FLOW[cmd]; if (!c) return { err: "Noma’lum buyruq" };
  if (c.who !== role) return { err: "Bu amal sizga mumkin emas" };
  const o = D.orders.find(x => x.no === no && x.rid === r.id);
  if (!o) return { err: "Buyurtma topilmadi" };
  if (!c.from.includes(o.status)) return { err: `№${no} holati: ${LABEL[o.status]}. Hozir bu amal mumkin emas.` };
  o.status = c.to; save();
  if (c.to === "out") r.bot.couriers.forEach(k => say(r, k, `🚚 Yetkazish uchun:\n${text(o)}`, kb(o)));
  if (c.to === "done" || c.to === "x") r.bot.ops.forEach(k => k !== actor && say(r, k, `№${no}: ${LABEL[o.status]}`));
  return { o };
}
function tgAct(r, id, cmd, no) {
  const c = FLOW[cmd]; if (!c) return say(r, id, HELP);
  if (!(c.who === "op" ? r.bot.ops : r.bot.couriers).includes(id)) return say(r, id, "Bu buyruq sizga mumkin emas.");
  const x = doAct(r, c.who, cmd, no, id);
  if (x.err) return say(r, id, x.err + (x.err === "Buyurtma topilmadi" ? `. Masalan: /${cmd} 1001` : ""));
  say(r, id, `✅ №${no}: ${LABEL[x.o.status]}`, x.o.status === "out" ? undefined : kb(x.o));
}
function handle(r, m) {
  const id = String(m.chat.id), [cmd, arg] = m.text.trim().split(/\s+/), no = parseInt(arg, 10);
  const isOp = r.bot.ops.includes(id), isC = r.bot.couriers.includes(id);
  if (cmd === "/stop") { r.bot.subs = r.bot.subs.filter(x => x !== id); save(); return say(r, id, "Yangiliklar o‘chirildi. Qayta yoqish: /start"); }
  if (cmd === "/start" && !r.bot.subs.includes(id)) { r.bot.subs.push(id); save(); }
  if (cmd === "/start" && !isOp && !isC)
    return say(r, id, `Assalomu alaykum! «${r.name}» yangiliklari va chegirmalari shu yerga keladi. To‘xtatish: /stop\n\n(Telegram ID: ${id})`);
  if (cmd === "/start" || cmd === "/id")
    return say(r, id, `Telegram ID: ${id}\nRol: ${isOp ? "operator" : isC ? "kuryer" : "belgilanmagan"}\n\n${HELP}`);
  if (!isOp && !isC) return say(r, id, "Sizga ruxsat berilmagan.");
  if (cmd === "/yangilik") {
    if (!isOp) return say(r, id, "Bu buyruq faqat operator uchun.");
    const msg = m.text.slice(cmd.length).trim();
    if (!msg) return say(r, id, "Yozing: /yangilik Bugun barcha taomlarga 10% chegirma!");
    say(r, id, `📣 ${r.bot.subs.length} ta obunachiga yuborilmoqda...`);
    broadcast(r, "📣 " + msg).then(x => say(r, id, `✅ Yuborildi: ${x.ok}, yetmadi: ${x.bad}`));
    return;
  }
  if (cmd === "/buyurtmalar") {
    const l = D.orders.filter(o => o.rid === r.id && (isC && !isOp ? o.status === "out" : !["done", "x"].includes(o.status)));
    return say(r, id, l.length ? l.map(text).join("\n\n") : "Faol buyurtma yo‘q.");
  }
  tgAct(r, id, cmd.slice(1), no);
}
function cb(r, q) {
  const [cmd, no] = String(q.data || "").split(":");
  tg(r.bot.token, "answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  tgAct(r, String(q.from.id), cmd, parseInt(no, 10));
}
const gens = {};
function startBot(r) {
  const my = (gens[r.id] = (gens[r.id] || 0) + 1), tok = r.bot.token; if (!tok) return;
  let off = 0;
  (async () => {
    while (gens[r.id] === my) {
      try {
        const x = await tg(tok, "getUpdates", { offset: off, timeout: 25, allowed_updates: ["message", "callback_query"] });
        if (!x.ok) { console.log(`[${r.name}] Telegram xatosi: ${x.error_code} ${x.description}`); await sleep(5000); continue; }
        for (const u of x.result) {
          off = u.update_id + 1;
          if (u.message && u.message.text) handle(r, u.message);
          if (u.callback_query) cb(r, u.callback_query);
        }
      } catch { await sleep(3000); }
    }
  })();
}
async function setBot(r, token, ops, couriers) {
  token = str(token, 100).trim();
  if (token) {
    if (!/^\d+:[\w-]{20,}$/.test(token)) return "Token shakli noto‘g‘ri";
    if (Object.values(D.rs).some(x => x.id !== r.id && x.bot.token === token)) return "Bu token boshqa restoranda ishlatilgan";
    try { const x = await tg(token, "getMe"); if (!x.ok) return "Telegram bu tokenni qabul qilmadi"; r.bot.token = token; r.bot.name = x.result.username; }
    catch { return "Telegramga ulanib bo‘lmadi (internetni tekshiring)"; }
  }
  r.bot.ops = ids(ops); r.bot.couriers = ids(couriers); save(); startBot(r); return "";
}

// ---------- Restoran ma'lumotlari ----------
const pub = r => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, about: r.about, tel: r.tel, loc: r.loc, bot: r.bot.name || "", dishes: r.dishes });
function applySync(r, d) {
  r.name = str(d.name, 60).trim() || r.name; r.emoji = str(d.emoji, 8) || "🍽";
  r.color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : r.color; r.about = str(d.about, 120);
  r.tel = str(d.tel, 20).replace(/\D/g, "").slice(0, 12); r.loc = str(d.loc, 300);
  r.dishes = (Array.isArray(d.dishes) ? d.dishes : []).slice(0, 200).map(x => {
    let img = "", s = String(x.img || "");
    if (/^\/img\/[a-f0-9]{16}\.jpg$/.test(s)) img = s;
    else if (s.startsWith("data:image/jpeg;base64,") && s.length < 600000) {
      const buf = Buffer.from(s.slice(23), "base64"), h = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
      fs.writeFileSync(F("uploads/" + h + ".jpg"), buf); img = "/img/" + h + ".jpg";
    }
    return { id: /^[\w-]{1,20}$/.test(x.id) ? x.id : uid(), n: str(x.n, 80).trim(), p: Math.max(0, Math.min(1e8, parseInt(x.p, 10) || 0)),
      c: str(x.c, 30) || "Boshqa", e: str(x.e, 8) || "🍽", d: str(x.d, 200), ing: str(x.ing, 300), img, on: x.on ? 1 : 0 };
  }).filter(x => x.n);
  save();
}

// ---------- Kirish ----------
const ses = new Map(), resets = new Map(), hits = new Map(); setInterval(() => hits.clear(), 60000);
const limited = (k, max) => { const n = (hits.get(k) || 0) + 1; hits.set(k, n); return n > max; };
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString("hex");
const newSes = (res, rid) => { const s = crypto.randomBytes(24).toString("hex"); ses.set(s, rid);
  res.setHeader("Set-Cookie", `o=${s}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`); };
const ownerOf = req => { const c = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("o="));
  return c ? D.rs[ses.get(c.slice(2))] : null; };
async function body(req, max = 20000) {
  let raw = ""; for await (const c of req) { raw += c; if (raw.length > max) throw new Error("big"); }
  return raw ? JSON.parse(raw) : {};
}
const meOf = r => ({ restaurant: pub(r), bot: { name: r.bot.name || "", tail: r.bot.token ? r.bot.token.slice(-4) : "",
  ops: r.bot.ops.join(", "), couriers: r.bot.couriers.join(", "), subs: r.bot.subs.length } });

if (process.argv[2] === "reset") {                          // node server.js reset username yangiParol
  const u = String(process.argv[3] || "").toLowerCase().replace("@", ""), pw = String(process.argv[4] || ""), r = Object.values(D.rs).find(x => x.owner.tg === u);
  if (!r) { console.log("Bunday username topilmadi: " + u); process.exit(1); }
  if (pw.length < 6) { console.log("Parol kamida 6 belgi bo‘lsin"); process.exit(1); }
  r.owner.salt = crypto.randomBytes(16).toString("hex"); r.owner.hash = hash(pw, r.owner.salt); save();
  console.log("Parol almashtirildi: " + u); process.exit(0);
}

http.createServer(async (req, res) => {
  const send = (code, b) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(b)); };
  const p = new URL(req.url, "http://x").pathname, post = req.method === "POST", ip = req.socket.remoteAddress;
  try {
    if (req.method === "GET" && p === "/") { res.writeHead(302, { location: "/shop" }); return res.end(); }
    if (req.method === "GET" && p === "/shop") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(F("dasturxon.html")));
    }
    const im = p.match(/^\/img\/([a-f0-9]{16}\.jpg)$/);
    if (req.method === "GET" && im) {
      try { const b = fs.readFileSync(F("uploads/" + im[1]));
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" }); return res.end(b); }
      catch { return send(404, {}); }
    }
    if (req.method === "GET" && p === "/api/restaurants") return send(200, Object.values(D.rs).map(pub));

    if (post && p === "/api/owner/register") {
      if (limited("g" + ip, 5)) return send(429, { error: "Ko‘p urinish. Bir daqiqadan so‘ng qayta urining" });
      const d = await body(req), tgu = str(d.tg, 40).toLowerCase().replace("@", "");
      if (!/^[a-z0-9_]{4,32}$/.test(tgu)) return send(400, { error: "Telegram username noto‘g‘ri" });
      if (String(d.pw || "").length < 6) return send(400, { error: "Parol kamida 6 belgi bo‘lsin" });
      if (!str(d.rname, 60).trim()) return send(400, { error: "Restoran nomini kiriting" });
      if (Object.values(D.rs).some(x => x.owner.tg === tgu)) return send(400, { error: "Bu username band. Kirish bo‘limiga o‘ting" });
      const salt = crypto.randomBytes(16).toString("hex"), id = uid();
      D.rs[id] = { id, owner: { tg: tgu, salt, hash: hash(String(d.pw), salt) }, name: str(d.rname, 60).trim(), emoji: "🍽", color: "#0e6b52",
        about: "Qisqa tavsif yozing", tel: str(d.tel, 20).replace(/\D/g, "").slice(0, 12), loc: "", dishes: [], bot: { ops: [], couriers: [], subs: [] } };
      save(); newSes(res, id); return send(200, meOf(D.rs[id]));
    }
    if (post && p === "/api/owner/login") {
      if (limited("l" + ip, 8)) return send(429, { error: "Ko‘p urinish. Bir daqiqadan so‘ng qayta urining" });
      const d = await body(req), tgu = str(d.tg, 40).toLowerCase().replace("@", "");
      const r = Object.values(D.rs).find(x => x.owner.tg === tgu);
      if (!r || !crypto.timingSafeEqual(Buffer.from(hash(String(d.pw || ""), r.owner.salt)), Buffer.from(r.owner.hash)))
        return send(401, { error: "Username yoki parol xato" });
      newSes(res, r.id); return send(200, meOf(r));
    }
    if (post && p === "/api/owner/forgot") {                 // parolni tiklash kodi operator Telegramiga yuboriladi
      if (limited("f" + ip, 4)) return send(429, { error: "Ko‘p urinish. Bir daqiqadan so‘ng qayta urining" });
      const d = await body(req), tgu = str(d.tg, 40).toLowerCase().replace("@", "");
      const r = Object.values(D.rs).find(x => x.owner.tg === tgu), old = resets.get(tgu);
      if (r && r.bot.token && r.bot.ops.length && !(old && Date.now() - old.t < 60000)) {
        const code = String(crypto.randomInt(100000, 1000000));
        resets.set(tgu, { code, exp: Date.now() + 600000, tries: 0, t: Date.now() });
        r.bot.ops.forEach(k => say(r, k, `🔑 Parolni tiklash kodi: ${code}\n10 daqiqa amal qiladi. Siz so‘ramagan bo‘lsangiz, e’tibor bermang.`));
      }
      return send(200, { ok: 1 });                            // akkaunt bor-yo'qligini bildirmaymiz
    }
    if (post && p === "/api/owner/reset") {
      if (limited("r" + ip, 8)) return send(429, { error: "Ko‘p urinish. Bir daqiqadan so‘ng qayta urining" });
      const d = await body(req), tgu = str(d.tg, 40).toLowerCase().replace("@", "");
      const r = Object.values(D.rs).find(x => x.owner.tg === tgu), x = resets.get(tgu);
      if (!r || !x || Date.now() > x.exp || x.tries >= 5) return send(400, { error: "Kod noto‘g‘ri yoki muddati tugagan" });
      if (String(d.code || "").trim() !== x.code) { x.tries++; return send(400, { error: "Kod noto‘g‘ri yoki muddati tugagan" }); }
      if (String(d.pw || "").length < 6) return send(400, { error: "Parol kamida 6 belgi bo‘lsin" });
      r.owner.salt = crypto.randomBytes(16).toString("hex"); r.owner.hash = hash(String(d.pw), r.owner.salt); save();
      resets.delete(tgu); for (const [k, v] of ses) if (v === r.id) ses.delete(k);
      return send(200, { ok: 1 });
    }
    if (p.startsWith("/api/owner/")) {
      const r = ownerOf(req); if (!r) return send(401, { error: "Avval kiring" });
      if (req.method === "GET" && p === "/api/owner/me") return send(200, meOf(r));
      if (req.method === "GET" && p === "/api/owner/orders")
        return send(200, D.orders.filter(o => o.rid === r.id).slice(-30).reverse().map(o => ({ ...o, sum: total(o) })));
      if (post && p === "/api/owner/logout") { const c = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("o=")); if (c) ses.delete(c.slice(2)); return send(200, { ok: 1 }); }
      if (post && p === "/api/owner/sync") { applySync(r, (await body(req, 3e6)).restaurant || {}); return send(200, pub(r)); }
      if (post && p === "/api/owner/bot") { const d = await body(req); const e = await setBot(r, d.token, d.ops, d.couriers); return e ? send(400, { error: e }) : send(200, meOf(r)); }
      if (post && p === "/api/owner/news") {
        const msg = str((await body(req)).text, 3500).trim();
        if (!r.bot.token) return send(400, { error: "Avval Telegram botni ulang" });
        if (!msg) return send(400, { error: "Yangilik matnini yozing" });
        if (!r.bot.subs.length) return send(400, { error: "Hali obunachi yo‘q. Mijozlar botga /start yozishi kerak" });
        broadcast(r, "📣 " + msg); return send(200, { count: r.bot.subs.length });
      }
      if (post && p === "/api/owner/status") {
        const d = await body(req), x = doAct(r, "op", String(d.cmd), parseInt(d.no, 10), "");
        return x.err ? send(400, { error: x.err }) : send(200, { status: x.o.status });
      }
      return send(404, { error: "Topilmadi" });
    }

    if (post && p === "/api/orders") {                       // mijoz buyurtmasi
      if (limited("o" + ip, 10)) return send(429, { error: "Juda ko‘p so‘rov" });
      const d = await body(req), r = D.rs[d.rid];
      if (!r) return send(400, { error: "Restoran topilmadi" });
      const items = [];
      for (const i of (Array.isArray(d.items) ? d.items : []).slice(0, 50)) {
        const x = r.dishes.find(z => z.id === i.id && z.on);
        if (!x) return send(400, { error: "Taom topilmadi" });
        items.push({ n: x.n, q: Math.max(1, Math.min(99, i.q | 0)), p: x.p });       // narx serverdan olinadi
      }
      const tel = String(d.tel || "").replace(/\D/g, "");
      if (!items.length || tel.length < 9 || !d.name || !d.addr) return send(400, { error: "Ma’lumot to‘liq emas" });
      const o = { no: nextNo(), rid: r.id, restaurant: r.name, items, name: str(d.name, 60), tel, addr: str(d.addr, 200),
        loc: /^https:\/\//.test(d.loc || "") ? str(d.loc, 300) : "", note: str(d.note, 200), status: "new", t: Date.now() };
      D.orders.push(o); save();
      r.bot.ops.forEach(k => say(r, k, `🆕 Yangi buyurtma\n${text(o)}`, kb(o)));
      return send(200, { no: o.no, bot: r.bot.ops.length > 0 });
    }
    const m = p.match(/^\/api\/orders\/(\d+)$/);
    if (req.method === "GET" && m) {
      const o = D.orders.find(x => x.no === +m[1]);
      return o ? send(200, { no: o.no, status: o.status, label: LABEL[o.status] }) : send(404, { error: "Topilmadi" });
    }
    send(404, { error: "Topilmadi" });
  } catch { send(400, { error: "So‘rov noto‘g‘ri" }); }
}).listen(PORT, () => {
  console.log(`\nDasturxon serveri ishlayapti.\nMijozlar va restoranlar uchun sayt: http://localhost:${PORT}\n`);
  Object.values(D.rs).forEach(r => { r.bot.subs = r.bot.subs || []; console.log(`Restoran: ${r.name} — bot: ${r.bot.token ? "@" + r.bot.name : "ulanmagan"}`); startBot(r); });
});
