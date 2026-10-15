import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Droplet, Eye, EyeOff, Mail, Lock, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

const LoginPage = ({ onLogin }: { onLogin: () => void }) => {
  const { currentUser, loading, login, resetPassword, error: authError, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Forgot Password Flow States
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Load saved credentials on mount if remember-me was active
  useEffect(() => {
    try {
      const savedRemember = localStorage.getItem('wm_remember_me') === 'true';
      setRememberMe(savedRemember);
      if (savedRemember) {
        const savedEmail = localStorage.getItem('wm_remembered_email') || '';
        const savedPassword = localStorage.getItem('wm_remembered_password') || '';
        setEmail(savedEmail);
        setPassword(savedPassword);
      }
    } catch (e) {
      console.error('Error loading remembered credentials:', e);
    }
  }, []);

  useEffect(() => {
    if (!loading && currentUser) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, loading, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20 animate-pulse">
            <Droplet className="h-8 w-8 text-primary animate-bounce" />
          </div>
          <h2 className="text-lg font-semibold text-primary">MSU Water System</h2>
          <p className="text-xs text-muted-foreground animate-pulse">Restoring secure session state...</p>
        </div>
      </div>
    );
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }
    
    // Fallback: If username has no domain, append '@gmail.com'
    let resolvedEmail = email.trim();
    if (resolvedEmail && !resolvedEmail.includes('@')) {
      resolvedEmail = `${resolvedEmail}@gmail.com`;
    }
    
    // Email basic regex validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resolvedEmail)) {
      setError('Please enter a valid username or email address');
      return;
    }

    setIsSubmitting(true);
    setError('');
    clearError();

    try {
      await login(resolvedEmail, password);
      
      // Save or clear credentials based on the Remember Me toggle
      if (rememberMe) {
        localStorage.setItem('wm_remember_me', 'true');
        localStorage.setItem('wm_remembered_email', email);
        localStorage.setItem('wm_remembered_password', password);
      } else {
        localStorage.removeItem('wm_remember_me');
        localStorage.removeItem('wm_remembered_email');
        localStorage.removeItem('wm_remembered_password');
      }

      toast.success('Successfully logged in!');
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      toast.error(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setError('Please enter your username or email address');
      return;
    }

    // Fallback: If username has no domain, append '@gmail.com'
    let resolvedResetEmail = resetEmail.trim();
    if (resolvedResetEmail && !resolvedResetEmail.includes('@')) {
      resolvedResetEmail = `${resolvedResetEmail}@gmail.com`;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resolvedResetEmail)) {
      setError('Please enter a valid username or email address');
      return;
    }

    setIsResetting(true);
    setError('');
    clearError();

    try {
      await resetPassword(resolvedResetEmail);
      toast.success('Password reset email sent! Check your inbox.');
      setIsForgotPassword(false);
      setResetEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to send password reset email');
      toast.error(err.message || 'Failed to send password reset email');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Glassmorphic card design matching existing theme */}
      <div className="w-full max-w-md rounded-xl bg-card p-8 border border-border/40 shadow-xl transition-all duration-300">
        
        {/* Branding header */}
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mb-4 animate-pulse">
            <Droplet className="h-8 w-8 text-primary animate-bounce" />
          </div>
          <h1 className="text-2xl font-extrabold text-primary text-center">MSU Water System</h1>
          <p className="text-muted-foreground text-xs mt-1.5 text-center">
            {isForgotPassword 
              ? 'Reset your administrator or operator password' 
              : 'Sign in to access your telemetry dashboard'}
          </p>
        </div>

        {/* Dynamic form rendering */}
        {!isForgotPassword ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Email or Username</label>
              <div className="relative">
                <input
                  type="text"
                  value={email}
                  disabled={isSubmitting}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  placeholder="e.g. zailanorpundato"
                  className="w-full rounded-lg border border-input bg-secondary/30 pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition"
                />
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Password</label>
                <button
                  type="button"
                  onClick={() => { setIsForgotPassword(true); setError(''); clearError(); }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  disabled={isSubmitting}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-input bg-secondary/30 pl-10 pr-10 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition"
                />
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)} 
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="flex items-center justify-between py-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  disabled={isSubmitting}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-input bg-secondary/30 text-primary focus:ring-primary/20 transition cursor-pointer accent-primary disabled:opacity-50"
                />
                <span className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  Remember Me
                </span>
              </label>
            </div>

            {(error || authError) && (
              <p className="text-xs text-danger font-semibold bg-danger/10 border border-danger/20 p-2.5 rounded-lg animate-pulse">
                ⚠️ {error || authError}
              </p>
            )}

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Verifying Credentials...
                </>
              ) : (
                'Secure Login'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Registered Email or Username</label>
              <div className="relative">
                <input
                  type="text"
                  value={resetEmail}
                  disabled={isResetting}
                  onChange={e => { setResetEmail(e.target.value); setError(''); }}
                  placeholder="e.g. zailanorpundato"
                  className="w-full rounded-lg border border-input bg-secondary/30 pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition"
                />
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            {(error || authError) && (
              <p className="text-xs text-danger font-semibold bg-danger/10 border border-danger/20 p-2.5 rounded-lg">
                ⚠️ {error || authError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button 
                type="submit" 
                disabled={isResetting}
                className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-sm"
              >
                {isResetting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending Reset Email...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
              
              <button
                type="button"
                onClick={() => { setIsForgotPassword(false); setError(''); clearError(); }}
                className="w-full rounded-lg border border-border bg-transparent py-2.5 text-sm font-semibold hover:bg-secondary/40 transition flex items-center justify-center gap-1.5"
              >
                <ArrowLeft size={14} /> Back to Sign In
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
