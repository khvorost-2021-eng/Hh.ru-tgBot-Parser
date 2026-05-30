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

async function askGroq(userMessage, chatHistory = []) {
    const messages = [
        {
            role: 'system',
            content: 'Ты — карьерный консультант. Отвечай полезно и кратко. Если пользователь просит детали, объясни. Если хочет другую профессию — предложи альтернативу.'
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
    return data.choices?.[0]?.message?.content || 'Ошибка';
}

async function getVacancies(profession) {
    try {
        const response = await axios.get('https://api.hh.ru/vacancies', {
            params: { text: profession, area: 113, per_page: 5 },
            headers: { 'User-Agent': 'CareerBot/1.0' }
        });
        const vacancies = response.data.items;
        if (!vacancies.length) return 'Вакансий не найдено';
        return vacancies.map((v, i) => {
            const title = v.name;
            const url = v.alternate_url;
            const salary = v.salary ? 
                `${v.salary.from || '?'} - ${v.salary.to || '?'} ${v.salary.currency || 'RUR'}` : 
                'з/п не указана';
            return `${i + 1}. ${title}\n💰 ${salary}\n🔗 ${url}`;
        }).join('\n\n');
    } catch (err) {
        return 'Ошибка при поиске вакансий';
    }
}

// /start
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

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') return;

    const session = userSessions[chatId];
    if (!session) return;

    // Режим свободного общения
    if (session.state === 'chat') {
        const thinking = await bot.sendMessage(chatId, 'Думаю...');
        session.chatHistory.push({ role: 'user', content: text });
        const reply = await askGroq(text, session.chatHistory);
        session.chatHistory.push({ role: 'assistant', content: reply });
        await bot.deleteMessage(chatId, thinking.message_id);
        bot.sendMessage(chatId, reply);
        return;
    }

    // Режим опроса
    if (session.state === 'survey') {
        session.answers.push(`${questions[session.step]}: ${text}`);
        session.step++;

        if (session.step < questions.length) {
            bot.sendMessage(chatId, questions[session.step]);
        } else {
            const thinking = await bot.sendMessage(chatId, 'Анализирую...');
            const summary = session.answers.join('\n');
            const professions = await askGroq(`Ответы пользователя:\n${summary}\n\nПредложи 3 профессии.`);
            const firstProfession = professions.split('\n')[0].replace(/^\d+\.\s*/, '').split('—')[0].trim();
            const links = await getVacancies(firstProfession);
            
            await bot.deleteMessage(chatId, thinking.message_id);
            
            const finalMessage = `🤖 *Рекомендованные профессии:*\n\n${professions}\n\n📋 *Вакансии по первой профессии:*\n\n${links}\n\n💬 *Теперь ты можешь задать мне любые вопросы: уточнить про профессии, попросить найти другую, спросить совета.*`;
            
            bot.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
            
            // Переключаем в режим чата
            session.state = 'chat';
            session.chatHistory = [
                { role: 'assistant', content: professions }
            ];
        }
    }
});

// Фиктивный сервер для Render
require('http').createServer((req, res) => res.end('OK')).listen(process.env.PORT || 10000, () => {
    console.log('Бот запущен');
});