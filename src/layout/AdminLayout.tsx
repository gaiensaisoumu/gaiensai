import type { ComponentChildren } from 'preact';
import AdminFooter from '../components/AdminFooter';
import Header from '../components/Header';
import { NoIndexMeta } from '../components/NoIndexMeta';

const AdminLayout = ({ children }: { children: ComponentChildren }) => {
  return (
    <>
      <NoIndexMeta />
      <Header linkTo='/admin/' isAdmin>
        {' '}
        管理画面
      </Header>
      <main>{children}</main>
      <AdminFooter />
    </>
  );
};

export default AdminLayout;
