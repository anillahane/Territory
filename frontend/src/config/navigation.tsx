import type { ReactElement } from 'react';
import {
  Business as BusinessIcon,
  Calculate as CalculateIcon,
  CloudUpload as CloudUploadIcon,
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  TableChart as TableChartIcon,
} from '@mui/icons-material';
import type { Role } from '../services/api';

export type NavItem = {
  path: string;
  label: string;
  icon: ReactElement;
  roles?: Role[];
};

export type NavSection = {
  title: 'MAP' | 'DATA' | 'OPERATIONS' | 'ADMIN';
  items: NavItem[];
};

export const navigationSections: NavSection[] = [
  {
    title: 'MAP',
    items: [
      { path: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    ],
  },
  {
    title: 'DATA',
    items: [
      { path: '/branches', label: 'Branches', icon: <BusinessIcon /> },
      { path: '/mappings', label: 'Customer Pocket Mappings', icon: <TableChartIcon /> },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { path: '/batch', label: 'Batch Processing', icon: <CloudUploadIcon /> },
    ],
  },
  {
    title: 'ADMIN',
    items: [
      { path: '/calculator', label: 'Pocket ID Calculator', icon: <CalculateIcon />, roles: ['admin'] },
      { path: '/config', label: 'System Configuration', icon: <SettingsIcon />, roles: ['admin'] },
    ],
  },
];
