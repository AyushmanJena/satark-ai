import type { CrowdLevel, CrowdRegion } from './crowd-api';

export type Coordinate = { latitude: number; longitude: number };

export type CrowdWarning = {
  level: CrowdLevel;
  message: string;
  nearestRegion?: CrowdRegion;
};

const earthRadiusMetres = 6_371_000;

export function isPointInRegion(point: Coordinate, region: CrowdRegion) {
  return (
    point.latitude >= region.south &&
    point.latitude <= region.north &&
    point.longitude >= region.west &&
    point.longitude <= region.east
  );
}

function distanceBetweenMetres(a: Coordinate, b: Coordinate) {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusMetres * Math.asin(Math.sqrt(haversine));
}

/** Returns the shortest distance from a point to a latitude/longitude rectangle. */
export function distanceToRegionMetres(point: Coordinate, region: CrowdRegion) {
  const closestPoint = {
    latitude: Math.min(Math.max(point.latitude, region.south), region.north),
    longitude: Math.min(Math.max(point.longitude, region.west), region.east),
  };

  return distanceBetweenMetres(point, closestPoint);
}

const severity: Record<CrowdLevel, number> = { low: 1, moderate: 2, extreme: 3 };

export function getCrowdWarning(point: Coordinate, regions: CrowdRegion[]): CrowdWarning {
  const overlappingRegions = regions.filter((region) => isPointInRegion(point, region));
  if (overlappingRegions.length > 0) {
    const region = overlappingRegions.reduce((mostSevere, region) =>
      severity[region.level] > severity[mostSevere.level] ? region : mostSevere
    );
    return {
      level: region.level,
      nearestRegion: region,
      message: `You are inside the ${region.label ?? 'crowd'} area.`,
    };
  }

  const nearest = regions
    .map((region) => ({ region, distance: distanceToRegionMetres(point, region) }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearest && nearest.distance <= 400) {
    return {
      level: 'moderate',
      nearestRegion: nearest.region,
      message: `Dense crowd area ${Math.round(nearest.distance)} m away near ${nearest.region.label ?? 'you'}.`,
    };
  }

  return { level: 'low', message: 'No dense crowd area nearby.' };
}
