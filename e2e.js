// Owl Messenger — сквозное шифрование личных чатов (E2E), ядро. Формат v1: «E2E/План шифрования.md», §2, §3.1, §3.8, §6.2.
// Один файл для приложения (динамический import из app.js) и для service worker (importScripts в sw.js).
// Всё — внутри IIFE: верхнеуровневые const делили бы область имён с sw.js (CACHE, SHELL, offlineHtml) → SyntaxError.
// Наружу — только globalThis.OwlE2E (заморожен). Только WebCrypto, без библиотек.
(() => {
    'use strict';

    // ───── Константы формата v1 ─────
    const PH = '🔒 Зашифрованное сообщение';        // открытый text e2e-сообщения (видят старые клиенты и старый Worker)
    const MAX_PV = 120;                              // превью: до 120 кодовых точек…
    const PV_MAX_BYTES = 240;                        // …и до 240 байт UTF-8
    const PV_BYTES = 256;                            // открытый текст pv — ровно 256 байт
    const PV_CT_LEN = 363;                           // 256 + 16 (тег) = 272 байта = ровно 363 знака base64url
    const MAX_CT = 800000;                           // правило: e2e.ct ≤ 800 000 байт
    const MAX_HDR = 65536;                           // JSON-заголовок контейнера
    const UID_RE = /^[A-Za-z0-9]{1,128}$/;           // uid Firebase; части id лички ([A-Za-z0-9]+_[A-Za-z0-9]+, как isDmId в правилах)
    const SAFE_ID = /^[A-Za-z0-9]{1,40}$/;           // id сообщения (как SAFE_ID в app.js и replyTo.id в правилах)
    const KID_RE = /^[A-Za-z0-9_-]{12}$/;
    const IV_RE = /^[A-Za-z0-9_-]{16}$/;
    const PVCT_RE = /^[A-Za-z0-9_-]{363}$/;
    const PK_RE = /^B[A-P][A-Za-z0-9_-]{85}$/;       // 65 байт 0x04‖x‖y в base64url
    const B43_RE = /^[A-Za-z0-9_-]{43}$/;            // 32 байта (x, y, d в JWK)
    const IMG_MIME = /^image\/(jpeg|png|webp|gif)$/;
    const AUD_MIME = /^audio\/[A-Za-z0-9.+-]+(;[ A-Za-z0-9=.,+"-]+)*$/;
    // Стикеры, которые разрешают правила базы (если app.js не передал свой список)
    const STICKERS_DEFAULT = ['hi', 'love', 'haha', 'thanks', 'ok', 'think', 'wait', 'party', 'sad', 'angry', 'shock', 'coffee', 'work', 'night', 'secret', 'bye'];
    // Служебные строки превью (по-русски, как в базе) и их перевод для push (SW словарей не имеет)
    const PV_SERVICE = [['📷 ', 'Фотография'], ['🎤 ', 'Голосовое сообщение'], ['🦉 ', 'Стикер'], ['', 'Сообщение']];
    const PV_WORDS = deepFreeze({
        en: { 'Фотография': 'Photo', 'Голосовое сообщение': 'Voice message', 'Стикер': 'Sticker', 'Сообщение': 'Message' },
        de: { 'Фотография': 'Foto', 'Голосовое сообщение': 'Sprachnachricht', 'Стикер': 'Sticker', 'Сообщение': 'Nachricht' },
        pl: { 'Фотография': 'Zdjęcie', 'Голосовое сообщение': 'Wiadomość głosowa', 'Стикер': 'Naklejka', 'Сообщение': 'Wiadomość' }
    });

    // ───── Общие помощники ─────
    function deepFreeze(o) { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); return Object.freeze(o); }
    function fail(code, msg) { const e = new Error('OwlE2E: ' + code + (msg ? ' (' + msg + ')' : '')); e.name = 'OwlE2EError'; e.code = code; return e; }
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const re = (rx, v) => typeof v === 'string' && rx.test(v);
    const strMax = (v, n) => typeof v === 'string' && v.length <= n;
    const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.prototype.toString.call(o) === '[object Object]';
    const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.indexOf(k) >= 0);
    const TE = new TextEncoder();
    const TD = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const utf8 = (s) => TE.encode(s);
    function subtle() { const c = globalThis.crypto; if (!c || !c.subtle) throw fail('nocrypto'); return c.subtle; }
    function rnd(n) { const u = new Uint8Array(n); globalThis.crypto.getRandomValues(u); return u; }
    // Байты из Uint8Array / любого TypedArray / ArrayBuffer / Firestore Bytes (toUint8Array). Работает и между «мирами» (vm, iframe)
    function toU8(x) {
        if (x instanceof Uint8Array) return x;
        if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
        if (Object.prototype.toString.call(x) === '[object ArrayBuffer]') return new Uint8Array(x);
        if (x && typeof x === 'object' && typeof x.toUint8Array === 'function') { const u = x.toUint8Array(); if (ArrayBuffer.isView(u)) return toU8(u); }
        throw fail('bytes');
    }
    function concat(list) {
        let n = 0; for (const a of list) n += a.length;
        const out = new Uint8Array(n); let o = 0;
        for (const a of list) { out.set(a, o); o += a.length; }
        return out;
    }
    function eqBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
    function timeout(p, ms, onTimeout) {
        let timer;
        const lim = new Promise((_, reject) => { timer = setTimeout(() => { try { if (onTimeout) onTimeout(); } catch (_) { /* пусто */ } reject(fail('timeout')); }, ms); });
        return Promise.race([p, lim]).finally(() => clearTimeout(timer));
    }

    // ───── base64 / base64url: свой кодер кусками по 32 КБ (spread большого буфера переполнил бы стек) ─────
    const A_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const A_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const codes = (a) => { const c = new Uint8Array(64); for (let i = 0; i < 64; i++) c[i] = a.charCodeAt(i); return c; };
    const table = (a) => { const tb = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) tb[a.charCodeAt(i)] = i; return tb; };
    const C_URL = codes(A_URL), C_STD = codes(A_STD), T_URL = table(A_URL), T_STD = table(A_STD);
    const CHUNK_IN = 24576;   // кратно 3 → 32 768 знаков на кусок
    function enc64(input, cd, pad) {
        const u = toU8(input), parts = [];
        for (let off = 0; off < u.length; off += CHUNK_IN) {
            const end = Math.min(off + CHUNK_IN, u.length), n = end - off, r = n % 3;
            const out = new Uint8Array((n - r) / 3 * 4 + (r ? (pad ? 4 : r + 1) : 0));
            let o = 0, i = off;
            for (; i + 2 < end; i += 3) {
                const v = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2];
                out[o++] = cd[v >>> 18]; out[o++] = cd[(v >>> 12) & 63]; out[o++] = cd[(v >>> 6) & 63]; out[o++] = cd[v & 63];
            }
            if (r === 1) {
                const v = u[i] << 16;
                out[o++] = cd[v >>> 18]; out[o++] = cd[(v >>> 12) & 63];
                if (pad) { out[o++] = 61; out[o++] = 61; }
            } else if (r === 2) {
                const v = (u[i] << 16) | (u[i + 1] << 8);
                out[o++] = cd[v >>> 18]; out[o++] = cd[(v >>> 12) & 63]; out[o++] = cd[(v >>> 6) & 63];
                if (pad) out[o++] = 61;
            }
            parts.push(String.fromCharCode.apply(null, out));
        }
        return parts.join('');
    }
    // strict: без «=» и только каноничная запись (лишние биты в конце = 0); иначе — стандартный base64 c необязательным «=»
    function dec64(str, tb, strict) {
        if (typeof str !== 'string') throw fail('b64');
        let len = str.length;
        if (!strict && len % 4 === 0 && len > 0) { if (str.charCodeAt(len - 1) === 61) len--; if (str.charCodeAt(len - 1) === 61) len--; }
        if (len % 4 === 1) throw fail('b64');
        const out = new Uint8Array(Math.floor(len * 3 / 4));
        const at = (j) => { const c = str.charCodeAt(j), v = c < 128 ? tb[c] : -1; if (v < 0) throw fail('b64'); return v; };
        let o = 0, i = 0;
        for (; i + 3 < len; i += 4) {
            const v = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
            out[o++] = v >>> 16; out[o++] = (v >>> 8) & 255; out[o++] = v & 255;
        }
        const r = len - i;
        if (r === 2) {
            const v = (at(i) << 18) | (at(i + 1) << 12);
            if (strict && (v & 0xffff)) throw fail('b64');
            out[o++] = v >>> 16;
        } else if (r === 3) {
            const v = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6);
            if (strict && (v & 0xff)) throw fail('b64');
            out[o++] = v >>> 16; out[o++] = (v >>> 8) & 255;
        }
        return out;
    }
    const b64u = (bytes) => enc64(bytes, C_URL, false);
    const unb64u = (str) => dec64(str, T_URL, true);
    const b64 = (bytes) => enc64(bytes, C_STD, true);
    const unb64 = (str) => dec64(str, T_STD, false);

    // ───── SHA-256 синхронно (контрольный байт Совиного ключа и «Отпечаток совы» нужны без await) ─────
    const K256 = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    function sha256(msg) {
        const m = toU8(msg), len = m.length, total = Math.ceil((len + 9) / 64) * 64;
        const buf = new Uint8Array(total); buf.set(m); buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
        const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
        const W = new Uint32Array(64);
        for (let off = 0; off < total; off += 64) {
            for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + 4 * i);
            for (let i = 16; i < 64; i++) {
                const a = W[i - 15], b = W[i - 2];
                W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
            }
            let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (let i = 0; i < 64; i++) {
                const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
                h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
            H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
        }
        const out = new Uint8Array(32), ov = new DataView(out.buffer);
        for (let i = 0; i < 8; i++) ov.setUint32(4 * i, H[i]);
        return out;
    }

    // ───── Публичный ключ: 65 байт 0x04‖x‖y; проверка точки на кривой P-256 ─────
    function rawPub(x) {
        let u;
        if (typeof x === 'string') { if (!PK_RE.test(x)) throw fail('pub', 'format'); u = unb64u(x); }
        else u = toU8(x);
        if (u.length !== 65 || u[0] !== 4) throw fail('pub', 'format');
        return u;
    }
    const P256 = typeof BigInt === 'function' ? {
        p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
        b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
        three: BigInt(3)
    } : null;
    function big(u, off, n) { let h = '0x'; for (let i = off; i < off + n; i++) h += (u[i] < 16 ? '0' : '') + u[i].toString(16); return BigInt(h); }
    function onCurve(raw) {
        if (!P256) return true;   // без BigInt полагаемся на проверку WebCrypto в importKey
        const { p, b, three } = P256, x = big(raw, 1, 32), y = big(raw, 33, 32);
        if (x >= p || y >= p) return false;
        const rhs = (((x * x % p) * x - three * x + b) % p + p) % p;
        return (y * y) % p === rhs;
    }
    async function importPub(pubRaw) {
        const raw = rawPub(pubRaw);
        if (!onCurve(raw)) throw fail('pub', 'not on curve');
        try { return await subtle().importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []); }
        catch (e) { throw fail('pub', e && e.name); }
    }
    async function pkHash(pubRaw) { return b64u(new Uint8Array(await subtle().digest('SHA-256', rawPub(pubRaw)))); }
    async function kidOf(pubRaw) { return (await pkHash(pubRaw)).slice(0, 12); }

    // ───── Ключ личности (ECDH P-256), JWK {kty,crv,x,y,d} ─────
    function normJwk(j) {
        if (!isObj(j) || j.kty !== 'EC' || j.crv !== 'P-256' || !re(B43_RE, j.x) || !re(B43_RE, j.y) || !re(B43_RE, j.d)) throw fail('jwk');
        for (const k of ['x', 'y', 'd']) if (unb64u(j[k]).length !== 32) throw fail('jwk');
        return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, d: j.d };
    }
    function pubFromJwk(jwk) {
        const j = normJwk(jwk);
        return concat([new Uint8Array([4]), unb64u(j.x), unb64u(j.y)]);
    }
    async function generateIdentity() {
        const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const jwk = normJwk(await subtle().exportKey('jwk', kp.privateKey));
        const pubRaw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
        return { jwk, pubRaw, kid: await kidOf(pubRaw) };
    }
    async function importPriv(jwk) {
        return subtle().importKey('jwk', normJwk(jwk), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    }
    // Ключ рабочий и подходит к pub: ECDH сам с собой + сверка с одноразовым ключом (d·E == e·P ⇔ P = d·G). Не бросает.
    async function selfTest(priv, pubRaw) {
        try {
            const S = subtle(), alg = { name: 'ECDH', namedCurve: 'P-256' };
            const pub = await importPub(pubRaw);
            const same = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
            if (same.length !== 32) return false;
            const eph = await S.generateKey(alg, false, ['deriveBits']);
            const a = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: eph.publicKey }, priv, 256));
            const b = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256));
            return a.length === 32 && eqBytes(a, b);
        } catch (_) { return false; }
    }

    // ───── Совиный ключ: 16 байт + контрольный байт → 28 знаков base32 Crockford, 7 групп по 4 ─────
    const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    function secretBytes(u) { const s = toU8(u); if (s.length !== 16) throw fail('secret'); return s; }
    function newSecret() { return rnd(16); }
    function formatSecret(u8) {
        const s = secretBytes(u8), bytes = concat([s, new Uint8Array([sha256(s)[0]])]);
        let val = 0, bits = 0, out = '';
        for (const x of bytes) {
            val = (val << 8) | x; bits += 8;
            while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
            val &= (1 << bits) - 1;
        }
        if (bits) out += B32[(val << (5 - bits)) & 31];   // 136 бит + 4 нулевых = 28 знаков
        return out.match(/.{4}/g).join('-');
    }
    function parseSecret(str) {
        if (typeof str !== 'string') throw fail('format');
        let s = str.toUpperCase().replace(/[\s_‐-―−-]/g, '');
        if (s.indexOf('OWLKEY1:') === 0) s = s.slice(8);   // вставили содержимое QR целиком
        s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
        if (!/^[0-9A-HJKMNP-TV-Z]{28}$/.test(s)) throw fail('format');
        const out = new Uint8Array(17);
        let val = 0, bits = 0, o = 0;
        for (const ch of s) {
            val = (val << 5) | B32.indexOf(ch); bits += 5;
            if (bits >= 8) { if (o < 17) out[o++] = (val >>> (bits - 8)) & 255; bits -= 8; }
            val &= (1 << bits) - 1;
        }
        if (o !== 17 || bits !== 4 || val !== 0) throw fail('checksum');   // младшие 4 бита — нули
        const secret = out.slice(0, 16);
        if (sha256(secret)[0] !== out[16]) throw fail('checksum');
        return secret;
    }

    // ───── Сейф: JWK под ключом из Совиного ключа (HKDF → AES-GCM), AAD owl1vault|uid|kid ─────
    async function vaultKey(secret, uid) {
        const S = subtle();
        const ikm = await S.importKey('raw', secretBytes(secret), 'HKDF', false, ['deriveKey']);
        return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('owl-vault-v1'), info: utf8('vault|' + uid) }, ikm,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    function vaultAad(uid, kid) {
        if (!re(UID_RE, uid) || !re(KID_RE, kid)) throw fail('ids');
        return utf8('owl1vault|' + uid + '|' + kid);
    }
    async function sealVault(jwk, secret, uid, kid) {
        const j = normJwk(jwk), aad = vaultAad(uid, kid);
        if (await kidOf(pubFromJwk(j)) !== kid) throw fail('kid');
        const key = await vaultKey(secret, uid), iv = rnd(12);
        const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, utf8(JSON.stringify(j)));
        return { iv: b64u(iv), ct: b64u(new Uint8Array(ct)) };
    }
    async function openVault(v, secret, uid, kid) {
        try {
            const aad = vaultAad(uid, kid);
            if (!v || !re(IV_RE, v.iv) || typeof v.ct !== 'string') throw fail('badkey');
            const key = await vaultKey(secret, uid);
            const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(v.iv), additionalData: aad, tagLength: 128 }, key, unb64u(v.ct));
            const j = normJwk(JSON.parse(TD.decode(new Uint8Array(pt))));
            if (await kidOf(pubFromJwk(j)) !== kid) throw fail('badkey');
            return j;
        } catch (_) { throw fail('badkey'); }
    }

    // ───── Ключ для запросов (escrow, «E2E/notes/escrow-design.md» §2): копия JWK, запертая главным ключом ─────
    // ECIES: одноразовая пара → ECDH с главным pk → HKDF → AES-GCM. Документ escrow/{uid}_{kid}: {v:1, mk, kid, epk, iv, ct} (+ t от сервера).
    // В приложении — только escrowSeal; escrowOpen нужен инструменту владельца (owl-escrow.mjs) и тестам.
    // Любой сбой → OwlE2EError с кодом 'escrow' (подробность — в сообщении).
    const ESC_KEYS = ['v', 'mk', 'kid', 'epk', 'iv', 'ct', 't'];
    const ESC_CT_RE = /^[A-Za-z0-9_-]{150,400}$/;   // JWK фиксированной длины → всегда 256 знаков; рамки — как в правилах
    const isCryptoKey = (k) => Object.prototype.toString.call(k) === '[object CryptoKey]';
    function escFail(e) {
        if (e && e.name === 'OwlE2EError' && e.code === 'escrow') return e;
        return fail('escrow', e && e.name === 'OwlE2EError' ? e.code : (e && e.name) || 'error');
    }
    const escrowAad = (uid, kid, mk) => utf8('owl1escrow|' + uid + '|' + kid + '|' + mk);
    async function escrowKey(bits, uid, kid, mk, epk) {
        const S = subtle(), hk = await S.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('owl-escrow-v1'), info: utf8('escrow|' + uid + '|' + kid + '|' + mk + '|' + epk) },
            hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    // master = { mk, pk } (вшит в app.js). Заглушка { mk: "", pk: "" } и mk не от этого pk (опечатка при вшивании) → отказ.
    async function escrowSeal(jwk, uid, kid, master) {
        try {
            const j = normJwk(jwk);
            if (!re(UID_RE, uid) || !re(KID_RE, kid)) throw fail('escrow', 'ids');
            if (await kidOf(pubFromJwk(j)) !== kid) throw fail('escrow', 'kid');
            if (!isObj(master)) throw fail('escrow', 'master');
            const mk = master.mk, pk = master.pk;
            if (!re(KID_RE, mk) || !re(PK_RE, pk)) throw fail('escrow', 'master');
            if (await kidOf(pk) !== mk) throw fail('escrow', 'mk');
            const S = subtle(), mpub = await importPub(pk);   // importPub: формат + точка на кривой
            const eph = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
            const epk = b64u(new Uint8Array(await S.exportKey('raw', eph.publicKey)));
            if (!re(PK_RE, epk)) throw fail('escrow', 'epk');
            const key = await escrowKey(await S.deriveBits({ name: 'ECDH', public: mpub }, eph.privateKey, 256), uid, kid, mk, epk);
            const iv = rnd(12);
            const ct = b64u(new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: escrowAad(uid, kid, mk), tagLength: 128 }, key, utf8(JSON.stringify(j)))));
            if (!re(ESC_CT_RE, ct)) throw fail('escrow', 'ct size');
            return { v: 1, mk, kid, epk, iv: b64u(iv), ct };
        } catch (e) { throw escFail(e); }
    }
    // Главный закрытый ключ → { priv: CryptoKey, pub: 65 байт }. Варианты: JWK {kty,crv,x,y,d} (pub из x, y);
    // { priv: CryptoKey | JWK, pk } (pk — открытая часть, b64u или байты); CryptoKey — только извлекаемый (pub из его JWK).
    async function escrowMaster(m) {
        if (isCryptoKey(m)) {
            if (!m.extractable) throw fail('escrow', 'master pub');   // pub не узнать — передать { priv, pk }
            return { priv: m, pub: pubFromJwk(await subtle().exportKey('jwk', m)) };
        }
        if (!isObj(m)) throw fail('escrow', 'master');
        if (own(m, 'pk')) {
            const pub = rawPub(m.pk).slice();
            if (!onCurve(pub)) throw fail('escrow', 'master pub');
            if (isCryptoKey(m.priv)) return { priv: m.priv, pub };
            if (!eqBytes(pubFromJwk(m.priv), pub)) throw fail('escrow', 'master pub');
            return { priv: await importPriv(m.priv), pub };
        }
        return { priv: await importPriv(m), pub: pubFromJwk(m) };
    }
    // → JWK человека. Проверяет формат, v, mk = kidOf(главный pub), AAD/info (uid|kid|mk|epk) и что ключ внутри подходит к kid.
    async function escrowOpen(doc, masterPriv, uid) {
        try {
            if (!isObj(doc) || !onlyKeys(doc, ESC_KEYS)) throw fail('escrow', 'format');
            if (doc.v !== 1) throw fail('escrow', 'v');
            const { mk, kid, epk, iv, ct } = doc;
            if (!re(KID_RE, mk) || !re(KID_RE, kid) || !re(PK_RE, epk) || !re(IV_RE, iv) || !re(ESC_CT_RE, ct)) throw fail('escrow', 'format');
            if (!re(UID_RE, uid)) throw fail('escrow', 'ids');
            const m = await escrowMaster(masterPriv);
            if (await kidOf(m.pub) !== mk) throw fail('escrow', 'mk');   // копия заперта другим главным ключом
            const S = subtle();
            const key = await escrowKey(await S.deriveBits({ name: 'ECDH', public: await importPub(epk) }, m.priv, 256), uid, kid, mk, epk);
            let pt;
            try { pt = await S.decrypt({ name: 'AES-GCM', iv: unb64u(iv), additionalData: escrowAad(uid, kid, mk), tagLength: 128 }, key, unb64u(ct)); }
            catch (_) { throw fail('escrow', 'decrypt'); }
            let j;
            try { j = normJwk(JSON.parse(TD.decode(new Uint8Array(pt)))); } catch (_) { throw fail('escrow', 'jwk'); }
            if (await kidOf(pubFromJwk(j)) !== kid) throw fail('escrow', 'kid');
            return j;
        } catch (e) { throw escFail(e); }
    }

    // ───── Ключи чата: deriveBits(ECDH) → HKDF → msgKey и pvKey ─────
    function dmParts(chatId) {
        if (typeof chatId !== 'string') return null;
        const p = chatId.split('_');
        return p.length === 2 && UID_RE.test(p[0]) && UID_RE.test(p[1]) ? p : null;
    }
    async function deriveChatKeys(myPriv, raw, chatId, lo, hi) {
        const peerKid = await kidOf(raw);
        if (peerKid !== lo && peerKid !== hi) throw fail('kid', 'peer key does not match kids');
        const S = subtle(), pub = await importPub(raw);
        const bits = await S.deriveBits({ name: 'ECDH', public: pub }, myPriv, 256);
        const hk = await S.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        const mk = (label) => S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('owl-e2e-v1'), info: utf8(label + '|' + chatId + '|' + lo + '|' + hi) },
            hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const [msg, pv] = await Promise.all([mk('dm'), mk('dmpv')]);
        return Object.freeze({ msg, pv });
    }
    // Кэш §2.1: WeakMap(myPriv → Map(«chatId|kidMin|kidMax|pub» → Promise<{msg, pv}>)). Привязан к самому CryptoKey и полному pub
    // (kid — лишь 72 бита), поэтому не отдаст ключи другой пары. Сбой из кэша убирается; до KC_MAX записей на ключ (давние вытесняются).
    // В SW каждый push приносит новый CryptoKey из IDB → просто промах. wipe() сбрасывает кэш.
    const KC_MAX = 500;
    let keyCache = new WeakMap();
    async function chatKeys(myPriv, peerPubRaw, chatId, kidA, kidB) {
        if (!dmParts(chatId)) throw fail('ids');
        if (!re(KID_RE, kidA) || !re(KID_RE, kidB)) throw fail('kid');
        const raw = rawPub(peerPubRaw).slice();   // своя копия: вход могут поменять, пока идёт расчёт
        const lo = kidA < kidB ? kidA : kidB, hi = kidA < kidB ? kidB : kidA;
        if (!myPriv || typeof myPriv !== 'object') return deriveChatKeys(myPriv, raw, chatId, lo, hi);   // не ключ — пусть бросит WebCrypto
        let m = keyCache.get(myPriv);
        if (!m) { m = new Map(); keyCache.set(myPriv, m); }
        const ck = chatId + '|' + lo + '|' + hi + '|' + b64u(raw);
        let p = m.get(ck);
        if (p) { m.delete(ck); m.set(ck, p); return p; }   // свежее использование — в конец очереди
        p = deriveChatKeys(myPriv, raw, chatId, lo, hi);
        m.set(ck, p);
        if (m.size > KC_MAX) m.delete(m.keys().next().value);
        p.catch(() => { if (m.get(ck) === p) m.delete(ck); });
        return p;
    }
    function aadFor(prefix, ids) {
        const p = ids && dmParts(ids.chatId);
        if (!p || !re(UID_RE, ids.uid) || p.indexOf(ids.uid) < 0 || !re(SAFE_ID, ids.msgId)) throw fail('ids');
        return utf8(prefix + '|' + ids.chatId + '|' + ids.uid + '|' + ids.msgId);
    }

    // ───── Превью: строка из полей, ≤120 кодовых точек и ≤240 байт; открытый текст pv — ровно 256 байт ─────
    function cpBytes(cp) { const c = cp.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
    function clipPreview(s) {
        const cps = Array.from(String(s)).slice(0, MAX_PV);
        let n = 0, bytes = 0;
        for (; n < cps.length; n++) { const b = cpBytes(cps[n]); if (bytes + b > PV_MAX_BYTES) break; bytes += b; }
        return cps.slice(0, n).join('');
    }
    function previewOf(fields) {
        const f = fields && typeof fields === 'object' ? fields : {};
        const s = (typeof f.text === 'string' && f.text) ? f.text : f.imageUrl ? '📷 Фотография' : f.audioUrl ? '🎤 Голосовое сообщение'
            : f.sticker ? '🦉 Стикер' : 'Сообщение';
        return clipPreview(s);
    }
    function pvPlain(s) {
        const b = utf8(clipPreview(s));
        if (b.length > PV_MAX_BYTES) throw fail('pv');
        const out = new Uint8Array(PV_BYTES); out[0] = b.length; out.set(b, 1);
        return out;
    }

    // ───── Контейнер (открытый текст e2e.ct): [0x01][H uint32 BE][JSON H байт][медиа N байт][нули до кратности 256] ─────
    const HDR_KEYS = ['text', 'sticker', 'replyTo', 'forwardedFrom', 'media'];
    function stickerOk(id, ids) {
        if (typeof id !== 'string') return false;
        const list = ids == null ? STICKERS_DEFAULT : ids;
        if (typeof list.has === 'function') return list.has(id);
        return Array.isArray(list) && list.indexOf(id) >= 0;
    }
    // Проверка заголовка — одна для отправки и приёма. Возвращает причину отказа или null.
    function headerProblem(h, stickerIds) {
        if (!isObj(h)) return 'header';
        for (const k of Object.keys(h)) if (HDR_KEYS.indexOf(k) < 0) return 'key ' + k;
        if (own(h, 'text') && !strMax(h.text, 4000)) return 'text';
        if (own(h, 'sticker') && !stickerOk(h.sticker, stickerIds)) return 'sticker';
        if (own(h, 'replyTo')) {
            const r = h.replyTo;
            if (!isObj(r) || !onlyKeys(r, ['id', 'uid', 'sender', 'text']) || !re(SAFE_ID, r.id)
                || (own(r, 'uid') && !strMax(r.uid, 128)) || (own(r, 'sender') && !strMax(r.sender, 64)) || (own(r, 'text') && !strMax(r.text, 300))) return 'replyTo';
        }
        if (own(h, 'forwardedFrom')) {
            const f = h.forwardedFrom;
            if (!isObj(f) || !onlyKeys(f, ['uid', 'name']) || (own(f, 'uid') && !strMax(f.uid, 128)) || (own(f, 'name') && !strMax(f.name, 64))) return 'forwardedFrom';
        }
        if (own(h, 'media')) {
            const m = h.media;
            if (!isObj(m) || !onlyKeys(m, ['kind', 'mime', 'len'])) return 'media';
            if (!(m.kind === 'image' ? re(IMG_MIME, m.mime) : m.kind === 'audio' ? re(AUD_MIME, m.mime) : false)) return 'media mime';
            if (!Number.isInteger(m.len) || m.len < 1 || m.len > MAX_CT) return 'media len';
        }
        return null;
    }
    function parseDataUrl(url, kind) {
        if (typeof url !== 'string' || url.indexOf('data:' + kind + '/') !== 0) throw fail('fields', kind + ' url');
        const i = url.indexOf(';base64,');
        if (i < 0) throw fail('fields', kind + ' url');
        const mime = url.slice(5, i);
        let bytes;
        try { bytes = unb64(url.slice(i + 8)); } catch (_) { throw fail('fields', kind + ' base64'); }
        return { kind, mime, bytes };
    }
    function copyStr(o) { const c = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) c[k] = o[k]; return c; }
    function pack(fields, stickerIds) {
        if (!isObj(fields)) throw fail('fields');
        if (own(fields, 'poll') && fields.poll != null) throw fail('fields', 'poll');   // опросов в E2E нет (§2.2)
        const h = {};
        let media = null;
        if (fields.text != null && fields.text !== '') h.text = fields.text;
        if (fields.sticker != null && fields.sticker !== '') h.sticker = fields.sticker;
        if (fields.replyTo != null) { if (!isObj(fields.replyTo)) throw fail('fields', 'replyTo'); h.replyTo = copyStr(fields.replyTo); }
        if (fields.forwardedFrom != null) { if (!isObj(fields.forwardedFrom)) throw fail('fields', 'forwardedFrom'); h.forwardedFrom = copyStr(fields.forwardedFrom); }
        if (fields.imageUrl) media = parseDataUrl(fields.imageUrl, 'image');
        if (fields.audioUrl) { if (media) throw fail('fields', 'two media'); media = parseDataUrl(fields.audioUrl, 'audio'); }
        if (media) h.media = { kind: media.kind, mime: media.mime, len: media.bytes.length };
        const why = headerProblem(h, stickerIds);
        if (why) throw fail('fields', why);
        const hb = utf8(JSON.stringify(h));
        if (hb.length > MAX_HDR) throw fail('fields', 'header size');
        const N = media ? media.bytes.length : 0, used = 5 + hb.length + N, total = Math.ceil(used / 256) * 256;
        if (total + 16 > MAX_CT) throw fail('size');
        const out = new Uint8Array(total);
        out[0] = 1;
        new DataView(out.buffer).setUint32(1, hb.length);
        out.set(hb, 5);
        if (media) out.set(media.bytes, 5 + hb.length);
        return out;
    }
    // Строгая проверка после расшифровки: правила внутрь шифра не видят. Итог собирается по белому списку.
    function unpack(input, stickerIds) {
        const bad = (why) => fail('container', why);
        let u;
        try { u = toU8(input); } catch (_) { throw bad('bytes'); }
        const n = u.length;
        if (n < 5 || u[0] !== 1) throw bad('format');
        if (n % 256 !== 0) throw bad('padding');
        const H = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(1);
        if (H < 2 || H > MAX_HDR || 5 + H > n) throw bad('H');
        let h;
        try { h = JSON.parse(TD.decode(u.subarray(5, 5 + H))); } catch (_) { throw bad('json'); }
        const why = headerProblem(h, stickerIds);
        if (why) throw bad(why);
        const N = own(h, 'media') ? h.media.len : 0, end = 5 + H + N;
        if (end > n) throw bad('N');
        if (n - end > 255) throw bad('padding');
        for (let i = end; i < n; i++) if (u[i] !== 0) throw bad('padding');
        const out = {};
        if (own(h, 'text')) out.text = h.text;
        if (own(h, 'sticker')) out.sticker = h.sticker;
        if (own(h, 'replyTo')) {
            const r = h.replyTo, c = { id: r.id };
            if (own(r, 'uid')) c.uid = r.uid; if (own(r, 'sender')) c.sender = r.sender; if (own(r, 'text')) c.text = r.text;
            out.replyTo = c;
        }
        if (own(h, 'forwardedFrom')) {
            const f = h.forwardedFrom, c = {};
            if (own(f, 'uid')) c.uid = f.uid; if (own(f, 'name')) c.name = f.name;
            out.forwardedFrom = c;
        }
        if (N) {
            const url = 'data:' + h.media.mime + ';base64,' + b64(u.subarray(5 + H, end));   // именно data-URL, не blob:
            if (h.media.kind === 'image') out.imageUrl = url; else out.audioUrl = url;
        }
        return out;
    }

    // ───── Сообщение и превью ─────
    const gcm = (iv, aad) => ({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 });
    async function encryptMsg(keys, ids, fields, stickerIds) {
        const aad = aadFor('owl1', ids), aadPv = aadFor('owl1pv', ids);
        const pt = pack(fields, stickerIds), pvp = pvPlain(previewOf(fields));
        const iv = rnd(12), piv = rnd(12), S = subtle();
        const ct = new Uint8Array(await S.encrypt(gcm(iv, aad), keys.msg, pt));
        if (ct.length > MAX_CT) throw fail('size');
        const pct = b64u(new Uint8Array(await S.encrypt(gcm(piv, aadPv), keys.pv, pvp)));
        if (pct.length !== PV_CT_LEN) throw fail('pv');
        return { v: 1, iv: b64u(iv), ct, pv: { iv: b64u(piv), ct: pct } };
    }
    async function decryptMsg(keys, ids, e2e, stickerIds) {
        const aad = aadFor('owl1', ids);
        if (!e2e || typeof e2e !== 'object') throw fail('format');
        if (e2e.v !== 1) throw fail('newer');
        if (!re(IV_RE, e2e.iv)) throw fail('format', 'iv');
        let ct;
        try { ct = toU8(e2e.ct); } catch (_) { throw fail('format', 'ct'); }
        if (ct.length < 17 || ct.length > MAX_CT) throw fail('format', 'ct size');
        let pt;
        try { pt = new Uint8Array(await subtle().decrypt(gcm(unb64u(e2e.iv), aad), keys.msg, ct)); }
        catch (_) { throw fail('decrypt'); }
        return unpack(pt, stickerIds);
    }
    async function decryptPreview(keys, ids, pv) {
        const aad = aadFor('owl1pv', ids);
        if (!pv || typeof pv !== 'object' || !re(IV_RE, pv.iv) || !re(PVCT_RE, pv.ct)) throw fail('pv', 'format');
        let ct;
        try { ct = unb64u(pv.ct); } catch (_) { throw fail('pv', 'format'); }
        if (ct.length !== PV_BYTES + 16) throw fail('pv', 'size');
        let pt;
        try { pt = new Uint8Array(await subtle().decrypt(gcm(unb64u(pv.iv), aad), keys.pv, ct)); }
        catch (_) { throw fail('decrypt'); }
        const L = pt[0];
        if (pt.length !== PV_BYTES || L > PV_MAX_BYTES) throw fail('pv', 'L');
        for (let i = 1 + L; i < PV_BYTES; i++) if (pt[i] !== 0) throw fail('pv', 'padding');
        try { return TD.decode(pt.subarray(1, 1 + L)); } catch (_) { throw fail('pv', 'utf8'); }
    }

    // ───── «Отпечаток совы» v1: 8 групп по 5 цифр, одинаково у обоих ─────
    function fingerprint(uidA, pkA, uidB, pkB) {
        if (!re(UID_RE, uidA) || !re(UID_RE, uidB)) throw fail('ids');
        const a = rawPub(pkA), b = rawPub(pkB);
        const [u1, p1, u2, p2] = uidA < uidB ? [uidA, a, uidB, b] : [uidB, b, uidA, a];
        const bar = utf8('|');
        const H = sha256(concat([utf8('owl-fp-v1|'), utf8(u1), bar, p1, bar, utf8(u2), bar, p2]));
        const dv = new DataView(H.buffer), g = [];
        for (let i = 0; i < 8; i++) g.push(String(dv.getUint32(4 * i) % 100000).padStart(5, '0'));
        return g.join(' ');
    }

    // ───── IndexedDB «owl-e2e» v1: keys / peers / pins / prefs (ключи вне записей). Пишет только окно; SW только читает ─────
    const DB_NAME = 'owl-e2e', DB_VER = 1, STORES = Object.freeze(['keys', 'peers', 'pins', 'prefs']);
    const DB_MS = 3000, WIPE_DEL_MS = 2000, PUSH_IDB_MS = 1200;
    function idbFactory() { const f = globalThis.indexedDB; if (!f) throw fail('noidb'); return f; }
    function closeQuiet(c) { try { if (c) c.close(); } catch (_) { /* пусто */ } }
    // create = true: открыть v1 и создать хранилища; false (SW): открыть без версии, а если БД нет — отменить создание
    function openRaw(create, ms) {
        return new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => { if (!done) { done = true; reject(fail('timeout', 'open')); } }, ms);
            const settle = (ok, v) => { if (done) return false; done = true; clearTimeout(timer); (ok ? resolve : reject)(v); return true; };
            let req;
            try { req = create ? idbFactory().open(DB_NAME, DB_VER) : idbFactory().open(DB_NAME); } catch (e) { settle(false, e); return; }
            req.onupgradeneeded = () => {
                if (!create) { try { req.transaction.abort(); } catch (_) { /* пусто */ } return; }   // пустую БД из SW не создаём
                const c = req.result;
                for (const s of STORES) if (!c.objectStoreNames.contains(s)) c.createObjectStore(s);
            };
            req.onsuccess = () => {
                const c = req.result;
                c.onversionchange = () => closeQuiet(c);   // не мешать deleteDatabase/обновлению из другой вкладки
                if (!settle(true, c)) closeQuiet(c);        // опоздавшее после тайм-аута соединение — сразу закрыть
            };
            req.onerror = (ev) => { if (ev && typeof ev.preventDefault === 'function') ev.preventDefault(); settle(false, req.error || fail('open')); };
            req.onblocked = () => { /* ждём до тайм-аута */ };
        });
    }
    function txDo(c, stores, mode, body, holder) {
        return new Promise((resolve, reject) => {
            const tx = mode === 'readwrite' ? c.transaction(stores, 'readwrite', { durability: 'strict' }) : c.transaction(stores, 'readonly');
            if (holder) holder.tx = tx;
            let out;
            tx.oncomplete = () => resolve(out);   // запись считается сделанной только после complete
            tx.onabort = () => reject(tx.error || fail('abort'));
            body(tx, (v) => { out = v; });
        });
    }
    let conn = null, connP = null, connGen = 0;
    function dropConn(c) { if (c && conn === c) conn = null; closeQuiet(c); }
    function getConn(ms) {
        if (conn) return Promise.resolve(conn);
        if (!connP) {
            const gen = connGen;
            // connP чистим, только если это всё ещё наше открытие: после dbClose() опоздавшее не должно затереть новое
            const p = openRaw(true, ms).then((c) => {
                if (connP === p) connP = null;
                if (gen !== connGen) { closeQuiet(c); throw fail('closed'); }
                if (conn && conn !== c) { closeQuiet(c); return conn; }   // уже есть рабочее — второе не держим
                const close0 = c.onversionchange;
                c.onversionchange = () => { if (conn === c) conn = null; close0(); };
                c.onclose = () => { if (conn === c) conn = null; };   // браузер закрыл соединение сам (iOS в фоне)
                conn = c;
                return c;
            }, (e) => { if (connP === p) connP = null; throw e; });
            connP = p;
        }
        return connP;
    }
    // Один вызов: общий тайм-аут 3 с; InvalidStateError/UnknownError — переоткрыть и повторить один раз
    async function dbCall(stores, mode, body) {
        for (const s of stores) if (STORES.indexOf(s) < 0) throw fail('store', String(s));
        const deadline = Date.now() + DB_MS;
        for (let attempt = 0; ; attempt++) {
            const left = deadline - Date.now();
            if (left <= 0) throw fail('timeout');
            const h = {};
            try {
                return await timeout((async () => { h.c = await getConn(left); return txDo(h.c, stores, mode, body, h); })(), left,
                    () => { if (h.tx) { try { h.tx.abort(); } catch (_) { /* пусто */ } } dropConn(h.c); });
            } catch (e) {
                const name = e && e.name;
                if (attempt === 0 && (name === 'InvalidStateError' || name === 'UnknownError')) { dropConn(h.c); continue; }
                throw e;
            }
        }
    }
    const keyOk = (key) => { if (typeof key !== 'string' || !key) throw fail('key'); return key; };
    function dbClose() { connGen++; const c = conn; conn = null; connP = null; closeQuiet(c); }
    function deleteDb(ms) {
        return new Promise((resolve) => {
            let done = false, timer = null;
            const fin = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
            timer = setTimeout(() => fin(false), ms);
            let r;
            try { r = idbFactory().deleteDatabase(DB_NAME); } catch (_) { fin(false); return; }
            r.onsuccess = () => fin(true);
            r.onerror = () => fin(false);
            r.onblocked = () => { /* ждём до тайм-аута; удаление само завершится, когда чужие соединения закроются */ };
        });
    }
    // Стирание (§3.8): закрыть своё соединение → новое соединение, очистить все хранилища одной транзакцией → deleteDatabase (≤2 с).
    // Флаг незавершённого стирания и метку сессии ставит app.js. Итог: {cleared, deleted}; стёрто, если хоть одно true.
    async function wipe() {
        keyCache = new WeakMap();   // §3.8 «очистить память»: выведенные ключи чатов тоже
        dbClose();
        let cleared = false, deleted = false;
        try {
            const c = await openRaw(true, DB_MS), h = {};
            try {
                await timeout(txDo(c, STORES.slice(), 'readwrite', (tx) => { for (const s of STORES) tx.objectStore(s).clear(); }, h), DB_MS,
                    () => { if (h.tx) { try { h.tx.abort(); } catch (_) { /* пусто */ } } });
                cleared = true;
            } finally { closeQuiet(c); }
        } catch (_) { /* пусто */ }
        try { deleted = await deleteDb(WIPE_DEL_MS); } catch (_) { /* пусто */ }
        return { cleared, deleted };
    }
    const db = Object.freeze({
        open: async () => { await timeout(getConn(DB_MS), DB_MS); return true; },
        get: (store, key) => dbCall([store], 'readonly', (tx, set) => { const r = tx.objectStore(store).get(keyOk(key)); r.onsuccess = () => set(r.result); }),
        // → Map(ключ → запись): у keys/peers ключ записи не лежит внутри неё («me», «old:{kid}», «pending:{kid}»)
        getAll: (store) => dbCall([store], 'readonly', (tx, set) => {
            const os = tx.objectStore(store), rk = os.getAllKeys(), rv = os.getAll();
            rv.onsuccess = () => { const m = new Map(), ks = rk.result || [], vs = rv.result || []; for (let i = 0; i < ks.length; i++) m.set(ks[i], vs[i]); set(m); };
        }),
        put: (store, key, value) => dbCall([store], 'readwrite', (tx) => { tx.objectStore(store).put(value, keyOk(key)); }).then(() => undefined),
        del: (store, key) => dbCall([store], 'readwrite', (tx) => { tx.objectStore(store).delete(keyOk(key)); }).then(() => undefined),
        clearAll: () => dbCall(STORES.slice(), 'readwrite', (tx) => { for (const s of STORES) tx.objectStore(s).clear(); }).then(() => undefined),
        wipe,
        close: dbClose
    });

    // ───── Push в SW (§6.2): расшифровать превью; любая ошибка → null (покажется запасной текст Worker'а) ─────
    async function idbReader() {
        const c = await openRaw(false, PUSH_IDB_MS);
        return {
            get: (store, key) => timeout(txDo(c, [store], 'readonly', (tx, set) => { const r = tx.objectStore(store).get(key); r.onsuccess = () => set(r.result); }), PUSH_IDB_MS),
            close: () => closeQuiet(c)
        };
    }
    function trService(s, l) {
        const w = typeof l === 'string' && own(PV_WORDS, l) ? PV_WORDS[l] : null;
        if (!w) return s;
        for (const [pre, ru] of PV_SERVICE) if (s === pre + ru) return pre + w[ru];
        return s;
    }
    // Ключ второй стороны для push — только ДОВЕРЕННЫЙ ТЕКУЩИЙ (правило e2ePeerPub/e2eOldPeerOk из app.js по тому, что есть в IndexedDB, без сети):
    // в Гнезде — свой ключ (keys/me или old:{sk}); в личке — только закреплённый ключ собеседника: pins/{from}.kid === sk и pkHash(pk) === pin.h.
    // pk берётся из peers/{from|sk} или из e.pk, но лишь как байты — доверие даёт совпадение с pin (src записи peers не важен).
    // Иначе null (покажется запасной «🔒 Новое сообщение»): прежний ключ собеседника (прежний «cur», prev-pin, prev-nopin, pin.prevH),
    // ключ без закрепления и e.pk, не совпавший с закреплённым. app.js принимает прежние ключи лишь для переписки ДО смены (время смены
    // знает только сервер) и ставит в пузыре ⚠ — в уведомлении такой пометки нет, а подложенный в prev ключ показал бы «его» текст как настоящий.
    async function trustedPub(rd, e, parts, me, uid) {
        if (parts[0] === parts[1]) {   // Гнездо: обе стороны — свои ключи; e.pk и peers не нужны
            const own = (me && me.kid === e.sk) ? me : await rd.get('keys', 'old:' + e.sk);
            return own && own.uid === uid && own.kid === e.sk && re(PK_RE, own.pub) && await kidOf(own.pub) === e.sk ? own.pub : null;
        }
        const [pin, rec] = await Promise.all([rd.get('pins', e.from), rd.get('peers', e.from + '|' + e.sk)]);
        if (!pin || typeof pin !== 'object' || pin.kid !== e.sk || !re(B43_RE, pin.h) || pin.h.slice(0, 12) !== e.sk) return null;
        const cands = [rec && typeof rec === 'object' && rec.uid === e.from && rec.kid === e.sk ? rec.pk : null, e.pk];
        for (const pk of cands) if (re(PK_RE, pk) && await pkHash(pk) === pin.h) return pk;
        return null;
    }
    // deps — только для тестов: {get(store, key)} вместо IndexedDB. Ничего не пишет.
    async function pushPreview(e, chatId, deps) {
        let rd = null;
        try {
            if (!e || typeof e !== 'object' || e.v !== 1) return null;
            const pv = e.pv;
            if (!pv || typeof pv !== 'object' || !re(IV_RE, pv.iv) || !re(PVCT_RE, pv.ct)) return null;
            if (!re(KID_RE, e.sk) || !re(KID_RE, e.rk) || !re(UID_RE, e.from) || !re(SAFE_ID, e.msgId)) return null;
            const parts = dmParts(chatId);
            if (!parts || parts.indexOf(e.from) < 0) return null;
            if (deps && typeof deps.get === 'function') rd = { get: (s, k) => deps.get(s, k), close: () => {} };
            else {
                if (typeof globalThis.indexedDB === 'undefined' || !globalThis.indexedDB) return null;   // iOS: бывает undefined при пробуждении
                rd = await idbReader();
            }
            const ses = await rd.get('prefs', 'session');                 // метка сессии (§3.8): после выхода — молчим
            if (!ses || ses.on !== true || !re(UID_RE, ses.uid)) return null;
            const me = await rd.get('keys', 'me');
            if (me && me.uid !== ses.uid) return null;
            const key = (me && me.kid === e.rk) ? me : await rd.get('keys', 'old:' + e.rk);
            if (!key || key.uid !== ses.uid || key.kid !== e.rk || !key.priv) return null;
            if (parts.indexOf(key.uid) < 0) return null;
            if (e.from === key.uid && parts[0] !== parts[1]) return null;
            const pk = await trustedPub(rd, e, parts, me, ses.uid);   // не текущий/недоверенный ключ второй стороны → null
            if (!pk) return null;
            const keys = await chatKeys(key.priv, pk, chatId, e.rk, e.sk);
            let txt = await decryptPreview(keys, { chatId, uid: e.from, msgId: e.msgId }, pv);
            txt = trService(txt, e.l).replace(/\s+/g, ' ').trim();
            txt = Array.from(txt).slice(0, 140).join('');
            return txt || null;
        } catch (_) {
            return null;
        } finally {
            if (rd) rd.close();
        }
    }

    globalThis.OwlE2E = Object.freeze({
        PH, MAX_PV, PV_BYTES, PV_CT_LEN, PV_WORDS,
        b64u, unb64u, b64, unb64,
        kidOf, pkHash,
        generateIdentity, importPriv, pubFromJwk, importPub, selfTest,
        newSecret, formatSecret, parseSecret,
        sealVault, openVault,
        escrowSeal, escrowOpen,
        chatKeys, previewOf, pack, unpack,
        encryptMsg, decryptMsg, decryptPreview,
        fingerprint,
        db,
        pushPreview
    });
})();
