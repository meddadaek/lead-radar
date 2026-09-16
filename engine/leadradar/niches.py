"""Turn a free-text niche into OpenStreetMap tag filters."""
import re

NICHES = [
    (r"dent", "Dental", ['nwr["amenity"="dentist"]', 'nwr["healthcare"="dentist"]']),
    (r"physio|kin[eé]", "Physiotherapy", ['nwr["healthcare"="physiotherapist"]']),
    (r"clinic|clinique|medical|m[eé]dical|doctor|m[eé]decin|physician|health|sant[eé]", "Medical",
     ['nwr["amenity"~"^(clinic|doctors)$"]', 'nwr["healthcare"~"^(clinic|doctor|centre)$"]']),
    (r"pharma", "Pharmacy", ['nwr["amenity"="pharmacy"]']),
    (r"\bvet|v[eé]t[eé]rinaire", "Veterinary", ['nwr["amenity"="veterinary"]']),
    (r"hotel|h[oô]tel|guest|hostel|motel|riad|b&b|chambre d", "Hospitality",
     ['nwr["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]']),
    (r"restaurant|resto", "Restaurants", ['nwr["amenity"="restaurant"]']),
    (r"caf[eé]|coffee", "Cafés", ['nwr["amenity"="cafe"]']),
    (r"real estate|immobili|estate agent|realtor|agence immo", "Real estate",
     ['nwr["office"="estate_agent"]', 'nwr["shop"="estate_agent"]']),
    (r"car rental|location (de )?voiture|rent a car|location auto", "Car rental", ['nwr["amenity"="car_rental"]']),
    (r"garage|car repair|m[eé]cani|auto repair", "Auto repair", ['nwr["shop"="car_repair"]']),
    (r"hair|coiff|barber", "Hair salons", ['nwr["shop"~"^(hairdresser|barber)$"]']),
    (r"beauty|beaut[eé]|esth[eé]ti|spa\b|nail", "Beauty", ['nwr["shop"="beauty"]', 'nwr["leisure"="spa"]']),
    (r"gym|fitness|salle de sport", "Fitness", ['nwr["leisure"="fitness_centre"]']),
    (r"lawyer|avocat|law firm|attorney", "Law firms", ['nwr["office"="lawyer"]']),
    (r"account|comptab", "Accountants", ['nwr["office"="accountant"]']),
    (r"plumb|plombier", "Plumbers", ['nwr["craft"="plumber"]']),
    (r"electric", "Electricians", ['nwr["craft"="electrician"]']),
    (r"hvac|climatisation|heating|chauffage", "HVAC", ['nwr["craft"="hvac"]']),
    (r"travel|voyage", "Travel agencies", ['nwr["shop"="travel_agency"]']),
    (r"school|[eé]cole|formation|training|language", "Training centers",
     ['nwr["amenity"~"^(language_school|driving_school|training)$"]']),
    (r"bakery|boulang", "Bakeries", ['nwr["shop"="bakery"]']),
    (r"optic|opticien", "Opticians", ['nwr["shop"="optician"]']),
]

MEDICAL = {"Dental", "Medical", "Physiotherapy", "Veterinary"}


def resolve(niche: str) -> tuple[str, list[str]]:
    for rx, label, filters in NICHES:
        if re.search(rx, niche, re.I):
            return label, filters
    word = re.sub(r"[^\w\s-]", "", niche, flags=re.U).strip()
    return word.title() or "Businesses", [f'nwr["name"~"{word}",i]']
