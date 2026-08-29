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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// اختيار نماذج قوية وسريعة من Google Gemini
const MODEL_DEEP = "gemini-1.5-pro";     // تفكير عميق / برمجة معقدة
const MODEL_FAST = "gemini-1.5-flash";   // ردود سريعة وبسيطة
const MAX_HISTORY_MESSAGES = 20;         // حد أقصى لعدد الرسائل المحفوظة في السياق
const MAX_RETRIES = 2;                   // عدد محاولات إعادة الاتصال عند الفشل

if (!GEMINI_API_KEY) {
    console.warn("⚠️ [تحذير]: GEMINI_API_KEY غير موجود في متغيرات البيئة! يرجى إضافته ليعمل الذكاء الاصطناعي.");
}

if (!MONGO_URI) {
    console.warn("⚠️ [تحذير]: MONGO_URI غير موجود في ملف .env أو متغيرات Railway!");
} else {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
      .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// تصميم شكل بيانات المستخدم ومحادثاته
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

// حماية بسيطة للحد من الطلبات المكثفة
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // نافذة 1 دقيقة
const MAX_REQUESTS_PER_WINDOW = 30;     // أقصى حد 30 طلب

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
        return res.status(429).json({
            error: "⚠️ تم تجاوز عدد الطلبات المسموح بها! يرجى الانتظار قليلاً ثم المحاولة."
        });
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
منهجك في حل أي مسألة (اتبعه دائماً بصمت قبل الرد):
1. فكّك الطلب: حدد بدقة ما يريده المستخدم فعلياً.
2. اجمع الافتراضات: إذا كانت هناك تفاصيل ناقصة اذكر أقرب افتراض منطقي وامضِ في الحل.
3. خطط قبل أن تكتب: فكّر في الأخطاء المحتملة والأداء.
4. تحقق من نفسك: هل يعمل الكود من أول تشغيل؟
5. اشرح باختصار بعد الكود فقط عند الحاجة.`;

    if (domain === "roblox") {
        return `أنت MMR-AI، مطور Roblox Luau خبير بأسلوب دافئ وودود ("ابشر يا قلبي"، "تفضل يا الغالي").\n${shared}\nقواعدك: استخدم --!strict، الأمان أولاً، وتجنب حلقات لا نهائية.`;
    }
    if (domain === "web") {
        return `أنت MMR-AI، مهندس Full-Stack خبير بأسلوب دافئ ("ابشر يا غالي").\n${shared}\nقواعدك: أعطِ الحل الأصح هندسياً وانتبه لثغرات الأمان.`;
    }
    return `أنت MMR-AI، مساعد ذكي وودود جداً ("ابشر"، "يا قلبي").\n${shared}`;
}

function trimHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-MAX_HISTORY_MESSAGES);
}

// بناء هيكل البيانات المخصص لـ Gemini API
function buildGeminiPayload(systemPrompt, message, history, domain) {
    const systemInstruction = getSystemInstruction(domain);
    const contents = [];

    trimHistory(history).forEach(msg => {
        if (msg.role && msg.content) {
            contents.push({
                role: msg.role === 'user' ? 'user' : 'model', // Gemini يستخدم model بدل assistant
                parts: [{ text: msg.content }]
            });
        }
    });

    if (message) {
        contents.push({
            role: "user",
            parts: [{ text: message }]
        });
    }

    return {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
    };
}

// ==========================================
// 4. GEMINI API CALL HELPER
// ==========================================
async function callGemini(payload, model, { stream = false } = {}) {
    let lastError = null;
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
    const endpoint = stream ? `${baseUrl}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}` : `${baseUrl}:generateContent?key=${GEMINI_API_KEY}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (stream) return response;

            const data = await response.json();

            if (!response.ok) {
                if (model === MODEL_DEEP && attempt === MAX_RETRIES) {
                    console.warn("⚠️ [Fallback]: التحويل إلى النموذج السريع بعد الفشل.");
                    return callGemini(payload, MODEL_FAST, { stream: false });
                }
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

    return { ok: false, error: lastError || "فشل الاتصال بخدمة Gemini." };
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
        system: "MMR-AI Backend (Gemini API)",
        models: { deep: MODEL_DEEP, fast: MODEL_FAST }
    });
});

// ==========================================
// 6. API ROUTES — CHAT (GEMINI ROUTING)
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], systemPrompt, username } = req.body;

        if (!message && (!history || history.length === 0)) {
            return res.status(400).json({ error: "يرجى إرسال رسالة." });
        }

        const { domain, model } = classifyTask(systemPrompt, message);
        const payload = buildGeminiPayload(systemPrompt, message, history, domain);

        const result = await callGemini(payload, model);

        if (!result.ok) {
            console.error("❌ [Gemini Error]:", result.error);
            return res.status(502).json({ error: result.error });
        }

        // استخراج النص من استجابة Gemini
        const reply = result.data.candidates?.[0]?.content?.parts?.[0]?.text || "لم يتم استلام رد.";

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

// مسار البث الحي (Streaming)
app.post('/api/chat/stream', async (req, res) => {
    try {
        const { message, history = [], systemPrompt } = req.body;
        const { domain, model } = classifyTask(systemPrompt, message);
        const payload = buildGeminiPayload(systemPrompt, message, history, domain);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const response = await callGemini(payload, model, { stream: true });

        if (!response.ok) {
            res.write(`data: ${JSON.stringify({ error: "خطأ في الاتصال بالخدمة" })}\n\n`);
            return res.end();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }
        res.end();

    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: "حدث خطأ" })}\n\n`);
        res.end();
    }
});

// ==========================================
// 7. SERVER LAUNCH
// ==========================================
app.use((req, res) => res.status(404).json({ error: "المسار غير موجود 404" }));

const server = app.listen(PORT, () => {
    console.log(`
===================================================
🚀 MMR-AI Backend v5.1 (Google Gemini API + Auth)
🌐 Local URL: http://localhost:${PORT}
🧠 Deep model: ${MODEL_DEEP}
⚡ Fast model: ${MODEL_FAST}
===================================================
    `);
});

process.on('SIGTERM', () => server.close(() => console.log('HTTP server closed.')));
