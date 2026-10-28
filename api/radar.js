const https = require('https');

function formatReg(reg) {
  if (!reg) return '';
  const clean = reg.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length >= 4 && (
    clean.startsWith('TC') || clean.startsWith('VT') || clean.startsWith('SU') ||
    clean.startsWith('A6') || clean.startsWith('A7') || clean.startsWith('9K') ||
    clean.startsWith('4X') || clean.startsWith('VP') || clean.startsWith('VQ') ||
    clean.startsWith('RA') || clean.startsWith('B')  || clean.startsWith('N')
  )) {
    if (clean.startsWith('N')) return clean; // US tail e.g. N12345
    return clean.slice(0, 2) + '-' + clean.slice(2);
  }
  return clean;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { callsign, reg, flight } = req.query || {};
  const queries = [];

  if (callsign) {
    const cleanCallsign = callsign.replace(/\s+/g, '').toUpperCase();
    queries.push(`callsign=${encodeURIComponent(cleanCallsign)}`);
  }

  if (reg) {
    const cleanReg = reg.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    queries.push(`reg=${encodeURIComponent(cleanReg)}`);
    const formatted = formatReg(cleanReg);
    if (formatted !== cleanReg) {
      queries.push(`reg=${encodeURIComponent(formatted)}`);
    }
  }

  if (flight) {
    const cleanFlight = flight.replace(/\s+/g, '').toUpperCase();
    queries.push(`flight=${encodeURIComponent(cleanFlight)}`);
    // Handle leading zero variations like 6E0018 -> 6E18 or 6E11
    const noLeadingZeros = cleanFlight.replace(/^([A-Za-z0-9]{2})0+([0-9]+)$/, '$1$2');
    if (noLeadingZeros !== cleanFlight) {
      queries.push(`flight=${encodeURIComponent(noLeadingZeros)}`);
    }
  }

  for (const q of queries) {
    try {
      const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?${q}`;
      const raw = await fetchUrl(url);
      const data = JSON.parse(raw);
      for (const k of Object.keys(data)) {
        if (k !== 'full_count' && k !== 'version' && Array.isArray(data[k])) {
          const row = data[k];
          return res.status(200).json({
            found: true,
            source: 'FLIGHTRADAR24',
            hex: row[0],
            latitude: row[1],
            longitude: row[2],
            true_track: row[3],
            baro_altitude: Math.round(row[4] * 0.3048), // feet to meters
            altitude_ft: row[4],
            velocity: Math.round(row[5] * 0.514444), // knots to m/s
            speed_kmh: Math.round(row[5] * 1.852),
            speed_kts: row[5],
            on_ground: row[4] <= 0 || row[14] === 1,
            aircraft_type: row[8],
            registration: row[9],
            origin: row[11],
            destination: row[12],
            flight_number: row[13],
            callsign: row[16] || callsign,
            airline: row[18],
            last_contact: row[10]
          });
        }
      }
    } catch (e) {
      // Continue to next query candidate
    }
  }

  return res.status(200).json({
    found: false,
    message: 'Canlı ADS-B / Flightradar24 beslemesinde anlık havadaki sinyal bulunamadı (Uçak yerde veya transponder kapalı olabilir)'
  });
};
