"""SCREENCAST layout: full-width content on top, the speaker underneath.

The fourth layout. It targets the failure this repo has now attacked three
times: a screen recording that happens to contain a face gets classified TRACK,
the 9:16 crop keeps a centre strip, and the chart or headline the shot is
actually about comes out sliced mid-word.

The two previous attempts tried to find that content in pixels and both failed
(see the note above analyze_scenes_strategy in main.py): edge density and MSER
text density BOTH score ordinary detailed footage higher than a clean panel of
text, because they measure visual busyness rather than meaning. The third
attempt asked Gemini and detected well, but decided badly: it flagged corner
tickers and demoted well-framed talking heads to the blurred layout.

What is different here is the question asked and what the answer is used for.

  - The question is how much of the WIDTH the content spans, not how much of the
    duration it covers. Coverage did not separate the cases (screencasts ran
    88-97% of the video, a corner-ticker clip 2%, but the failure was on the
    ticker anyway). Width is the quantity that actually decides whether a 9:16
    crop destroys information: a corner bug spans ~15% of the frame and survives
    any crop, a spreadsheet spans ~100% and cannot.
  - The answer routes to THIS layout, not to GENERAL. The old wiring's worst
    case was shrinking a subject into blurred filler to preserve a corner
    counter. Here the worst case is showing the content full width above the
    speaker, which is a reasonable frame even when the trigger was wrong.

Off by default (``SCREENCAST_LAYOUT=1``). Needs GEMINI_API_KEY; without one it
is a silent no-op, like every other optional Gemini path here.
"""
import json
import os
import time

import numpy as np

ENABLED = os.environ.get("SCREENCAST_LAYOUT", "0") == "1"

# Fraction of the frame width the content must span. A corner ticker, logo or
# channel bug sits far below this; a screen recording, slide or spreadsheet sits
# near 1.0. This is the axis the previous attempt did not ask about.
MIN_WIDTH_FRACTION = 0.5

# Above this the content fills the frame, so any presenter is composited ON TOP
# of it rather than sitting beside it. Stacking then shows the same content
# twice: measured on an Excel walkthrough where the speaker is keyed into the
# corner, the bottom band came out as a zoomed crop of the same spreadsheet.
# Those scenes get the full-width GENERAL layout instead, which is the fix they
# actually needed — the default GENERAL ratio crops ~24% off the sides, and on a
# spreadsheet the discarded columns are the point.
STACK_MAX_WIDTH_FRACTION = 0.85

# Seconds of overlap before a scene counts as showing the content.
MIN_OVERLAP_SECONDS = 0.25

# ...AND that overlap must cover at least this fraction of the scene's own
# duration. The absolute-seconds gate alone let a scene through on a sliver:
# a 6.43s scene with only its last 0.39s brushing a content range (6% of it,
# comfortably over 0.25s) got the WHOLE scene routed as screen-share, showing
# the same wide-content crop over a talking-head shot for the other 94%.
# split_scenes_at_content_boundaries() already carves out any boundary worth
# a scene of its own (see MIN_SUBSCENE_SECONDS there); a boundary too close
# to a scene's edge to clear THAT bar still leaves this fraction gate as the
# backstop against routing the scene on its strength alone.
MIN_OVERLAP_FRACTION = 0.5

# The speaker crop below the content needs a face of at least this width
# (fraction of frame width). Smaller than this and the bottom half is mostly
# desktop with a stamp-sized webcam in it, which is worse than GENERAL.
MIN_FACE_WIDTH = 0.05


def content_bands(orig_w, orig_h, out_w, out_h):
    """(content_height, speaker_height) for the stacked screencast frame.

    The content keeps its full width, which is the entire point of this layout,
    so its height follows from the source aspect: a 16:9 source gives 608px of a
    1920px frame. The speaker takes the rest.
    """
    content_h = int(round(out_w * orig_h / float(orig_w)))
    content_h -= content_h % 2
    content_h = max(2, min(content_h, out_h - 2))
    speaker_h = out_h - content_h
    return content_h, speaker_h


def speaker_crop(orig_w, orig_h, out_w, speaker_h, face_centre):
    """Crop box (w, h, x, y) for the speaker band, framed on the face."""
    aspect = out_w / float(speaker_h)

    crop_h = orig_h
    crop_w = int(round(crop_h * aspect))
    if crop_w > orig_w:
        crop_w = orig_w
        crop_h = int(round(crop_w / aspect))

    crop_w -= crop_w % 2
    crop_h -= crop_h % 2

    cx, cy = face_centre
    x = int(round(cx - crop_w / 2.0))
    x = max(0, min(x, orig_w - crop_w))
    y = int(round(cy - crop_h * 0.42))
    y = max(0, min(y, orig_h - crop_h))

    return crop_w, crop_h, x - (x % 2), y - (y % 2)


def screencast_filtergraph(orig_w, orig_h, out_w, out_h, face_centre):
    """Full-width content above, face-framed speaker below."""
    content_h, speaker_h = content_bands(orig_w, orig_h, out_w, out_h)
    cw, ch, cx, cy = speaker_crop(orig_w, orig_h, out_w, speaker_h, face_centre)

    return (
        f"[0:v]split=2[ca][sa];"
        # The content band is the WHOLE frame scaled down. Nothing is cropped
        # off the sides, which is the one thing this layout exists to guarantee.
        f"[ca]scale={out_w}:{content_h}[content];"
        f"[sa]crop=w={cw}:h={ch}:x={cx}:y={cy},scale={out_w}:{speaker_h}[speaker];"
        f"[content][speaker]vstack=inputs=2,"
        f"pad={out_w}:{out_h}:0:0,setsar=1[v]"
    )


def detect_faces_full_res(frame):
    """Face boxes from the UNSCALED frame, in original coordinates.

    main.detect_face_candidates() runs detection on a 640px copy, which is the
    right trade for a talking head whose face spans a third of the frame. A
    presenter inset into a screen recording does not survive it: measured on a
    1920x1080 Excel walkthrough, the presenter's ~110px face becomes ~37px at
    640 and BlazeFace returned zero detections on every sample. At full width
    the same frames detect fine. Six samples per scene, so the cost is paid on
    screencast candidates only.
    """
    import cv2
    import main as m

    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    with m.DETECT_LOCK:
        results = m.face_detection.process(rgb)
    if not results.detections:
        return []

    out = []
    for detection in results.detections:
        b = detection.location_data.relative_bounding_box
        box = [int(b.xmin * w), int(b.ymin * h),
               int(b.width * w), int(b.height * h)]
        out.append({'box': box, 'score': box[2] * box[3]})
    return out


def _face_centre(candidates, frame_w):
    """Centre of the biggest usable face in a frame, or None."""
    big = [c for c in candidates if c['box'][2] >= MIN_FACE_WIDTH * frame_w]
    if not big:
        return None
    box = max(big, key=lambda c: c['score'])['box']
    return box[0] + box[2] / 2.0, box[1] + box[3] / 2.0


def overlapping_width(scene_start, scene_end, ranges):
    """Widest content the scene overlaps, as a fraction of frame width.

    0.0 when the scene overlaps nothing (or only a sliver of it — see
    MIN_OVERLAP_FRACTION), which leaves its routing untouched.
    """
    min_covered = max(MIN_OVERLAP_SECONDS,
                       MIN_OVERLAP_FRACTION * (scene_end - scene_start))
    widest = 0.0
    for r in ranges:
        start, end = r[0], r[1]
        width = r[3] if len(r) > 3 else 1.0
        if min(scene_end, end) - max(scene_start, start) >= min_covered:
            widest = max(widest, width)
    return widest


# Below this, a sub-scene created by a content-range boundary is a sliver
# too short to be worth a layout decision of its own (a boundary landing a
# couple of frames from the scene's real edge, say) — merged back into
# its neighbour instead of kept as its own scene.
MIN_SUBSCENE_SECONDS = 0.5


def split_scenes_at_content_boundaries(scenes, fps, content_ranges):
    """Subdivide scenes at the start/end of every content range that falls
    strictly inside them.

    PySceneDetect finds CAMERA cuts, not content changes: a presenter who
    switches from screen-share to full camera by alt-tabbing, with OBS never
    hard-cutting the recording, is one continuous scene to it. Routing that
    whole scene by whichever layout its content overlap happens to win handed
    the SAME crop to every second of it — measured on a real clip, a fixed
    webcam-inset crop taken from the screen-share half of a 66s scene was
    still being applied 15s later, well into the half where the presenter had
    switched to full camera and there was no inset there to crop to; the band
    showed a stretch of the *background* instead of a face.

    Splitting first means analyze_scenes_strategy() and detect_screencast_
    scenes() below each see spans that are consistently one or the other, so
    the layout decision for a span matches what is actually on screen for its
    whole duration - the same guarantee the strategy classifier already
    assumed it had for an ordinary scene.
    """
    if not content_ranges:
        return scenes
    from scenedetect import FrameTimecode

    boundary_frames = sorted({
        int(round(t * fps)) for s, e, *_ in content_ranges for t in (s, e)
    })

    out = []
    for start_tc, end_tc in scenes:
        s_f, e_f = start_tc.get_frames(), end_tc.get_frames()
        min_gap = max(1, int(round(MIN_SUBSCENE_SECONDS * fps)))
        cuts = [f for f in boundary_frames
                if s_f + min_gap <= f <= e_f - min_gap]
        if not cuts:
            out.append((start_tc, end_tc))
            continue
        bounds = [s_f] + cuts + [e_f]
        out.extend((FrameTimecode(a, fps), FrameTimecode(b, fps))
                   for a, b in zip(bounds, bounds[1:]) if b > a)
    return out


def _sample_timed_frames(video_path, video_duration, target_count=40, width=480,
                          min_interval=3.0):
    """(timestamp, jpeg_bytes) pairs spread evenly across the video.

    Interval is duration/target_count, floored at min_interval so a short clip
    doesn't get frames crammed 1s apart. No upper cap on the interval — the
    whole point of dividing by target_count is to keep the frame count (and
    therefore the request size/cost) roughly constant regardless of video
    length: a 2-hour video should sample every ~3 minutes, not every 20s
    (which would emit ~360 images into one request). A very short scene that
    falls entirely between two samples can be missed — the width-fraction
    gate downstream already discards borderline calls, so this trades some
    recall on brief cutaways for requests that stay a sane size on long
    videos. Silent [] on any decode failure — callers must degrade, not
    crash the job.
    """
    import cv2

    interval = max(min_interval, video_duration / max(target_count, 1))
    cap = cv2.VideoCapture(video_path)
    out = []
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            return out
        t = 0.0
        while t < video_duration:
            frame_idx = min(int(t * fps), total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if ok:
                h, w = frame.shape[:2]
                scaled = cv2.resize(frame, (width, max(2, int(h * width / w))),
                                     interpolation=cv2.INTER_AREA)
                ok, buf = cv2.imencode(".jpg", scaled, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    out.append((round(t, 1), buf.tobytes()))
            t += interval
    finally:
        cap.release()
    return out


def _parse_content_ranges(raw, video_duration):
    """Shared post-processing for both providers' raw {"ranges": [...]} JSON."""
    ranges = []
    for r in raw:
        try:
            s = max(0.0, float(r.get("start", 0)))
            e = min(float(video_duration), float(r.get("end", 0)))
            width = float(r.get("width_fraction", 0))
        except (TypeError, ValueError):
            continue
        # The width gate is the whole point: everything narrower survives a 9:16
        # crop and must not move a single scene.
        if e - s >= 0.5 and width >= MIN_WIDTH_FRACTION:
            ranges.append((s, e, str(r.get("what", ""))[:40], width))
    ranges.sort()
    return ranges


def _detect_content_ranges_gemini_video(video_path, video_duration, api_key, model_name):
    """Native path: upload the whole video to Gemini's File API and let it
    watch the real thing. Best quality (genuine temporal understanding, not
    a handful of stills) — this is what runs by default with a real
    GEMINI_API_KEY."""
    from google import genai
    from google.genai import types as genai_types
    import gemini_worker

    client = genai.Client(api_key=api_key)
    file_upload = client.files.upload(file=video_path)
    deadline = time.time() + 180
    while True:
        info = client.files.get(name=file_upload.name)
        state = str(getattr(getattr(info, "state", info), "name", "")).upper()
        if state == "ACTIVE":
            break
        if state == "FAILED" or time.time() > deadline:
            print("   ⚠️ Upload not usable — keeping face-only routing.")
            return []
        time.sleep(2)

    response = client.models.generate_content(
        model=model_name,
        contents=[file_upload,
                  gemini_worker.WIDE_CONTENT_PROMPT_TEMPLATE.format(
                      video_duration=video_duration)],
        config=genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=gemini_worker.WideContentResponse,
            temperature=0,  # factual classification, not creative — see _detect_content_ranges_openrouter
        ))
    gemini_worker.raise_if_blocked(response)
    return (json.loads(response.text) or {}).get("ranges") or []


def _detect_content_ranges_openrouter(video_path, video_duration, model_name):
    """OpenRouter has no equivalent of Gemini's native video File API (no
    provider on it accepts an uploaded video file for a chat completion), so
    this approximates temporal understanding with sampled frames sent as a
    sequence of labelled images instead — the same trick
    detect_screencast_scenes() below already relies on for per-scene face
    detection, just applied to the whole-video pass. Lower fidelity than
    watching the actual video (a scene shorter than the sampling interval can
    be missed entirely), but functional, and the width-fraction gate this
    feeds into already discards borderline calls.

    temperature=0 below is deliberate, not cosmetic: this is a factual "is
    there wide on-screen content here" classification, not a task that
    benefits from sampling variance. Verified on a real 55-minute screencast:
    3 back-to-back reruns of the same frames through this exact function
    returned the same 17 ranges, byte-identical timestamps each time."""
    from google.genai import types as genai_types
    import gemini_worker
    import llm_client

    frames = _sample_timed_frames(video_path, video_duration)
    if not frames:
        return []

    parts = [genai_types.Part.from_text(text=gemini_worker.WIDE_CONTENT_PROMPT_TEMPLATE.format(
        video_duration=video_duration) +
        "\n\nYou are shown sampled frames from the video, in chronological order, "
        "each preceded by a text label giving its timestamp in seconds. Base "
        "start/end on those timestamps.")]
    for ts, jpeg_bytes in frames:
        parts.append(genai_types.Part.from_text(text=f"Frame at {ts}s:"))
        parts.append(genai_types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"))

    client = llm_client.get_client()
    response = client.models.generate_content(
        model=model_name,
        contents=parts,
        config=genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=gemini_worker.WideContentResponse,
            temperature=0,
        ))
    gemini_worker.raise_if_blocked(response)
    return (json.loads(response.text) or {}).get("ranges") or []


def detect_content_ranges(video_path, video_duration):
    """Time ranges where on-screen content spans most of the frame width.

    Returns (start, end, what, width_fraction) tuples, or [] on any failure:
    a missing answer must degrade to today's routing rather than break the job.
    """
    if not ENABLED:
        return []

    provider = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
    model_name = os.environ.get("GEMINI_MODEL") or 'gemini-3.1-flash-lite'
    print("🔎 Checking for full-width on-screen content…")

    if provider == "openrouter" and not os.getenv("OPENROUTER_API_KEY"):
        return []
    if provider != "openrouter" and not os.getenv("GEMINI_API_KEY"):
        return []

    # temperature=0 made this reliable in testing (see
    # _detect_content_ranges_openrouter's docstring), but OpenRouter can still
    # route a request to different backing infra than the last one, so this
    # keeps a couple of retries as a safety net: a wrongly-empty result only
    # costs today's routing (no harm, just a missed improvement), which is
    # cheap insurance against a single unlucky call deciding the whole job.
    attempts = 3 if provider == "openrouter" else 1
    raw = []
    for attempt in range(1, attempts + 1):
        try:
            if provider == "openrouter":
                raw = _detect_content_ranges_openrouter(video_path, video_duration, model_name)
            else:
                api_key = os.getenv("GEMINI_API_KEY")
                raw = _detect_content_ranges_gemini_video(video_path, video_duration, api_key, model_name)
        except Exception as e:
            print(f"   ⚠️ On-screen check failed ({e}) — keeping face-only routing.")
            raw = []
            break
        if raw:
            break
        if attempt < attempts:
            print(f"   ↻ Empty result (attempt {attempt}/{attempts}) — retrying…")

    ranges = _parse_content_ranges(raw, video_duration)
    if ranges:
        print("   📊 " + ", ".join(
            f"{w}@{s:.0f}-{e:.0f}s ({frac:.0%} wide)"
            for s, e, w, frac in ranges[:5]))
    else:
        print("   ✅ No full-width content — routing unchanged.")
    return ranges


def detect_screencast_scenes(video_path, scenes, strategies, ranges, samples=6):
    """Route scenes that show wide on-screen content.

    Returns ``{scene_index: ('SCREENCAST', centre) | ('WIDE', None)}``:

      - SCREENCAST stacks the content over the presenter, for content that
        leaves room beside itself (width below STACK_MAX_WIDTH_FRACTION) and
        where a presenter is actually found.
      - WIDE is the blurred layout with side-cropping disabled, for content that
        fills the frame, or that has no presenter to stack.
    """
    if not ENABLED or not ranges:
        return {}
    # Below the gate on purpose: main pulls torch/mediapipe, and the disabled
    # path (the default, and what CI exercises) must not pay that import.
    import cv2
    import main as m

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    found = {}

    try:
        for i, (start, end) in enumerate(scenes):
            s_f, e_f = start.get_frames(), end.get_frames()
            width = overlapping_width(s_f / fps, e_f / fps, ranges)
            if not width:
                continue

            # Content that fills the frame has the presenter on top of it, so
            # there is nothing to stack — just stop cropping the sides.
            if width > STACK_MAX_WIDTH_FRACTION:
                found[i] = ('WIDE', None)
                continue

            last_f = e_f - 1
            if total_frames:
                last_f = min(last_f, total_frames - 1)
            if last_f < s_f:
                continue

            centres = []
            for f_idx in np.linspace(s_f, last_f, samples):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(f_idx)))
                ok, frame = cap.read()
                if not ok:
                    continue
                centre = _face_centre(detect_faces_full_res(frame), frame_w)
                if centre is None:
                    # A presenter keyed into the corner of a screen recording is
                    # often too small for BlazeFace even at full resolution
                    # (measured: zero detections across an Excel walkthrough
                    # where the person is plainly visible). YOLO finds the body
                    # in the same frames, and a body centre frames the speaker
                    # just as well for this layout.
                    person = m.detect_person_yolo(frame)
                    if person:
                        centre = (person[0] + person[2] / 2.0,
                                  person[1] + person[3] / 2.0)
                if centre:
                    centres.append(centre)

            # Half the samples: a webcam inset is static and easy to find, so a
            # weaker signal than this means there is no presenter to stack, and
            # the content still deserves its full width.
            if len(centres) < samples / 2.0:
                found[i] = ('WIDE', None)
                continue

            found[i] = ('SCREENCAST',
                        (float(np.median([c[0] for c in centres])),
                         float(np.median([c[1] for c in centres]))))
    finally:
        cap.release()

    return found
