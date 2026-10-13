import { isAuthError, requireHost } from "@/lib/server/auth";
import { randomId } from "@/lib/server/crypto";
import { requireBucket } from "@/lib/server/env";
import { fail, json } from "@/lib/server/http";
import { assertImage } from "@/lib/server/validation";

export async function POST(request: Request) {
  try {
    await requireHost(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("file is required");
    }

    await assertImage(file);
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "img";
    const key = `${randomId("img_")}.${extension}`;
    await requireBucket().put(`question-images/${key}`, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    return json(
      { key, url: `/api/images/${encodeURIComponent(key)}` },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "image upload failed";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
