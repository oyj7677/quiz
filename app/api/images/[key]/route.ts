import { requireBucket } from "@/lib/server/env";
import { fail, getRouteParam } from "@/lib/server/http";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await getRouteParam(context);
    const object = await requireBucket().get(`question-images/${key}`);
    if (!object) {
      return fail("image not found", 404);
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "image read failed", 500);
  }
}
