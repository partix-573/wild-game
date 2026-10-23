import { randomBytes } from "node:crypto";

const MAX_PLAYERS = 8;
const ROOM_TTL = 86400;
const ROOM_PREFIX = "matrix:room:";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Используй POST"
    });
  }

  // Поддерживаем названия переменных Upstash из твоего проекта.
  const redisUrl =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_URL ||
    process.env.REDIS_REST_URL;

  const redisToken =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_KV_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(500).json({
      ok: false,
      error: "Не найдены URL или токен Upstash. Проверь Environment Variables."
    });
  }

  async function redis(...command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: Bearer ${redisToken},
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Upstash вернул неправильный ответ");
    }

    if (!response.ok || data.error) {
      throw new Error("Запрос к Upstash не выполнен");
    }

    return data.result;
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Некорректный JSON"
        });
      }
    }

    const action = body.action;

    if (!["create", "join", "get"].includes(action)) {
      return res.status(400).json({
        ok: false,
        error: "Действие должно быть create, join или get"
      });
    }

    const name = String(body.playerName || "")
      .trim()
      .slice(0, 20);

    if ((action === "create" || action === "join") && !name) {
      return res.status(400).json({
        ok: false,
        error: "Введи имя игрока"
      });
    }

    if (action === "create") {
      let id;
      let key;
      let attempts = 0;

      do {
        id = randomBytes(5).toString("hex").slice(0, 6).toUpperCase();
        key = ${ROOM_PREFIX}${id};
        attempts++;

        if (attempts > 10) {
          throw new Error("Не удалось создать ID комнаты");
        }
      } while (await redis("EXISTS", key));

      const room = {
        id,
        host: name,
        players: [name],
        createdAt: Date.now()
      };

      const saved = await redis(
        "SET",
        key,
        JSON.stringify(room),
        "EX",
        ROOM_TTL,
        "NX"
      );

      if (saved !== "OK") {
        throw new Error("Не удалось сохранить комнату");
      }

      return res.status(200).json({
        ok: true,
        roomId: id,
        room
      });
    }

    const id = String(body.roomId || "").trim().toUpperCase();

    if (!/^[A-F0-9]{6}$/.test(id)) {
      return res.status(400).json({
        ok: false,
        error: "Неверный ID комнаты"
      });
    }

    const key = ${ROOM_PREFIX}${id};
    const savedRoom = await redis("GET", key);

    if (!savedRoom) {
      return res.status(404).json({
        ok: false,
        error: "Комната не найдена или истекла"
      });
    }

    const room = JSON.parse(savedRoom);

    if (!room || !Array.isArray(room.players)) {
      throw new Error("Некорректные данные комнаты");
    }

    if (action === "join") {
      const alreadyJoined = room.players.some(
        player => String(player).toLowerCase() === name.toLowerCase()
      );if (!alreadyJoined) {
        if (room.players.length >= MAX_PLAYERS) {
          return res.status(409).json({
            ok: false,
            error: "Комната заполнена"
          });
        }

        room.players.push(name);

        await redis(
          "SET",
          key,
          JSON.stringify(room),
          "EX",
          ROOM_TTL
        );
      }
    }

    return res.status(200).json({
      ok: true,
      roomId: id,
      room
    });
  } catch (error) {
    console.error("MATRIX API error:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка Redis/Upstash. Проверь URL, токен и доступ к базе."
    });
  }
}
