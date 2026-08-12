export type CrowdLevel = 'low' | 'moderate' | 'extreme';

export type CrowdRegion = {
  id: string;
  level: CrowdLevel;
  /** Northernmost latitude of the rectangular region. */
  north: number;
  south: number;
  east: number;
  west: number;
  label?: string;
};

const mockCrowdRegions: CrowdRegion[] = [
  
  {
    id: 'master-canteen',
    label: 'Master Canteen',
    level: 'extreme',
    north: 20.2759,
    south: 20.2719,
    east: 85.8464,
    west: 85.8412,
  },
  {
    id: 'unit-1-market',
    label: 'Unit 1 Market',
    level: 'moderate',
    north: 20.2706,
    south: 20.2674,
    east: 85.8389,
    west: 85.8348,
  },
  {
    id: 'railway-station',
    label: 'Bhubaneswar Railway Station',
    level: 'low',
    north: 20.2694,
    south: 20.2658,
    east: 85.8507,
    west: 85.8465,
  },
];

type CrowdApiResponse = CrowdRegion[] | { regions: CrowdRegion[] };

/**
 * Retrieves live crowd regions when EXPO_PUBLIC_CROWD_API_URL is configured.
 * The API should return either a CrowdRegion array or `{ regions: CrowdRegion[] }`.
 */
export async function fetchCrowdRegions(): Promise<{ regions: CrowdRegion[]; usingMockData: boolean }> {
  const endpoint = process.env.EXPO_PUBLIC_CROWD_API_URL;

  if (!endpoint) {
    return { regions: mockCrowdRegions, usingMockData: true };
  }

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Crowd API returned ${response.status}`);
    }

    const data: CrowdApiResponse = await response.json();
    const regions = Array.isArray(data) ? data : data.regions;
    if (!Array.isArray(regions) || regions.length === 0) {
      throw new Error('Crowd API did not return any regions');
    }

    return { regions, usingMockData: false };
  } catch {
    return { regions: mockCrowdRegions, usingMockData: true };
  }
}
