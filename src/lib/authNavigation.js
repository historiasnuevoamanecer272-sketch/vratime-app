export const createGoogleSignInRequest = (redirectTo) => ({
  provider: 'google',
  options: {
    redirectTo,
    queryParams: { prompt: 'select_account' },
  },
});
