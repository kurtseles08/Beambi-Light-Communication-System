export type Quake = {
  id: string
  magnitude: number
  place: string
  time: number // ms since epoch
  depthKm: number
  url: string
}

export async function fetchQuakes(): Promise<Quake[]> {
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    minmagnitude: '3',
    orderby: 'time',
    limit: '15',
    // Philippine region bounding box
    minlatitude: '4',
    maxlatitude: '22',
    minlongitude: '115',
    maxlongitude: '128',
  })
  const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`)
  if (!res.ok) throw new Error(`Earthquake request failed (${res.status})`)
  const data = await res.json()
  return data.features.map((f: any) => ({
    id: f.id,
    magnitude: f.properties.mag ?? 0,
    place: f.properties.place ?? 'Unknown location',
    time: f.properties.time,
    depthKm: f.geometry.coordinates[2],
    url: f.properties.url,
  }))
}