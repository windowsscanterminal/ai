/*==================================================
 MMR-AI V4 Pro - Main Script (Full & Optimized)
==================================================*/

/*==============================
 MARKDOWN & HIGHLIGHT CONFIG
==============================*/
if (window.marked && window.hljs) {
    marked.setOptions({
        highlight: function (code, lang) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        },
        langPrefix: 'hljs language-'
    });
}

/*==============================
 ELEMENTS & HELPER SELECTOR
==============================*/
const getEl = (id) => document.getElementById(id);

const message = getEl("message");
const send = getEl("send");
const stopGenerating = getEl("stopGenerating");
const stopThinking = getEl("stopThinking");
const chatMessages = getEl("chatMessages");
const historyList = getEl("historyList");
const previewBox = getEl("previewBox");

const imageInput = getEl("imageInput");
const fileInput = getEl("fileInput");

const uploadImage = getEl("uploadImage");
const uploadFile = getEl("uploadFile");
const voice = getEl("voice");

const thinkingBox = getEl("thinkingBox");
const charCount = getEl("charCount");

const toast = getEl("toast");
const toastText = getEl("toastText");

/*==============================
 حالة التوليد الحالية (للإيقاف)
==============================*/
let activeAbortController = null;
let isGenerating = false;
let stopRequested = false;

function setGeneratingState(active) {
    isGenerating = active;
    if (!active) stopRequested = false;

    if (send) send.classList.toggle("hidden", active);
    if (stopGenerating) stopGenerating.classList.toggle("hidden", !active);
}

function stopCurrentGeneration() {
    if (!isGenerating) return;
    stopRequested = true;
    if (activeAbortController) {
        activeAbortController.abort();
    }
    hideThinking();
    showToast("⏹️ تم إيقاف التوليد");
}

if (stopGenerating) stopGenerating.addEventListener("click", stopCurrentGeneration);
if (stopThinking) stopThinking.addEventListener("click", stopCurrentGeneration);

/*==============================
 زر النزول الذكي لآخر الرسائل
==============================*/
const scrollToBottomBtn = getEl("scrollToBottom");
let userScrolledUp = false;

if (chatMessages && scrollToBottomBtn) {
    chatMessages.addEventListener("scroll", () => {
        const distanceFromBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
        userScrolledUp = distanceFromBottom > 120;
        scrollToBottomBtn.classList.toggle("hidden", !userScrolledUp);
    });

    scrollToBottomBtn.addEventListener("click", () => {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
        userScrolledUp = false;
        scrollToBottomBtn.classList.add("hidden");
    });
}

// يحترم رغبة المستخدم: لا ينزل تلقائيًا إذا كان قد مرّر للأعلى يقرأ رسالة سابقة
function smartScrollToBottom() {
    if (!chatMessages) return;
    if (!userScrolledUp) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (scrollToBottomBtn) {
        scrollToBottomBtn.classList.remove("hidden");
    }
}

const settings = getEl("settings");
const settingBtn = getEl("settingBtn");
const closeSettings = getEl("closeSettings");

const themeBtn = getEl("themeBtn");
const languageBtn = getEl("languageBtn");

const languageSelect = getEl("language");
const themeSelect = getEl("theme");
const systemPromptSelect = getEl("systemPrompt");

const newChat = getEl("newChat");
const searchChats = getEl("searchChats");
const clearHistory = getEl("clearHistory");

const importJsonInput = getEl("importJsonInput");
const importBackupBtn = getEl("importBackupBtn");
const exportBackupBtn = getEl("exportBackup");
const exportChatBtn = getEl("exportChat");
const clearChatBtn = getEl("clearChat");

const toggleHeroBtn = getEl("toggleHeroBtn");
const heroSection = getEl("heroSection");
const sidebar = getEl("sidebar");
const sidebarToggle = getEl("sidebarToggle");

/*==============================
 DATA & STATE
==============================*/
let chats = [];
let currentChat = 0;

let uploadedImages = [];
let uploadedFiles = [];

let canSend = true;
const SEND_DELAY = 2500;

/*==============================
 MOBILE SIDEBAR TOGGLE
==============================*/
if (sidebarToggle && sidebar) {
    sidebarToggle.onclick = () => {
        sidebar.classList.toggle("show-mobile");
    };
    
    document.addEventListener("click", (e) => {
        if (window.innerWidth <= 850) {
            if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target) && sidebar.classList.contains("show-mobile")) {
                sidebar.classList.remove("show-mobile");
            }
        }
    });
}

/*==============================
 NOTIFICATION SOUND (WEB AUDIO API)
==============================*/
function playNotificationSound() {
    if (!appSettings.sound) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
        console.warn("Audio playback not supported or blocked", e);
    }
}

/*==============================
 TOGGLE HERO SECTION
==============================*/
function setHeroVisibility(hide) {
    if (!heroSection) return;
    if (hide) {
        heroSection.classList.add("hidden");
        if (toggleHeroBtn) {
            toggleHeroBtn.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
            toggleHeroBtn.title = "إظهار قسم الترحيب";
        }
    } else {
        heroSection.classList.remove("hidden");
        if (toggleHeroBtn) {
            toggleHeroBtn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
            toggleHeroBtn.title = "إخفاء قسم الترحيب";
        }
    }
    localStorage.setItem("mmr_hero_hidden", hide ? "true" : "false");
}

if (toggleHeroBtn) {
    toggleHeroBtn.onclick = () => {
        const isHidden = heroSection.classList.contains("hidden");
        setHeroVisibility(!isHidden);
        showToast(isHidden ? "👁️ تم إظهار قسم الترحيب" : "🙈 تم إخفاء قسم الترحيب");
    };
}

if (localStorage.getItem("mmr_hero_hidden") === "true") {
    setHeroVisibility(true);
}

/*==============================
 ATTACH COPY BUTTON TO CODE BLOCKS
==============================*/
function attachCodeCopyButtons(container) {
    if (!container) return;
    const codeBlocks = container.querySelectorAll('pre');
    
    codeBlocks.forEach((pre) => {
        if (pre.querySelector('.code-copy-btn')) return;

        const codeEl = pre.querySelector('code');
        if (codeEl && !pre.querySelector('.code-lang-badge')) {
            const langClass = [...codeEl.classList].find(c => c.startsWith('language-'));
            const langName = langClass ? langClass.replace('language-', '') : (codeEl.className.match(/hljs\s+(\w+)/) || [])[1];
            if (langName) {
                const badge = document.createElement('span');
                badge.className = 'code-lang-badge';
                badge.textContent = langName;
                pre.appendChild(badge);
            }
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> <span>نسخ الكود</span>';
        
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            const codeElement = pre.querySelector('code');
            const textToCopy = codeElement ? codeElement.innerText : pre.innerText;

            navigator.clipboard.writeText(textToCopy).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>تم النسخ!</span>';
                showToast("✅ تم نسخ الكود البرمجي");
                
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> <span>نسخ الكود</span>';
                }, 2000);
            }).catch(() => {
                showToast("❌ تعذر نسخ الكود");
            });
        };

        pre.appendChild(copyBtn);
    });
}

/*==============================
 WELCOME MESSAGES
==============================*/
const welcomes = [
    "👋 كيف أستطيع مساعدتك اليوم؟",
    "🤖 أنا مستعد لأي سؤال.",
    "🚀 ماذا تريد أن نبرمج اليوم؟",
    "💻 هل لديك مشروع تعمل عليه؟",
    "⚡ جاهز لمساعدتك في الأكواد.",
    "📚 اسألني عن البرمجة أو الذكاء الاصطناعي.",
    "🌟 أهلاً بك في MMR-AI."
];

const welcomeEl = getEl("welcomeText");
if (welcomeEl) {
    welcomeEl.textContent = welcomes[Math.floor(Math.random() * welcomes.length)];
}

/*==============================
 TOAST NOTIFICATION
==============================*/
function showToast(text) {
    if (!toast || !toastText) return;
    toastText.textContent = text;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}

/*==============================
 THINKING BOX
==============================*/
function showThinking() {
    if (thinkingBox) thinkingBox.classList.remove("hidden");
}

function hideThinking() {
    if (thinkingBox) thinkingBox.classList.add("hidden");
}

/*==============================
 AUTO RESIZE TEXTAREA
==============================*/
if (message) {
    message.addEventListener("input", () => {
        message.style.height = "60px";
        message.style.height = message.scrollHeight + "px";
        if (charCount) {
            charCount.textContent = message.value.length + " / 5000";
        }
    });

    message.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

if (send) {
    send.onclick = sendMessage;
}

/*==============================
 SEND MESSAGE
==============================*/
function sendMessage() {
    if (!message) return;
    const text = message.value.trim();
    if (text === "") return;

    if (isGenerating) {
        showToast("⏳ يوجد رد قيد التوليد الآن — أوقفه أولاً أو انتظر اكتماله");
        return;
    }

    if (!canSend && appSettings.antiSpam) {
        showToast("⏳ انتظر قليلاً قبل إرسال رسالة جديدة");
        return;
    }

    canSend = false;
    setTimeout(() => {
        canSend = true;
    }, SEND_DELAY);

    addMessage("user", text);

    if (!chats[currentChat]) {
        chats[currentChat] = { name: "محادثة جديدة", pinned: false, messages: [] };
    }

    chats[currentChat].messages.push({
        role: "user",
        text: text,
        time: new Date().toLocaleTimeString()
    });

    if (chats[currentChat].messages.length === 1) {
        chats[currentChat].name = text.substring(0, 20) + "...";
        renderChats();
    }

    saveChats();

    message.value = "";
    message.style.height = "60px";
    if (charCount) charCount.textContent = "0 / 5000";

    showThinking();
    askAI(text);
}

/*==============================
 TEXT-TO-SPEECH
==============================*/
function speakText(text) {
    if (!('speechSynthesis' in window)) {
        showToast("⚠️ المتصفح لا يدعم القراءة الصوتية");
        return;
    }
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/```[\s\S]*?```/g, "كود برمجي").replace(/[#*`]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = appSettings.language === "ar" ? "ar-SA" : "en-US";
    window.speechSynthesis.speak(utterance);
    showToast("🔊 جاري القراءة الصوتية...");
}

/*==============================
 ADD MESSAGE TO DOM
==============================*/
function addMessage(role, rawText) {
    if (!chatMessages) return;

    const box = document.createElement("div");
    box.className = "message " + role;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = role === "user" ? "👤" : "🤖";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (role === "assistant" && window.marked) {
        bubble.innerHTML = marked.parse(rawText);
    } else {
        bubble.innerText = rawText;
    }

    const actionsBar = document.createElement("div");
    actionsBar.className = "actionsBar";
    actionsBar.style.marginTop = "8px";
    actionsBar.style.display = "flex";
    actionsBar.style.gap = "8px";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copyCode";
    copyBtn.innerHTML = "📋 نسخ الرسالة";
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(rawText);
        showToast("✅ تم نسخ الرسالة الكاملة");
    };
    actionsBar.appendChild(copyBtn);

    if (role === "assistant") {
        const speakBtn = document.createElement("button");
        speakBtn.className = "copyCode";
        speakBtn.innerHTML = "🔊 قراءة";
        speakBtn.onclick = () => speakText(rawText);
        actionsBar.appendChild(speakBtn);

        const regenBtn = document.createElement("button");
        regenBtn.className = "copyCode";
        regenBtn.innerHTML = "🔄 إعادة";
        regenBtn.onclick = () => {
            const history = chats[currentChat]?.messages || [];
            const lastUserMsg = [...history].reverse().find(m => m.role === "user");
            if (lastUserMsg) {
                showThinking();
                askAI(lastUserMsg.text);
            }
        };
        actionsBar.appendChild(regenBtn);
    }

    if (role === "user") {
        const editBtn = document.createElement("button");
        editBtn.className = "copyCode";
        editBtn.innerHTML = "✏️ تعديل";
        editBtn.onclick = () => {
            if (message) {
                message.value = rawText;
                message.focus();
                showToast("✏️ يمكنك تعديل النص الآن من مربع الكتابة");
            }
        };
        actionsBar.appendChild(editBtn);
    }

    bubble.appendChild(actionsBar);
    box.appendChild(avatar);
    box.appendChild(bubble);

    chatMessages.appendChild(box);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (window.hljs) {
        box.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    attachCodeCopyButtons(box);
}

/*==============================
 NEW CHAT
==============================*/
if (newChat) {
    newChat.onclick = () => {
        chats.push({
            name: "محادثة جديدة",
            pinned: false,
            messages: []
        });
        currentChat = chats.length - 1;
        if (chatMessages) chatMessages.innerHTML = "";
        saveChats();
        renderChats();
        if (window.innerWidth <= 850 && sidebar) {
            sidebar.classList.remove("show-mobile");
        }
        showToast("✨ تم إنشاء محادثة جديدة");
    };
}

/*==================================================
 UPLOAD IMAGE
==================================================*/
if (uploadImage && imageInput) {
    uploadImage.onclick = () => imageInput.click();

    imageInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file || !previewBox) return;

        uploadedImages.push(file);
        const reader = new FileReader();

        reader.onload = () => {
            const box = document.createElement("div");
            box.className = "previewImage";
            box.innerHTML = `
                <img src="${reader.result}">
                <button class="removePreview"><i class="fa-solid fa-xmark"></i></button>
            `;

            box.querySelector("button").onclick = () => {
                uploadedImages = uploadedImages.filter(f => f !== file);
                box.remove();
                showToast("تم حذف الصورة");
            };

            previewBox.appendChild(box);
        };

        reader.readAsDataURL(file);
    };
}

/*==================================================
 UPLOAD FILE
==================================================*/
if (uploadFile && fileInput) {
    uploadFile.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file || !previewBox) return;

        uploadedFiles.push(file);
        const box = document.createElement("div");
        box.className = "previewFile";
        box.innerHTML = `
            <i class="fa-solid fa-file"></i>
            <span>${file.name}</span>
            <button class="removePreview"><i class="fa-solid fa-xmark"></i></button>
        `;

        box.querySelector("button").onclick = () => {
            uploadedFiles = uploadedFiles.filter(f => f !== file);
            box.remove();
            showToast("تم حذف الملف");
        };

        previewBox.appendChild(box);
    };
}

/*==================================================
 DRAG & DROP
==================================================*/
document.addEventListener("dragover", (e) => e.preventDefault());

document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!previewBox) return;

    const files = [...e.dataTransfer.files];

    files.forEach(file => {
        if (file.type.startsWith("image/")) {
            uploadedImages.push(file);
            const reader = new FileReader();
            reader.onload = () => {
                const box = document.createElement("div");
                box.className = "previewImage";
                box.innerHTML = `
                    <img src="${reader.result}">
                    <button class="removePreview"><i class="fa-solid fa-xmark"></i></button>
                `;
                box.querySelector("button").onclick = () => {
                    uploadedImages = uploadedImages.filter(f => f !== file);
                    box.remove();
                };
                previewBox.appendChild(box);
            };
            reader.readAsDataURL(file);
        } else {
            uploadedFiles.push(file);
            const box = document.createElement("div");
            box.className = "previewFile";
            box.innerHTML = `
                <i class="fa-solid fa-file"></i>
                <span>${file.name}</span>
                <button class="removePreview"><i class="fa-solid fa-xmark"></i></button>
            `;
            box.querySelector("button").onclick = () => {
                uploadedFiles = uploadedFiles.filter(f => f !== file);
                box.remove();
            };
            previewBox.appendChild(box);
        }
    });

    showToast("تمت إضافة الملفات");
});

/*==================================================
 VOICE RECOGNITION
==================================================*/
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (voice) {
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
            isListening = true;
            voice.classList.add("recording");
            showToast("🎤 جاري الاستماع... يمكنك التحدث الآن");
        };

        recognition.onresult = (event) => {
            let transcript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            if (message) {
                message.value = transcript;
                message.dispatchEvent(new Event("input"));
            }
        };

        recognition.onerror = (event) => {
            isListening = false;
            voice.classList.remove("recording");
            if (event.error === 'not-allowed') {
                showToast("❌ تم رفض إذن المايك من المتصفح");
            } else {
                showToast("⚠️ حدث خطأ في التسجيل: " + event.error);
            }
        };

        recognition.onend = () => {
            isListening = false;
            voice.classList.remove("recording");
            showToast("⏹️ تم إيقاف المايك");
        };

        voice.onclick = () => {
            if (isListening) {
                recognition.stop();
            } else {
                recognition.lang = appSettings.language === "ar" ? "ar-SA" : "en-US";
                try {
                    recognition.start();
                } catch (err) {
                    recognition.stop();
                }
            }
        };
    } else {
        voice.onclick = () => {
            showToast("❌ متصفحك الحالي لا يدعم خاصية تحويل الصوت إلى نص");
        };
    }
}

/*==================================================
 SAVE & LOAD CHATS
==================================================*/
function saveChats() {
    try {
        localStorage.setItem("mmr_ai_chats", JSON.stringify(chats));
    } catch (e) {
        console.error("Failed to save chats to LocalStorage", e);
    }
}

function loadChats() {
    try {
        const data = localStorage.getItem("mmr_ai_chats");
        if (data) chats = JSON.parse(data);
    } catch {
        chats = [];
    }

    if (!Array.isArray(chats) || chats.length === 0) {
        chats = [{
            name: "محادثة جديدة",
            pinned: false,
            messages: []
        }];
    }
    renderChats();
}

/*==================================================
 RENDER CHATS LIST
==================================================*/
function renderChats() {
    if (!historyList) return;
    historyList.innerHTML = "";

    chats.forEach((chat, index) => {
        const item = document.createElement("div");
        item.className = "historyItem" + (index === currentChat ? " active" : "");
        item.innerHTML = `
        <div class="historyTop">
            <strong>${chat.pinned ? '📌 ' : ''}${chat.name}</strong>
        </div>
        <div class="historyButtons">
            <button class="pinBtn" title="تثبيت">📌</button>
            <button class="editBtn" title="تعديل الاسم">✏️</button>
            <button class="deleteBtn" title="حذف">🗑️</button>
        </div>
        `;

        item.querySelector(".historyTop").onclick = () => {
            currentChat = index;
            if (chatMessages) {
                chatMessages.innerHTML = "";
                chat.messages.forEach(msg => {
                    addMessage(msg.role, msg.text);
                });
            }
            renderChats();
            if (window.innerWidth <= 850 && sidebar) {
                sidebar.classList.remove("show-mobile");
            }
        };

        item.querySelector(".pinBtn").onclick = (e) => {
            e.stopPropagation();
            chat.pinned = !chat.pinned;
            saveChats();
            renderChats();
            showToast(chat.pinned ? "📌 تم تثبيت المحادثة" : "📂 تم إلغاء التثبيت");
        };

        item.querySelector(".editBtn").onclick = (e) => {
            e.stopPropagation();
            const name = prompt("اسم المحادثة الجديدة:", chat.name);
            if (!name) return;
            chat.name = name;
            saveChats();
            renderChats();
        };

        item.querySelector(".deleteBtn").onclick = (e) => {
            e.stopPropagation();
            if (!confirm("هل أنت تأكد من حذف هذه المحادثة؟")) return;
            chats.splice(index, 1);
            if (chats.length === 0) {
                chats.push({ name: "محادثة جديدة", pinned: false, messages: [] });
            }
            currentChat = 0;
            if (chatMessages) chatMessages.innerHTML = "";
            saveChats();
            renderChats();
            showToast("🗑️ تم حذف المحادثة");
        };

        historyList.appendChild(item);
    });
}

/*==================================================
 SEARCH & CLEAR HISTORY
==================================================*/
if (searchChats && historyList) {
    searchChats.addEventListener("input", () => {
        const value = searchChats.value.toLowerCase();
        [...historyList.children].forEach(item => {
            item.style.display = item.innerText.toLowerCase().includes(value) ? "block" : "none";
        });
    });
}

if (clearHistory) {
    clearHistory.onclick = () => {
        if (!confirm("هل تريد مسح جميع المحادثات المخزنة؟")) return;
        chats = [{ name: "محادثة جديدة", pinned: false, messages: [] }];
        currentChat = 0;
        if (chatMessages) chatMessages.innerHTML = "";
        saveChats();
        renderChats();
        showToast("🗑️ تم مسح السجل بالكامل");
    };
}

/*==================================================
 EXPORT / IMPORT BACKUP
==================================================*/
if (exportChatBtn) {
    exportChatBtn.onclick = () => {
        if (!chats[currentChat] || chats[currentChat].messages.length === 0) {
            showToast("⚠️ لا توجد رسائل لتصديرها");
            return;
        }

        let txt = "";
        chats[currentChat].messages.forEach(msg => {
            txt += `${msg.role.toUpperCase()}: ${msg.text}\n------------------------\n`;
        });

        const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${chats[currentChat].name || 'MMR-AI-Chat'}.txt`;
        a.click();
        showToast("📄 تم تصدير النص");
    };
}

if (exportBackupBtn) {
    exportBackupBtn.onclick = () => {
        const jsonStr = JSON.stringify(chats, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `MMR-AI-Backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        showToast("📦 تم تصدير النسخة الاحتياطية");
    };
}

if (importBackupBtn && importJsonInput) {
    importBackupBtn.onclick = () => importJsonInput.click();

    importJsonInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedChats = JSON.parse(event.target.result);
                if (Array.isArray(importedChats)) {
                    chats = importedChats;
                    currentChat = 0;
                    saveChats();
                    renderChats();
                    showToast("📥 تم استرجاع المحادثات بنجاح");
                } else {
                    showToast("❌ صيغة الملف غير صحيحة");
                }
            } catch {
                showToast("❌ خطأ أثناء قراءة الملف");
            }
        };
        reader.readAsText(file);
    };
}

/*==================================================
 SETTINGS LOGIC
==================================================*/
const appSettings = {
    theme: localStorage.getItem("theme") || "dark",
    language: localStorage.getItem("language") || "ar",
    fontSize: localStorage.getItem("fontSize") || 16,
    typingSpeed: localStorage.getItem("typingSpeed") || 12,
    animation: JSON.parse(localStorage.getItem("animation") ?? "true"),
    sound: JSON.parse(localStorage.getItem("sound") ?? "false"),
    background: JSON.parse(localStorage.getItem("background") ?? "true"),
    autoSave: JSON.parse(localStorage.getItem("autoSave") ?? "true"),
    antiSpam: JSON.parse(localStorage.getItem("antiSpam") ?? "true")
};

if (settingBtn && settings) {
    settingBtn.onclick = () => {
        settings.classList.remove("hidden");
        requestAnimationFrame(() => settings.classList.add("show"));
    };
}

const closeSettingsPanel = () => {
    if (settings) {
        settings.classList.remove("show");
        settings.classList.add("hidden");
    }
};

if (closeSettings) closeSettings.onclick = closeSettingsPanel;
if (settings) {
    settings.onclick = (event) => {
        if (event.target === settings) closeSettingsPanel();
    };
}

/* THEME */
function applyTheme(themeName) {
    document.body.className = "";
    document.body.classList.add("theme-" + themeName);
    appSettings.theme = themeName;
    localStorage.setItem("theme", themeName);
}

if (themeSelect) {
    themeSelect.value = appSettings.theme;
    themeSelect.onchange = () => {
        applyTheme(themeSelect.value);
        showToast("🎨 تم تغيير الثيم");
    };
}
applyTheme(appSettings.theme);

if (themeBtn) {
    themeBtn.onclick = () => {
        const themes = ["dark", "light", "blue", "purple", "pink", "emerald"];
        const nextTheme = themes[(themes.indexOf(appSettings.theme) + 1) % themes.length];
        if (themeSelect) themeSelect.value = nextTheme;
        applyTheme(nextTheme);
        showToast("🎨 الثيم: " + nextTheme);
    };
}

/* LANGUAGE */
function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    appSettings.language = lang;
    localStorage.setItem("language", lang);
}

if (languageSelect) {
    languageSelect.value = appSettings.language;
    languageSelect.onchange = () => {
        applyLanguage(languageSelect.value);
        showToast("🌍 تم تغيير اللغة");
    };
}
applyLanguage(appSettings.language);

if (languageBtn) {
    languageBtn.onclick = () => {
        const nextLang = appSettings.language === "ar" ? "en" : "ar";
        if (languageSelect) languageSelect.value = nextLang;
        applyLanguage(nextLang);
        showToast("🌍 اللغة: " + (nextLang === "ar" ? "العربية" : "English"));
    };
}

/* FONT SIZE */
const fontSize = getEl("fontSize");
if (fontSize) {
    fontSize.value = appSettings.fontSize;
    document.body.style.fontSize = fontSize.value + "px";

    fontSize.oninput = () => {
        document.body.style.fontSize = fontSize.value + "px";
        localStorage.setItem("fontSize", fontSize.value);
    };
}

/* TYPING SPEED */
const typingSpeed = getEl("typingSpeed");
if (typingSpeed) {
    typingSpeed.value = appSettings.typingSpeed;
    typingSpeed.oninput = () => {
        localStorage.setItem("typingSpeed", typingSpeed.value);
    };
}

/* SWITCHES */
function bindSwitch(id, key) {
    const el = getEl(id);
    if (!el) return;
    el.checked = appSettings[key];
    el.onchange = () => {
        appSettings[key] = el.checked;
        localStorage.setItem(key, JSON.stringify(el.checked));
    };
}

bindSwitch("animation", "animation");
bindSwitch("sound", "sound");
bindSwitch("backgroundEffect", "background");
bindSwitch("autoSave", "autoSave");
bindSwitch("antiSpam", "antiSpam");

/* STATISTICS */
function updateStats() {
    const statChats = getEl("statChats");
    const statMessages = getEl("statMessages");
    const statImages = getEl("statImages");
    const statFiles = getEl("statFiles");

    if (statChats) statChats.textContent = chats.length;
    if (statMessages) {
        let msgCount = 0;
        chats.forEach(c => { msgCount += c.messages ? c.messages.length : 0; });
        statMessages.textContent = msgCount;
    }
    if (statImages) statImages.textContent = uploadedImages.length;
    if (statFiles) statFiles.textContent = uploadedFiles.length;
}

setInterval(updateStats, 1000);

/* CLEAR SINGLE CHAT */
if (clearChatBtn) {
    clearChatBtn.onclick = () => {
        if (!confirm("هل تريد حذف محادثة الحالية؟")) return;
        if (chats[currentChat]) chats[currentChat].messages = [];
        if (chatMessages) chatMessages.innerHTML = "";
        saveChats();
        showToast("🗑️ تم حذف المحادثة");
    };
}

/* ABOUT & STATS MODALS */
getEl("aboutBtn")?.addEventListener("click", () => {
    getEl("about")?.classList.remove("hidden");
});

getEl("closeAbout")?.addEventListener("click", () => {
    getEl("about")?.classList.add("hidden");
});

getEl("closeAboutX")?.addEventListener("click", () => {
    getEl("about")?.classList.add("hidden");
});

getEl("statsBtn")?.addEventListener("click", () => {
    getEl("stats")?.classList.remove("hidden");
});

getEl("closeStats")?.addEventListener("click", () => {
    getEl("stats")?.classList.add("hidden");
});

/*==================================================
 PROMPTS
==================================================*/
document.querySelectorAll(".prompt").forEach(btn => {
    btn.onclick = () => {
        if (message) {
            message.value = btn.innerText;
            message.focus();
        }
    };
});

/*==================================================
 KEYBOARD SHORTCUTS
==================================================*/
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat?.click();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchChats?.focus();
    }
    if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        sendMessage();
    }
    if (e.key === "Escape") {
        settings?.classList.add("hidden");
        getEl("about")?.classList.add("hidden");
        getEl("stats")?.classList.add("hidden");
        sidebar?.classList.remove("show-mobile");
    }
});

/*==================================================
 TYPE EFFECT WITH MARKDOWN
==================================================*/
async function typeMessage(text) {
    hideThinking();
    if (!chatMessages) return;

    let current = "";
    const speed = Number(localStorage.getItem("typingSpeed")) || 12;

    const div = document.createElement("div");
    div.className = "message assistant";
    div.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="bubble"></div>
    `;
    chatMessages.appendChild(div);

    const bubble = div.querySelector(".bubble");
    let wasStopped = false;

    for (const ch of text) {
        if (stopRequested) {
            wasStopped = true;
            break;
        }
        current += ch;
        if (window.marked) {
            bubble.innerHTML = marked.parse(current);
        } else {
            bubble.innerText = current;
        }
        smartScrollToBottom();
        await new Promise(r => setTimeout(r, speed));
    }

    if (wasStopped) {
        current += "\n\n*⏹️ تم إيقاف الرد.*";
        if (window.marked) {
            bubble.innerHTML = marked.parse(current);
        } else {
            bubble.innerText = current;
        }
    }

    if (window.hljs) {
        div.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    attachCodeCopyButtons(div);

    const actionsBar = document.createElement("div");
    actionsBar.style.marginTop = "8px";
    actionsBar.style.display = "flex";
    actionsBar.style.gap = "8px";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copyCode";
    copyBtn.innerHTML = "📋 نسخ الرسالة";
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(current);
        showToast("✅ تم نسخ الرسالة الكاملة");
    };

    const speakBtn = document.createElement("button");
    speakBtn.className = "copyCode";
    speakBtn.innerHTML = "🔊 قراءة";
    speakBtn.onclick = () => speakText(current);

    actionsBar.appendChild(copyBtn);
    actionsBar.appendChild(speakBtn);
    bubble.appendChild(actionsBar);

    if (!wasStopped) playNotificationSound();

    return { text: current, stopped: wasStopped };
}

/*==================================================
 API REQUEST (CLOUD RAILWAY SERVER)
==================================================*/
async function askAI(prompt) {
    showThinking();
    setGeneratingState(true);

    const contextMessages = chats[currentChat] ? chats[currentChat].messages.slice(-6) : [];
    const persona = systemPromptSelect ? systemPromptSelect.value : "default";
    const currentUsername = localStorage.getItem("mmr_username") || null;

    activeAbortController = new AbortController();

    try {
        const res = await fetch("https://mmr-ai-backend1-production.up.railway.app/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: prompt,
                systemPrompt: persona,
                history: contextMessages,
                username: currentUsername
            }),
            signal: activeAbortController.signal
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "تعذر الاتصال بالسيرفر السحابي");
        }

        if (stopRequested) {
            hideThinking();
            return;
        }

        const result = await typeMessage(data.reply);

        if (chats[currentChat]) {
            chats[currentChat].messages.push({
                role: "assistant",
                text: result ? result.text : data.reply,
                time: new Date().toLocaleTimeString()
            });
            saveChats();
        }
    } catch (err) {
        hideThinking();
        if (err.name === "AbortError") {
            addMessage("assistant", "⏹️ *تم إيقاف الطلب قبل استلام الرد.*");
        } else {
            addMessage("assistant", `❌ **خطأ:** ${err.message}`);
        }
    } finally {
        activeAbortController = null;
        setGeneratingState(false);
    }
}

/*==================================================
 AUTO SAVE INTERVAL
==================================================*/
setInterval(() => {
    if (appSettings.autoSave) {
        saveChats();
    }
}, 3000);

/*==================================================
 START APPLICATION
==================================================*/
loadChats();
updateStats();
showToast("🚀 MMR-AI جاهز لخدمتك!");

/*==================================================
 شاشة التحميل الاحترافية (Preloader)
==================================================*/
(function () {
    const pre = document.getElementById("mmrPreloader");
    if (!pre) return;
    const hide = () => pre.classList.add("mmr-hide");
    window.addEventListener("load", () => setTimeout(hide, 500));
    setTimeout(hide, 3000);

    const backLink = document.getElementById("backToHub");
    if (backLink) {
        backLink.addEventListener("click", (e) => {
            e.preventDefault();
            document.body.classList.add("page-exit");
            pre.classList.remove("mmr-hide");
            setTimeout(() => { window.location.href = "index.html"; }, 450);
        });
    }
})();