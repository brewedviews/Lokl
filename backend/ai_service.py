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
        # Re-load .env in case worker forked before env was set
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
        k = os.environ.get("EMERGENT_LLM_KEY")
    return k


async def generate_product_copy(product_name: str, category: str = "", raw_notes: str = "") -> dict:
    """Use Claude Sonnet 4.5 to generate fashion product copy."""
    system = (
        "You are an elite fashion copywriter for an Indian Gen-Z hyperlocal commerce platform. "
        "You craft premium, aspirational, Bharat-first product copy. Return ONLY valid JSON."
    )
    user_prompt = f"""Generate fashion catalog copy for this product.

Product Name: {product_name}
Category: {category}
Merchant notes: {raw_notes or 'none'}

Return STRICT JSON with these fields:
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

    chat = LlmChat(
        api_key=_key(),
        session_id=f"copy-{uuid.uuid4()}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    raw = await chat.send_message(UserMessage(text=user_prompt))
    # Strip code fences if present
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Best-effort: try to extract JSON object
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            return json.loads(match.group(0))
        return {
            "title": product_name,
            "description": cleaned[:800],
            "tags": [category] if category else [],
            "highlights": [],
            "seo_title": product_name,
            "seo_meta": cleaned[:155],
            "campaign_copy": cleaned[:200],
        }


async def enhance_product_image(image_base64: str, prompt_override: str = "") -> str | None:
    """Use Gemini Nano Banana to enhance/transform a raw product photo.
    Returns base64-encoded enhanced image, or None if not produced.
    """
    prompt = prompt_override or (
        "Transform this raw smartphone product photo into a premium editorial e-commerce "
        "catalog image. Replace the background with a clean studio backdrop, perfect lighting, "
        "sharp focus, soft shadows, magazine-quality fashion shoot. Keep the product identical."
    )

    chat = LlmChat(
        api_key=_key(),
        session_id=f"img-{uuid.uuid4()}",
        system_message="You are a premium fashion product photographer.",
    ).with_model("gemini", "gemini-2.5-flash-image-preview").with_params(modalities=["image", "text"])

    try:
        msg = UserMessage(
            text=prompt,
            file_contents=[ImageContent(image_base64=image_base64)],
        )
        _text, images = await chat.send_message_multimodal_response(msg)
        if images and len(images) > 0:
            # images is List[Dict[str,str]] with base64 data
            first = images[0]
            return first.get("data") or first.get("image_base64") or first.get("b64_json")
    except Exception as e:
        print(f"[ai_service] Gemini image enhancement failed: {e}")
    return None
