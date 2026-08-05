"""Featured Bhilai areas for the homepage "Shop by Area" section.

Slugs match `frontend/src/data/bhilai-areas.ts` (the merchant storefront
area picker) exactly — these 6 are a curated subset of the 25 areas
merchants can choose from, picked for the homepage tiles. A store's own
`area_slug` (set via /merchant/storefront) is what store-count aggregation
and the /stores?area= filter match against, so slugs here MUST stay in
sync with that file.

Images are intentionally NOT seeded here — they're admin/CMS-set via
PUT /api/admin/areas/{id} (mirrors how L1/L2 category images work) and
protected by $setOnInsert at boot, same as categories.
"""
AREAS_SEED = [
    {"id": "area-nehru-nagar", "slug": "nehru-nagar", "name": "Nehru Nagar", "order": 1, "featured": True},
    {"id": "area-smriti-nagar", "slug": "smriti-nagar", "name": "Smriti Nagar", "order": 2, "featured": True},
    {"id": "area-powerhouse", "slug": "powerhouse", "name": "Powerhouse", "order": 3, "featured": True},
    {"id": "area-sector-6", "slug": "sector-6", "name": "Sector 6", "order": 4, "featured": True},
    {"id": "area-supela", "slug": "supela", "name": "Supela", "order": 5, "featured": True},
    {"id": "area-risali", "slug": "risali", "name": "Risali", "order": 6, "featured": True},
]
