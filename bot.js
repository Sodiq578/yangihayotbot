require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// .env dan xavfsiz o'qish
const TOKEN = process.env.TOKEN?.trim();
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID.trim()) : null;

let CHANNELS = [];
if (process.env.CHANNELS && process.env.CHANNELS.trim() !== "") {
  CHANNELS = process.env.CHANNELS.split(",")
    .map(ch => ch.trim())
    .filter(ch => ch.startsWith("@") || !isNaN(ch)); // username yoki ID qo'llab-quvvatlash
}

if (!TOKEN || !ADMIN_ID || CHANNELS.length === 0) {
  console.error("❌ .env faylda TOKEN, ADMIN_ID yoki CHANNELS noto'g'ri!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const DATA_FILE = "posts.json";
let posts = [];

function loadPosts() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      posts = JSON.parse(data);
      posts.forEach(post => {
        post.likedUsers = new Set(post.likedUsers || []);
        post.messageIds = post.messageIds || {};
      });
      console.log(`${posts.length} ta post yuklandi.`);
    } catch (e) {
      console.error("posts.json o'qishda xato:", e.message);
      posts = [];
    }
  }
}

function savePosts() {
  const dataToSave = posts.map(post => ({
    ...post,
    likedUsers: Array.from(post.likedUsers)
  }));
  fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
}

loadPosts();

// Vaqtinchalik holatlar
let userState = {}; // { userId: { action: "waiting_photo" | "waiting_caption", postId: "...", photo: "..." } }

function clearUserState(userId) {
  delete userState[userId];
}

// Asosiy menu
function showMainMenu(chatId) {
  bot.sendMessage(chatId, "🤖 Admin panel", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📸 Yangi post qo'shish", callback_data: "new_post" }],
        [{ text: "📋 Postlarni boshqarish", callback_data: "manage_posts" }],
        [{ text: "📊 Statistika", callback_data: "stats" }]
      ]
    }
  });
}

// /start
bot.onText(/\/start/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  clearUserState(msg.from.id);
  showMainMenu(msg.chat.id);
});

// Callback query
bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  if (userId !== ADMIN_ID) {
    bot.answerCallbackQuery(q.id);
    return;
  }

  const data = q.data;

  if (data === "new_post") {
    clearUserState(userId);
    userState[userId] = { action: "waiting_photo" };
    bot.sendMessage(userId, "📸 Yangi post uchun rasm yuboring:\n\n❌ Bekor qilish uchun pastdagi tugmani bosing.", {
      reply_markup: { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]] }
    });

  } else if (data === "cancel") {
    clearUserState(userId);
    bot.sendMessage(userId, "❌ Jarayon bekor qilindi.");
    showMainMenu(userId);

  } else if (data === "stats") {
    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
    bot.sendMessage(userId, `📊 Statistika:\n\nPostlar soni: ${totalPosts}\nJami layklar: ${totalLikes}`);

  } else if (data === "manage_posts") {
    if (posts.length === 0) {
      bot.sendMessage(userId, "📭 Hozircha postlar yo'q.");
      return;
    }

    const buttons = posts.slice(-10).reverse().map((post, i) => [{
      text: `${posts.length - i}. ❤️ ${post.likes} • ${new Date(Number(post.id)).toLocaleDateString("uz-UZ")}`,
      callback_data: `view_post_${post.id}`
    }]);

    buttons.push([{ text: "◀️ Orqaga", callback_data: "back_to_menu" }]);

    bot.sendMessage(userId, "📋 Oxirgi postlar (eng yangilari yuqorida):", {
      reply_markup: { inline_keyboard: buttons }
    });

  } else if (data === "back_to_menu") {
    showMainMenu(userId);

  } else if (data.startsWith("view_post_")) {
    const postId = data.split("_")[2];
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const date = new Date(Number(postId)).toLocaleString("uz-UZ");
    bot.sendPhoto(userId, post.photo, {
      caption: `📸 Post ma'lumotlari:\n\n📅 Sana: ${date}\n❤️ Layklar: ${post.likes}\n\n${post.caption || "<matn yo'q>"}`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗑 O'chirish", callback_data: `delete_post_${post.id}` }],
          [{ text: "◀️ Orqaga", callback_data: "manage_posts" }]
        ]
      }
    });

  } else if (data.startsWith("delete_post_")) {
    const postId = data.split("_")[2];
    const postIndex = posts.findIndex(p => p.id === postId);
    if (postIndex === -1) return;

    const post = posts[postIndex];

    // Kanallardan o'chirish
    for (let [channel, messageId] of Object.entries(post.messageIds)) {
      try {
        await bot.deleteMessage(channel, messageId);
      } catch (err) {
        console.error(`O'chirish xatosi ${channel}:`, err.message);
      }
    }

    posts.splice(postIndex, 1);
    savePosts();

    bot.sendMessage(userId, "🗑 Post muvaffaqiyatli o'chirildi!", {
      reply_markup: { inline_keyboard: [[{ text: "◀️ Orqaga", callback_data: "manage_posts" }]] }
    });
  }

  bot.answerCallbackQuery(q.id);
});

// Rasm qabul qilish
bot.on("photo", (msg) => {
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) return;

  if (!userState[userId] || userState[userId].action !== "waiting_photo") {
    bot.sendMessage(userId, "❌ Avval 'Yangi post' ni bosing.");
    return;
  }

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  userState[userId] = { ...userState[userId], action: "waiting_caption", photo: fileId };

  bot.sendMessage(userId, "✅ Rasm qabul qilindi!\n\n✍️ Endi izoh (caption) yozing.\nBo'sh qoldirsangiz ham post chiqadi.", {
    reply_markup: { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]] }
  });
});

// Matn qabul qilish (caption)
bot.on("text", async (msg) => {
  const userId = msg.from.id;
  if (userId !== ADMIN_ID || msg.text.startsWith("/")) return;

  if (!userState[userId] || userState[userId].action !== "waiting_caption") return;

  const caption = msg.text.trim() || undefined;
  const photo = userState[userId].photo;

  clearUserState(userId);

  const post = {
    id: Date.now().toString(),
    photo: photo,
    caption: caption,
    likes: 0,
    likedUsers: new Set(),
    messageIds: {}
  };
  posts.push(post);

  let successCount = 0;
  for (let channel of CHANNELS) {
    try {
      const sent = await bot.sendPhoto(channel, photo, {
        caption: caption,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "❤️ Like (0)", callback_data: `like_${post.id}` },
              { text: "🔔 Obuna bo‘lish", url: "https://t.me/yangihayottest" }
            ]
          ]
        }
      });
      post.messageIds[channel] = sent.message_id;
      successCount++;
    } catch (err) {
      bot.sendMessage(ADMIN_ID, `❌ ${channel} ga yuborishda xato: ${err.message}`);
    }
  }

  savePosts();

  bot.sendMessage(ADMIN_ID, `✅ Post ${successCount}/${CHANNELS.length} ta kanalga yuborildi!`, {
    reply_markup: { inline_keyboard: [[{ text: "📸 Yana yangi post", callback_data: "new_post" }]] }
  });
  showMainMenu(ADMIN_ID);
});

// Like bosilganda
bot.on("callback_query", async (q) => {
  if (!q.data?.startsWith("like_")) return;

  const postId = q.data.split("_")[1];
  const post = posts.find(p => p.id === postId);
  if (!post) {
    bot.answerCallbackQuery(q.id, { text: "❌ Post topilmadi." });
    return;
  }

  const userId = q.from.id;

  // Obuna tekshiruvi
  let allSubscribed = true;
  for (let channel of CHANNELS) {
    try {
      const member = await bot.getChatMember(channel, userId);
      if (!["member", "administrator", "creator"].includes(member.status)) {
        allSubscribed = false;
        break;
      }
    } catch (e) {
      bot.answerCallbackQuery(q.id, { text: "❗ Obuna holatini tekshirib bo‘lmadi.", show_alert: true });
      return;
    }
  }

  if (!allSubscribed) {
    bot.answerCallbackQuery(q.id, {
      text: "❗ Like bosish uchun barcha kanallarga obuna bo‘ling!",
      show_alert: true
    });
    return;
  }

  if (post.likedUsers.has(userId)) {
    bot.answerCallbackQuery(q.id, { text: "❗ Siz allaqachon like bosgansiz!", show_alert: true });
    return;
  }

  post.likes++;
  post.likedUsers.add(userId);
  savePosts();

  // Barcha kanallarda tugmani yangilash
  for (let [channel, messageId] of Object.entries(post.messageIds)) {
    try {
      await bot.editMessageReplyMarkup({
        inline_keyboard: [
          [
            { text: `❤️ Like (${post.likes})`, callback_data: `like_${post.id}` },
            { text: "🔔 Obuna bo‘lish", url: "https://t.me/yangihayottest" }
          ]
        ]
      }, { chat_id: channel, message_id: messageId });
    } catch (err) {
      console.error("Tugma yangilash xatosi:", err.message);
    }
  }

  bot.answerCallbackQuery(q.id, { text: "❤️ Layk qabul qilindi!" });
});

console.log("🤖 Bot muvaffaqiyatli ishga tushdi!");
console.log(`👤 Admin: ${ADMIN_ID}`);
console.log(`📢 Kanallar: ${CHANNELS.join(", ")}`);