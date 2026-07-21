import { lazy } from 'preact-iso';

// components that should remain eagerly loaded
import Ticket from './pages/user/Ticket';
import TicketHistory from './pages/user/TicketHistory';

// everything else is code-split by default
export const MainLayout = lazy(() => import('./layout/MainLayout'));
export const AdminLayout = lazy(() => import('./layout/AdminLayout'));
export const ScanLayout = lazy(() => import('./layout/ScanLayout'));
export const JuniorLayout = lazy(() => import('./layout/JuniorLayout'));

export const Home = lazy(() => import('./pages/user/Home'));
export const Performances = lazy(() => import('./pages/user/Performances'));
export const FAQ = lazy(() => import('./pages/user/FAQ'));
export const TimeTable = lazy(() => import('./pages/user/TimeTable'));
export const Map = lazy(() => import('./pages/user/Map'));
export const Pamphlet = lazy(() => import('./pages/user/Pamphlet'));
export const Info = lazy(() => import('./pages/user/Info'));
export const DayTicketIssue = lazy(() => import('./pages/user/dayTickets/DayTicketIssue'));
export const DayTicketIssueResult = lazy(() => import('./pages/user/dayTickets/DayTicketIssueResult'));
export const Students = lazy(() => import('./pages/user/students/Students'));
export const AdminHome = lazy(() => import('./pages/admin/AdminHome'));
export const Scan = lazy(() => import('./pages/admin/Scan'));
export const Register = lazy( () => import('./pages/admin/Register'));
export const ScanHistory = lazy(() => import('./pages/admin/ScanHistory'));
export const Settings = lazy(() => import('./pages/admin/Settings'));
export const StudentAccounts = lazy(() => import('./pages/admin/StudentAccounts'));
export const JuniorAccounts = lazy(() => import('./pages/admin/JuniorAccounts'));
export const Junior = lazy(() => import('./pages/user/junior/Junior'));
export const SecretBase = lazy(() => import('./pages/easteregg/SecretBase'));
export const MiniGame = lazy(() => import('./pages/easteregg/MiniGame'));


// re-export the eagerly-loaded routes so callers can treat them uniformly
export { Ticket, TicketHistory };

// utility for preloading a lazy component when a link is hovered
export function preload(...components: Array<{ preload?: () => Promise<unknown> }>) {
  components.forEach((c) => c.preload && c.preload());
}
