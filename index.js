import "dotenv/config";
import bedrockProtocol from "bedrock-protocol";
import express from "express";
import OpenAI from "openai";

const app = express();

let client = null;
let isConnected = false;
let reconnectTimer = null;
let reconnecting = false;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// =========================
// AI
// =========================

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

    return "Sorry, I couldn't process your request right now.";
  }
}

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
// SPLIT MESSAGE
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
// RECONNECT
// =========================

function scheduleReconnect(reason = "unknown reason") {
  // Prevent multiple reconnect timers
  if (reconnectTimer || reconnecting) {
    console.log("[RECONNECT] Already scheduled. Ignoring duplicate event.");
    return;
  }

  isConnected = false;

  console.log(`[RECONNECT] Reason: ${reason}`);
  console.log("[RECONNECT] Reconnecting in 30 seconds...");

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnecting = false;

    console.log("[RECONNECT] Attempting to reconnect...");

    client = null;

    connectBot();
  }, 30000);

  reconnecting = true;
}

// =========================
// CONNECT BOT
// =========================

function connectBot() {
  // Don't create multiple clients
  if (client) {
    console.log("[BOT] Client already exists. Skipping connection.");
    return;
  }

  console.log("[BOT] Connecting to Minecraft server...");

  try {
    client = bedrockProtocol.createClient({
      host: process.env.MC_HOST,
      port: Number(process.env.MC_PORT),
      username: process.env.MC_USERNAME,
      offline: process.env.MC_OFFLINE === "true",
      profilesFolder: "./profiles",
    });
  } catch (err) {
    console.error("[BOT] Failed to create client:", err?.message ?? err);

    client = null;
    isConnected = false;

    scheduleReconnect("failed to create client");

    return;
  }

  // =========================
  // CONNECT
  // =========================

  client.on("connect", () => {
    console.log("[BOT] Connected to Minecraft server.");
  });

  // =========================
  // JOIN
  // =========================

  client.on("join", () => {
    console.log("[BOT] Bot spawned successfully.");

    isConnected = true;
    reconnecting = false;

    console.log("[BOT] Ready to receive chat messages.");
  });

  // =========================
  // CHAT
  // =========================

  client.on("text", async (packet) => {
    try {
      console.log(
        `[DEBUG] Text event: type=${packet.type} from=${packet.source_name} msg=${packet.message}`
      );

      // Only process normal chat
      if (packet.type !== "chat") {
        return;
      }

      // Make sure client still exists
      if (!client) {
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
        // Check connection before sending
        if (!client || !isConnected) {
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
  // DEATH
  // =========================

  client.on("death_info", (packet) => {
    console.log(
      "[BOT] Death info:",
      JSON.stringify(packet)
    );

    isConnected = false;

    scheduleReconnect("bot died");
  });

  // =========================
  // DISCONNECT
  // =========================

  client.on("disconnect", (packet) => {
    console.log(
      "[BOT] Disconnect packet:",
      JSON.stringify(packet)
    );

    isConnected = false;

    scheduleReconnect(
      packet?.reason || "Minecraft disconnected"
    );
  });

  // =========================
  // CLOSE
  // =========================

  client.on("close", () => {
    console.log("[BOT] Client connection closed.");

    isConnected = false;

    // IMPORTANT:
    // DO NOT call client.close() here.
    //
    // Calling client.close() inside the close event
    // causes:
    //
    // close -> close() -> close -> close() -> ...
    //
    // which caused your Maximum call stack size exceeded error.

    scheduleReconnect("connection closed");
  });

  // =========================
  // END
  // =========================

  client.on("end", () => {
    console.log("[BOT] Client stream ended.");

    isConnected = false;

    scheduleReconnect("stream ended");
  });

  // =========================
  // ERROR
  // =========================

  client.on("error", (err) => {
    console.error(
      "[BOT ERROR]",
      err?.message ?? err
    );

    // Don't immediately reconnect here.
    //
    // Usually disconnect/close/end will follow.
    // If they don't, the process can remain alive
    // and we don't want duplicate reconnect attempts.
  });
}

// =========================
// SERVER STATUS
// =========================

async function getServerStatus() {
  const host = process.env.MC_HOST;
  const port = Number(process.env.MC_PORT);
  const platform =
    process.env.MC_PLATFORM || "bedrock";

  const url =
    `https://minecraft-serverhub.com/api/ping` +
    `?host=${encodeURIComponent(host)}` +
    `&port=${port}` +
    `&platform=${encodeURIComponent(platform)}`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error(
      "[STATUS] Failed to fetch server status:",
      err?.message ?? err
    );

    return null;
  }
}

// =========================
// HOME PAGE
// =========================

app.get("/", async (_, res) => {
  try {
    const status = await getServerStatus();

    const botStatus = isConnected
      ? "Bot is connected"
      : "Bot is disconnected";

    const serverOnline = status?.online ?? false;

    res.send(`
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>Minecraft Bot Status</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .container {
      width: 100%;
      max-width: 600px;
    }

    h1 {
      text-align: center;
      margin-bottom: 25px;
      font-size: 32px;
    }

    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.25);
    }

    .card h2 {
      margin-bottom: 18px;
      font-size: 20px;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: bold;
    }

    .online {
      color: #22c55e;
    }

    .offline {
      color: #ef4444;
    }

    .info {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #334155;
      gap: 20px;
    }

    .info:last-child {
      border-bottom: none;
    }

    .label {
      color: #94a3b8;
    }

    .value {
      font-weight: bold;
      text-align: right;
    }

    .motd {
      white-space: pre-line;
      word-break: break-word;
    }

    .refresh {
      text-align: center;
      color: #64748b;
      font-size: 14px;
      margin-top: 15px;
    }
  </style>
</head>

<body>

  <div class="container">

    <h1>Minecraft Server</h1>

    <!-- Bot Status -->

    <div class="card">

      <h2>Bot Status</h2>

      <div
        class="status ${isConnected ? "online" : "offline"}"
      >
        <span>
          ${botStatus}
        </span>
      </div>

    </div>

    <!-- Server Status -->

    <div class="card">

      <h2>Server Status</h2>

      <div class="info">
        <span class="label">
          Status
        </span>

        <span
          class="value ${serverOnline ? "online" : "offline"}"
        >
          ${serverOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div class="info">
        <span class="label">
          Players
        </span>

        <span class="value">
          ${status?.players?.online ?? 0}
          /
          ${status?.players?.max ?? 0}
        </span>
      </div>

      <div class="info">
        <span class="label">
          Version
        </span>

        <span class="value">
          ${status?.version ?? "Unknown"}
        </span>
      </div>

      <div class="info">
        <span class="label">
          Ping
        </span>

        <span class="value">
          ${status?.ping ?? "N/A"} ms
        </span>
      </div>

      <div class="info">
        <span class="label">
          MOTD
        </span>

        <span class="value motd">
          ${status?.motd ?? "Unknown"}
        </span>
      </div>

    </div>

    <div class="refresh">
      Page generated at
      ${new Date().toLocaleString()}
    </div>

  </div>

</body>
</html>
    `);
  } catch (err) {
    console.error(
      "[HTTP] Failed to fetch server status:",
      err?.message ?? err
    );

    res
      .status(500)
      .send("Failed to fetch server status");
  }
});

// =========================
// HEALTH CHECK
// =========================

app.head("/health", (_, res) => {
  res.sendStatus(200);
});

app.get("/health", (_, res) => {
  res.sendStatus(200);
});

// =========================
// START BOT
// =========================

connectBot();

// =========================
// START EXPRESS
// =========================

const PORT = Number(process.env.PORT) || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[HTTP] Server started on port ${PORT}`
  );
});
