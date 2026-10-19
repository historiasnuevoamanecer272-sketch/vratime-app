import { createContext } from 'react';

export const AppNavigationContext = createContext({ activeTab: 'map', registerOverlay: () => () => {} });
