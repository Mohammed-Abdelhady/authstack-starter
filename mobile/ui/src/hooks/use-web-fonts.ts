import { useContext } from 'react';
import { FontsContext } from '../context/fonts-context';

export function useWebFonts(): boolean {
  return useContext(FontsContext);
}
