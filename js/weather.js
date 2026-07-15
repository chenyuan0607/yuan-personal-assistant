export const DEFAULT_LOCATION = { name: "六枝特区", latitude: 26.2342, longitude: 105.426 };

const round = (value) => Math.round(Number(value));

export function weatherLabel(code) {
  if (code === 0) return "晴";
  if ([1].includes(code)) return "晴间多云";
  if ([2].includes(code)) return "多云";
  if ([3].includes(code)) return "阴";
  if ([45, 48].includes(code)) return "有雾";
  if ([51, 53, 55, 56, 57, 61].includes(code)) return "小雨";
  if ([63, 65, 66, 67, 80, 81, 82].includes(code)) return "有雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "有雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "天气变化中";
}

export function buildForecastUrl(location) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "4",
    timezone: "auto",
  });
  return url.href;
}

export function formatWeather(payload, location) {
  const daily = payload.daily;
  const toDay = (index) => ({
    date: daily.time[index],
    label: weatherLabel(daily.weather_code[index]),
    high: round(daily.temperature_2m_max[index]),
    low: round(daily.temperature_2m_min[index]),
  });
  return {
    location,
    current: { temperature: round(payload.current.temperature_2m), label: weatherLabel(payload.current.weather_code) },
    today: toDay(0),
    forecast: [1, 2, 3].map(toDay),
  };
}

const dateLabel = (date) => new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(`${date}T12:00:00+08:00`));

export function initWeather({ root = document, fetchImpl = fetch, storage = localStorage, geolocation = navigator.geolocation } = {}) {
  const panel = root.querySelector("#weather-panel");
  if (!panel) return { refresh: async () => {} };
  const readLocation = () => {
    try { return JSON.parse(storage.getItem("yuan-weather-location")) || DEFAULT_LOCATION; }
    catch { return DEFAULT_LOCATION; }
  };
  const saveLocation = (location) => storage.setItem("yuan-weather-location", JSON.stringify(location));
  const status = root.querySelector("#weather-status");
  const render = (weather) => {
    root.querySelector("#weather-title").textContent = weather.location.name;
    root.querySelector("#weather-current").replaceChildren(Object.assign(document.createElement("strong"), { textContent: `${weather.current.temperature}°` }), Object.assign(document.createElement("span"), { textContent: weather.current.label }));
    root.querySelector("#weather-range").textContent = `今日 ${weather.today.high}° / ${weather.today.low}°`;
    root.querySelector("#weather-forecast").replaceChildren(...weather.forecast.map((day) => {
      const item = document.createElement("div"); item.className = "weather-day";
      item.innerHTML = `<strong>${dateLabel(day.date)}</strong><span>${day.label}</span><span>${day.high}° / ${day.low}°</span>`;
      return item;
    }));
    status.textContent = "";
  };
  const refresh = async (location = readLocation()) => {
    status.textContent = "正在更新天气…";
    try {
      const response = await fetchImpl(buildForecastUrl(location));
      if (!response.ok) throw new Error("weather unavailable");
      render(formatWeather(await response.json(), location));
    } catch { status.textContent = "天气暂不可用，请稍后刷新"; }
  };
  root.querySelector("#weather-refresh").addEventListener("click", () => refresh());
  root.querySelector("#weather-location").addEventListener("click", () => {
    if (!geolocation) { status.textContent = "当前浏览器不支持定位"; return; }
    status.textContent = "正在获取位置…";
    geolocation.getCurrentPosition(({ coords }) => {
      const location = { name: "当前位置", latitude: Number(coords.latitude.toFixed(4)), longitude: Number(coords.longitude.toFixed(4)) };
      saveLocation(location); refresh(location);
    }, () => { status.textContent = "未能获取位置，请检查定位权限"; }, { enableHighAccuracy: false, timeout: 10000 });
  });
  root.querySelector("#weather-city").addEventListener("click", async () => {
    const name = window.prompt("输入城市或区县名称", readLocation().name)?.trim();
    if (!name) return;
    status.textContent = "正在查找城市…";
    try {
      const response = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: "1", language: "zh", format: "json" })}`);
      const match = (await response.json()).results?.[0];
      if (!match) throw new Error("not found");
      const location = { name: match.name, latitude: match.latitude, longitude: match.longitude };
      saveLocation(location); refresh(location);
    } catch { status.textContent = "没有找到这个城市"; }
  });
  refresh();
  return { refresh };
}
