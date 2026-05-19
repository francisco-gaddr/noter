import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Rate-limit identical error reports. Without this, a render-loop error
// would spam logs hundreds of times per second and obscure the actual
// signal. We key on the error's name+message+first stack frame so distinct
// errors aren't collapsed but the same one stays at 1/min.
const REPORT_WINDOW_MS = 60_000;
const recentReports = new Map<string, number>();

const reportKey = (error: Error): string => {
  const firstFrame = (error.stack || '').split('\n')[1] || '';
  return `${error.name || 'Error'}|${error.message || ''}|${firstFrame.trim()}`;
};

const shouldReport = (error: Error): boolean => {
  const key = reportKey(error);
  const now = Date.now();
  const last = recentReports.get(key);
  if (last !== undefined && now - last < REPORT_WINDOW_MS) return false;
  recentReports.set(key, now);
  // Garbage-collect entries older than the window so the map can't grow unbounded.
  if (recentReports.size > 64) {
    for (const [k, t] of recentReports) {
      if (now - t > REPORT_WINDOW_MS) recentReports.delete(k);
    }
  }
  return true;
};

export class CustomErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (!shouldReport(error)) return;
    // Structured payload — easy to parse by log shippers and easy to read
    // in a terminal. Stack trace included; PII should never be in error
    // messages but we leave that as a separate redaction concern.
    const payload = {
      level: 'error',
      kind: 'react-error-boundary',
      name: error.name || 'Error',
      message: String(error.message || '').slice(0, 500),
      stack: String(error.stack || '').slice(0, 4000),
      componentStack: String(errorInfo.componentStack || '').slice(0, 2000),
      ts: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.error('[error-boundary]', JSON.stringify(payload));
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Surface style={styles.surface} elevation={2}>
            <Text variant="headlineMedium" style={styles.title}>Oops, something went wrong</Text>
            <Text variant="bodyMedium" style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </Text>
            <Button mode="contained" onPress={this.handleRetry} style={styles.button}>
              Try Again
            </Button>
          </Surface>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  surface: {
    padding: 20,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  title: {
    marginBottom: 10,
    textAlign: 'center',
    color: '#B00020',
  },
  message: {
    marginBottom: 20,
    textAlign: 'center',
    color: '#666',
  },
  button: {
    marginTop: 10,
  },
});
