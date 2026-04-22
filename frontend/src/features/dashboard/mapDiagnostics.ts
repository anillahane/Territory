import type { Map } from 'maplibre-gl';

const stringifyDiagnosticValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildViewportSnapshot = (mapInstance: Map): string => {
  const center = mapInstance.getCenter();
  const bounds = mapInstance.getBounds();

  return [
    `zoom=${mapInstance.getZoom().toFixed(2)}`,
    `center=${center.lat.toFixed(4)}deg,${center.lng.toFixed(4)}deg`,
    `bounds=[${bounds.getSouth().toFixed(4)},${bounds.getWest().toFixed(4)}]-[${bounds.getNorth().toFixed(4)},${bounds.getEast().toFixed(4)}]`
  ].join(' | ');
};

export const buildMapStatusMessage = (
  summary: string,
  mapInstance: Map | null,
  details?: Record<string, unknown>,
  error?: unknown
): string => {
  const lines: string[] = [summary];

  if (mapInstance) {
    lines.push(`viewport: ${buildViewportSnapshot(mapInstance)}`);
  }

  if (details) {
    Object.entries(details).forEach(([key, value]) => {
      if (value !== undefined) {
        lines.push(`${key}: ${stringifyDiagnosticValue(value)}`);
      }
    });
  }

  if (error !== undefined) {
    lines.push(`error: ${stringifyDiagnosticValue(error)}`);
  }

  return lines.join('\n');
};
