import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const PlatformLogin = () => {
  const { signIn } = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await signIn(email.trim(), password);
      navigate('/platform/dashboard', { replace: true });
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Invalid email or password.' : (err.message || 'Login failed.'));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface rounded-spa-lg shadow-spa-elevated p-6 space-y-4">
        <h1 className="font-heading font-heading-semibold text-lg text-text-primary">Platform Admin</h1>
        {error && <p className="font-body text-sm text-error">{error}</p>}
        <div className="space-y-1">
          <label className="font-body text-sm text-text-secondary">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            data-ph-mask
            className="w-full border border-border rounded-spa px-3 py-2 font-body text-sm" />
        </div>
        <div className="space-y-1">
          <label className="font-body text-sm text-text-secondary">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            data-ph-mask
            className="w-full border border-border rounded-spa px-3 py-2 font-body text-sm" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-primary text-white rounded-spa px-3 py-2 font-body text-sm disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

export default PlatformLogin;
