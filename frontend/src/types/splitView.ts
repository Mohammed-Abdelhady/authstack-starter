import type { HTMLAttributes, ReactNode } from 'react';
import type { SafeMarkupProps } from './markup';

export interface SplitViewProps extends Omit<
  SafeMarkupProps<HTMLAttributes<HTMLDivElement>>,
  'content'
> {
  sidebar: ReactNode;
  content: ReactNode;
  sidebarLabel?: string;
  sidebarWidth?: string;
  stickySidebar?: boolean;
}
