const TelegramBot = require("node-telegram-bot-api");
const { Anthropic } = require("@anthropic-ai/sdk");
const { Octokit } = require("@octokit/rest");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const SYSTEM_PROMPT = `You are CLAWD 🦞, the AI project manager and developer for "We Goin To Mars" — a multiplayer Mars colony builder game on Steam, built by a 7-person student team.

You have two modes:
1. ANSWER questions about the project
2. EXECUTE GitHub actions when asked

PROJECT BIBLE:
- Game: We Goin To Mars — top-down 2D multiplayer colony builder on Mars
- Engine: Godot 4 + GDScript
- Art: LPC free assets from OpenGameArt.org (Stardew Valley style)
- Multiplayer: Nakama server via Heroic Labs
- Platform: Steam + Web export
- Team email: marsdagame@gmail.com
- Treasurer: Aiden

WORLD LAYOUT:
6 Parishes surrounding The Mountain (central hub)

THE MOUNTAIN has: Martian Bank, Central Train Station, Grand Marketplace, Notice Board, Leaderboard Shrine

CURRENCY:
- Mars Coins (soft): earned in-game, used for train rides and goods
- Red Dust (premium): bought with real money, cosmetics ONLY, never pay-to-win

GITHUB REPO STRUCTURE:
/we-goin-to-mars-game
  /parishes/parish_[name].tscn
  /mountain/mountain.tscn + marketplace.tscn
  /shared/economy.gd + player.gd + train.gd
  main.tscn + README.md

ROADMAP:
- Week 1-2: Prototype
- Week 3-4: Map Builder
- Week 5-6: Economy
- Week 7-8: Multiplayer
- Week 9-10: Steam Launch

WHEN ASKED TO DO SOMETHING IN GITHUB respond with:
<ACTION>
{
  "action": "create_file",
  "path": "path/to/file.gd",
  "content": "file content here",
  "message": "commit message"
}
</ACTION>

PERSONALITY: Enthusiastic, knowledgeable, speaks like a cool teammate. Writes clean GDScript when asked.`;

const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = [];
  return sessions[chatId];
}

async function createOrUpdateFile(path, content, message) {
  try {
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path });
      sha = data.sha;
    } catch (e) {}

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path, message,
      content: Buffer.from(content).toString("base64"),
      ...(sha ? { sha } : {}),
    });
    return `✅ ${path} committed!`;
  } catch (err) {
    return `❌ GitHub error: ${err.message}`;
  }
}

async function executeActions(text, chatId, msgId) {
  const actionRegex = /<ACTION>([\s\S]*?)<\/ACTION>/g;
  let match, results = [];
  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1].trim());
      if (action.action === "create_file" || action.action === "update_file") {
        results.push(await createOrUpdateFile(action.path, action.content, action.message || "CLAWD commit"));
      }
    } catch (e) { results.push(`❌ Parse error: ${e.message}`); }
  }
  if (results.length > 0) {
    const clean = text.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, "").trim();
    await bot.editMessageText(clean + "\n\n" + results.join("\n"), { chat_id: chatId, message_id: msgId });
  }
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🦞 *CLAWD is online!*\n\nI'm your AI dev for We Goin To Mars!\n\nI can:\n- Answer project questions\n- Write GDScript code\n- Commit files to GitHub\n- Manage the roadmap\n\nTry: "Set up the repo" or "Write a player script"`,
    { parse_mode: "Markdown" });
});

bot.onText(/\/setup/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🚀 Setting up GitHub repo...");
  const files = [
    { path: "README.md", content: `# We Goin To Mars 🚀\nMultiplayer Mars colony builder — Godot 4\nTeam: 7 members | Email: marsdagame@gmail.com`, message: "CLAWD: README" },
    { path: "parishes/.gitkeep", content: "", message: "CLAWD: parishes folder" },
    { path: "mountain/.gitkeep", content: "", message: "CLAWD: mountain folder" },
    { path: "shared/economy.gd", content: `extends Node\n\nvar mars_coins: int = 0\nvar red_dust: int = 0\nconst TRAIN_TICKET_COST = 10\n\nfunc add_coins(amount: int):\n\tmars_coins += amount\n\nfunc spend_coins(amount: int) -> bool:\n\tif mars_coins >= amount:\n\t\tmars_coins -= amount\n\t\treturn true\n\treturn false\n\nfunc buy_train_ticket() -> bool:\n\treturn spend_coins(TRAIN_TICKET_COST)\n`, message: "CLAWD: economy.gd" },
    { path: "shared/player.gd", content: `extends CharacterBody2D\n\nconst SPEED = 150.0\n\nfunc _physics_process(delta):\n\tvar dir = Vector2(\n\t\tInput.get_action_strength("ui_right") - Input.get_action_strength("ui_left"),\n\t\tInput.get_action_strength("ui_down") - Input.get_action_strength("ui_up")\n\t)\n\tif dir != Vector2.ZERO:\n\t\tvelocity = dir.normalized() * SPEED\n\telse:\n\t\tvelocity = Vector2.ZERO\n\tmove_and_slide()\n`, message: "CLAWD: player.gd" },
    { path: "shared/train.gd", content: `extends Node\n\nsignal travel_requested(destination: String)\n\nconst PARISHES = ["parish_1","parish_2","parish_3","parish_4","parish_5","parish_6","mountain"]\n\nfunc travel_to(parish: String):\n\tif parish in PARISHES:\n\t\temit_signal("travel_requested", parish)\n`, message: "CLAWD: train.gd" },
  ];
  let results = [];
  for (const f of files) results.push(await createOrUpdateFile(f.path, f.content, f.message));
  bot.sendMessage(chatId, `🦞 Repo setup complete!\n\n${results.join("\n")}`);
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🦞 *Commands:*\n/start — Wake me up\n/setup — Set up GitHub repo\n/help — This menu\n\nOr just talk to me naturally!`,
    { parse_mode: "Markdown" });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const session = getSession(chatId);
  session.push({ role: "user", content: text });
  const thinking = await bot.sendMessage(chatId, "🦞 thinking...");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 1024,
      system: SYSTEM_PROMPT, messages: session,
    });
    const reply = response.content[0].text;
    session.push({ role: "assistant", content: reply });
    const display = reply.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, "").trim();
    await bot.editMessageText(display || "✅ Done!", { chat_id: chatId, message_id: thinking.message_id });
    if (reply.includes("<ACTION>")) await executeActions(reply, chatId, thinking.message_id);
    if (session.length > 20) session.splice(0, 2);
  } catch (err) {
    await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: thinking.message_id });
  }
});

console.log("🦞 CLAWD is online — We Goin To Mars!");
