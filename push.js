
const PUSH_API = "https://diet-checkin-reminder.gaoyuan-1516-b63.workers.dev";
const DEVICE_KEY = "diet_push_device_id";
const DB_KEY = "diet_checkin_v1";

// 生成或读取当前手机的唯一标识
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }

  return id;
}

// 当前手机日期
function getToday() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 把打卡状态同步到云端
window.syncMealStatus = async function(date) {
  try {
    const id = localStorage.getItem(DEVICE_KEY);
    if (!id) return;

    const db = JSON.parse(
      localStorage.getItem(DB_KEY) || '{"days":{}}'
    );

    const day = db.days?.[date] || {};

    const response = await fetch(`${PUSH_API}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        date,
        meals: {
          breakfast: day.breakfast === true,
          lunch: day.lunch === true,
          dinner: day.dinner === true
        }
      })
    });

    if (!response.ok) {
      console.warn("打卡状态同步失败", response.status);
    }
  } catch (error) {
    console.warn("云端同步暂时不可用", error);
  }
};

// Base64URL 公钥转 Uint8Array
function decodePublicKey(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(base64);
  const output = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

// 开启推送
async function enablePush(button) {
  try {
    if (!("Notification" in window) ||
        !("serviceWorker" in navigator)) {
      alert("当前环境不支持通知，请使用已安装的手机桌面应用。");
      return;
    }

    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent);

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    if (isIOS && !isStandalone) {
      alert("请先从 iPhone 桌面上的「饮食自律」图标打开应用，再开启通知。");
      return;
    }

    if (!("PushManager" in window)) {
      alert("当前浏览器暂不支持推送功能。");
      return;
    }

    // 必须由用户点击按钮触发权限申请
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      alert("你还没有允许通知，请在系统设置中开启通知权限。");
      return;
    }

    button.textContent = "正在连接通知服务…";

    const [configResponse, registration] = await Promise.all([
      fetch(`${PUSH_API}/config`),
      navigator.serviceWorker.ready
    ]);

    if (!configResponse.ok) {
      throw new Error("无法读取推送配置");
    }

    const config = await configResponse.json();

    if (!config.publicKey) {
      throw new Error("推送公钥为空");
    }

    let subscription =
      await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodePublicKey(config.publicKey)
      });
    }

    const id = getDeviceId();

    const saveResponse = await fetch(`${PUSH_API}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        subscription: subscription.toJSON()
      })
    });

    if (!saveResponse.ok) {
      throw new Error("服务器保存订阅失败");
    }

    button.textContent = "✓ 通知已开启";

    // 开启后立即同步今天已有的三餐状态
    await window.syncMealStatus(getToday());

    alert("通知开启成功！以后会按照设定时间提醒你。");

  } catch (error) {
    console.error("开启推送失败：", error);
    button.textContent = "重新开启通知";
    alert("开启失败：" + error.message);
  }
}

// 创建开启通知按钮
function createPushButton() {
  if (document.getElementById("diet-push-button")) return;

  const button = document.createElement("button");

  button.id = "diet-push-button";
  button.textContent = "开启消息提醒";

  button.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: calc(env(safe-area-inset-bottom) + 88px);
    z-index: 99999;
    padding: 12px 18px;
    border: none;
    border-radius: 24px;
    background: #557b61;
    color: white;
    font-size: 14px;
    box-shadow: 0 3px 12px rgba(0,0,0,.18);
  `;

  button.addEventListener("click", () => enablePush(button));

  document.body.appendChild(button);

  if (Notification.permission === "granted") {
    button.textContent = "开启消息提醒";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createPushButton);
} else {
  createPushButton();
}
