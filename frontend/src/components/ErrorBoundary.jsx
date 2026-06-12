// Wraps a tab view so a render error in one tab shows a fallback instead of
// whiting out the whole app. Other tabs keep working. "Try again" resets the
// boundary so the user doesn't have to reload.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // surfaced in the console for debugging; the UI shows the message below
    console.error(`[${this.props.name || 'view'}] crashed:`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback">
          <h3>This view hit an error</h3>
          <p className="hint">{this.props.name
            ? `The ${this.props.name} view couldn't render.` : ''} Other tabs
            still work.</p>
          <pre className="error-detail">{String(this.state.error.message
            || this.state.error)}</pre>
          <button className="export-btn" onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
