const originalConsoleLog = console.log;
console.error = function () {}; 
console.warn = function () {};

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const app = express();

const MY_NUMBER = "967733556980@s.whatsapp.net";
const LAST_FILE = './last_message.json';

let CHANNELS_CONFIG = [
  { code: "0029Vb9FZTa9sBIHN33KUP0O", name: "مشجعين", jid: null },
  { code: "0029Vb7YjwX72WU3T0isLp45", name: "شقادف", jid: null },
  { code: "0029VbBngWE89inrqmF5vk0i", name: "شخصية", jid: null },
  { code: "0029VbDVm2N1Hsq0Ay38AQ18", name: "ريماس", jid: null }
];

// تحميل آخر أرقام مرصودة لمنع تكرارها عند إعادة التشغيل
let LAST = {};
if (fs.existsSync(LAST_FILE)) {
    try { LAST = JSON.parse(fs.readFileSync(LAST_FILE)); } catch (e) {}
}

function saveLast() {
    try { fs.writeFileSync(LAST_FILE, JSON.stringify(LAST)); } catch (e) {}
}

let sock = null;
let isConnectedOnce = false;

// طابور إرسال ذكي لمنع حظر واتساب ورمز 428
let messageQueue = [];
let isSending = false;

async function processQueue() {
    if (isSending || messageQueue.length === 0) return;
    isSending = true;
    
    let link = messageQueue.shift();
    try {
        if (sock) {
            await sock.sendMessage(MY_NUMBER, { text: `.chreact ${link}` });
            // تأخير زمني 1.5 ثانية بين كل رسالة وأخرى لحماية الاتصال من الانفجار
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    } catch (e) {
    } finally {
        isSending = false;
        processQueue();
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const logger = pino({ level: 'silent' });
    logger.child = () => logger;
    
    sock = makeWASocket({ 
        version, 
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        }, 
        logger, 
        browser: Browsers.ubuntu('Chrome'), 
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        syncFullHistory: false,
        getMessage: async (key) => { return { conversation: '' }; }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (u) => {
        if (u.qr) qrcode.generate(u.qr, { small: true });
        
        if (u.connection === 'open') {
            originalConsoleLog("✅ البوت متصل بالواتساب الآن...");
            
            if (!isConnectedOnce) {
                isConnectedOnce = true;
                for(let ch of CHANNELS_CONFIG) {
                    try {
                        let meta = await sock.newsletterMetadata("invite", ch.code);
                        if(meta && meta.id) {
                            ch.jid = meta.id;
                            await sock.newsletterFollow(meta.id).catch(()=>{});
                            originalConsoleLog(`🔗 [تم الارتباط الحقيقي] بالقناة: ${ch.name}`);
                        }
                    } catch(e) {}
                }
            }
        }
        
        if (u.connection === 'close') {
            isConnectedOnce = false;
            const statusCode = u.lastDisconnect?.error?.output?.statusCode;
            originalConsoleLog(`⚠️ انقطع الاتصال الحقيقي (رمز: ${statusCode}). جارٍ إعادة التهيئة الفورية...`);
            
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !m.messages[0]) return;
        let msg = m.messages[0];

        try {
            let jid = msg?.key?.remoteJid;
            if (!jid || !jid.endsWith('@newsletter')) return;
            
            let num = parseInt(msg.newsletterServerId || msg.key.server_id);
            if (isNaN(num)) return;

            let targetChannel = CHANNELS_CONFIG.find(c => c.jid === jid);
            if (!targetChannel) return;

            if (!LAST[jid]) LAST[jid] = num - 1;
            if (num <= LAST[jid]) return;
            LAST[jid] = num;
            saveLast(); // حفظ الفهرس فوراً في الملف لضمان عدم تكراره أبداً

            let link = `https://whatsapp.com/channel/${targetChannel.code}/${num}`;
            
            originalConsoleLog(`🔥 [رصد حقيقي ونشط] في [${targetChannel.name}] -> ${link}`);
            
            // وضع الرابط في طابور الإرسال المنظم لتجنب رمز 428
            messageQueue.push(link);
            processQueue();

        } catch(e) { 
        } finally {
            msg = null;
            m = null;
            if (global.gc) {
                try { global.gc(); } catch (e) {}
            }
        }
    });
}

app.get('/', (req, res) => res.send("ULTRA STABLE BOT ONLINE"));
app.listen(process.env.PORT || 3000, () => originalConsoleLog("Server Ready"));

startBot();


