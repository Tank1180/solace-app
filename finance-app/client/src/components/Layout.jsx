import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pendingRetirementCount, setPendingRetirementCount] = useState(0);
  const [pendingCashAllocationCount, setPendingCashAllocationCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/investments/retirement-allocations');
      const pendingAllocation = (data.paychecks || []).filter((paycheck) => Number(paycheck.remaining_amount || 0) > 0);
      const pendingShares = data.pendingShareAllocations || [];
      setPendingRetirementCount(pendingAllocation.length + pendingShares.length);
    } catch {
      setPendingRetirementCount(0);
    }
    try {
      const { data } = await api.get('/cash-accounts/allocations');
      const pendingPaychecks = (data.paychecks || []).filter((p) => Number(p.remaining_amount || 0) > 0);
      const pendingIncome = (data.otherIncome || []).filter((oi) => Number(oi.remaining_amount || 0) > 0);
      setPendingCashAllocationCount(pendingPaychecks.length + pendingIncome.length);
    } catch {
      setPendingCashAllocationCount(0);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    window.addEventListener('retirement-reminders-changed', loadNotifications);
    window.addEventListener('cash-allocation-reminders-changed', loadNotifications);
    window.addEventListener('focus', loadNotifications);
    return () => {
      window.removeEventListener('retirement-reminders-changed', loadNotifications);
      window.removeEventListener('cash-allocation-reminders-changed', loadNotifications);
      window.removeEventListener('focus', loadNotifications);
    };
  }, [loadNotifications]);

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
          <NavLink to="/investments" className="nav-link-with-badge">
            <span>Investments</span>
            {pendingRetirementCount > 0 && <span className="nav-badge" title="Retirement contributions or share counts need attention">{pendingRetirementCount}</span>}
          </NavLink>
          <NavLink to="/other-income">Other Income</NavLink>
          <NavLink to="/cash-accounts" className="nav-link-with-badge">
            <span>Cash Accounts</span>
            {pendingCashAllocationCount > 0 && <span className="nav-badge" title="Paychecks or other income awaiting a destination account">{pendingCashAllocationCount}</span>}
          </NavLink>
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
