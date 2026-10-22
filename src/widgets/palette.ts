import { colors, magnets, paper } from '../ui/tokens.ts';

/** JSON-only palette shared with the web app; resolved before widget rendering. */
export const widgetColors = {
  wall: colors.wall,
  paper: paper[0],
  taskPaper: paper[1],
  ink: colors.ntx,
  muted: colors.mu,
  accent: colors.ac,
  papers: [...paper],
  magnets: [...magnets],
};

export type WidgetColors = {
  readonly wall: string;
  readonly paper: string;
  readonly taskPaper: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly papers: readonly string[];
  readonly magnets: readonly string[];
};
