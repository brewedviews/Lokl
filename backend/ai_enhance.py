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

log = logging.getLogger("lokl.ai_enhance")


def _strip_data_url(b64: str) -> str:
    """Accept both bare base64 and `data:image/...;base64,XXX` and return bare base64."""
    if not b64:
        return ""
    m = re.match(r"^data:image/[^;]+;base64,(.*)$", b64)
    return m.group(1) if m else b64


# ---------- Prompt scaffolding ----------
PRESERVATION_RULES = (
    "STRICT PRESERVATION RULES — non-negotiable:\n"
    "- Use the uploaded product image as the EXACT reference. The product's shape, "
    "colour, texture, branding, material, proportions, and build must be reproduced "
    "identically. Do NOT modify, recolour, restyle, or re-brand the product.\n"
    "- Do NOT hallucinate or add non-existent product elements, logos, prints, or "
    "accessories that are not visible on the reference.\n"
    "- This is a SINGLE STANDALONE image. Absolutely NO collages, grids, splits, "
    "multi-panel layouts, or combined multi-angle compositions.\n"
    "- Intelligently detect the product category, use-case, and target audience from "
    "the reference image to decide the model's age, gender presentation, styling, and "
    "scene context — but the product itself must remain unchanged.\n"
    "- High-end D2C brand aesthetic: professional lighting, crisp focus, realistic "
    "textures and shadows, accurate product proportions.\n"
    "- Aspect ratio 4:5 (portrait) or 1:1 (square). Ultra-high resolution. Optimised for "
    "e-commerce listings, ads, and social commerce."
)


def _outdoor_prompt(variant: int) -> str:
    """One of two outdoor lifestyle prompts. variant ∈ {1, 2}."""
    base = (
        "Generate a premium e-commerce outdoor lifestyle photograph of a realistic "
        "human model naturally using or wearing the product from the reference image. "
        "The setting should feel natural, premium, and commercially aesthetic — like a "
        "high-end D2C campaign."
    )
    if variant == 1:
        scene = (
            "Composition: front-three-quarter angle, model in a confident relaxed pose, "
            "soft golden-hour light, urban-meets-nature setting (clean street, sunlit "
            "courtyard, or tasteful outdoor terrace). The product is the clear hero of "
            "the frame."
        )
    else:
        scene = (
            "Composition: a different angle and pose from the first outdoor shot — "
            "consider a candid mid-action moment, a side or back-three-quarter framing, "
            "and a contrasting environment (e.g. modern architectural backdrop, beach "
            "boardwalk, café exterior, or open landscape). Keep the product clearly "
            "visible and uncropped at its key features."
        )
    return f"{base}\n\n{scene}\n\n{PRESERVATION_RULES}"


def _studio_prompt(variant: int) -> str:
    """One of two studio prompts. variant ∈ {1, 2}."""
    base = (
        "Generate a premium e-commerce STUDIO product photograph on a clean, professional "
        "studio background. No model — product only. The image should resemble premium "
        "marketplace catalog photography: sharp detailing, realistic shadows, accurate "
        "proportions, no distractions."
    )
    if variant == 1:
        scene = (
            "Composition: hero front-facing or straight-on angle on a clean seamless "
            "white or warm-neutral studio background. Soft directional lighting that "
            "sculpts the product's form. Subtle natural floor shadow."
        )
    else:
        scene = (
            "Composition: a different professional detail angle from the first studio "
            "shot — consider a 3/4 angle, a top-down flat-lay (if appropriate to the "
            "category), or a close-up detail of a key product feature (stitching, "
            "texture, logo placement). Background remains clean and complementary "
            "to the product's colour."
        )
    return f"{base}\n\n{scene}\n\n{PRESERVATION_RULES}"


# 4 standalone outputs in fixed order
PROMPTS: list[tuple[str, str]] = [
    ("outdoor_1", _outdoor_prompt(1)),
    ("outdoor_2", _outdoor_prompt(2)),
    ("studio_1", _studio_prompt(1)),
    ("studio_2", _studio_prompt(2)),
]


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


async def enhance_product_images(reference_b64: str, *, model_id: str = "gemini-3.1-flash-image-preview") -> dict[str, Any]:
    """Generate 4 standalone enhanced images from a single reference. Returns dict with `outputs` array."""
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    ref = _strip_data_url(reference_b64)
    if not ref:
        raise ValueError("Reference image is empty")

    outputs: list[dict[str, Any]] = []
    # Sequential — each call uses its own session so they don't share context, but
    # Gemini's image-mode is fairly fast and 4 calls keep cost predictable.
    for kind, prompt in PROMPTS:
        sid = f"lokl-aienh-{uuid.uuid4().hex[:8]}"
        data = await _generate_one(api_key, model_id, ref, prompt, sid)
        outputs.append({
            "kind": kind,
            "ok": bool(data),
            "image": (f"data:image/png;base64,{data}" if data else None),
        })
    return {"outputs": outputs}
