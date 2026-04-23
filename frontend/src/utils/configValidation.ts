export interface ConfigFormValues {
  originLat: number;
  originLon: number;
  alphabet: string;
}

export type ConfigValidationErrors = Partial<Record<keyof ConfigFormValues, string>>;

export const validateConfig = (config: ConfigFormValues): ConfigValidationErrors => {
  const errors: ConfigValidationErrors = {};

  if (config.originLat < -90 || config.originLat > 90) {
    errors.originLat = 'Latitude must be between -90 and 90';
  }

  if (config.originLon < -180 || config.originLon > 180) {
    errors.originLon = 'Longitude must be between -180 and 180';
  }

  if (config.alphabet.length !== 30) {
    errors.alphabet = 'Alphabet must contain exactly 30 characters';
  } else if (config.alphabet.includes('-')) {
    errors.alphabet = 'Alphabet cannot contain hyphen (-)';
  } else if (new Set(config.alphabet).size !== 30) {
    errors.alphabet = 'Alphabet must contain 30 unique characters';
  }

  return errors;
};
