const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userAnswers = {};

const questions = [
    'Какие предметы тебе нравились в школе? (математика, физика, литература, биология, информатика)',
    'Что тебе интересно делать? (работать с людьми, анализировать данные, создавать что-то руками, программировать, управлять процессами)',
    'Какой формат работы предпочитаешь? (офис, удалёнка, гибрид, неважно)',
    'Какая зарплата тебе нужна? (до 50 000, 50-100 000, 100-200 000, неважно)',
    'Есть ли у тебя образование? (школа, колледж, универ, курсы)',
    'Сколько часов в день готов работать? (2-4, 4-8, 8+)'
];

async function askGroq(userMessage) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content: 'Ты — карьерный консультант. На основе ответов пользователя предложи 3 профессии, которые ему подходят. Для каждой укажи: название, краткое описание (1 предложение), примерную зарплату. Отвечай строго по формату: 1. Профессия — описание — зарплата.'
                },
                { role: 'user', content: userMessage }
            ],
            max_tokens: 2000,
            temperature: 0.7
        })
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Ошибка';
}

// /start
bot.onText(/\/start/, (msg) => {
    userAnswers[msg.chat.id] = { step: 0, answers: [] };
    bot.sendMessage(msg.chat.id, 'Привет! Я помогу тебе найти профессию. Сейчас задам несколько вопросов.');
    bot.sendMessage(msg.chat.id, questions[0]);
});

// Ответы
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') return;

    const session = userAnswers[chatId];
    if (!session) return;

    session.answers.push(`${questions[session.step]}: ${text}`);
    session.step++;

    if (session.step < questions.length) {
        bot.sendMessage(chatId, questions[session.step]);
    } else {
        const thinking = await bot.sendMessage(chatId, 'Анализирую ответы...');
        const summary = session.answers.join('\n');
        const result = await askGroq(`Вот ответы пользователя:\n${summary}\n\nПредложи 3 профессии.`);
        await bot.deleteMessage(chatId, thinking.message_id);
        bot.sendMessage(chatId, result);
        delete userAnswers[chatId];
    }
});

// Фиктивный сервер для Render (чтобы был открытый порт)
require('http').createServer((req, res) => res.end('OK')).listen(process.env.PORT || 10000, () => {
    console.log('Порт открыт для Render');
});