import {
  ErrorBoundary,
  LocationProvider,
  Route,
  Router,
  useLocation,
} from 'preact-iso';

import { ScrollToTop } from './utils/ScrollToTop';
import { useEffect } from 'preact/hooks';
import {
  FAQ,
  Junior,
  JuniorAccounts,
  preload,
  ScanHistory,
  TimeTable,
  Settings,
  StudentAccounts,
} from './routes';
import LineCallback from './features/auth/Line';
import NotFound from './shared/NotFound';

// route components; Ticket and TicketHistory are still eager
import {
  MainLayout,
  AdminLayout,
  ScanLayout,
  Home,
  Performances,
  DayTicketIssue,
  DayTicketIssueResult,
  Students,
  AdminHome,
  Scan,
  Register,
  Ticket,
  TicketHistory,
} from './routes';

import './styles/color-settings.css';
import './styles/index.css';
import subPageStyles from './styles/sub-pages.module.css';
import { useTicketCleanup } from './features/tickets/useTicketCleanup';

const userPageLayout = () => (
  <MainLayout>
    <div className={subPageStyles.subPageShell}>
      <Router>
        <Route path='/' component={HomePageLayout} />
        <Route path='/t' component={TicketHistory} />
        <Route path='/t/:id' component={Ticket} />
        <Route path='/day-tickets/result' component={DayTicketIssueResult} />
        <Route path='/day-tickets' component={DayTicketIssue} />
        <Route path='/performances' component={Performances} />
        <Route path='/faq' component={FAQ} />
        <Route path='/timetable' component={TimeTable} />
        <Route path='/auth/line/callback' component={LineCallback} />
        <Route default component={NotFound} />
      </Router>
    </div>
  </MainLayout>
);

const AdminPageLayout = () => (
  <AdminLayout>
    <div className={subPageStyles.subPageShell}>
      <Router>
        <Route path='/' component={AdminHome} />
        <Route path='/register' component={Register} />
        <Route path='/history' component={ScanHistory} />
        <Route path='settings' component={Settings} />
        <Route path='/student-accounts' component={StudentAccounts} />
        <Route path='/junior-accounts' component={JuniorAccounts} />
        <Route default component={NotFound} />
      </Router>
    </div>
  </AdminLayout>
);

const AdminScanLayout = () => (
  <ScanLayout>
    <Scan />
  </ScanLayout>
);

const HomePageLayout = () => (
  <MainLayout>
    <Home />
  </MainLayout>
);

const InnerApp = () => {
  const { path } = useLocation();

  // when the app first mounts (or path changes) prefetch the chunk for the current route
  useEffect(() => {
    if (path === '/' || path === '') {
      preload(Home);
    } else if (path.startsWith('/students')) {
      preload(Students);
    } else if (path.startsWith('/junior')) {
      preload(Junior);
    } else if (path.startsWith('/day-tickets')) {
      preload(DayTicketIssue, DayTicketIssueResult);
    } else if (path.startsWith('/performances')) {
      preload(Performances);
    } else if (path.startsWith('/faq')) {
      preload(FAQ);
    } else if (path.startsWith('/timetable')) {
      preload(TimeTable);
    }
    else if (path.startsWith('/admin/scan')) {
      preload(AdminLayout, ScanLayout, Scan, AdminHome);
    } else if (path.startsWith('/admin')) {
      preload(AdminLayout, AdminHome);
    }
  }, [path]);

  return (
    <Router>
      <Route path='/' component={HomePageLayout} />
      <Route path='/students' component={Students} />
      <Route path='/students/*' component={Students} />
      <Route path='/admin/scan' component={AdminScanLayout} />
      <Route path='/admin/*' component={AdminPageLayout} />
      <Route path='/admin' component={AdminPageLayout} />
      <Route path='/junior/*' component={Junior} />
      <Route path='/junior' component={Junior} />
      <Route path='/*' component={userPageLayout} />
      <Route default component={NotFound} />
    </Router>
  );
};

const App = () => {
  useTicketCleanup();
  return (
    <LocationProvider>
      <ScrollToTop />
      <ErrorBoundary>
        <InnerApp />
      </ErrorBoundary>
    </LocationProvider>
  );
};

export default App;
