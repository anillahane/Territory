export const replaceWindowInterval = (
  currentIntervalId: number | null,
  callback: () => void,
  delayMs: number
): number => {
  if (currentIntervalId !== null) {
    window.clearInterval(currentIntervalId);
  }

  return window.setInterval(callback, delayMs);
};

export const clearWindowInterval = (currentIntervalId: number | null): null => {
  if (currentIntervalId !== null) {
    window.clearInterval(currentIntervalId);
  }

  return null;
};
