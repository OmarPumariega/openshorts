"""Provider-aware LLM client factory.

CLAUDE.md's spec (and the default here) is calling Google's Gemini API
directly via the google-genai SDK, with GEMINI_API_KEY. This module also
supports an explicitly opted-in alternative: routing the exact same prompts/
schemas through OpenRouter's OpenAI-compatible endpoint to a Gemini model,
for a deployment that already has an OpenRouter key instead of (or in
addition to) a Gemini one. Set LLM_PROVIDER=openrouter + OPENROUTER_API_KEY
to use it; leave both unset and nothing changes from stock behavior.

get_client() returns an object exposing `.models.generate_content(model,
contents, config)`, matching genai.Client's shape closely enough that
gemini_worker.py's response helpers (raise_if_blocked, _get_response_text,
_calculate_cost_analysis — all duck-typed via getattr) work unmodified
against either provider's response.

Scope: main.py's get_viral_clips (the primary, always-on moment-detection
pipeline, text-only) and screencast_layout.py's detect_content_ranges
(frame-sampled images, see that module for why frames instead of a native
video upload) both go through get_client() and work on either provider.
_build_message_content() converts genai Part objects with inline image
bytes into OpenAI-style image_url content blocks for the OpenRouter path;
plain-text `contents` (the common case) stays a plain string.

layout_picker.py's own frame-based layout picker (SPLIT/SCREENCAST framing
choice, distinct from screencast_layout.py's content detection) and
main.py's get_visual_clips silent-video fallback still construct their own
genai.Client() directly and remain Gemini-only — both already degrade
gracefully (return "none"/None) rather than crash when GEMINI_API_KEY is
absent, so running in OpenRouter-only mode just means those two specific
edge-case features sit idle instead of erroring.
"""
import base64
import json
import os
from types import SimpleNamespace

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def get_client():
    provider = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
    if provider == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise SystemExit("LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.")
        return _OpenRouterClient(api_key)

    from google import genai
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("Missing GEMINI_API_KEY.")
    return genai.Client(api_key=api_key)


def _to_openrouter_model(model_name: str) -> str:
    """gemini-3.1-flash-lite -> google/gemini-3.1-flash-lite. Already-slashed
    names (a caller who set GEMINI_MODEL to a full OpenRouter slug) pass through."""
    return model_name if "/" in model_name else f"google/{model_name}"


def _strip_unsupported_schema_keys(node):
    """Pydantic's model_json_schema() emits `title` everywhere and `$defs`/`$ref`
    for nested models; OpenRouter's strict json_schema mode is pickier about
    extra keywords than Gemini's native response_schema. Titles are cosmetic,
    so drop them recursively; leave $defs/$ref/type/properties/required alone."""
    if isinstance(node, dict):
        node.pop("title", None)
        for v in node.values():
            _strip_unsupported_schema_keys(v)
    elif isinstance(node, list):
        for v in node:
            _strip_unsupported_schema_keys(v)


def _build_message_content(contents):
    """Turn a genai-style `contents` argument into an OpenAI-style message
    `content` value: a plain string for text-only calls (main.py's
    get_viral_clips — the common case), or a list of text/image_url parts
    when the caller passes genai Part objects with inline image bytes
    (screencast_layout.py's frame-sampling path — see its own module
    docstring for why frames instead of a native video upload).
    """
    if isinstance(contents, str):
        return contents

    items = contents if isinstance(contents, (list, tuple)) else [contents]
    has_image = any(getattr(item, "inline_data", None) is not None for item in items)
    if not has_image:
        # Text-only list (e.g. [prompt]) — same flattening as before, just
        # renamed now that this function also handles the multimodal case.
        parts = [getattr(item, "text", None) or str(item) for item in items]
        return "\n".join(parts)

    content = []
    for item in items:
        inline = getattr(item, "inline_data", None)
        if inline is not None:
            b64 = base64.b64encode(inline.data).decode("ascii")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{inline.mime_type};base64,{b64}"},
            })
            continue
        text = getattr(item, "text", None)
        if text:
            content.append({"type": "text", "text": text})
    return content


class _Models:
    def __init__(self, client):
        self._client = client

    def generate_content(self, model, contents, config=None):
        return self._client._generate(model, contents, config)


class _OpenRouterClient:
    def __init__(self, api_key: str):
        self._api_key = api_key
        self.models = _Models(self)

    def _generate(self, model, contents, config):
        body = {
            "model": _to_openrouter_model(model),
            "messages": [{"role": "user", "content": _build_message_content(contents)}],
        }

        schema_cls = getattr(config, "response_schema", None) if config is not None else None
        if schema_cls is not None:
            schema = schema_cls.model_json_schema()
            _strip_unsupported_schema_keys(schema)
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_cls.__name__, "strict": True, "schema": schema},
            }

        thinking = getattr(config, "thinking_config", None) if config is not None else None
        if thinking is not None:
            budget = getattr(thinking, "thinking_budget", None)
            level = getattr(thinking, "thinking_level", None)
            if budget:
                body["reasoning"] = {"max_tokens": int(budget)}
            elif level:
                body["reasoning"] = {"effort": level}

        temperature = getattr(config, "temperature", None) if config is not None else None
        if temperature is not None:
            body["temperature"] = temperature

        resp = httpx.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=180,
        )
        resp.raise_for_status()
        return _wrap_response(resp.json(), schema_cls)


def _wrap_response(data: dict, schema_cls):
    """Build a genai-response-shaped object out of an OpenRouter chat-completion
    JSON body, matching exactly the attributes gemini_worker.py's helpers read
    via getattr (see raise_if_blocked / _get_response_text / _calculate_cost_analysis)."""
    choices = data.get("choices") or []
    text = ""
    finish_reason = None
    if choices:
        message = choices[0].get("message") or {}
        text = message.get("content") or ""
        finish_reason = choices[0].get("finish_reason")

    # OpenRouter/upstream refusals show up as an empty choices list or a
    # finish_reason of "content_filter" rather than Gemini's prompt_feedback
    # block_reason — map the latter so raise_if_blocked's existing check fires.
    block_reason = "SAFETY" if (finish_reason == "content_filter" or not choices) else None

    candidate = SimpleNamespace(
        finish_reason=SimpleNamespace(name=(finish_reason or "STOP").upper()),
        content=SimpleNamespace(parts=[SimpleNamespace(text=text)]),
    )

    parsed = None
    if schema_cls is not None and text:
        try:
            parsed = schema_cls.model_validate(json.loads(text))
        except Exception:
            parsed = None  # falls back to gemini_worker._parse_json_response_text(response.text)

    usage = data.get("usage") or {}
    reasoning_tokens = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)

    return SimpleNamespace(
        text=text,
        parsed=parsed,
        candidates=[candidate],
        prompt_feedback=SimpleNamespace(block_reason=block_reason),
        usage_metadata=SimpleNamespace(
            prompt_token_count=usage.get("prompt_tokens", 0),
            candidates_token_count=usage.get("completion_tokens", 0),
            thoughts_token_count=reasoning_tokens,
        ),
    )
