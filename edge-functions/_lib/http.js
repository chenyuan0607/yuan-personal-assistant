export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  },
});

export async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("请求必须是JSON");
  return request.json();
}

export const errorJson = (error, status = 400) => json({ ok: false, error: error.message }, status);
