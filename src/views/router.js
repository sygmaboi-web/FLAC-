const normalizePath = path => {
  if (!path || path === '/') return '/app';
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
};

export const parseRoute = pathName => {
  const path = normalizePath(pathName);
  const shareMatch = path.match(/^\/share\/([^/]+)$/);
  if (shareMatch) {
    return { name: 'share', params: { token: shareMatch[1] } };
  }
  if (path === '/auth') return { name: 'auth', params: {} };
  if (path === '/app') return { name: 'app', params: {} };
  return { name: 'app', params: {} };
};

export const navigate = (path, { replace = false } = {}) => {
  const target = normalizePath(path);
  if (replace) {
    window.history.replaceState({}, '', target);
  } else {
    window.history.pushState({}, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
};
