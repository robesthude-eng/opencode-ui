import React, { useState } from "react";
import { useStore } from "../store/useStore";

export default function LoginPage() {
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Введите корректный email адрес.");
      return;
    }
    if (!password || password.length < 6) {
      setError("Пароль должен содержать минимум 6 символов.");
      return;
    }
    if (isRegistering && password !== confirmPass) {
      setError("Пароли не совпадают.");
      return;
    }

    setLoading(true);
    const res = isRegistering ? await register(cleanEmail, password) : await login(cleanEmail, password);
    setLoading(false);

    if (!res.ok) {
      setError(res.error || "Ошибка авторизации.");
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">✦</div>
          <h2>{isRegistering ? "Регистрация" : "Вход"}</h2>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${!isRegistering ? "active" : ""}`}
            onClick={() => { setIsRegistering(false); setError(null); }}
          >
            Вход
          </button>
          <button
            type="button"
            className={`auth-tab ${isRegistering ? "active" : ""}`}
            onClick={() => { setIsRegistering(true); setError(null); }}
          >
            Регистрация
          </button>
        </div>

        {error && <div className="error-banner small" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {isRegistering && (
            <div className="form-group">
              <label>Подтвердите пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
              />
            </div>
          )}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? "Подождите…" : isRegistering ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
