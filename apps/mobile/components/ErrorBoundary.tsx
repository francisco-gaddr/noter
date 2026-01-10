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

export class CustomErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
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
