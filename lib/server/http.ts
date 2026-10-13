export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(message: string, status = 400) {
  return json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("요청 형식이 올바르지 않습니다.");
  }
}

export function getRouteParam<T extends Record<string, string>>(
  context: { params: T | Promise<T> }
) {
  return Promise.resolve(context.params);
}
