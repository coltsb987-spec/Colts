"""Distances and search tiles. Google returns at most 60 results per search, so a big area is
split into square tiles, and any tile that hits the cap is split again into 4 smaller ones."""
import math
from dataclasses import dataclass

MILE_M = 1609.344
EARTH_R_M = 6371008.8


def miles_between(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(a)) / MILE_M


def miles_to_deg(lat, miles):
    """(degrees of latitude, degrees of longitude) spanned by `miles` at this latitude."""
    m = miles * MILE_M
    dlat = m / 111320.0
    dlng = m / (111320.0 * max(math.cos(math.radians(lat)), 0.01))
    return dlat, dlng


@dataclass(frozen=True)
class Tile:
    south: float
    west: float
    north: float
    east: float
    depth: int = 0

    @property
    def centre(self):
        return (self.south + self.north) / 2, (self.west + self.east) / 2

    def split(self):
        mlat, mlng = self.centre
        d = self.depth + 1
        return [
            Tile(self.south, self.west, mlat, mlng, d),
            Tile(self.south, mlng, mlat, self.east, d),
            Tile(mlat, self.west, self.north, mlng, d),
            Tile(mlat, mlng, self.north, self.east, d),
        ]

    def nearest_point(self, lat, lng):
        return min(max(lat, self.south), self.north), min(max(lng, self.west), self.east)


def tiles_for_circle(lat, lng, radius_miles, tile_miles):
    """Square tiles of about `tile_miles` a side covering the circle. Tiles that don't touch it are dropped."""
    n = max(1, math.ceil(2 * radius_miles / tile_miles))
    dlat, dlng = miles_to_deg(lat, radius_miles)
    south, west = lat - dlat, lng - dlng
    step_lat, step_lng = 2 * dlat / n, 2 * dlng / n
    tiles = []
    for i in range(n):
        for j in range(n):
            t = Tile(south + i * step_lat, west + j * step_lng,
                     south + (i + 1) * step_lat, west + (j + 1) * step_lng)
            plat, plng = t.nearest_point(lat, lng)
            if miles_between(lat, lng, plat, plng) <= radius_miles:
                tiles.append(t)
    return tiles
