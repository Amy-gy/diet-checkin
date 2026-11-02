
import webpush from "web-push";

const SITE_ORIGIN = "https://amy-gy.github.io";
const SITE_URL = "https://amy-gy.github.io/diet-checkin/";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function validId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{10,80}$/.test(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": SITE_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "diet-checkin-reminder" });
    }

    if (url.pathname === "/config" && request.method === "GET") {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || "" });
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      try {
        const { id, subscription } = await request.json();

        if (!validId(id) || !subscription?.endpoint) {
          return json({ error: "订阅信息不完整" }, 400);
        }

        await env.DIET_CHECKIN_KV.put(
          `sub:${id}`,
          JSON.stringify(subscription)
        );

        return json({ ok: true });
      } catch {
        return json({ error: "订阅保存失败" }, 400);
      }
    }

    if (url.pathname === "/status" && request.method === "POST") {
      try {
        const { id, date, meals } = await request.json();

        if (
          !validId(id) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !meals
        ) {
          return json({ error: "打卡数据不完整" }, 400);
        }

        const safeMeals = {};
        for (const meal of ["breakfast", "lunch", "dinner"]) {
          safeMeals[meal] = meals[meal] === true;
        }

        await env.DIET_CHECKIN_KV.put(
          `status:${id}:${date}`,
          JSON.stringify(safeMeals),
          { expirationTtl: 864000 }
        );

        return json({ ok: true });
      } catch {
        return json({ error: "打卡状态同步失败" }, 400);
      }
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  }
};

function chinaTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const value = {};
  for (const p of parts) {
    value[p.type] = p.value;
  }

  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
    minute: Number(value.minute)
  };
}

async function sendReminders(env) {
  if (
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT
  ) {
    console.error("VAPID secrets 尚未配置");
    return;
  }

  const now = chinaTime();

  if (now.minute !== 0 && now.minute !== 30) return;

  let meal = null;
  let mealName = "";

  if (now.hour >= 6 && now.hour < 10) {
    meal = "breakfast";
    mealName = "早餐";
  } else if (now.hour >= 10 && now.hour < 14) {
    meal = "lunch";
    mealName = "午餐";
  } else if (now.hour >= 14 && now.hour < 21) {
    meal = "dinner";
    mealName = "晚餐";
  }

  if (!meal) return;

  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  let cursor;

  do {
    const result = await env.DIET_CHECKIN_KV.list({
      prefix: "sub:",
      limit: 1000,
      cursor
    });

    for (const item of result.keys) {
      const id = item.name.slice(4);

      try {
        const statusText = await env.DIET_CHECKIN_KV.get(
          `status:${id}:${now.date}`
        );

        const status = statusText ? JSON.parse(statusText) : {};

        if (status[meal] === true) continue;

        const slot = `${String(now.hour).padStart(2, "0")}-${now.minute}`;
        const sentKey = `sent:${id}:${now.date}:${meal}:${slot}`;

        if (await env.DIET_CHECKIN_KV.get(sentKey)) continue;

        // 先记录本时段，避免同一时段重复发送
        await env.DIET_CHECKIN_KV.put(sentKey, "1", {
          expirationTtl: 172800
        });

        const subscriptionText = await env.DIET_CHECKIN_KV.get(item.name);
        if (!subscriptionText) continue;

        const subscription = JSON.parse(subscriptionText);

        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: `饮食自律提醒 🌿`,
            body: `别忘了完成今天的${mealName}打卡。`,
            tag: `diet-${meal}`,
            url: SITE_URL
          }),
          { TTL: 60 }
        );
      } catch (error) {
        console.error("推送失败：", error);

        if (error.statusCode === 404 || error.statusCode === 410) {
          await env.DIET_CHECKIN_KV.delete(item.name);
        }
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
}
