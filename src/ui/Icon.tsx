import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { colors } from './tokens.ts';

export type IconName = ComponentProps<typeof Feather>['name'];

/**
 * Iconos de línea fina del mismo color que el texto (nunca emojis).
 * Feather usa trazo de 2 px; a 16–18 px se lee como línea fina.
 */
export function Icon({ name, size = 18, color = colors.tx }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}
