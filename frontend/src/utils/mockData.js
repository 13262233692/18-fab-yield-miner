const WAFER_RADIUS_MM = 150;

export function generateMockDefects(count = 50000) {
  const defects = [];
  const clusterCenters = [
    { x: -40, y: 30, spread: 15, count: 0.2 },
    { x: 50, y: -60, spread: 20, count: 0.15 },
    { x: 20, y: 80, spread: 10, count: 0.1 },
    { x: -70, y: -40, spread: 18, count: 0.12 },
    { x: 60, y: 50, spread: 12, count: 0.08 },
  ];

  for (let i = 0; i < count; i++) {
    let x, y;
    const rand = Math.random();

    if (rand < 0.65) {
      let cumulative = 0;
      let cluster = clusterCenters[0];
      for (const c of clusterCenters) {
        cumulative += c.count;
        if (rand < cumulative) {
          cluster = c;
          break;
        }
      }
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.random() * cluster.spread;
      x = cluster.x + Math.cos(angle) * r;
      y = cluster.y + Math.sin(angle) * r;
    } else {
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.sqrt(Math.random()) * WAFER_RADIUS_MM * 0.95;
      x = Math.cos(angle) * r;
      y = Math.sin(angle) * r;
    }

    const size = Math.random() * 1.5 + 0.2;
    const defectClass = ['Particle', 'Scratch', 'Defect', 'Contamination'][
      Math.floor(Math.random() * 4)
    ];

    defects.push({
      id: i,
      x: parseFloat(x.toFixed(4)),
      y: parseFloat(y.toFixed(4)),
      size: parseFloat(size.toFixed(3)),
      defectClass,
      waferId: `W${String(Math.floor(Math.random() * 8) + 1).padStart(2, '0')}`,
    });
  }

  return defects;
}

export function aggregateDefects(defects, xMin, yMin, xMax, yMax, resolution = 200) {
  const tileWidth = (xMax - xMin) / resolution;
  const tileHeight = (yMax - yMin) / resolution;
  const grid = new Map();

  defects.forEach((defect) => {
    if (defect.x < xMin || defect.x > xMax || defect.y < yMin || defect.y > yMax) return;

    const gridX = Math.floor((defect.x - xMin) / tileWidth);
    const gridY = Math.floor((defect.y - yMin) / tileHeight);
    const key = `${gridX},${gridY}`;

    if (!grid.has(key)) {
      grid.set(key, {
        x: xMin + gridX * tileWidth + tileWidth / 2,
        y: yMin + gridY * tileHeight + tileHeight / 2,
        count: 0,
        totalSize: 0,
      });
    }

    const cell = grid.get(key);
    cell.count++;
    cell.totalSize += defect.size;
  });

  return Array.from(grid.values()).map((cell) => ({
    x: cell.x,
    y: cell.y,
    count: cell.count,
    avgSize: cell.totalSize / cell.count,
  }));
}

export function getMockWafers() {
  return ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08'];
}

export function getMockBatches() {
  return [
    {
      id: 'mock-batch-1',
      batchName: 'DEMO_BATCH_001',
      productName: 'DEMO_PRODUCT',
      waferCount: 8,
      defectCount: 50000,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function pickDefectAtPoint(defects, x, y, radius) {
  return defects
    .filter((d) => {
      const dx = d.x - x;
      const dy = d.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= radius;
    })
    .sort((a, b) => {
      const da = Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2);
      const db = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2);
      return da - db;
    })
    .slice(0, 10);
}

export function findClusters(defects, eps = 8.0, minPoints = 15) {
  const clusters = [];
  const visited = new Set();

  defects.forEach((defect, idx) => {
    if (visited.has(idx)) return;

    const neighbors = getNeighbors(defects, defect, eps);
    if (neighbors.length < minPoints) return;

    const cluster = [];
    const queue = [idx];

    while (queue.length > 0) {
      const currIdx = queue.shift();
      if (visited.has(currIdx)) continue;
      visited.add(currIdx);

      const currDefect = defects[currIdx];
      cluster.push(currDefect);

      const currNeighbors = getNeighbors(defects, currDefect, eps);
      if (currNeighbors.length >= minPoints) {
        currNeighbors.forEach((nIdx) => {
          if (!visited.has(nIdx)) {
            queue.push(nIdx);
          }
        });
      }
    }

    if (cluster.length >= minPoints) {
      const centroidX = cluster.reduce((sum, d) => sum + d.x, 0) / cluster.length;
      const centroidY = cluster.reduce((sum, d) => sum + d.y, 0) / cluster.length;
      clusters.push({
        clusterId: clusters.length,
        defectCount: cluster.length,
        centroidX: parseFloat(centroidX.toFixed(2)),
        centroidY: parseFloat(centroidY.toFixed(2)),
      });
    }
  });

  return clusters
    .sort((a, b) => b.defectCount - a.defectCount)
    .slice(0, 20);
}

function getNeighbors(defects, target, eps) {
  const result = [];
  defects.forEach((defect, idx) => {
    const dx = defect.x - target.x;
    const dy = defect.y - target.y;
    if (Math.sqrt(dx * dx + dy * dy) <= eps) {
      result.push(idx);
    }
  });
  return result;
}
