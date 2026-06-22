import asyncio
import re
import json
import os
from datetime import datetime
from pathlib import Path

# Загружаем .env если есть
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        if "=" in _line and not _line.startswith("#"):
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

import aiosqlite
import aiohttp

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage

from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardRemove,
    CallbackQuery,
    InputMediaPhoto
)

# =========================================================
# НАСТРОЙКИ
# =========================================================

BOT_TOKEN        = "8646781791:AAG69ZzIy0C1eFLVexUHPKQ1ff-hM2xOvys"
ADMIN_ID         = 8280654557
CHANNEL_ID       = "@LegalAutoStore"
MANAGER_USERNAME = "LegalAuto247"
BOT_USERNAME     = "LegalAutoStore_Bot"
PHONE_NUMBER     = "+79385152429"
WHATSAPP         = "+79385152429"
CLAUDE_API_KEY   = os.getenv("CLAUDE_API_KEY", "")  # из .env или Railway

# Файл с источниками для мониторинга
SOURCES_FILE = "sources.json"

# =========================================================
# СОСТОЯНИЯ
# =========================================================

class AdminPost(StatesGroup):
    waiting_post = State()

class ClientForm(StatesGroup):
    waiting_contact = State()

class AddSource(StatesGroup):
    waiting_username = State()

# =========================================================
# БАЗА ДАННЫХ
# =========================================================

async def init_db():
    async with aiosqlite.connect("database.db") as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            username TEXT,
            phone TEXT,
            car_id TEXT,
            created_at TEXT
        )
        """)
        await db.execute("""
        CREATE TABLE IF NOT EXISTS posted_ids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            source TEXT,
            posted_at TEXT
        )
        """)
        await db.commit()

async def is_already_posted(message_id: str) -> bool:
    async with aiosqlite.connect("database.db") as db:
        async with db.execute(
            "SELECT id FROM posted_ids WHERE message_id = ?", (message_id,)
        ) as cursor:
            return await cursor.fetchone() is not None

async def mark_as_posted(message_id: str, source: str):
    async with aiosqlite.connect("database.db") as db:
        await db.execute(
            "INSERT OR IGNORE INTO posted_ids (message_id, source, posted_at) VALUES (?, ?, ?)",
            (message_id, source, str(datetime.now()))
        )
        await db.commit()

# =========================================================
# ИСТОЧНИКИ (каналы партнёров)
# =========================================================

def load_sources() -> list:
    if os.path.exists(SOURCES_FILE):
        with open(SOURCES_FILE, "r") as f:
            return json.load(f)
    return []

def save_sources(sources: list):
    with open(SOURCES_FILE, "w") as f:
        json.dump(sources, f, ensure_ascii=False, indent=2)

def add_source(channel: str) -> bool:
    sources = load_sources()
    channel = channel.strip().lstrip("@")
    if channel not in sources:
        sources.append(channel)
        save_sources(sources)
        return True
    return False

def remove_source(channel: str) -> bool:
    sources = load_sources()
    channel = channel.strip().lstrip("@")
    if channel in sources:
        sources.remove(channel)
        save_sources(sources)
        return True
    return False

# =========================================================
# КНОПКИ
# =========================================================

admin_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="📤 Опубликовать авто"),  KeyboardButton(text="📋 Источники")],
        [KeyboardButton(text="📊 Заявки"),             KeyboardButton(text="🔍 Мониторинг")],
        [KeyboardButton(text="➕ Добавить источник"),  KeyboardButton(text="❓ Помощь")],
    ],
    resize_keyboard=True
)

def channel_keyboard(car_id):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(
                text="🔥 Оставить заявку",
                url=f"https://t.me/{BOT_USERNAME}?start=car_{car_id}"
            )],
            [InlineKeyboardButton(text="💬 WhatsApp", url=f"https://wa.me/{WHATSAPP.replace('+', '')}")],
            [InlineKeyboardButton(text="📞 Telegram",  url=f"https://t.me/{MANAGER_USERNAME}")],
        ]
    )

contact_keyboard = ReplyKeyboardMarkup(
    keyboard=[[KeyboardButton(text="📱 Отправить мой номер", request_contact=True)]],
    resize_keyboard=True,
    one_time_keyboard=True
)

# =========================================================
# ОЧИСТКА И ФОРМАТИРОВАНИЕ
# =========================================================

def clean_text(text):
    if not text:
        return ""
    text = re.sub(r'@\w+', '', text)
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'\+?\d[\d\s\-\(\)]{8,}\d', '', text)
    stop_words = [
        'менеджер', 'телефон', 'whatsapp', 'вотсап',
        'тг:', 'консультация', 'заказ', 'связаться',
        'написать', 'контакт', 'звонить', 'звоните',
        'пишите', 'обращайтесь', 'подробнее'
    ]
    lines = text.split('\n')
    clean_lines = [l for l in lines if not any(w in l.lower() for w in stop_words)]
    text = '\n'.join(clean_lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def format_post(text):
    text = clean_text(text)
    return (
        f"🚗 Автомобиль в продаже\n\n"
        f"{text}\n\n"
        f"━━━━━━━━━━━━━━━\n"
        f"✅ Менеджер: @{MANAGER_USERNAME}\n"
        f"📞 Телефон: {PHONE_NUMBER}\n"
        f"💬 WhatsApp: {WHATSAPP}"
    )

# =========================================================
# AI ПЕРЕРАБОТКА ОБЪЯВЛЕНИЯ (Claude Haiku)
# =========================================================

async def ai_rewrite(text: str, source: str) -> str:
    """Переписывает объявление партнёра под стиль LegalAutoStore."""
    if not CLAUDE_API_KEY or not text.strip():
        return format_post(text)

    clean = clean_text(text)
    prompt = (
        f"Ты копирайтер автосалона LegalAutoStore. Перепиши объявление о продаже авто "
        f"в нашем фирменном стиле. Сохрани ВСЕ технические данные (марка, модель, год, "
        f"пробег, объём, цвет, цена). Убери контакты партнёра. Добавь эмодзи. "
        f"Начни с '🚗 Автомобиль в продаже'.\n\n"
        f"Исходный текст:\n{clean}\n\n"
        f"Перепиши:"
    )

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": CLAUDE_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 400,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                data = await resp.json()
                rewritten = data.get("content", [{}])[0].get("text", "").strip()
                if rewritten:
                    return (
                        f"{rewritten}\n\n"
                        f"━━━━━━━━━━━━━━━\n"
                        f"✅ Менеджер: @{MANAGER_USERNAME}\n"
                        f"📞 Телефон: {PHONE_NUMBER}\n"
                        f"💬 WhatsApp: {WHATSAPP}"
                    )
    except Exception as e:
        print(f"[AI] Ошибка: {e}")

    return format_post(text)

# =========================================================
# ХРАНИЛИЩЕ МЕДИАГРУПП
# =========================================================

media_groups = {}

async def process_media_group(group_id: str, message: Message, state: FSMContext, ai: bool = False, source: str = ""):
    await asyncio.sleep(3)
    if group_id not in media_groups or media_groups[group_id].get("processed"):
        return

    data = media_groups.pop(group_id)
    data["processed"] = True
    photos = data["photos"]
    caption = data.get("caption", "")

    if not photos:
        return

    car_id   = datetime.now().strftime("%d%m%H%M%S")
    formatted = await ai_rewrite(caption, source) if ai else format_post(caption)
    keyboard  = channel_keyboard(car_id)

    try:
        chunks = [photos[i:i+10] for i in range(0, len(photos), 10)]
        for chunk_index, chunk in enumerate(chunks):
            media = []
            for i, photo in enumerate(chunk):
                media.append(InputMediaPhoto(
                    media=photo,
                    caption=formatted if (i == 0 and chunk_index == 0) else None
                ))
            await bot.send_media_group(chat_id=CHANNEL_ID, media=media)

        await bot.send_message(chat_id=CHANNEL_ID, text="👆 По этому автомобилю:", reply_markup=keyboard)
        if state:
            await message.answer("✅ Альбом опубликован!\n\nЕщё одно? → /post")
    except Exception as e:
        if state:
            await message.answer(f"❌ Ошибка:\n{e}")

    if state:
        await state.clear()

# =========================================================
# МОНИТОРИНГ ПАРТНЁРСКИХ КАНАЛОВ
# =========================================================

bot = Bot(BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

monitoring_active = False

async def fetch_channel_updates(channel: str) -> list:
    """Получает последние посты из канала через Bot API (если бот там участник)."""
    try:
        updates = await bot.get_updates(limit=10, timeout=5)
        # Фильтруем сообщения из нужного канала
        result = []
        for u in updates:
            msg = u.channel_post or u.message
            if msg and (
                str(getattr(msg.chat, 'username', '')) == channel or
                str(getattr(msg.chat, 'id', '')) == channel
            ):
                result.append(msg)
        return result
    except Exception as e:
        print(f"[Monitor] Ошибка fetch {channel}: {e}")
        return []

async def auto_monitor_loop():
    """Каждые 5 минут проверяет каналы источников и публикует новые авто."""
    global monitoring_active
    print("🔍 [Monitor] Мониторинг запущен")
    while monitoring_active:
        sources = load_sources()
        for source in sources:
            try:
                messages = await fetch_channel_updates(source)
                for msg in messages:
                    msg_key = f"{source}_{msg.message_id}"
                    if await is_already_posted(msg_key):
                        continue

                    # Есть фото или текст об авто?
                    has_car_content = False
                    caption = msg.caption or msg.text or ""
                    car_keywords = ['авто', 'машин', 'bmw', 'geely', 'mercedes', 'audi',
                                   'toyota', 'пробег', 'год:', 'объем', 'цена', '₽', '$',
                                   'li auto', 'haval', 'chery', 'бензин', 'дизель']
                    if any(k in caption.lower() for k in car_keywords):
                        has_car_content = True

                    if not has_car_content:
                        continue

                    # Публикуем с AI переработкой
                    car_id    = datetime.now().strftime("%d%m%H%M%S")
                    formatted = await ai_rewrite(caption, source)
                    keyboard  = channel_keyboard(car_id)

                    if msg.photo:
                        await bot.send_photo(
                            chat_id=CHANNEL_ID,
                            photo=msg.photo[-1].file_id,
                            caption=formatted,
                            reply_markup=keyboard
                        )
                    elif msg.text:
                        await bot.send_message(
                            chat_id=CHANNEL_ID,
                            text=formatted,
                            reply_markup=keyboard
                        )

                    await mark_as_posted(msg_key, source)
                    print(f"[Monitor] ✅ Опубликовано из @{source}")

                    # Уведомить Эдо
                    await bot.send_message(
                        ADMIN_ID,
                        f"🤖 *Авто-публикация из @{source}*\n\nЕсли нужно удалить — зайди в канал @LegalAutoStore",
                        parse_mode="Markdown"
                    )
                    await asyncio.sleep(2)

            except Exception as e:
                print(f"[Monitor] Ошибка для @{source}: {e}")

        await asyncio.sleep(5 * 60)  # проверяем каждые 5 минут

# =========================================================
# START
# =========================================================

@dp.message(CommandStart())
async def start(message: Message, state: FSMContext):
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("car_"):
        car_id = args[1].replace("car_", "")
        await state.update_data(car_id=car_id)
        await state.set_state(ClientForm.waiting_contact)
        await message.answer(
            "👋 Здравствуйте!\n\nВы заинтересовались автомобилем.\n\n"
            "📱 Нажмите кнопку ниже чтобы отправить номер телефона — "
            "мы перезвоним в течение 15 минут!",
            reply_markup=contact_keyboard
        )
        return

    if message.from_user.id == ADMIN_ID:
        await message.answer("✅ Бот работает!\n\nИспользуй кнопки ниже 👇", reply_markup=admin_keyboard)
    else:
        await message.answer(
            f"🚗 Добро пожаловать в Legal Auto Store!\n\n"
            f"Выберите автомобиль в канале и нажмите кнопку заявки.\n\n"
            f"✅ Менеджер: @{MANAGER_USERNAME}\n"
            f"📞 Телефон: {PHONE_NUMBER}"
        )

# =========================================================
# HELP
# =========================================================

@dp.message(Command("help"))
@dp.message(F.text == "❓ Помощь")
async def help_cmd(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "📌 *Команды:*\n\n"
        "/post — опубликовать авто вручную\n"
        "/sources — управление каналами-источниками\n"
        "/monitor — запустить/остановить авто-мониторинг\n"
        "/leads — последние заявки\n\n"
        "🤖 *Авто-мониторинг:*\n"
        "1. /addsource @канал_партнёра\n"
        "2. /monitor — запустить\n"
        "3. Бот сам следит и публикует!\n\n"
        "📤 *Ручная публикация:*\n"
        "1. /post → перешли пост или фото\n"
        "2. AI переделывает под наш стиль\n"
        "3. Публикует в @LegalAutoStore",
        parse_mode="Markdown",
        reply_markup=admin_keyboard
    )

# =========================================================
# УПРАВЛЕНИЕ ИСТОЧНИКАМИ
# =========================================================

@dp.message(Command("sources"))
@dp.message(F.text == "📋 Источники")
async def sources_cmd(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    sources = load_sources()
    if not sources:
        text = "📋 *Источники не добавлены*\n\nДобавь: `/addsource @канал`"
    else:
        text = "📋 *Каналы-источники:*\n\n"
        for i, s in enumerate(sources, 1):
            text += f"{i}. @{s}\n"
        text += "\nУдалить: `/removesource @канал`"
    await message.answer(text, parse_mode="Markdown")

@dp.message(Command("addsource"))
@dp.message(F.text == "➕ Добавить источник")
async def addsource_cmd(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    # Если передан username сразу (/addsource @channel)
    parts = message.text.split(maxsplit=1)
    if len(parts) >= 2 and not message.text.startswith("➕"):
        channel = parts[1].strip().lstrip("@")
        if add_source(channel):
            await message.answer(f"✅ Добавлен: @{channel}\n\nЗапусти 🔍 Мониторинг чтобы начать слежение.", reply_markup=admin_keyboard)
        else:
            await message.answer(f"⚠️ @{channel} уже есть в списке", reply_markup=admin_keyboard)
        return
    # Иначе спрашиваем
    await state.set_state(AddSource.waiting_username)
    await message.answer(
        "📲 Напиши username канала партнёра:\n\nПример: `@AutoDealerMoscow`",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text="❌ Отмена")]],
            resize_keyboard=True
        )
    )

@dp.message(AddSource.waiting_username)
async def handle_add_source(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    if message.text == "❌ Отмена":
        await state.clear()
        await message.answer("Отменено.", reply_markup=admin_keyboard)
        return
    channel = message.text.strip().lstrip("@")
    if add_source(channel):
        await message.answer(f"✅ Добавлен: @{channel}\n\nНажми 🔍 Мониторинг чтобы начать слежение.", reply_markup=admin_keyboard)
    else:
        await message.answer(f"⚠️ @{channel} уже есть в списке", reply_markup=admin_keyboard)
    await state.clear()

@dp.message(Command("removesource"))
async def removesource_cmd(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Укажи канал: `/removesource @канал`", parse_mode="Markdown")
        return
    channel = parts[1].strip().lstrip("@")
    if remove_source(channel):
        await message.answer(f"✅ Удалён: @{channel}")
    else:
        await message.answer(f"❌ @{channel} не найден")

# =========================================================
# МОНИТОРИНГ
# =========================================================

monitor_task = None

@dp.message(Command("monitor"))
@dp.message(F.text == "🔍 Мониторинг")
async def monitor_cmd(message: Message):
    global monitoring_active, monitor_task
    if message.from_user.id != ADMIN_ID:
        return

    sources = load_sources()
    if not sources:
        await message.answer("❌ Сначала добавь источники:\n`/addsource @канал_партнёра`", parse_mode="Markdown")
        return

    if monitoring_active:
        monitoring_active = False
        if monitor_task:
            monitor_task.cancel()
        await message.answer("⏹ Мониторинг остановлен")
    else:
        monitoring_active = True
        monitor_task = asyncio.create_task(auto_monitor_loop())
        src_list = "\n".join([f"• @{s}" for s in sources])
        await message.answer(
            f"▶️ *Мониторинг запущен!*\n\n"
            f"Слежу за:\n{src_list}\n\n"
            f"🤖 AI будет автоматически переделывать и публиковать объявления об авто.",
            parse_mode="Markdown"
        )

# =========================================================
# РУЧНАЯ ПУБЛИКАЦИЯ (/post)
# =========================================================

@dp.message(Command("post"))
@dp.message(F.text == "📤 Опубликовать авто")
async def create_post(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    await state.clear()
    await state.set_state(AdminPost.waiting_post)
    await message.answer(
        "📤 Отправь объявление:\n\n"
        "• Перешли пост из канала партнёра\n"
        "• Фото + описание\n"
        "• Несколько фото + описание\n\n"
        "🤖 AI автоматически перепишет под наш стиль."
    )

@dp.message(AdminPost.waiting_post)
async def handle_post(message: Message, state: FSMContext):
    # Медиагруппа
    if message.media_group_id:
        group_id = message.media_group_id
        if group_id not in media_groups:
            media_groups[group_id] = {"photos": [], "caption": "", "processed": False}
        if message.photo:
            media_groups[group_id]["photos"].append(message.photo[-1].file_id)
        if message.caption and not media_groups[group_id]["caption"]:
            media_groups[group_id]["caption"] = message.caption
        asyncio.create_task(process_media_group(group_id, message, state, ai=True, source="manual"))
        return

    # Одно фото
    if message.photo:
        car_id    = datetime.now().strftime("%d%m%H%M%S")
        caption   = message.caption or ""
        formatted = await ai_rewrite(caption, "manual")
        keyboard  = channel_keyboard(car_id)
        try:
            await bot.send_photo(chat_id=CHANNEL_ID, photo=message.photo[-1].file_id, caption=formatted, reply_markup=keyboard)
            await message.answer("✅ Опубликовано с AI переработкой!\n\nЕщё? → /post")
        except Exception as e:
            await message.answer(f"❌ Ошибка:\n{e}")
        await state.clear()
        return

    # Только текст
    if message.text and not message.text.startswith('/'):
        car_id    = datetime.now().strftime("%d%m%H%M%S")
        formatted = await ai_rewrite(message.text, "manual")
        keyboard  = channel_keyboard(car_id)
        try:
            await bot.send_message(chat_id=CHANNEL_ID, text=formatted, reply_markup=keyboard)
            await message.answer("✅ Опубликовано!\n\nЕщё? → /post")
        except Exception as e:
            await message.answer(f"❌ Ошибка:\n{e}")
        await state.clear()
        return

    await message.answer("⚠️ Отправь фото или текст.")

# =========================================================
# КЛИЕНТ: КОНТАКТ
# =========================================================

@dp.message(ClientForm.waiting_contact, F.contact)
async def get_contact(message: Message, state: FSMContext):
    phone    = message.contact.phone_number
    data     = await state.get_data()
    car_id   = data.get("car_id", "unknown")
    name     = message.from_user.first_name or "Без имени"
    username = f"@{message.from_user.username}" if message.from_user.username else "нет username"

    async with aiosqlite.connect("database.db") as db:
        await db.execute(
            "INSERT INTO leads (name, username, phone, car_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, username, phone, car_id, str(datetime.now()))
        )
        await db.commit()

    await bot.send_message(
        ADMIN_ID,
        f"🔔 *НОВАЯ ЗАЯВКА!*\n\n"
        f"👤 Имя: {name}\n📱 Username: {username}\n"
        f"☎️ Телефон: {phone}\n🚗 Авто ID: #{car_id}\n\n"
        f"🕒 {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        parse_mode="Markdown"
    )
    await message.answer(
        f"✅ Заявка отправлена!\n\nМенеджер свяжется с вами в течение 15 минут.\n\nНаписать самому: @{MANAGER_USERNAME}",
        reply_markup=ReplyKeyboardRemove()
    )
    await state.clear()

@dp.message(ClientForm.waiting_contact, F.text)
async def wrong_input(message: Message):
    await message.answer("⚠️ Пожалуйста нажмите кнопку\n📱 Отправить мой номер", reply_markup=contact_keyboard)

# =========================================================
# ЗАЯВКИ
# =========================================================

@dp.message(Command("leads"))
@dp.message(F.text == "📊 Заявки")
async def leads_cmd(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    async with aiosqlite.connect("database.db") as db:
        async with db.execute(
            "SELECT name, username, phone, car_id, created_at FROM leads ORDER BY id DESC LIMIT 20"
        ) as cursor:
            rows = await cursor.fetchall()

    if not rows:
        await message.answer("📋 Заявок пока нет", reply_markup=admin_keyboard)
        return

    text = "📋 *Последние заявки:*\n\n"
    for i, row in enumerate(rows, 1):
        text += f"{i}. 👤 {row[0]} | 📱 {row[1]} | ☎️ {row[2]}\n    🚗 #{row[3]} | 🕒 {row[4][:16]}\n\n"
    await message.answer(text, parse_mode="Markdown", reply_markup=admin_keyboard)

# =========================================================
# ЗАПУСК
# =========================================================

async def main():
    await init_db()
    print("✅ LegalAutoStore Bot запущен")
    print("📌 Команды: /post /sources /addsource /monitor /leads")
    if not CLAUDE_API_KEY:
        print("⚠️ CLAUDE_API_KEY не задан — AI переработка отключена")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
