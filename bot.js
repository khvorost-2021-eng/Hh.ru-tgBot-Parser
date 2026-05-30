const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userSessions = {};

const questions = [
    'Какие предметы тебе нравятся, и ты в них разбираешься? (математика, физика, литература, биология, информатика)',
    'Что тебе интересно делать? (работать с людьми, анализировать данные, создавать что-то руками, программировать, управлять процессами)',
    'Какой формат работы предпочитаешь? (офис, удалёнка, гибрид, неважно)',
    'Какая зарплата тебе нужна? (до 50 000, 50-100 000, 100-200 000, неважно)',
    'Есть ли у тебя образование? (школа, колледж, универ, курсы)',
    'Сколько часов в день готов работать? (2-4, 4-8, 8+)'
];

process.on('SIGTERM', () => {
    bot.stop();
    process.exit(0);
});

async function askGroq(userMessage, chatHistory = []) {
    const messages = [
        {
            role: 'system',
            content: 'Ты — карьерный консультант. Предложи 3 профессии на основе ответов пользователя. Для каждой: название, краткое описание (1 предложение), примерная зарплата в рублях. После рекомендаций дай совет: какие ключевые слова использовать при поиске вакансий на сайтах вроде hh.ru. Если ответы пользователя неразборчивы — переспроси. Не используй Markdown.'
        },
        ...chatHistory,
        { role: 'user', content: userMessage }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: messages,
            max_tokens: 2000,
            temperature: 0.7
        })
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Извини, я не понял. Попробуй написать иначе.';
}

function isAdequate(text) {
    const garbage = ['ау', 'поп', 'рэп', 'джаз', 'мам', 'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'хз', 'не знаю', '...', 'ку', 'привет', 'пока', 'да', 'нет'];
    const lower = text.toLowerCase().trim();
    if (garbage.includes(lower)) return false;
    if (lower.length < 3) return false;
    return true;
}

bot.onText(/\/start/, (msg) => {
    userSessions[msg.chat.id] = { 
        state: 'survey', 
        step: 0, 
        answers: [],
        chatHistory: []
    };
    bot.sendMessage(msg.chat.id, 'Привет! Я помогу найти профессию. Сейчас задам несколько вопросов.');
    bot.sendMessage(msg.chat.id, questions[0]);
});

bot.onText(/\/reset/, (msg) => {
    userSessions[msg.chat.id] = { 
        state: 'survey', 
        step: 0, 
        answers: [],
        chatHistory: []
    };
    bot.sendMessage(msg.chat.id, 'Начинаем заново!');
    bot.sendMessage(msg.chat.id, questions[0]);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start' || text === '/reset') return;

    const session = userSessions[chatId];
    if (!session) return;

    if (session.state === 'chat') {
        const thinking = await bot.sendMessage(chatId, 'Думаю...');
        session.chatHistory.push({ role: 'user', content: text });
        const reply = await askGroq(text, session.chatHistory);
        session.chatHistory.push({ role: 'assistant', content: reply });
        await bot.deleteMessage(chatId, thinking.message_id);
        bot.sendMessage(chatId, reply);
        return;
    }

    if (session.state === 'survey') {
        if (!isAdequate(text)) {
            bot.sendMessage(chatId, 'Пожалуйста, ответь развёрнуто. Это поможет мне точнее подобрать профессию.');
            return;
        }

        session.answers.push(`${questions[session.step]}: ${text}`);
        session.step++;

        if (session.step < questions.length) {
            bot.sendMessage(chatId, questions[session.step]);
        } else {
            const thinking = await bot.sendMessage(chatId, 'Анализирую...');
            const summary = session.answers.join('\n');
            const result = await askGroq(`Ответы пользователя:\n${summary}\n\nПредложи 3 профессии и дай советы по поиску вакансий.`);
            
            await bot.deleteMessage(chatId, thinking.message_id);
            bot.sendMessage(chatId, result);
            
            session.state = 'chat';
            session.chatHistory = [
                { role: 'assistant', content: result }
            ];
        }
    }
});

require('http').createServer((req, res) => res.end('OK')).listen(process.env.PORT || 10000, () => {
    console.log('Бот запущен');
});