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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// اختيار نماذج قوية وسريعة من OpenRouter
const MODEL_DEEP = "anthropic/claude-3.5-sonnet";   // تفكير عميق / برمجة معقدة
const MODEL_FAST = "openai/gpt-4o-mini";            // ردود سريعة وبسيطة
const MAX_HISTORY_MESSAGES = 20;                     // حد أقصى لعدد الرسائل المحفوظة في السياق
const MAX_RETRIES = 2;                               // عدد محاولات إعادة الاتصال عند الفشل

if (!OPENROUTER_API_KEY) {
    console.warn("⚠️ [تحذير]: OPENROUTER_API_KEY غير موجود في ملف .env! يرجى إضافته ليعمل الذكاء الاصطناعي.");
}

if (!MONGO_URI) {
    console.warn("⚠️ [تحذير]: MONGO_URI غير موجود في ملف .env أو متغيرات Railway!");
} else {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
      .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// تصميم شكل بيانات المستخدم ومحادثاته (User Schema & Model)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }, // مخزّنة بصيغة hash (bcrypt) وليست نصاً صريحاً
    chats: [{ role: String, content: String, timestamp: { type: Date, default: Date.now } }]
});

const User = mongoose.model('User', userSchema);

// ==========================================
// 2. MIDDLEWARES & SECURITY
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// تقديم الملفات الاستاتيكية من المجلد الرئيسي
app.use(express.static(path.join(__dirname, '../')));

// حماية بسيطة للحد من الطلبات المكثفة (In-Memory Rate Limiter)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // نافذة 1 دقيقة
const MAX_REQUESTS_PER_WINDOW = 30;     // أقصى حد 30 طلب في الدقيقة لكل IP

// تنظيف دوري لمنع تسرب الذاكرة
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
1. فكّك الطلب: حدد بدقة ما يريده المستخدم فعلياً، حتى لو صاغه بشكل غير مكتمل أو فيه أخطاء إملائية.
2. اجمع الافتراضات: إذا كانت هناك تفاصيل ناقصة وضرورية جداً لإتمام الحل بشكل صحيح، اذكر أقرب افتراض منطقي وامضِ في الحل فوراً — لا تتوقف لتسأل إلا إذا كان الأمر غامضاً جداً بشكل يمنع أي تقدّم.
3. خطط قبل أن تكتب: فكّر في الحالات الحدّية (edge cases)، الأخطاء المحتملة، والأداء، قبل كتابة أي سطر كود.
4. تحقق من نفسك: بعد كتابة الحل، راجعه ذهنياً كأنك تدقق كود شخص آخر — هل يعمل من أول تشغيل؟ هل يفوّت أي حالة؟
5. اشرح باختصار بعد الكود فقط عند الحاجة: ما الذي فعلته وأين يوضع، بدون حشو.`;

    if (domain === "roblox") {
        return `أنت MMR-AI، مطور Roblox Luau خبير على مستوى الإنتاج الحقيقي (production-grade)، بأسلوب دافئ وودود ("ابشر يا قلبي"، "تفضل يا الغالي") لكن بدون أي مبالغة تصرف عن الجوهر التقني.
${shared}

قواعدك البرمجية في Luau:
- استخدم \`--!strict\` عند الإمكان، وتحقق من الأنواع (types) بدل الاعتماد على التخمين.
- الأمان أولاً: أي RemoteEvent/RemoteFunction يجب أن يُتحقق من مدخلاته على السيرفر بشكل كامل (لا تثق أبداً بالعميل).
- الأداء: تجنب حلقات لا نهائية بدون \`task.wait\`، استخدم \`task.spawn\`/\`task.defer\` بدل \`spawn\`/\`wait\` القديمة، وانتبه لتسريبات الذاكرة (تنظيف الاتصالات \`:Disconnect()\` عند الحاجة).
- التنظيم: اذكر بدقة أين يوضع كل سكربت (ServerScriptService, StarterPlayerScripts, ReplicatedStorage...) ولماذا هناك تحديداً.
- الكود دائماً كامل 100%، بدون "-- اكمل هنا" وبدون حذف أي جزء، جاهز للتشغيل الفوري.`;
    }

    if (domain === "web") {
        return `أنت MMR-AI، مهندس Full-Stack خبير (JavaScript/TypeScript, React, Node.js, Python, SQL وغيرها)، بأسلوب دافئ ومباشر ("ابشر يا غالي") بدون حشو.
${shared}

قواعدك البرمجية:
- أعطِ الحل الأصح هندسياً لا فقط الأسرع كتابةً؛ اذكر إن وُجد خيار بديل أفضل للأداء أو الأمان.
- انتبه دائماً لثغرات الأمان الشائعة (XSS, SQL Injection, كشف بيانات حساسة، عدم تحقق من المدخلات) وعالجها ضمن الكود نفسه دون أن يُطلب منك.
- الكود كامل، منسّق، وجاهز للنسخ والتشغيل مباشرة — بدون اختصارات أو "...".
- إذا كان الطلب فيه غموض تقني حقيقي يغيّر الحل جذرياً، اسأل سؤالاً واحداً دقيقاً بدل التخمين.`;
    }

    return `أنت MMR-AI، مساعد ذكي وموسوعي، ودود جداً ("ابشر"، "يا قلبي") وفي نفس الوقت دقيق ومباشر في المحتوى.
${shared}
لست مضطراً لكتابة كود في كل رد — فقط عندما يخدم الطلب فعلاً. في الأسئلة العامة، كن واضحاً، صادقاً، ولا تخمّن معلومات لا تعرفها بثقة زائفة.`;
}

// ==========================================
// 4. OPENROUTER CALL HELPER (مع إعادة محاولة + fallback)
// ==========================================
async function callOpenRouter(messages, model, { stream = false } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000", // اختيارية لتوثيق موقعك في OpenRouter
                    "X-Title": "MMR-AI"
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.4,
                    max_tokens: 4096,
                    stream
                })
            });

            if (stream) return response;

            const data = await response.json();

            if (!response.ok) {
                if (model === MODEL_DEEP && attempt === MAX_RETRIES) {
                    console.warn("⚠️ [Fallback]: التحويل إلى النموذج السريع بعد فشل النموذج العميق.");
                    return callOpenRouter(messages, MODEL_FAST, { stream: false });
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

    return { ok: false, error: lastError || "فشل الاتصال بخدمة OpenRouter بعد عدة محاولات." };
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
// 5. API ROUTES — AUTH (كلمات مرور مشفّرة)
// ==========================================
const SALT_ROUNDS = 10;

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        }
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم موجود مسبقاً' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = new User({ username, password: hashedPassword, chats: [] });
        await newUser.save();

        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح', username });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        }

        const user = await User.findOne({ username });
        const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;

        if (!user || !passwordMatches) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        res.json({ success: true, message: 'تم تسجيل الدخول بنجاح', username, chats: user.chats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/chats/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }
        res.json({ success: true, chats: user.chats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../ai.html'));
});

app.get('/api/health', (req, res) => {
    res.json({
        status: "online",
        system: "MMR-AI Backend (OpenRouter)",
        models: { deep: MODEL_DEEP, fast: MODEL_FAST },
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// 6. API ROUTES — CHAT (مع توجيه ذكي للنموذج)
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], systemPrompt, username } = req.body;

        if (!message && (!history || history.length === 0)) {
            return res.status(400).json({ error: "يرجى إرسال رسالة أو محادثة صحيحة." });
        }

        const { domain, model } = classifyTask(systemPrompt, message);
        const messages = buildMessages(systemPrompt, message, history, domain);

        const result = await callOpenRouter(messages, model);

        if (!result.ok) {
            console.error("❌ [OpenRouter Error]:", result.error);
            return res.status(502).json({ error: result.error || "حدث خطأ في الاتصال بسيرفر OpenRouter API" });
        }

        const reply = result.data.choices[0]?.message?.content || "لم يتم استلام رد من النموذج.";

        if (username) {
            await User.findOneAndUpdate(
                { username },
                {
                    $push: {
                        chats: {
                            $each: [
                                { role: 'user', content: message },
                                { role: 'assistant', content: reply }
                            ]
                        }
                    }
                }
            );
        }

        res.json({ reply, domain, model });

    } catch (error) {
        console.error("💥 [Server Error]:", error);
        res.status(500).json({ error: "حدث خطأ في السيرفر الداخلي" });
    }
});

// مسار البث الحي (Streaming API - SSE)
app.post('/api/chat/stream', async (req, res) => {
    try {
        const { message, history = [], systemPrompt } = req.body;
        const { domain, model } = classifyTask(systemPrompt, message);
        const messages = buildMessages(systemPrompt, message, history, domain);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const response = await callOpenRouter(messages, model, { stream: true });

        if (!response.ok) {
            res.write(`data: ${JSON.stringify({ error: "خطأ في الاتصال بالخدمة" })}\n\n`);
            return res.end();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
        }

        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        console.error("💥 [Stream Error]:", error);
        res.write(`data: ${JSON.stringify({ error: "حدث خطأ أثناء بث البيانات" })}\n\n`);
        res.end();
    }
});

// ==========================================
// 7. SERVER LAUNCH & CATCH-ALLS
// ==========================================

app.use((req, res) => {
    res.status(404).json({ error: "المسار المطلوب غير موجود 404" });
});

const server = app.listen(PORT, () => {
    console.log(`
===================================================
🚀 MMR-AI Backend v5.0 (OpenRouter + Secure Auth)
🌐 Local URL: http://localhost:${PORT}
⚡ API Stream: http://localhost:${PORT}/api/chat/stream
🧠 Deep model: ${MODEL_DEEP}
⚡ Fast model: ${MODEL_FAST}
===================================================
    `);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing HTTP server gracefully...');
    server.close(() => {
        console.log('HTTP server closed.');
    });
});