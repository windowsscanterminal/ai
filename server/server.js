require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ==========================================
// 1. INITIALIZATION & CONFIGURATION
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const XAI_API_KEY = process.env.XAI_API_KEY; // تم تصحيح اسم المتغير ليطابق xAI
const MONGO_URI = process.env.MONGO_URI;

const MODEL_DEEP = "grok-beta"; 
const MODEL_FAST = "grok-beta";
const MAX_HISTORY_MESSAGES = 20;
const MAX_RETRIES = 2;

if (!XAI_API_KEY) {
    console.warn("⚠️ [تحذير]: XAI_API_KEY غير موجود في متغيرات البيئة!");
}

if (!MONGO_URI) {
    console.warn("⚠️ [تحذير]: MONGO_URI غير موجود!");
} else {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
      .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }, 
    chats: [{ role: String, content: String, timestamp: { type: Date, default: Date.now } }]
});

const User = mongoose.model('User', userSchema);

// ==========================================
// 2. MIDDLEWARES & SECURITY
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../')));

const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requestCounts.entries()) {
        if (now - data.startTime > RATE_LIMIT_WINDOW_MS) requestCounts.delete(ip);
    }
}, 5 * 60 * 1000);

const rateLimiter = (req, res, next) => {
    const userIp = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
    const currentTime = Date.now();

    if (!requestCounts.has(userIp)) {
        requestCounts.set(userIp, { count: 1, startTime: currentTime });
        return next();
    }

    const userData = requestCounts.get(userIp);
    if (currentTime - userData.startTime > RATE_LIMIT_WINDOW_MS) {
        userData.count = 1;
        userData.startTime = currentTime;
        return next();
    }

    if (userData.count >= MAX_REQUESTS_PER_WINDOW) {
        return res.status(429).json({ error: "⚠️ تم تجاوز عدد الطلبات المسموح بها!" });
    }

    userData.count++;
    next();
};

app.use('/api/', rateLimiter);

// ==========================================
// 3. SYSTEM PROMPTS ENGINE + MODEL ROUTER
// ==========================================
function classifyTask(systemPrompt, userMessage = "") {
    const text = typeof userMessage === "string" ? userMessage.toLowerCase() : "";
    const robloxKeywords = ["roblox", "luau", "remoteevent", "remotefunction", "datastoreservice", "replicatedstorage"];
    const webKeywords = ["html", "css", "javascript", "js", "react", "tailwind", "api", "backend", "node", "express", "sql", "python", "بايثون", "كود", "سكربت", "برمجة", "دالة", "function", "بق", "bug", "error"];

    const isRoblox = systemPrompt === "roblox" || robloxKeywords.some(k => text.includes(k));
    const isWeb = systemPrompt === "web" || webKeywords.some(k => text.includes(k));
    const isDeepTask = isRoblox || isWeb || text.length > 220;

    return {
        domain: isRoblox ? "roblox" : (isWeb ? "web" : "general"),
        model: isDeepTask ? MODEL_DEEP : MODEL_FAST
    };
}

function getSystemInstruction(domain) {
    const shared = `
منهجك في حل أي مسألة:
1. فكّك الطلب بدقة.
2. ضع افتراضات منطقية واستمر في الحل فوراً.
3. خطط للأداء والأمان قبل كتابة الكود.
4. تأكد أن الكود يعمل من أول تشغيل.
5. اشرح باختصار بعد الكود عند الحاجة.`;

    if (domain === "roblox") {
        return `أنت MMR-AI، مطور Roblox Luau خبير بأسلوب دافئ وودود ("ابشر يا قلبي"، "تفضل يا الغالي").\n${shared}`;
    }
    if (domain === "web") {
        return `أنت MMR-AI، مهندس Full-Stack خبير بأسلوب دافئ ("ابشر يا غالي").\n${shared}`;
    }
    return `أنت MMR-AI، مساعد ذكي وودود جداً ("ابشر"، "يا قلبي").\n${shared}`;
}

function trimHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-MAX_HISTORY_MESSAGES);
}

function buildMessages(systemPrompt, message, history, domain) {
    const messages = [{ role: "system", content: getSystemInstruction(domain) }];

    trimHistory(history).forEach(msg => {
        if (msg.role && msg.content) {
            messages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        }
    });

    if (message) messages.push({ role: "user", content: message });
    return messages;
}

// ==========================================
// 4. xAI (Grok) API CALL HELPER
// ==========================================
async function callXAI(messages, model) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch("https://api.x.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${XAI_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "grok-2-latest", // <-- تم التعديل هنا ليتوافق مع المعيار الحالي
                    messages,
                    temperature: 0.4,
                    max_tokens: 4096
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // سيطبع لك السبب الدقيق للخطأ 400 في الـ terminal عندك
                console.error("❌ xAI Error Details:", JSON.stringify(data, null, 2));
                lastError = data.error?.message || `HTTP ${response.status}`;
                await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
                continue;
            }

            return { ok: true, data };
        } catch (err) {
                    lastError = err.message;
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
    }

    return { ok: false, error: lastError || "فشل الاتصال بخدمة xAI." };
}
// ==========================================
// 5. API ROUTES — AUTH
// ==========================================
const SALT_ROUNDS = 10;

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, error: 'البيانات ناقصة' });
        
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, error: 'المستخدم موجود' });

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = new User({ username, password: hashedPassword, chats: [] });
        await newUser.save();
        res.json({ success: true, message: 'تم الإنشاء', username });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        const isMatch = user ? await bcrypt.compare(password, user.password) : false;

        if (!user || !isMatch) return res.status(400).json({ success: false, error: 'بيانات غير صحيحة' });
        res.json({ success: true, username, chats: user.chats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/chats/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ success: false, error: 'غير موجود' });
        res.json({ success: true, chats: user.chats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../ai.html')));

app.get('/api/health', (req, res) => {
    res.json({
        status: "online",
        system: "MMR-AI Backend (xAI Grok API)",
        models: { deep: MODEL_DEEP, fast: MODEL_FAST }
    });
});

// ==========================================
// 6. API ROUTES — CHAT
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], systemPrompt, username } = req.body;

        if (!message && (!history || history.length === 0)) {
            return res.status(400).json({ error: "يرجى إرسال رسالة." });
        }

        const { domain, model } = classifyTask(systemPrompt, message);
        const messages = buildMessages(systemPrompt, message, history, domain);

        const result = await callXAI(messages, model);

        if (!result.ok) {
            console.error("❌ [xAI Error]:", result.error);
            return res.status(502).json({ error: result.error });
        }

        const reply = result.data.choices[0]?.message?.content || "لم يتم استلام رد.";

        if (username) {
            await User.findOneAndUpdate(
                { username },
                {
                    $push: {
                        chats: { $each: [{ role: 'user', content: message }, { role: 'assistant', content: reply }] }
                    }
                }
            );
        }

        res.json({ reply, domain, model });

    } catch (error) {
        console.error("💥 [Server Error]:", error);
        res.status(500).json({ error: "خطأ داخلي" });
    }
});

// ==========================================
// 7. SERVER LAUNCH
// ==========================================
app.use((req, res) => res.status(404).json({ error: "المسار غير موجود 404" }));

const server = app.listen(PORT, () => {
    console.log(`
===================================================
🚀 MMR-AI Backend v6.2 (xAI Grok API + Auth)
🌐 Local URL: http://localhost:${PORT}
🧠 Model: grok-beta
===================================================
    `);
});

process.on('SIGTERM', () => server.close(() => console.log('HTTP server closed.')));
