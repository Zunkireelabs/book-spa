import React from 'react';

// Keeps one bad list row from taking the whole page to the error screen: a failed row renders nothing (and logs).
class RowBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[RowBoundary] row failed to render:', error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default RowBoundary;
