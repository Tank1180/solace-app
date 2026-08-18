import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/solace-logo.png" alt="Solace" className="brand-logo" />
        </div>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/paychecks">Paychecks</NavLink>
          <NavLink to="/transactions">Spending</NavLink>
          <NavLink to="/bills">Bills</NavLink>
          <NavLink to="/investments">Investments</NavLink>
          <NavLink to="/other-income">Other Income</NavLink>
          {user?.customer_type === 'business' && <NavLink to="/business">Business Center</NavLink>}
          <NavLink to="/tax">Tax Center</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/subscription">Subscription</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/tax">Tax Config</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/subscriptions">Subscriptions</NavLink>}
        </nav>
        <div className="user-info">
          <span>{user?.email}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
