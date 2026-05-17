import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiYzd0dSIsImEiOiJjbXA5ZTFxMDkwMHVhMnNvbXNxaG8zMTNzIn0.9AAaK0CvEDWzmPiES_08Gg';

const STATIONS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const TRIPS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const BOSTON_BIKE_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';

const CAMBRIDGE_BIKE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl());

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }

  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;

    return {
      ...station,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0),
    };
  });
}

function tooltipText(d) {
  return `${d.name}
${d.totalTraffic} trips
${d.departures} departures
${d.arrivals} arrivals`;
}

map.on('load', async () => {
  const bikeLanePaint = {
    'line-color': '#32D400',
    'line-width': 3,
    'line-opacity': 0.55,
  };

  map.addSource('boston-bike-lanes', {
    type: 'geojson',
    data: BOSTON_BIKE_LANES_URL,
  });

  map.addLayer({
    id: 'boston-bike-lanes-layer',
    type: 'line',
    source: 'boston-bike-lanes',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge-bike-lanes', {
    type: 'geojson',
    data: CAMBRIDGE_BIKE_LANES_URL,
  });

  map.addLayer({
    id: 'cambridge-bike-lanes-layer',
    type: 'line',
    source: 'cambridge-bike-lanes',
    paint: bikeLanePaint,
  });

  const stationJson = await d3.json(STATIONS_URL);
  const baseStations = stationJson.data.stations;

  await d3.csv(TRIPS_URL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);

    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    departuresByMinute[startedMinutes].push(trip);
    arrivalsByMinute[endedMinutes].push(trip);

    return trip;
  });

  let stations = computeStationTraffic(baseStations);

  const svg = d3.select('#map').select('svg');

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic)
    );

  circles.append('title').text((d) => tooltipText(d));

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(baseStations, timeFilter);

    radiusScale
      .domain([0, d3.max(filteredStations, (d) => d.totalTraffic)])
      .range(timeFilter === -1 ? [0, 25] : [3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic)
      )
      .select('title')
      .text((d) => tooltipText(d));

    updatePositions();
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'block';
      anyTimeLabel.textContent = '± 1 hour';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});