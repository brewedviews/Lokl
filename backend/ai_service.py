"""AI services — disabled pending OpenAI integration.
emergentintegrations is Emergent-specific and unavailable on Railway.
Functions return graceful stubs so server.py imports without error.
Re-enable by replacing with OpenAI SDK calls when ready."""

import os
import json

async def generate_product_copy(
    product_name: str,
    category: str = "",
    raw_notes: str = ""
) -> dict:
    return {
        "title": product_name,
        "description": "",
        "tags": [category] if category else [],
        "highlights": [],
        "seo_title": product_name,
        "seo_meta": "",
        "campaign_copy": "",
        "error": "AI service not configured"
    }

async def enhance_product_image(
    image_base64: str,
    prompt_override: str = ""
) -> str | None:
    return None

async def ai_model_tryon(image_base64: str) -> str | None:
    return None
