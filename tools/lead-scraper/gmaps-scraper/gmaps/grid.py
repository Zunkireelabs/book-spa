"""Cut an area into small search cells (same idea as gosom/google-maps-scraper's grid package).

Google Maps returns roughly 120 results per search, so one search per big area misses most businesses.
Searching from the centre of many ~600 m cells finds far more, and the list of cells doubles as the
record of where we have looked.
"""
import math

from .areas import distance_m

M_PER_DEG_LAT = 111_320.0


def cells_for_area(lat, lng, radius_m, cell_m=600):
    """Centres of cells covering the circle (lat, lng, radius_m). Returns [(lat, lng), ...]."""
    cell_m = max(150, cell_m)
    dlat = cell_m / M_PER_DEG_LAT
    dlng = cell_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    n = int(math.ceil(radius_m / cell_m))
    reach = radius_m + cell_m * 0.7          # keep cells that overlap the edge of the circle
    out = []
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            c_lat, c_lng = lat + i * dlat, lng + j * dlng
            if distance_m(lat, lng, c_lat, c_lng) <= reach:
                out.append((round(c_lat, 6), round(c_lng, 6)))
    return out
