"""Thumbnail generation: a still frame from a clip, composited with bold
text — the same visual language as the in-video hook overlay (hooks.py),
applied once as a static 16:9 image instead of burned into video.

Two paths:
  - generate_thumbnail_card(): PIL text card over a picked frame. No new AI
    call — reuses whatever hook/title text the moment-detection pass already
    generated for the clip (main.py's viral_hook_text / video_title_for_
    youtube_short, already sitting in every job's metadata.json). Always
    available, zero new dependencies (Pillow and hooks.py's create_hook_image
    already exist).
  - generate_thumbnail_ai(): Gemini's native image-generation model composes
    a thumbnail from scratch, using a picked frame as a background/style
    reference. Recovered and trimmed from OpenShorts' own thumbnail.py
    (git show 774b05f^:thumbnail.py) — the original had no billing/session
    code of its own (that lived in app.py's now-deleted routes), so the
    generation call itself ports over almost unchanged; what got dropped is
    analyze_video_for_titles()/refine_titles(), since title/hook text is
    already generated for free during moment detection and doesn't need a
    second Gemini pass.

    This goes through google-genai's native image-output API
    (response_modalities=["IMAGE"]) directly — llm_client.py's OpenRouter
    path has no equivalent (that's a text-only chat-completions REST
    client), so this function needs a real GEMINI_API_KEY specifically.
    Callers must check for that (independent of LLM_PROVIDER) before
    offering this path; it does not fall back to OpenRouter.
"""
import os
import uuid

import cv2
from PIL import Image

from hooks import create_hook_image


def pick_thumbnail_frame(video_path, out_jpg_path, prefer_faces=True, samples=5):
    """Grab the best still frame from a clip for a thumbnail background.

    Samples a handful of timestamps across the clip and keeps whichever has
    the largest detected face — a presenter looking at camera reads better
    as a thumbnail than an empty establishing shot — falling back to the
    first readable sample (roughly the clip's midpoint) if no face is found
    anywhere, or duration can't be read. Mirrors the frame-grab idiom already
    used for the reframe editor's scene-picker previews (app.py's
    _clip_scene_workfile build(), ~app.py:2790-2807).
    """
    import main as m  # heavy import (cv2/mediapipe) kept lazy, matches app.py's own routes

    cap = cv2.VideoCapture(video_path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            return False

        best_frame, best_score = None, -1
        fractions = (0.5, 0.3, 0.7, 0.15, 0.85)[:max(1, samples)]
        for frac in fractions:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * frac))
            ok, frame = cap.read()
            if not ok:
                continue
            if best_frame is None:
                best_frame = frame  # first readable sample is the fallback
            if not prefer_faces:
                continue
            try:
                faces = m.detect_face_candidates(frame)
            except Exception:
                faces = []
            if faces:
                score = max(f['box'][2] * f['box'][3] for f in faces)
                if score > best_score:
                    best_score, best_frame = score, frame

        if best_frame is None:
            return False
        return bool(cv2.imwrite(out_jpg_path, best_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90]))
    finally:
        cap.release()


def generate_thumbnail_card(frame_jpg_path, text, out_jpg_path, style="classic"):
    """Composite a hooks.py-style text card onto a still frame -> flat JPG.

    Reuses create_hook_image() exactly as the in-video hook overlay does
    (same wrapping/emoji/style logic), just pasted once with PIL instead of
    burned via an FFmpeg overlay pass — there's no video here, so no need to
    invoke FFmpeg at all for this path.
    """
    bg = Image.open(frame_jpg_path).convert("RGB")
    card_path = os.path.join(
        os.path.dirname(out_jpg_path) or ".", f"temp_thumb_card_{uuid.uuid4().hex[:8]}.png")
    try:
        create_hook_image(text, int(bg.width * 0.9), card_path, font_scale=1.3, style=style)
        card = Image.open(card_path).convert("RGBA")
        x = (bg.width - card.width) // 2
        # Lower third, the conventional thumbnail-card position — clamped so
        # a tall multi-line card never runs off the bottom edge.
        y = min(int(bg.height * 0.62), bg.height - card.height - 20)
        canvas = bg.convert("RGBA")
        canvas.alpha_composite(card, (max(0, x), max(20, y)))
        canvas.convert("RGB").save(out_jpg_path, quality=92)
        return True
    finally:
        if os.path.exists(card_path):
            os.remove(card_path)


def generate_thumbnail_ai(api_key, title, out_dir, frame_jpg_path=None,
                          extra_prompt="", count=3, video_context=""):
    """AI-composed thumbnails via Gemini's native image-generation model.

    Trimmed from the original OpenShorts thumbnail.py's generate_thumbnail():
    dropped the session_id-keyed output-dir convention (this fork writes
    directly to a caller-supplied out_dir instead — no multi-tenant session
    store to key off of) and the face_image_path parameter (the picked clip
    frame already shows the presenter, a second face reference isn't needed
    for this single-user tool). The prompt and the actual generate_content
    call are otherwise unchanged from the working original.

    Returns a list of saved JPG paths (may be shorter than `count` if some
    generations failed; raises only if ALL of them failed).
    """
    from google import genai
    from google.genai import types

    os.makedirs(out_dir, exist_ok=True)
    client = genai.Client(api_key=api_key)

    prompt_parts = []
    if frame_jpg_path and os.path.exists(frame_jpg_path):
        prompt_parts.append(Image.open(frame_jpg_path))

    context_block = f"\nVIDEO CONTEXT (use this to understand the video and design a relevant thumbnail):\n{video_context}\n" if video_context else ""
    extra_block = f"\n⚠️ MANDATORY USER INSTRUCTIONS (MUST follow these exactly — they override any default behavior):\n{extra_prompt}\n" if extra_prompt else ""

    text_prompt = f"""Generate a professional, eye-catching YouTube thumbnail image.

VIDEO TITLE (for reference — do NOT put the full title on the thumbnail): "{title}"
{context_block}
TEXT ON THE THUMBNAIL:
- Based on the title AND the video context, create a SHORT visual hook: 1 to 5 words maximum
- It should capture the core emotion, surprise, or promise of the video
- The thumbnail text should COMPLEMENT the video title (which appears below it on the platform), not repeat it
- Use ALL CAPS for maximum impact, split into 2-3 lines
{extra_block}
DESIGN REQUIREMENTS:
- The text MUST be large, bold, and high-contrast (readable at small sizes)
- Use vibrant, eye-catching colors that match the video's mood
- Professional YouTube thumbnail aesthetic
- Clean composition — text and subject as clear focal points
- NO clutter, NO small text, NO watermarks"""

    if frame_jpg_path and os.path.exists(frame_jpg_path):
        text_prompt += "\n- Use the provided frame as the background/subject reference — keep the person recognizable"

    prompt_parts.append(text_prompt)

    thumbnails = []
    last_error = None
    for i in range(count):
        print(f"🎨 [Thumbnail] Generating thumbnail {i + 1}/{count}...")
        try:
            response = client.models.generate_content(
                model="gemini-3.1-flash-image-preview",
                contents=prompt_parts,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio="16:9", image_size="2K"),
                ),
            )
            for part in response.parts:
                if part.text is not None:
                    print(f"📝 [Thumbnail] Gemini text: {part.text}")
                elif image := part.as_image():
                    filepath = os.path.join(out_dir, f"thumb_ai_{i + 1}.jpg")
                    image.save(filepath)
                    thumbnails.append(filepath)
                    print(f"✅ [Thumbnail] Saved: {filepath}")
                    break
        except Exception as e:
            last_error = str(e)
            print(f"❌ [Thumbnail] Generation {i + 1} failed: {e}")

    if not thumbnails and last_error:
        raise RuntimeError(f"All thumbnail generations failed. Last error: {last_error}")
    return thumbnails
