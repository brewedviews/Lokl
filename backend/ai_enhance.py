"""AI Product Image Enhancement via Gemini Nano Banana.

Takes a merchant-uploaded raw product photo and generates 4 standalone premium e-commerce
catalog images — 2 outdoor lifestyle (with realistic gender-appropriate model) and 2 studio
shots. The product's exact appearance is strictly preserved (shape, colour, texture,
branding, material, proportions, build); no collages, grids, or split layouts.
"""
import base64
import logging
import os
import re
import uuid
from typing import Any

import httpx

log = logging.getLogger("lokl.ai_enhance")


def _strip_data_url(b64: str) -> str:
    """Accept both bare base64 and `data:image/...;base64,XXX` and return bare base64."""
    if not b64:
        return ""
    m = re.match(r"^data:image/[^;]+;base64,(.*)$", b64)
    return m.group(1) if m else b64


async def _resolve_to_b64(src: str) -> str:
    """Resolve an arbitrary `image` input (URL, data: URI, or bare base64) to bare base64."""
    if not src:
        return ""
    s = src.strip()
    if s.startswith(("http://", "https://")):
        # Fetch the bytes and encode them — Gemini's inline_data expects raw base64.
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            r = await client.get(s)
            r.raise_for_status()
            return base64.b64encode(r.content).decode()
    return _strip_data_url(s)


# ---------- Prompt scaffolding ----------
PRESERVATION_RULES = (
    "STRICT PRESERVATION RULES — non-negotiable:\n"
    "- The uploaded image is the EXACT reference. The garment's shape, colour, "
    "print, pattern, texture, fabric, neckline, sleeves, length, hemline, "
    "stitching, branding and proportions MUST be reproduced identically. "
    "Do NOT modify, recolour, restyle, re-brand, redesign or re-cut the garment.\n"
    "- Do NOT hallucinate or add elements that are not on the reference garment: "
    "no extra prints, logos, embellishments, buttons, pockets, embroidery, "
    "accessories, jewellery, bags, or props.\n"
    "- Model rule: If the reference image already contains a human model, you "
    "may keep a human wearing the garment. If the reference image does NOT "
    "contain a person, do NOT fabricate a model or face — present the garment "
    "alone (ghost-mannequin / flat-lay / on a clean hanger).\n"
    "- This is ONE SINGLE STANDALONE image. Absolutely NO collages, grids, "
    "splits, multi-panel layouts, side-by-side comparisons, or text overlays. "
    "No watermarks. No captions.\n"
    "- Aspect ratio 4:5 (portrait) or 1:1 (square). Ultra-high resolution. "
    "Premium D2C e-commerce catalog quality."
)


def _outdoor_prompt(variant: int) -> str:
    """One of two outdoor prompts. variant ∈ {1, 2}. Natural daylight, neutral backdrop."""
    base = (
        "Generate a single premium e-commerce OUTDOOR product photograph of the "
        "garment from the reference image, shot in soft natural daylight on a "
        "neutral, uncluttered outdoor backdrop. The garment is the clear hero of "
        "the frame, sharply detailed and fully visible."
    )
    if variant == 1:
        scene = (
            "Composition: front-facing or front-three-quarter view. Soft diffused "
            "natural daylight (overcast or open-shade quality). Background is a "
            "calm neutral outdoor surface — clean stone wall, weathered concrete, "
            "warm sand, or pale plaster — with no distracting objects, signage, "
            "or props. If the reference has no model, present the garment on a "
            "ghost-mannequin / invisible mannequin or laid flat on a neutral "
            "outdoor surface. If the reference has a model, keep the model and "
            "use a relaxed, natural pose."
        )
    else:
        scene = (
            "Composition: distinct angle from the first outdoor shot — side, "
            "back-three-quarter, or slight low-angle view. Soft golden-hour "
            "natural daylight. Background is a different but still neutral "
            "outdoor surface — sun-warmed stone, gentle dune, or muted sandy "
            "courtyard. No props, no other people. If the reference has no "
            "model, keep the garment alone (ghost-mannequin or styled flat-lay). "
            "If the reference has a model, change the pose but preserve "
            "the same person and outfit fit."
        )
    return f"{base}\n\n{scene}\n\n{PRESERVATION_RULES}"


def _studio_prompt(variant: int) -> str:
    """One of two studio prompts. variant ∈ {1, 2}. White seamless / soft grey."""
    base = (
        "Generate a single premium STUDIO e-commerce product photograph of the "
        "garment from the reference image. Professional studio lighting, crisp "
        "focus, accurate fabric texture, true-to-source colour."
    )
    if variant == 1:
        scene = (
            "Composition: hero straight-on / front-facing view on a clean "
            "seamless WHITE studio background (paper or cyclorama). Soft "
            "directional key light with a subtle natural floor shadow. If the "
            "reference has no model, use a ghost-mannequin / invisible mannequin "
            "presentation so the garment shape is fully visible. If the reference "
            "has a model, keep the same model in a neutral studio pose."
        )
    else:
        scene = (
            "Composition: a distinct angle from the first studio shot — "
            "three-quarter view or a slight close-up detail of a key feature "
            "(neckline, sleeve, hem, weave or print) — on a clean SOFT GREY "
            "seamless studio background. Even soft studio lighting. Same model "
            "rule as above: ghost-mannequin if the reference has no person, "
            "otherwise keep the existing model."
        )
    return f"{base}\n\n{scene}\n\n{PRESERVATION_RULES}"


# 4 standalone outputs in fixed order
PROMPTS: list[tuple[str, str]] = [
    ("outdoor_1", _outdoor_prompt(1)),
    ("outdoor_2", _outdoor_prompt(2)),
    ("studio_1", _studio_prompt(1)),
    ("studio_2", _studio_prompt(2)),
]
PROMPTS_BY_KIND: dict[str, str] = dict(PROMPTS)
VALID_KINDS = tuple(k for k, _ in PROMPTS)


async def _generate_one(api_key: str, model_id: str, ref_b64: str, prompt: str, session_id: str) -> str | None:
    """Single Nano Banana call. Returns base64 string of first generated image, or None."""
    # Import inline so the rest of the server can boot even if the SDK isn't installed
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=(
            "You are a senior product photographer for a premium D2C fashion brand. "
            "You produce ultra-high-resolution e-commerce catalog images."
        ),
    )
    chat.with_model("gemini", model_id).with_params(modalities=["image", "text"])
    try:
        msg = UserMessage(text=prompt, file_contents=[ImageContent(ref_b64)])
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as exc:
        log.warning("[ai_enhance] generation failed: %s", exc)
        return None
    if not images:
        return None
    img = images[0]
    return img.get("data")


async def enhance_one_kind(reference_b64: str, kind: str, *, model_id: str = "gemini-3.1-flash-image-preview") -> dict[str, Any]:
    """Generate a single image of the given kind. Used by the per-kind endpoint so the
    frontend can fire 4 parallel calls (each well under the 60s ingress cap)."""
    if kind not in PROMPTS_BY_KIND:
        raise ValueError(f"Unknown kind: {kind}")
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    ref = await _resolve_to_b64(reference_b64)
    if not ref:
        raise ValueError("Reference image is empty")
    prompt = PROMPTS_BY_KIND[kind]
    sid = f"lokl-aienh-{uuid.uuid4().hex[:8]}"
    data = await _generate_one(api_key, model_id, ref, prompt, sid)
    if not data:
        sid2 = f"lokl-aienh-{uuid.uuid4().hex[:8]}"
        data = await _generate_one(api_key, model_id, ref, prompt, sid2)
    return {
        "kind": kind,
        "ok": bool(data),
        "image": (f"data:image/png;base64,{data}" if data else None),
    }


async def enhance_product_images(reference_b64: str, *, model_id: str = "gemini-3.1-flash-image-preview") -> dict[str, Any]:
    """Generate 4 standalone enhanced images from a single reference. Returns dict with `outputs` array."""
    import asyncio
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    ref = await _resolve_to_b64(reference_b64)
    if not ref:
        raise ValueError("Reference image is empty")

    async def _one(kind: str, prompt: str):
        # One single-shot retry per kind to absorb transient Gemini failures (rate-limits, blips).
        sid = f"lokl-aienh-{uuid.uuid4().hex[:8]}"
        data = await _generate_one(api_key, model_id, ref, prompt, sid)
        if not data:
            sid2 = f"lokl-aienh-{uuid.uuid4().hex[:8]}"
            data = await _generate_one(api_key, model_id, ref, prompt, sid2)
        return {
            "kind": kind,
            "ok": bool(data),
            "image": (f"data:image/png;base64,{data}" if data else None),
        }

    # Parallel — 4 distinct sessions so they don't share context. Cuts wall-time ~4x.
    outputs = await asyncio.gather(*[_one(k, p) for k, p in PROMPTS])
    return {"outputs": list(outputs)}
