declare module '@turf/boolean-intersects' {
  const booleanIntersects: (featureA: any, featureB: any) => boolean;
  export default booleanIntersects;
}

declare module '@turf/helpers' {
  export const polygon: (coordinates: number[][][], properties?: Record<string, unknown>) => any;
}
