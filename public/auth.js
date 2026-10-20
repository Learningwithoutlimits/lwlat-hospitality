// Microsoft sign-in for the booking form and the admin page.
// Uses MSAL (Microsoft's sign-in library), loaded from /vendor before this file.
//
//   const user = await Auth.start();   // null if not signed in
//   Auth.signIn();  Auth.signOut();
//   await Auth.token();                // fresh token to send to /api
//
// Sign-in always returns to the home page (the one redirect address registered
// in Entra), and MSAL then sends the person back to the page they started on.

(function () {
  const ADMIN_ROLE = "Catering.Admin";
  const SCOPES = ["openid", "profile", "email"];
  let app = null;
  let account = null;

  async function start() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!cfg.clientId || !cfg.tenantId) throw new Error("Microsoft sign-in has not been set up yet.");

    app = new msal.PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        redirectUri: location.origin + "/",
        postLogoutRedirectUri: location.origin + "/",
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await app.initialize();
    const result = await app.handleRedirectPromise();
    account = (result && result.account) || app.getAllAccounts()[0] || null;
    return user();
  }

  function user() {
    if (!account) return null;
    const claims = account.idTokenClaims || {};
    return {
      name: account.name || claims.name || "",
      email: String(claims.email || account.username || "").toLowerCase(),
      isAdmin: Array.isArray(claims.roles) && claims.roles.includes(ADMIN_ROLE),
    };
  }

  function signIn() {
    return app.loginRedirect({ scopes: SCOPES, redirectStartPage: location.href });
  }

  function signOut() {
    return app.logoutRedirect({ account });
  }

  // The ID token lasts about an hour. Ask for a new one shortly before it runs out.
  async function token() {
    const exp = (account && account.idTokenClaims && account.idTokenClaims.exp) || 0;
    const forceRefresh = exp * 1000 - Date.now() < 5 * 60 * 1000;
    try {
      const result = await app.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh });
      account = result.account || account;
      return result.idToken;
    } catch (err) {
      // The session has ended, so the person needs to sign in again.
      await signIn();
      throw err;
    }
  }

  window.Auth = { start, signIn, signOut, token, user };
})();
