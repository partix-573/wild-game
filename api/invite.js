const { randomBytes } = require("crypto");

const MAX_PLAYERS = 8;
const ROOM_TTL_SECONDS = 86400;
const ROOM_PREFIX = "matrix:room:";

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function getUpstashConfig() {
  const url =
    process.env.UPSTASH_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;

  const token =
    process.env.UPSTASH_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Upstash URL or write token");
  }

  if (!/^https:\/\//i.test(url)) {
    throw new Error("Upstash URL must use HTTPS");
  }

  return { url: url.replace(/\/+$/, ""), token };
}

async function redis(config, ...command) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: Bearer ${config.token},
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(Upstash returned invalid JSON: HTTP ${response.status});
  }

  if (!response.ok || data.error) {
    throw new Error(
      Upstash error: ${data.error || response.status}
    );
  }

  return data.result;
}

function normalizeName(value) {
  return String(value || "").trim().slice(0, 20);
}

function normalizeRoomId(value) {
  return String(value || "").trim().toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendJson(res, 405, {
      ok: false,
      error: "Используй POST"
    });
  }

  let body = req.body || {};

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, {
        ok: false,
        error: "Некорректный JSON"
      });
    }
  }

  if (!body  typeof body !== "object"  Array.isArray(body)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Некорректное тело запроса"
    });
  }

  const action = String(body.action || "").trim().toLowerCase();
  const playerName = normalizeName(body.playerName);
  const roomId = normalizeRoomId(body.roomId);

  if (!["create", "join", "get"].includes(action)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Действие должно быть create, join или get"
    });
  }

  if ((action === "create" || action === "join") && !playerName) {
    return sendJson(res, 400, {
      ok: false,
      error: "Введи имя игрока"
    });
  }

  if (action !== "create" && !/^[A-F0-9]{6}$/.test(roomId)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Неверный ID комнаты"
    });
  }

  try {
    const config = getUpstashConfig();

    if (action === "create") {
      for (let attempt = 0; attempt < 10; attempt++) {
        const id = randomBytes(4)
          .toString("hex")
          .slice(0, 6)
          .toUpperCase();

        const room = {
          id,
          host: playerName,
          players: [playerName],
          createdAt: Date.now()
        };

        const result = await redis(
          config,
          "SET",
          ${ROOM_PREFIX}${id},
          JSON.stringify(room),
          "EX",
          String(ROOM_TTL_SECONDS),
          "NX"
        );

        if (result === "OK") {
          return sendJson(res, 200, {
            ok: true,
            roomId: id,
            room
          });
        }
      }

      throw new Error("Could not create a unique room ID");
    }

    const key = ${ROOM_PREFIX}${roomId};
    const savedRoom = await redis(config, "GET", key);if (!savedRoom) {
      return sendJson(res, 404, {
        ok: false,
        error: "Комната не найдена или срок её действия истёк"
      });
    }

    let room;

    try {
      room = typeof savedRoom === "string"
        ? JSON.parse(savedRoom)
        : savedRoom;
    } catch {
      throw new Error("Invalid saved room data");
    }

    if (!room || !Array.isArray(room.players)) {
      throw new Error("Invalid room format");
    }

    if (action === "join") {
      const alreadyJoined = room.players.some(
        player =>
          String(player).toLowerCase() === playerName.toLowerCase()
      );

      if (!alreadyJoined) {
        if (room.players.length >= MAX_PLAYERS) {
          return sendJson(res, 409, {
            ok: false,
            error: "Комната заполнена"
          });
        }

        room.players.push(playerName);

        await redis(
          config,
          "SET",
          key,
          JSON.stringify(room),
          "EX",
          String(ROOM_TTL_SECONDS)
        );
      }
    }

    return sendJson(res, 200, {
      ok: true,
      roomId,
      room
    });
  } catch (error) {
    console.error(
      "MATRIX API error:",
      error instanceof Error ? error.message : error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Ошибка сервера. Проверь настройки Upstash и журналы Vercel."
    });
  }
};
