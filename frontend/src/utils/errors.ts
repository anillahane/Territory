export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getResponseData = (error: unknown): Record<string, unknown> | null => {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.data)) {
    return null;
  }

  return error.response.data;
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = getResponseData(error);

  if (responseData) {
    if (typeof responseData.message === 'string' && responseData.message.trim()) {
      return responseData.message;
    }

    if (typeof responseData.error === 'string' && responseData.error.trim()) {
      return responseData.error;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

export const getErrorSummary = (error: unknown) => {
  const responseData = getResponseData(error);

  return {
    message: error instanceof Error ? error.message : undefined,
    response: responseData,
    status:
      isRecord(error)
      && isRecord(error.response)
      && typeof error.response.status === 'number'
        ? error.response.status
        : undefined,
  };
};
