export const html = (strings, ...values) => {
  return strings.reduce((acc, part, index) => `${acc}${part}${values[index] ?? ''}`, '');
};

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const mount = (root, content) => {
  root.innerHTML = content;
};

export const setText = (selector, text, root = document) => {
  const el = qs(selector, root);
  if (el) el.textContent = text;
};
