import "dotenv/config";
import bedrockProtocol from "bedrock-protocol";
import express from "express";
import OpenAI from "openai";

const app = express();

// =========================
// STATE
// =========================

let isConnected = false;
let reconnecting = false;

// =========================
// OPENAI
// =========================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function askAI(query) {
  try {
    console.log(`[AI] Asking: ${query}`);

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",

      messages: [
        {
          role: "system",
          content:
            "You are a helpful Minecraft assistant. Keep answers short and concise under 100 characters. Answer based on Minecraft Bedrock Edition version 1.26.45 knowledge. Use only plain text. No emojis. No markdown. No special characters.",
        },
        {
          role: "user",
          content: query,
        },
      ],

      max_tokens: 200,
      temperature: 0.7,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      "No response from AI.";

    console.log(`[AI] Response: ${answer}`);

    return answer;
  } catch (err) {
    console.error("[AI ERROR]", err?.message ?? err);

    return "Sorry I could not process your request right now";
  }
}

// =========================
// MINECRAFT CLIENT
// =========================

const client = bedrockProtocol.createClient({
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME,
  offline: process.env.MC_OFFLINE === "true",
  profilesFolder: "./profiles",
});

// =========================
// SEND CHAT
// =========================

function sendChat(message) {
  try {
    if (!client || !isConnected) {
      console.error("[CHAT] Cannot send chat: bot is not connected");
      return;
    }

    client.queue("text", {
      needs_translation: false,
      category: "authored",
      type: "chat",
      source_name: client.username,
      message,
      xuid: "",
      platform_chat_id: "",
      has_filtered_message: false,
    });

    console.log(`[SENT] ${message}`);
  } catch (err) {
    console.error("[CHAT ERROR]", err?.message ?? err);
  }
}

// =========================
// SPLIT LONG MESSAGE
// =========================

function splitMessage(text, maxLen = 150) {
  if (!text || text.length <= maxLen) {
    return [text || ""];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let cut = remaining.lastIndexOf(" ", maxLen);

    if (cut === -1 || cut === 0) {
      cut = maxLen;
    }

    chunks.push(remaining.slice(0, cut));

    remaining = remaining.slice(cut).trim();
  }

  return chunks;
}

// =========================
// MINECRAFT EVENTS
// =========================

client.on("connect", () => {
  console.log("[BOT] Connected to Minecraft server.");
});

client.on("join", () => {
  console.log("[BOT] Bot spawned successfully.");

  isConnected = true;
  reconnecting = false;

  console.log("[BOT] Ready to receive chat messages.");
});

client.on("error", (err) => {
  console.error("[BOT ERROR]", err?.message ?? err);
});

client.on("close", () => {
  console.log("[BOT] Connection closed.");

  isConnected = false;

  // Prevent duplicate reconnect logic
  if (reconnecting) {
    return;
  }

  reconnecting = true;

  console.log("[BOT] Connection lost.");
});

client.on("text", async (packet) => {
  try {
    console.log(
      `[DEBUG] Text event: type=${packet.type} from=${packet.source_name} msg=${packet.message}`
    );

    // Only process normal chat
    if (packet.type !== "chat") {
      return;
    }

    // Ignore bot's own messages
    if (packet.source_name === client.username) {
      return;
    }

    const msg = packet.message?.trim() || "";

    // Command must start with "bot "
    if (!msg.toLowerCase().startsWith("bot ")) {
      return;
    }

    const question = msg.slice(4).trim();

    if (!question) {
      sendChat("Usage: bot <question>");
      return;
    }

    console.log(
      `[GAME] ${packet.source_name} asked: ${question}`
    );

    // =========================
    // ASK AI
    // =========================

    console.log("[AI] Sending request...");

    const answer = await askAI(question);

    console.log(`[GAME] AI answer: ${answer}`);

    // =========================
    // SEND RESPONSE
    // =========================

    const parts = splitMessage(answer);

    for (let i = 0; i < parts.length; i++) {
      if (!isConnected) {
        console.log(
          "[CHAT] Bot disconnected before response could be sent."
        );
        break;
      }

      sendChat(parts[i]);

      // Delay between multiple messages
      if (i < parts.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000)
        );
      }
    }

    console.log(
      `[GAME] Replied to ${packet.source_name}: ${answer}`
    );
  } catch (err) {
    console.error(
      "[CHAT ERROR]",
      err?.message ?? err
    );
  }
});

// =========================
// EXPRESS SERVER
// =========================

app.get("/", (_, res) => {
  res.end("Minecraft AI Bot is running");
});

app.head("/", (_, res) => {
  res.end("Minecraft AI Bot is running");
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});