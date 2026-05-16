"""AI services: Claude Sonnet 4.5 for text, Gemini Nano Banana for images."""
import os
import json
import base64
import uuid
import re
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent


def _key():
    k = os.environ.get("EMERGENT_LLM_KEY")
    if not k:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
        k = os.environ.get("EMERGENT_LLM_KEY")
    return k


async def generate_product_copy(product_name: str, category: str = "", raw_notes: str = "") -> dict:
    system = (
        "You are an elite fashion copywriter for an Indian Gen-Z hyperlocal commerce platform. "
        "You craft premium, aspirational, Bharat-first product copy. Return ONLY valid JSON."
    )
    user_prompt = f"""Generate fashion catalog copy for this product.

Product Name: {product_name}
Category: {category}
Merchant notes: {raw_notes or 'none'}

Return STRICT JSON:
{{
  "title": "compelling product title under 60 chars",
  "description": "200-word premium product description for an Indian fashion shopper",
  "tags": ["array", "of", "10", "fashion", "SEO", "tags"],
  "highlights": ["3", "bullet", "key", "features"],
  "seo_title": "SEO title under 60 chars",
  "seo_meta": "SEO meta description under 155 chars",
  "campaign_copy": "1-2 sentence Instagram-ready marketing hook"
}}
Output ONLY the JSON, no markdown fences, no commentary."""

    chat = LlmChat(api_key=_key(), session_id=f"copy-{uuid.uuid4()}", system_message=system) \
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    raw = await chat.send_message(UserMessage(text=user_prompt))
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            return json.loads(match.group(0))
        return {
            "title": product_name, "description": cleaned[:800],
            "tags": [category] if category else [], "highlights": [],
            "seo_title": product_name, "seo_meta": cleaned[:155],
            "campaign_copy": cleaned[:200],
        }


async def enhance_product_image(image_base64: str, prompt_override: str = "") -> str | None:
    """Improve lighting/background of the EXACT SAME product.
    Strict: must not change design, color, fabric, pattern, or any feature."""
    prompt = prompt_override or (
        "Re-photograph this EXACT garment with professional studio lighting and a clean neutral "
        "studio backdrop. You must keep the product 100% identical — same garment type, same "
        "color, same fabric, same pattern, same buttons, same collar, same sleeves, same hemline, "
        "same neckline, same prints/embroidery. Only improve lighting, background and sharpness. "
        "Output a single photograph of the same garment on a plain studio backdrop. Do NOT "
        "substitute the garment with a different style or different colour. The product must be "
        "visually recognisable as the same one in the input."
    )
    chat = LlmChat(api_key=_key(), session_id=f"img-{uuid.uuid4()}",
                   system_message="You are a precise product photographer. Reproduce inputs faithfully.") \
        .with_model("gemini", "gemini-2.5-flash-image-preview") \
        .with_params(modalities=["image", "text"])
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=image_base64)])
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
        if images:
            first = images[0]
            return first.get("data") or first.get("image_base64") or first.get("b64_json")
    except Exception as e:
        print(f"[ai_service] Gemini enhance failed: {e}")
    return None


async def ai_model_tryon(image_base64: str) -> str | None:
    """Place the EXACT product on a realistic model — never alter the product design."""
    prompt = (
        "Show this EXACT garment being worn by a realistic Indian fashion model in a clean "
        "editorial studio setting. CRITICAL: Do NOT change the garment's type, colour, pattern, "
        "fabric, neckline, sleeves, hemline, buttons, prints or any visual detail. Reproduce the "
        "garment pixel-for-pixel faithfully — only render how it looks worn. If the input is a "
        "men's shirt, show a man wearing the same men's shirt; if it's a kurta, show the same "
        "kurta. Never substitute a different garment. Output a single editorial fashion photograph."
    )
    chat = LlmChat(api_key=_key(), session_id=f"tryon-{uuid.uuid4()}",
                   system_message="You are a precise fashion photographer. The input garment must remain identical in the output.") \
        .with_model("gemini", "gemini-2.5-flash-image-preview") \
        .with_params(modalities=["image", "text"])
    try:
        msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=image_base64)])
        _text, images = await chat.send_message_multimodal_response(msg)
        if images:
            first = images[0]
            return first.get("data") or first.get("image_base64") or first.get("b64_json")
    except Exception as e:
        print(f"[ai_service] Gemini try-on failed: {e}")
    return None
