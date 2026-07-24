import { HIT_SLOP } from '@jobdrop/contracts';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * The small set of primitives every screen is built from.
 *
 * Keeping them here rather than styling ad hoc is what makes the app feel like
 * one product. If a screen needs a variant that does not exist, add it here.
 */

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-ink900" edges={['top', 'bottom']}>
      <View className={`flex-1 px-lg ${className}`}>{children}</View>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-ink900 dark:text-ink50">{children}</Text>;
}

export function Body({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Text className={`text-base text-ink500 dark:text-ink300 ${className}`}>{children}</Text>;
}

type ButtonProps = PressableProps & {
  label: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading, disabled, ...rest }: ButtonProps) {
  const isPrimary = variant === 'primary';
  const base = 'h-[52px] items-center justify-center rounded-lg px-lg';
  const look = isPrimary
    ? 'bg-accent500 dark:bg-accent300'
    : 'border border-ink100 bg-white dark:border-ink700 dark:bg-ink900';
  const textLook = isPrimary ? 'text-white dark:text-ink900' : 'text-ink900 dark:text-ink50';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      hitSlop={HIT_SLOP - 52 > 0 ? HIT_SLOP - 52 : 0}
      disabled={disabled || loading}
      // Opacity feedback rather than a scale animation: the press must feel
      // immediate, and doc 1 §4.3 budgets no animation on the send path.
      className={`${base} ${look} ${disabled || loading ? 'opacity-50' : 'active:opacity-80'}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#FFFFFF' : '#615B54'} />
      ) : (
        <Text className={`text-base font-semibold ${textLook}`}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Empty states carry real weight here — at M0 every tab is empty, and during
 * normal use a quiet group is common. They should say what to do next, not just
 * report absence.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center px-xl">
      <Text className="text-center text-lg font-semibold text-ink900 dark:text-ink50">{title}</Text>
      <Text className="mt-sm text-center text-sm text-ink500 dark:text-ink300">{hint}</Text>
      {action ? <View className="mt-lg w-full">{action}</View> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator />
    </View>
  );
}
