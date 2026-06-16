"""Generate AI product images for demo products using Together AI (Flux) and upload to Cloudinary.

For each demo product: generates an image via FLUX.1-schnell-Free, uploads it to
Cloudinary under lokl/products/, and updates the MongoDB product document.

Called from backend/run_image_gen.py — do not run this file directly.
"""
import asyncio
import base64
import logging

import cloudinary
import requests

log = logging.getLogger("lokl.image_gen")

# ---------------------------------------------------------------------------
# Together AI — synchronous, runs in the async seed loop (blocking is fine
# for a one-shot script; we're not serving HTTP traffic).
# ---------------------------------------------------------------------------
def generate_image(prompt: str, together_api_key: str) -> bytes:
    response = requests.post(
        "https://api.together.xyz/v1/images/generations",
        headers={"Authorization": f"Bearer {together_api_key}"},
        json={
            "model": "black-forest-labs/FLUX.1-schnell-Free",
            "prompt": prompt,
            "width": 800,
            "height": 800,
            "steps": 4,
            "n": 1,
            "response_format": "b64_json",
        },
        timeout=90,
    )
    response.raise_for_status()
    b64 = response.json()["data"][0]["b64_json"]
    return base64.b64decode(b64)


# ---------------------------------------------------------------------------
# Per-product prompts — all 100 demo products
# ---------------------------------------------------------------------------
PRODUCT_PROMPTS: dict[str, str] = {

    # Store 1 — Chandni Fashion House (Women's fashion)
    "demo-p-01-01": "Floral chiffon top with delicate hand-printed floral motifs in pastel pink and white, women's Indian fashion, relaxed fit, female model, clean white studio background, professional product photography, soft natural lighting",
    "demo-p-01-02": "Silk blouse with intricate gold thread embroidery at collar and cuffs, women's Indian fashion, female model, clean white studio background, professional fashion photography, detailed fabric texture",
    "demo-p-01-03": "Bohemian printed viscose shirt in earth tones with paisley print, women's casual fashion, female model, clean white studio background, professional product photography",
    "demo-p-01-04": "A-line flare midi dress in soft coral georgette fabric, hits below knee, women's Indian fashion, female model, clean white studio background, professional product photography, flowing fabric",
    "demo-p-01-05": "Elegant wrap cocktail dress in deep burgundy matte crepe with V-neckline, women's fashion, female model, clean white studio background, professional fashion photography",
    "demo-p-01-06": "Three-piece Anarkali suit in royal blue with gold zari border and dupatta, Indian ethnic women's wear, female model, clean white studio background, professional product photography, detailed embroidery",
    "demo-p-01-07": "Authentic Banarasi silk saree in deep red with intricate gold zari weave border, traditional Indian ethnic wear, female model wearing draped saree, clean white studio background, professional fashion photography, detailed silk texture",
    "demo-p-01-08": "Crisp white cotton formal shirt for women with button-down front and French tuck cut, women's office wear, female model, clean white studio background, professional product photography",
    "demo-p-01-09": "Women's tailored navy blue blazer with matching straight trousers in stretch fabric, women's power suit office wear, female model, clean white studio background, professional fashion photography",
    "demo-p-01-10": "Festive block-heel sandals with gold bead embellishments and ankle strap closure, Indian wedding footwear, white background, professional shoe product photography, side view, detailed ornate texture",

    # Store 2 — Sole Republic (Footwear)
    "demo-p-02-01": "White canvas high-top sneakers with rubber sole and lace-up closure, women's casual footwear, white background, professional shoe product photography, side view, clean minimal style",
    "demo-p-02-02": "Nude faux suede block heel pumps with 8cm heel, classic women's dress shoes, white background, professional shoe product photography, side view, detailed suede texture",
    "demo-p-02-03": "Handwoven jute upper flat sandals in tan and cream with leather insole, women's casual footwear, white background, professional shoe product photography, side view and top view",
    "demo-p-02-04": "Soft grey suede ankle boots with side zip and cushioned footbed, women's footwear, white background, professional shoe product photography, side view, detailed suede texture",
    "demo-p-02-05": "Black slip-on shoes with gold stud detailing on toe cap, women's casual footwear, white background, professional shoe product photography, side view",
    "demo-p-02-06": "Trail running sneakers in grey and orange with breathable mesh upper and cushioned midsole, men's athletic footwear, white background, professional shoe product photography, side view",
    "demo-p-02-07": "Full-grain tan leather derby shoes with Goodyear welt stitching, classic men's formal footwear, white background, professional shoe product photography, side view, detailed leather grain texture",
    "demo-p-02-08": "Navy canvas slip-on shoes for men with rubber sole, casual minimalist footwear, white background, professional shoe product photography, side view",
    "demo-p-02-09": "Brown leather moc-toe loafers with penny strap, men's smart casual footwear, white background, professional shoe product photography, three-quarter view, detailed leather texture",
    "demo-p-02-10": "Black EVA foam slide sandals with arch support and quick-dry strap, men's sports sandals, white background, professional shoe product photography, top view",

    # Store 3 — Diva Couture (Women casual & leisure)
    "demo-p-03-01": "High-rise dark denim jeggings for women, slim fit, 4-way stretch fabric, women's bottomwear, female model, clean white studio background, professional fashion photography",
    "demo-p-03-02": "Pleated chiffon midi skirt in pastel floral print, women's casual wear, female model, clean white studio background, professional product photography, flowing skirt",
    "demo-p-03-03": "Wide-leg palazzo pants in blush viscose crepe with elasticated waist, women's fashion, female model, clean white studio background, professional product photography",
    "demo-p-03-04": "High-waist 7/8 black sports leggings with moisture-wicking fabric and side pocket, women's activewear, female model, clean white studio background, professional product photography",
    "demo-p-03-05": "Seamless mint green crop top and legging yoga co-ord set, 4-way stretch athleisure, female model, clean white studio background, professional product photography",
    "demo-p-03-06": "Slim-fit grey track suit jacket and jogger set in French terry with thumb holes, women's activewear, female model, clean white studio background, professional product photography",
    "demo-p-03-07": "V-neck blush satin slip night dress for women, sleepwear laid flat on white linen surface, clean white studio background, professional product photography",
    "demo-p-03-08": "Cotton printed pyjama two-piece set in pastel floral print with drawstring waist, women's sleepwear, laid flat on white background, professional product photography",
    "demo-p-03-09": "Soft ivory lace bralette and brief lingerie set, women's intimate wear, clean white studio background, professional flat lay product photography",
    "demo-p-03-10": "Seamless nude microfibre T-shirt bra and matching brief everyday lingerie set, clean white studio background, professional flat lay product photography",

    # Store 4 — Streetwear Bhilai
    "demo-p-04-01": "Oversized drop-shoulder graphic tee in black with bold vintage print, streetwear fashion, unisex, flat lay on white background, professional product photography, 240gsm cotton texture",
    "demo-p-04-02": "Olive green cargo joggers with six pockets and ribbed ankle cuffs, urban streetwear fashion, flat lay on white background, professional product photography",
    "demo-p-04-03": "Black pullover hoodie with kangaroo pocket in fleece, unisex streetwear, flat lay on white background, professional product photography",
    "demo-p-04-04": "Relaxed camo track jacket in khaki camouflage twill with black contrast zipper, men's streetwear, male model, white studio background, professional product photography",
    "demo-p-04-05": "Boxy crop hoodie in spiral pastel tie-dye with ribbed hem, women's streetwear fashion, female model, white studio background, professional product photography",
    "demo-p-04-06": "Acid-wash distressed grey graphic T-shirt with screen-print graphic on chest, men's casual wear, male model, clean white studio background, professional product photography",
    "demo-p-04-07": "Slim-fit white V-neck T-shirt in Supima cotton, minimalist men's casual wear, male model, clean white studio background, professional product photography",
    "demo-p-04-08": "Slim fit dark indigo 5-pocket stretch denim jeans, men's fashion, male model, clean white studio background, professional product photography, detailed denim texture",
    "demo-p-04-09": "Skinny black stretch jeans with stretch waistband, men's fashion, male model, clean white studio background, professional product photography",
    "demo-p-04-10": "Tropical leaf print elastic-waist beach shorts in quick-dry fabric, men's casual shorts, flat lay on white background, professional product photography",

    # Store 5 — Little Stars (Kids)
    "demo-p-05-01": "Cotton floral frock with smocking at waist and colorful floral print, girls' fashion aged 4-10, white background, professional children's fashion photography, bright cheerful colors",
    "demo-p-05-02": "Soft denim dungaree with adjustable straps, unisex children's clothing aged 4-10, white background, professional children's fashion photography",
    "demo-p-05-03": "Dinosaur print half-sleeve tee with matching shorts set for boys aged 4-10, children's casual fashion, white background, professional product photography, bright fun colors",
    "demo-p-05-04": "Lightweight navy blue kids track jacket and jogger set, children's sportswear aged 4-10, white background, professional product photography, flat lay",
    "demo-p-05-05": "Pink layered tulle party dress with satin bodice and bow, princess dress for girls aged 4-10, white background, professional children's fashion photography, bright and festive",
    "demo-p-05-06": "Graphic tee and multi-pocket cargo shorts two-piece set for boys aged 4-10, children's casual wear, white background, professional product photography",
    "demo-p-05-07": "Cosy chunky knit sweater in cream with ribbed cuffs and hem, unisex children's winter wear, white background, professional product photography, flat lay",
    "demo-p-05-08": "Children's school uniform white shirt with grey trousers, wrinkle-resistant fabric for kids aged 4-10, clean white background, professional product photography, flat lay",
    "demo-p-05-09": "Festive kurta with Nehru collar in golden yellow with matching white pajama, Indian ethnic wear for boys aged 4-10, white background, professional children's fashion photography",
    "demo-p-05-10": "Embroidered lehenga choli set with dupatta in pink and gold for girls aged 4-10, Indian ethnic children's wear, white background, professional fashion photography, detailed embroidery",

    # Store 6 — Royal Ethnic Studio
    "demo-p-06-01": "Straight-cut white cotton kurta with Nehru collar and matching cotton pajama, Indian men's ethnic wear, male model, clean white studio background, professional fashion photography",
    "demo-p-06-02": "Navy blue jacquard silk sherwani with gold embroidered yoke, Indian groom's wedding wear with churidar, male model, clean white studio background, professional fashion photography, detailed embroidery work",
    "demo-p-06-03": "Champagne gold raw silk Nehru bundi jacket over white kurta-pajama set, Indian men's festive wear, male model, clean white studio background, professional fashion photography",
    "demo-p-06-04": "Off-white linen Pathani suit with side slits, traditional men's ethnic wear, male model, clean white studio background, professional product photography",
    "demo-p-06-05": "Block-print short kurta in mul cotton with navy geometric print, Indian men's casual ethnic wear, male model, clean white studio background, professional product photography",
    "demo-p-06-06": "Floor-length Anarkali suit in deep magenta with heavy gold thread embroidery and dupatta, Indian women's ethnic wear, female model, clean white studio background, professional fashion photography, detailed embroidery",
    "demo-p-06-07": "Bridal lehenga set in raw silk with gold mirror work, red dupatta, Indian wedding wear for women, female model, clean white studio background, professional fashion photography, detailed craftsmanship",
    "demo-p-06-08": "Pure Banarasi silk saree in deep green with gold zari border and matching blouse piece, Indian traditional ethnic wear, female model wearing draped saree, clean white studio background, professional fashion photography",
    "demo-p-06-09": "Straight-cut salwar kameez set with dupatta in sky blue Cambric cotton, Indian women's ethnic wear, female model, clean white studio background, professional fashion photography",
    "demo-p-06-10": "Sheer ivory Chanderi kurti over inner slip with matching palazzo pants, Indian women's ethnic wear, female model, clean white studio background, professional fashion photography, detailed fabric drape",

    # Store 7 — Powerhouse Sports
    "demo-p-07-01": "Pair of 5kg cast iron adjustable dumbbells with knurl grip, gym fitness equipment, white background, professional product photography, detailed metal texture",
    "demo-p-07-02": "Set of 5 colorful resistance bands in different resistance levels with door anchor and handles, fitness equipment, white background, professional product photography",
    "demo-p-07-03": "Black and red gym workout gloves with wrist wrap support and non-slip silicone palm, fitness accessories, white background, professional product photography",
    "demo-p-07-04": "English willow cricket bat with full-cane handle, grade 3 willow, 1200g, cricket sports equipment, white background, professional product photography, side view, natural wood grain texture",
    "demo-p-07-05": "Black cricket kit duffle bag with separate boot compartment and bat sleeve, multiple exterior pockets, cricket accessories, white background, professional product photography",
    "demo-p-07-06": "Black football turf boots with AG sole and textured upper for ball control, men's sports footwear, white background, professional product photography, side view",
    "demo-p-07-07": "Black and white FIFA-standard match football size 5 with hand-stitched PU leather panels, white background, professional product photography",
    "demo-p-07-08": "Purple 6mm NBR foam yoga mat with alignment lines and carry strap, fitness equipment, white background, professional product photography, shown both rolled and partially unrolled",
    "demo-p-07-09": "Pair of high-density purple EVA foam yoga blocks, fitness accessories, white background, professional product photography, stacked arrangement",
    "demo-p-07-10": "Chocolate whey protein powder in a sealed 1kg container with nutrition label, sports nutrition supplement, white background, professional product photography, clean packaging",

    # Store 8 — Glow & Grace Beauty
    "demo-p-08-01": "Vitamin C face serum 30ml in amber glass dropper bottle, skincare beauty product, clean white background, professional beauty product photography, soft studio lighting, minimal elegant styling",
    "demo-p-08-02": "Hydrating night cream 50ml in white jar with gold lid, ceramide-rich skincare, clean white background, professional beauty product photography, soft diffused lighting",
    "demo-p-08-03": "Kajal eyeliner duo twist-up pencils in black and brown, Indian makeup product, clean white background, professional beauty product photography",
    "demo-p-08-04": "Set of 5 matte lipstick tubes arranged in a gradient from nude to deep red, Indian makeup collection, clean white background, professional beauty product photography",
    "demo-p-08-05": "Onion hair growth oil in amber glass bottle with dropper, red onion extract haircare, clean white background, professional beauty product photography",
    "demo-p-08-06": "Activated charcoal face wash 150ml in black pump bottle, deep-pore cleanser, clean white background, professional beauty product photography",
    "demo-p-08-07": "SPF50 sunscreen gel in white tube, mineral sunscreen skincare, clean white background, professional beauty product photography",
    "demo-p-08-08": "Rose gold and white ceramic flat iron hair straightener, professional hair styling tool, clean white background, professional product photography, sleek modern design",
    "demo-p-08-09": "Portable white facial steamer with herb basket, beauty gadget for skincare, clean white background, professional product photography",
    "demo-p-08-10": "Cordless electric hair and beard trimmer in black and silver with guide combs, men's grooming tool, clean white background, professional product photography",

    # Store 9 — Steel City Formals (Men)
    "demo-p-09-01": "Crisp white Oxford weave formal shirt with button-down collar, 100% cotton men's office wear, male model, clean white studio background, professional fashion photography",
    "demo-p-09-02": "Linen-blend blue and white check shirt with chest pocket, men's smart casual shirt, male model, clean white studio background, professional fashion photography",
    "demo-p-09-03": "Slim-fit white poplin formal dress shirt for men, stays tucked all day, male model, clean white studio background, professional fashion photography",
    "demo-p-09-04": "Cotton casual shirt with subtle navy geometric print, men's smart casual wear, male model, clean white studio background, professional fashion photography",
    "demo-p-09-05": "Flat-front straight formal trousers in charcoal grey tropical wool blend, men's office wear, male model, clean white studio background, professional fashion photography",
    "demo-p-09-06": "Slim khaki chino pants in garment-washed cotton, men's smart casual wear, male model, clean white studio background, professional fashion photography",
    "demo-p-09-07": "Multi-pocket olive cargo pants in canvas with reinforced knees, men's utility work wear, male model, clean white studio background, professional fashion photography",
    "demo-p-09-08": "Slim fit dark indigo wash 5-pocket stretch denim jeans, men's fashion, male model, clean white studio background, professional product photography",
    "demo-p-09-09": "Mid-rise distressed blue jeans with whisker fading and slim taper, men's denim fashion, male model, clean white studio background, professional product photography",
    "demo-p-09-10": "Navy blue pique polo T-shirt with three-button placket, moisture management fabric, men's smart casual wear, male model, clean white studio background, professional fashion photography",

    # Store 10 — Zonal Style Hub (Accessories + Women)
    "demo-p-10-01": "Layered seed bead statement necklace in multicolored beads with brass fittings, women's fashion jewellery, white background, professional jewellery product photography, detailed",
    "demo-p-10-02": "Handwoven jute-cotton blend tote bag in natural tan with rope handles and interior pocket, women's fashion bag, white background, professional product photography, detailed weave texture",
    "demo-p-10-03": "Set of 3 bohemian earrings in oxidised silver finish — large hoops, drop earrings and studs, women's fashion jewellery, white background, professional product photography",
    "demo-p-10-04": "Grey canvas drawstring backpack with laptop sleeve and front pocket, unisex casual bag, white background, professional product photography",
    "demo-p-10-05": "Genuine braided tan leather belt with silver auto-lock buckle, men's accessories, white background, professional product photography, detailed leather braid texture",
    "demo-p-10-06": "Chiffon tiered ruffle midi skirt in dusty pink with elasticated waist, women's casual fashion, female model, clean white studio background, professional fashion photography, flowing fabric",
    "demo-p-10-07": "Relaxed linen shorts in white with tropical leaf print and side pockets, women's casual wear, female model, clean white studio background, professional fashion photography",
    "demo-p-10-08": "Wide-leg high waist pants in textured cream crepe, pull-on women's fashion, female model, clean white studio background, professional fashion photography",
    "demo-p-10-09": "Square-neck floral sundress in rayon challis with adjustable straps, women's casual summer dress, female model, clean white studio background, professional fashion photography",
    "demo-p-10-10": "Stretch crepe bodycon dress with asymmetric neckline in deep navy, knee length women's evening wear, female model, clean white studio background, professional fashion photography",
}


def build_prompt(product: dict) -> str:
    """Fallback prompt for any product not in PRODUCT_PROMPTS."""
    name = product.get("name", "fashion product")
    l1 = product.get("l1_id", "")
    if l1 == "l1-women":
        return f"{name}, Indian women's fashion, female model, clean white studio background, professional product photography, high quality, detailed fabric texture"
    if l1 == "l1-men":
        return f"{name}, Indian men's fashion, male model, clean white studio background, professional product photography, high quality"
    if l1 == "l1-kids":
        return f"{name}, children's fashion aged 4-10, clean white background, professional product photography, bright colors"
    if l1 in ("l1-footwear",):
        return f"{name}, shoe product photography, white background, professional lighting, detailed texture, side view"
    if l1 == "l1-streetwear":
        return f"{name}, streetwear fashion, urban style, white background, professional product photography"
    if l1 == "l1-accessories":
        return f"{name}, fashion accessory, white background, professional product photography, detailed"
    if l1 == "l1-beauty":
        return f"{name}, beauty product, clean white background, professional product photography, luxurious"
    if l1 == "l1-electronics":
        return f"{name}, consumer electronics, clean white background, professional product photography"
    if l1 == "l1-sports":
        return f"{name}, sports equipment, white background, professional product photography"
    return f"{name}, product photography, white background, professional, high quality"


# ---------------------------------------------------------------------------
# Seed entry point
# ---------------------------------------------------------------------------
async def up(db, together_api_key: str, cloudinary_env: dict):
    # Re-configure Cloudinary with the provided credentials (overrides any
    # module-level config in cloudinary_service that ran with empty env vars).
    cloudinary.config(
        cloud_name=cloudinary_env["cloud_name"],
        api_key=cloudinary_env["api_key"],
        api_secret=cloudinary_env["api_secret"],
        secure=True,
    )

    # Late import so sys.path is guaranteed to include backend/ by the time
    # this function is called from run_image_gen.py.
    from services.cloudinary_service import upload_bytes  # noqa: PLC0415

    products = await db.products.find(
        {"id": {"$regex": "^demo-p-"}},
        {"_id": 0, "id": 1, "name": 1, "l1_id": 1, "gender": 1},
    ).to_list(200)

    if not products:
        print("No demo products found in DB. Run the demo_stores seed first.")
        return {"updated": 0, "failed": 0}

    total = len(products)
    print(f"Found {total} demo products. Starting image generation...\n")

    updated = 0
    failed = 0

    for i, product in enumerate(products, 1):
        pid = product["id"]
        name = product["name"]
        print(f"[{i:>3}/{total}] {name} ({pid})")

        prompt = PRODUCT_PROMPTS.get(pid) or build_prompt(product)

        try:
            image_bytes = generate_image(prompt, together_api_key)
            result = await upload_bytes(image_bytes, "product", pid)
            url = result["image_url"]
            await db.products.update_one(
                {"id": pid},
                {"$set": {"image": url, "images": [url]}},
            )
            print(f"       ✓ {url}")
            updated += 1
        except Exception as exc:
            print(f"       ✗ {exc}")
            log.debug("Image gen/upload failed for %s", pid, exc_info=True)
            failed += 1

        # Respect Together AI rate limits between requests
        await asyncio.sleep(1)

    print(f"\nComplete — {updated} updated, {failed} failed.")
    return {"updated": updated, "failed": failed}
