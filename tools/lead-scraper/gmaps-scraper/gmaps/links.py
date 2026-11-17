"""Ties a lead to Zennly: which solutions page fits it, and a one-tap WhatsApp link."""
import re

from . import config

# category label used in leads.db / config.yaml -> /solutions/{slug}/ page on the Zennly site
SOLUTION_SLUG = {
    "salon": "salon",
    "beauty parlour": "salon",
    "nail": "salon",
    "spa": "spa",
    "barbershop": "barbershop",
    "gym": "fitness",
    "pilates/yoga": "fitness",
    "tattoo": "tattoo",
    "makeup": "bridal-makeup",
    "physiotherapy": "physiotherapy",
    "cleaning": "cleaning",
    "beauty clinic": "beauty-clinic",
}


def solution_url(category):
    slug = SOLUTION_SLUG.get((category or "").strip().lower())
    return f"{config.SITE_URL}/solutions/{slug}/" if slug else f"{config.SITE_URL}/solutions/"


def whatsapp_url(phone):
    """wa.me link for a +977 mobile (98/97...). Landlines (01...) cannot receive WhatsApp, so return None."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("977") and len(digits) == 13 and digits[3:5] in ("98", "97"):
        return f"https://wa.me/{digits}"
    return None
