export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Use POST"
    });
  }

  const { from, to, roomId } = req.body || {};

  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !from.trim() ||
    !to.trim()
  ) {
    return res.status(400).json({
      ok: false,
      error: "Укажи имена отправителя и получателя"
    });
  }

  if (from.trim().toLowerCase() === to.trim().toLowerCase()) {
    return res.status(400).json({
      ok: false,
      error: "Нельзя пригласить самого себя"
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Запрос приглашения принят",
    from: from.trim(),
    to: to.trim(),
    roomId: roomId || null,
    note: "Для доставки приглашения получателю требуется общее серверное хранилище."
  });
}
