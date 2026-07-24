import { darkTheme, lightTheme, type Theme } from '@jobdrop/contracts';
import { useColorScheme } from 'react-native';

/**
 * For the places that need theme values imperatively rather than as Tailwind
 * classes — navigator options, status bar, anything crossing into React
 * Navigation. Screens should prefer `className` with `dark:` variants.
 */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}

export { darkTheme, lightTheme };
export type { Theme };
