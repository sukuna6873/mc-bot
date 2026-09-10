import "dotenv/config";
import bedrockProtocol from "bedrock-protocol";
import express from "express";
import OpenAI from "openai";

const app = express();
let client;
let isConnected = false;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function askAI(query) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful Minecraft assistant. Keep answers short and concise (under 100 characters). Answer based on Minecraft Bedrock edition version 1.26.45 knowledge (dont use special characters in your answers like emoji, markdown, etc use only text).",
        },
        { role: "user", content: query },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });
    return (
      completion.choices[0]?.message?.content?.trim() || "No response from AI."
    );
  } catch (err) {
    console.error("AI API error:", err?.message);
    return "Sorry, I couldn't process your request right now.";
  }
}

function sendChat(message) {
  try {
    if (!client) {
      console.error("Cannot send chat: client is not connected");
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
    console.error("Error sending chat:", err?.message ?? err);
  }
}

function splitMessage(text, maxLen = 150) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf(" ", maxLen);
    if (cut === -1 || cut === 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

function connectBot() {
  client = bedrockProtocol.createClient({
    host: process.env.MC_HOST, // Minecraft server IP or hostname
    port: Number(process.env.MC_PORT), // Minecraft server port
    username: process.env.MC_USERNAME, // Minecraft username
    offline: process.env.MC_OFFLINE === "true", // set to true for offline mode
    profilesFolder: "./profiles", // stores login tokens
  });

  client.on("connect", () => {
    console.log("Connected to the server!");
  });

  client.on("join", () => {
    console.log("Bot spawned!");
    isConnected = true;
  });

  client.on("text", async (packet) => {
    try {
      console.log(
        `[DEBUG] Text event: type=${packet.type} from=${packet.source_name} msg=${packet.message}`,
      );

      if (packet.type !== "chat") return;
      if (packet.source_name === client.username) return;

      const msg = packet.message?.trim() || "";
      if (!msg.toLowerCase().startsWith("bot ")) return;

      const question = msg.slice(4).trim();
      if (!question) {
        sendChat("Usage: bot <question>");
        return;
      }

      console.log(`[GAME] ${packet.source_name} asked: ${question}`);

      const answer = await askAI(question);
      console.log(`[GAME] AI answer: ${answer}`);

      const parts = splitMessage(answer);

      for (let i = 0; i < parts.length; i++) {
        sendChat(parts[i]);
        if (i < parts.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      console.log(`[GAME] Replied to ${packet.source_name}: ${answer}`);
    } catch (err) {
      console.error("Error handling text event:", err?.message ?? err);
    }
  });

  client.on("death_info", async (packet) => {
    console.log(`[DEBUG] Death info:`, JSON.stringify(packet));
    client.close();
    isConnected = false;
    client = null;
    console.log("Bot died. Reconnecting in 30 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 30000));
    connectBot();
  });

  client.on("disconnect", async (packet) => {
    console.log(`[DEBUG] Disconnect packet:`, JSON.stringify(packet));
    client.close();
    isConnected = false;
    client = null;
    console.log(
      `Bot disconnected: ${packet.reason || "unknown reason"}. Reconnecting in 30 seconds...`,
    );
    await new Promise((resolve) => setTimeout(resolve, 30000));
    connectBot();
  });

  client.on("error", (err) => console.error("Client error:", err.message));
}

async function getServerStatus() {
  const host = process.env.MC_HOST;
  const port = Number(process.env.MC_PORT);
  const platform = process.env.MC_PLATFORM || "bedrock"; // Default to "bedrock" if not specified
  const url = `https://minecraft-serverhub.com/api/ping?host=${host}&port=${port}&platform=${platform}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch server status:", err.message);
    return null;
  }
}

app.get("/", async (_, res) => {
  try {
    const status = await getServerStatus();

    const botStatus = isConnected
      ? "Bot is connected 🤖"
      : "Bot is disconnected ❌";

    const serverOnline = status?.online ?? false;

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

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
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
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

        <h1>🎮 Minecraft Server</h1>

        <!-- Bot Status -->
        <div class="card">
          <h2>🤖 Bot Status</h2>

          <div class="status ${isConnected ? "online" : "offline"}">
            <span>
              ${botStatus}
            </span>
          </div>
        </div>

        <!-- Server Status -->
        <div class="card">
          <h2>🌐 Server Status</h2>

          <div class="info">
            <span class="label">Status</span>
            <span class="value ${serverOnline ? "online" : "offline"}">
              ${serverOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>

          <div class="info">
            <span class="label">Players</span>
            <span class="value">
              ${status?.players?.online ?? 0}
              /
              ${status?.players?.max ?? 0}
            </span>
          </div>

          <div class="info">
            <span class="label">Version</span>
            <span class="value">
              ${status?.version ?? "Unknown"}
            </span>
          </div>

          <div class="info">
            <span class="label">Ping</span>
            <span class="value">
              ${status?.ping ?? "N/A"} ms
            </span>
          </div>

          <div class="info">
            <span class="label">MOTD</span>
            <span class="value motd">
              ${status?.motd ?? "Unknown"}
            </span>
          </div>
        </div>

        <div class="refresh">
          Page generated at ${new Date().toLocaleString()}
        </div>

      </div>
    </body>
    </html>
  `);
  } catch (err) {
    console.error("Failed to fetch server status:", err.message ?? err);
    res.status(500).send("Failed to fetch server status");
  }
});

app.head("/health", (_, res) => res.sendStatus(200));
app.get("/health", (_, res) => res.sendStatus(200));

connectBot();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
