import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOCATION, buildForecastUrl, formatWeather, weatherLabel } from "../js/weather.js";

test("default weather location is Liuzhi Special District", () => {
  assert.deepEqual(DEFAULT_LOCATION, { name: "六枝特区", latitude: 26.2342, longitude: 105.426 });
});

test("forecast URL requests current and daily weather in local timezone", () => {
  const url = new URL(buildForecastUrl(DEFAULT_LOCATION));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "26.2342");
  assert.match(url.searchParams.get("current"), /temperature_2m/);
  assert.match(url.searchParams.get("daily"), /temperature_2m_max/);
  assert.equal(url.searchParams.get("timezone"), "auto");
});

test("weather codes and forecast payload become compact Chinese display data", () => {
  assert.equal(weatherLabel(0), "晴");
  assert.equal(weatherLabel(61), "小雨");
  assert.equal(weatherLabel(999), "天气变化中");
  const result = formatWeather({
    current: { temperature_2m: 22.4, weather_code: 2 },
    daily: {
      time: ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"],
      weather_code: [2, 61, 3, 0],
      temperature_2m_max: [27.2, 25.1, 24.8, 28.2],
      temperature_2m_min: [18.3, 17.8, 16.2, 18.9],
    },
  }, DEFAULT_LOCATION);
  assert.equal(result.current.temperature, 22);
  assert.equal(result.current.label, "多云");
  assert.equal(result.today.high, 27);
  assert.equal(result.forecast.length, 3);
  assert.deepEqual(result.forecast.map((day) => day.label), ["小雨", "阴", "晴"]);
});
