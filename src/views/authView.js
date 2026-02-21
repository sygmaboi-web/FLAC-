import { mount, qs } from '../lib/dom.js';

export const renderAuthView = ({ root, state, handlers }) => {
  const isVerified = Boolean(state.session?.user?.email_confirmed_at);
  const userEmail = state.session?.user?.email || '';

  mount(
    root,
    `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand"><i class="fab fa-spotify"></i> KingPin Music</div>
        <h1>Masuk ke akun kamu</h1>
        <p class="auth-sub">Google OAuth + Email/Password dengan verifikasi email wajib.</p>

        <button class="btn btn-google" id="googleBtn">
          <i class="fab fa-google"></i> Continue with Google
        </button>

        <div class="auth-divider">atau</div>

        <form id="signInForm" class="auth-form">
          <h3>Sign In</h3>
          <input id="signInEmail" type="email" placeholder="Email" required />
          <input id="signInPassword" type="password" placeholder="Password" required />
          <button class="btn btn-primary" type="submit">Sign In</button>
        </form>

        <form id="signUpForm" class="auth-form">
          <h3>Create Account</h3>
          <input id="signUpName" type="text" placeholder="Display name" />
          <input id="signUpEmail" type="email" placeholder="Email" required />
          <input id="signUpPassword" type="password" placeholder="Password" minlength="6" required />
          <button class="btn btn-outline" type="submit">Create Account</button>
        </form>

        <form id="resetForm" class="auth-form auth-reset">
          <h3>Reset Password</h3>
          <input id="resetEmail" type="email" placeholder="Email" required />
          <button class="btn btn-ghost" type="submit">Send Reset Link</button>
        </form>

        ${
          state.session
            ? `
            <div class="auth-status ${isVerified ? 'is-ok' : 'is-warning'}">
              <strong>${isVerified ? 'Email verified' : 'Email belum terverifikasi'}</strong>
              <p>${userEmail}</p>
              ${
                !isVerified
                  ? '<button class="btn btn-outline" id="resendBtn" type="button">Resend Verification</button>'
                  : '<button class="btn btn-primary" id="openAppBtn" type="button">Open App</button>'
              }
              <button class="btn btn-ghost" id="logoutBtn" type="button">Logout</button>
            </div>
          `
            : ''
        }
      </div>
    </div>
  `
  );

  qs('#googleBtn', root)?.addEventListener('click', handlers.onGoogleSignIn);
  qs('#signInForm', root)?.addEventListener('submit', handlers.onEmailSignIn);
  qs('#signUpForm', root)?.addEventListener('submit', handlers.onEmailSignUp);
  qs('#resetForm', root)?.addEventListener('submit', handlers.onResetPassword);
  qs('#resendBtn', root)?.addEventListener('click', handlers.onResendVerification);
  qs('#openAppBtn', root)?.addEventListener('click', handlers.onOpenApp);
  qs('#logoutBtn', root)?.addEventListener('click', handlers.onSignOut);
};
