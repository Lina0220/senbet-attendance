import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const AuthPage = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleChange = (evt) => {
    setForm((prev) => ({ ...prev, [evt.target.name]: evt.target.value }));
  };

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    setLoading(true);
    setFeedback('');

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword(form);
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp(form);
        if (error) throw error;
      }
      navigate('/app');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow eyebrow-gold auth-title-am">
          የፍኖተ ሎዛ ቅድስት ማርያም መራሔ ጽድቅ ሰንበት ትምህርት ቤት
        </p>
        <h2>{mode === 'signin' ? 'Teacher login' : 'Create teacher account'}</h2>
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            value={form.password}
            onChange={handleChange}
            placeholder="••••••••"
          />
        </label>
        {feedback && <p className="error-text">{feedback}</p>}
        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        <p className="hint">
          {mode === 'signin' ? 'New teacher?' : 'Already have an account?'}{' '}
          <button
            className="link-btn"
            type="button"
            onClick={() => setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'))}
          >
            {mode === 'signin' ? 'Create one' : 'Go to login'}
          </button>
        </p>
        <Link className='back-link' to='/'>
          ← Back to landing
        </Link>
      </form>
    </div>
  );
};

export default AuthPage;

