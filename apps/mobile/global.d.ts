// The Tailwind entrypoint is imported for its side effect; Metro handles it via
// the NativeWind transformer, but TypeScript needs to be told it is a module.
declare module '*.css';
