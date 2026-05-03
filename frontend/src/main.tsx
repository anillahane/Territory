import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import theme from './theme';
import './index.css';

const parseSampleRate = (value: string | undefined, fallback: number) => {
  const parsedValue = Number.parseFloat(value || '');
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const getTracePropagationTargets = () => {
  const targets = new Set<string>([window.location.origin]);
  const apiUrl = import.meta.env.VITE_API_URL;

  if (apiUrl) {
    try {
      targets.add(new URL(apiUrl, window.location.origin).origin);
    } catch {
      // Ignore malformed local overrides and keep the app bootable.
    }
  }

  return Array.from(targets);
};

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      import.meta.env.DEV ? 1.0 : 0.1
    ),
    replaysSessionSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
      import.meta.env.DEV ? 1.0 : 0.1
    ),
    replaysOnErrorSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
      1.0
    ),
    tracePropagationTargets: getTracePropagationTargets(),
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
