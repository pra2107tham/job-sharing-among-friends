// Fed from @jobdrop/contracts tokens so there is exactly one source of truth for
// colour and spacing. Do not add raw values here — add them to
// packages/contracts/src/tokens.json and reference them.

const tokens = require('../../packages/contracts/src/tokens.json');

const px = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, `${v}px`]));

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: tokens.palette,
      spacing: px(tokens.space),
      borderRadius: px(tokens.radius),
      fontSize: px(tokens.fontSize),
    },
  },
  plugins: [],
};
